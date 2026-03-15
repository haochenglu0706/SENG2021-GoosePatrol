import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" });


const DESPATCH_TABLE = process.env.DESPATCH_TABLE_NAME ?? "DespatchAdvices";
const RECEIPT_TABLE  = process.env.RECEIPT_TABLE_NAME  ?? "ReceiptAdvices";

// ---------------------------------------------------------------------------
// GET /receipt-advices/{receiptAdviceId}
// Obtain the Receipt Advice document
// ---------------------------------------------------------------------------
export async function getReceiptAdvice(event: any) {
  // 1. Extract path parameter
  const receiptAdviceId: string | undefined =
    event.pathParameters?.receiptAdviceId;

  if (!receiptAdviceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "receiptAdviceId path parameter is required",
      }),
    };
  }

  // 2. Look up the receipt advice — 404 if not found
  let receiptItem: Record<string, any>;
  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: RECEIPT_TABLE,
        Key: marshall({ receiptAdviceId }),
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "NotFound",
          message: `Receipt advice '${receiptAdviceId}' not found`,
        }),
      };
    }

    receiptItem = unmarshall(result.Item);
  } catch (err) {
    console.error("DynamoDB GetItem (ReceiptAdvices) error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "InternalServerError", message: "Unexpected error" }),
    };
  }

  // 3. 409 if already fully received
  if (receiptItem.documentStatusCode === "FULLY_RECEIVED") {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: "Conflict",
        message: "This receipt advice has already been fully received",
      }),
    };
  }

  // 4. Return the receipt advice document
  return {
    statusCode: 200,
    body: JSON.stringify(receiptItem),
  };
}

// ---------------------------------------------------------------------------
// POST /despatch-advices/{despatchAdviceId}/receipt-advices
// Delivery party confirms receipt or reports discrepancies.
// ---------------------------------------------------------------------------
export async function createReceiptAdvice(event: any) {
  // 1. Extract path parameter
  const despatchAdviceId: string | undefined =
    event.pathParameters?.despatchAdviceId;

  if (!despatchAdviceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "despatchAdviceId path parameter is required",
      }),
    };
  }

  // 2. Parse request body
  let body: any;
  try {
    body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body ?? {};
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "Invalid JSON body",
      }),
    };
  }

  // 3. Validate receiptLines
  const { receiptLines } = body as { receiptLines?: any[] };

  if (!Array.isArray(receiptLines) || receiptLines.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "receiptLines must be a non-empty array",
      }),
    };
  }

  for (const line of receiptLines) {
    if (line.receivedQuantity === undefined || line.receivedQuantity === null) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "BadRequest",
          message: "Each receiptLine must include receivedQuantity",
        }),
      };
    }
    if (typeof line.receivedQuantity !== "number") {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "BadRequest",
          message: "receivedQuantity must be a number",
        }),
      };
    }
  }

  // 4. Look up the despatch advice — 404 if not found
  let despatchItem: Record<string, any>;
  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: DESPATCH_TABLE,
        Key: marshall({ despatchAdviceId }),
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "NotFound",
          message: `Despatch advice '${despatchAdviceId}' not found`,
        }),
      };
    }

    despatchItem = unmarshall(result.Item);
  } catch (err) {
    console.error("DynamoDB GetItem (DespatchAdvices) error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "InternalServerError", message: "Unexpected error" }),
    };
  }

  // 5. 409 if already fully received
  if (despatchItem.status === "RECEIVED") {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: "Conflict",
        message: "This despatch advice has already been fully received",
      }),
    };
  }

  // 6. Build and persist the ReceiptAdvice record
  const receiptAdviceId = uuidv4();
  const issueDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const receiptAdviceItem = {
    receiptAdviceId,
    despatchAdviceId,
    issueDate,
    documentStatusCode: "RECEIVED",
    receiptLines: receiptLines.map((line: any) => ({
      id: line.id ?? uuidv4(),
      receivedQuantity: line.receivedQuantity,
      ...(line.receivedQuantityUnitCode !== undefined && {
        receivedQuantityUnitCode: line.receivedQuantityUnitCode,
      }),
      ...(line.shortQuantity !== undefined && {
        shortQuantity: line.shortQuantity,
      }),
      ...(line.shortQuantityUnitCode !== undefined && {
        shortQuantityUnitCode: line.shortQuantityUnitCode,
      }),
      ...(line.note !== undefined && { note: line.note }),
      ...(line.item !== undefined && { item: line.item }),
    })),
    // Forward party IDs from the despatch if present
    ...(despatchItem.senderId && { submitterId: despatchItem.receiverId }),
    ...(despatchItem.receiverId && { receiverId: despatchItem.senderId }),
  };

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: RECEIPT_TABLE,
        Item: marshall(receiptAdviceItem, { removeUndefinedValues: true }),
      })
    );
  } catch (err) {
    console.error("DynamoDB PutItem (ReceiptAdvices) error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "InternalServerError", message: "Unexpected error" }),
    };
  }

  // 7. Update despatch advice status to RECEIVED
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: DESPATCH_TABLE,
        Key: marshall({ despatchAdviceId }),
        UpdateExpression: "SET #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: marshall({ ":s": "RECEIVED" }),
      })
    );
  } catch (err) {
    // Non-fatal — the receipt advice was already saved; log and continue.
    console.error("DynamoDB UpdateItem (DespatchAdvices) error:", err);
  }

  // 8. Return success
  return {
    statusCode: 200,
    body: JSON.stringify({ receiptAdviceId }),
  };
}
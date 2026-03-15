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

  //3. 409 if already fully received
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
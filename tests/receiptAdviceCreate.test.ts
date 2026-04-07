import { jest } from "@jest/globals";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall } from "@aws-sdk/util-dynamodb";

jest.unstable_mockModule("../src/routes/auth.js", () => ({
  verifySession: jest.fn(),
}));

const { createReceiptAdvice } = await import("../src/routes/receiptAdvice.js");
const { verifySession } = await import("../src/routes/auth.js");

const ddbMock = mockClient(DynamoDBClient);

const SESSION_CLIENT = "session-client-1";

const mockVerifySession = verifySession as unknown as jest.MockedFunction<
  (sessionId: string | undefined) => Promise<string | false>
>;

beforeEach(() => {
  ddbMock.reset();
  mockVerifySession.mockReset();
  mockVerifySession.mockResolvedValue(SESSION_CLIENT);
});

const REQ_POSTAL = {
  streetName: "1 Warehouse Rd",
  cityName: "Sydney",
  postalZone: "2000",
  countryIdentificationCode: "AU",
};

const REQ_ORDER_REF = { id: "ORD-001" };

const MINIMAL_RECEIPT_LINE = {
  id: "line-1",
  receivedQuantity: 5,
  receivedQuantityUnitCode: "EA",
  item: { name: "Widget", description: "A widget" },
};

/** Matches swagger.yaml ReceiptAdviceCreateRequest required fields */
const VALID_RECEIPT_BODY = {
  documentId: "RA-DOC-001",
  senderId: "sender-1",
  receiverId: "receiver-1",
  copyIndicator: false,
  documentStatusCode: "RECEIVED",
  orderReference: REQ_ORDER_REF,
  despatchSupplierParty: {
    party: {
      name: "Supplier Co",
      postalAddress: REQ_POSTAL,
    },
  },
  deliveryCustomerParty: {
    party: {
      name: "Buyer Co",
      postalAddress: REQ_POSTAL,
    },
  },
  shipment: {
    id: "SHIP-1",
    consignmentId: "CONS-1",
    delivery: {},
  },
  receiptLines: [MINIMAL_RECEIPT_LINE],
};

const makeDespatchItem = (status = "DESPATCHED") =>
  marshall(
    {
      despatchAdviceId: "DESPATCH-001",
      status,
      senderId: "SUPPLIER-1",
      receiverId: SESSION_CLIENT,
    },
    { removeUndefinedValues: true }
  );

const makeEvent = (despatchAdviceId: string, body: Record<string, unknown>) => ({
  httpMethod: "POST",
  path: `/despatch-advices/${despatchAdviceId}/receipt-advices`,
  pathParameters: { despatchAdviceId },
  headers: { sessionId: "test-session" },
  body: JSON.stringify(body),
});

describe("createReceiptAdvice", () => {
  test("returns 400 when despatchAdviceId is missing", async () => {
    const event = {
      httpMethod: "POST",
      path: "/despatch-advices//receipt-advices",
      pathParameters: {},
      body: "{}",
    };
    const res = await createReceiptAdvice(event);
    expect(res.statusCode).toBe(400);
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  test("returns 401 when session is missing or invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await createReceiptAdvice({
      httpMethod: "POST",
      path: "/despatch-advices/DESPATCH-001/receipt-advices",
      pathParameters: { despatchAdviceId: "DESPATCH-001" },
      headers: {},
      body: JSON.stringify(VALID_RECEIPT_BODY),
    });
    expect(res.statusCode).toBe(401);
  });

  test("returns 401 when caller may not create receipt for this despatch", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        despatchAdviceId: "DESPATCH-001",
        status: "DESPATCHED",
        receiverId: "someone-else",
        senderId: "SUPPLIER-1",
      }),
    });
    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(401);
  });

  test("returns 400 when body is invalid JSON", async () => {
    const event = {
      httpMethod: "POST",
      path: "...",
      pathParameters: { despatchAdviceId: "X" },
      headers: { sessionId: "s" },
      body: "not-json",
    };
    const res = await createReceiptAdvice(event);
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when documentId is missing", async () => {
    const { documentId: _d, ...rest } = VALID_RECEIPT_BODY;
    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", rest as Record<string, unknown>));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toMatch(/documentId/);
  });

  test("returns 400 when receiptLines is missing", async () => {
    const { receiptLines: _r, ...rest } = VALID_RECEIPT_BODY;
    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", rest as Record<string, unknown>));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toMatch(/receiptLines/);
  });

  test("returns 400 when receiptLines is empty", async () => {
    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", { ...VALID_RECEIPT_BODY, receiptLines: [] })
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when a receiptLine is missing receivedQuantity", async () => {
    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", {
        ...VALID_RECEIPT_BODY,
        receiptLines: [
          {
            id: "line-1",
            receivedQuantityUnitCode: "EA",
            item: { name: "W", description: "D" },
          },
        ],
      })
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toMatch(/receivedQuantity/);
  });

  test("returns 404 when despatch advice is not found by key or documentId", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(404);
  });

  test("returns 409 when despatch advice is already RECEIVED", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("RECEIVED") });

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(409);
  });

  test("returns 200 with receiptAdviceId on success", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("DESPATCHED") });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", {
        ...VALID_RECEIPT_BODY,
        receiptLines: [{ ...MINIMAL_RECEIPT_LINE, receivedQuantity: 10, shortQuantity: 2 }],
      })
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.receiptAdviceId).toBe("string");
    expect(body.receiptAdviceId.length).toBeGreaterThan(0);
  });

  test("resolves despatch by documentId when partition key GetItem misses", async () => {
    const despatchRow = {
      despatchAdviceId: "uuid-despatch-1",
      documentId: "DA-BY-DOC",
      status: "DESPATCHED",
      senderId: "SUPPLIER-1",
      receiverId: SESSION_CLIENT,
    };
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    ddbMock.on(ScanCommand).resolves({
      Items: [marshall(despatchRow)],
    });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(makeEvent("DA-BY-DOC", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(200);
    const putCalls = ddbMock.commandCalls(PutItemCommand);
    expect(putCalls.length).toBe(1);
    const putItem = putCalls[0].args[0].input.Item;
    expect(putItem?.despatchAdviceId?.S).toBe("uuid-despatch-1");
  });

  test("still returns 200 even when the status update fails (non-fatal)", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("DESPATCHED") });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).rejects(new Error("update failed"));

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));

    expect(res.statusCode).toBe(200);
  });

  test("returns 400 when receivedQuantity is not a number", async () => {
    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", {
        ...VALID_RECEIPT_BODY,
        receiptLines: [{ ...MINIMAL_RECEIPT_LINE, receivedQuantity: "five" as unknown as number }],
      })
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 500 when DynamoDB GetItem throws", async () => {
    ddbMock.on(GetItemCommand).rejects(new Error("connection error"));

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(500);
  });

  test("returns 500 when DynamoDB PutItem throws", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("DESPATCHED") });
    ddbMock.on(PutItemCommand).rejects(new Error("write error"));

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(500);
  });

  test("returns 400 when pathParameters is null", async () => {
    const res = await createReceiptAdvice({
      httpMethod: "POST",
      path: "/despatch-advices//receipt-advices",
      pathParameters: null,
      body: JSON.stringify(VALID_RECEIPT_BODY),
    });
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when pathParameters is undefined", async () => {
    const res = await createReceiptAdvice({
      httpMethod: "POST",
      path: "/despatch-advices//receipt-advices",
      body: JSON.stringify(VALID_RECEIPT_BODY),
    });
    expect(res.statusCode).toBe(400);
  });

  test("returns 401 when only supplier clientId matches — buyer must match receiverId", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        despatchAdviceId: "DESPATCH-001",
        status: "DESPATCHED",
        clientId: SESSION_CLIENT,
        receiverId: "other-buyer-client-id",
      }),
    });

    const res = await createReceiptAdvice(makeEvent("DESPATCH-001", VALID_RECEIPT_BODY));
    expect(res.statusCode).toBe(401);
  });

  test("handles receipt line with all optional fields present", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("DESPATCHED") });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", {
        ...VALID_RECEIPT_BODY,
        receiptLines: [
          {
            id: "line-1",
            receivedQuantity: 10,
            receivedQuantityUnitCode: "EA",
            shortQuantity: 2,
            shortQuantityUnitCode: "EA",
            note: "damaged",
            item: { name: "Widget", description: "A widget" },
          },
        ],
      })
    );
    expect(res.statusCode).toBe(200);
  });

  test("accepts documentID alias and normalises to documentId", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem("DESPATCHED") });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const { documentId: _omit, ...rest } = VALID_RECEIPT_BODY;
    const res = await createReceiptAdvice(
      makeEvent("DESPATCH-001", { ...rest, documentID: "RA-ALIAS-1" })
    );
    expect(res.statusCode).toBe(200);
  });
});

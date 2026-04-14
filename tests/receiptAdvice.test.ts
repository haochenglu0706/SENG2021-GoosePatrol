import { jest } from "@jest/globals";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { marshall } from "@aws-sdk/util-dynamodb";

jest.unstable_mockModule("../src/routes/auth.js", () => ({
  verifySession: jest.fn(),
}));

const { getReceiptAdvice } = await import("../src/routes/receiptAdvice.js");
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

const eventWithSession = (pathParameters: Record<string, string> | null) => ({
  pathParameters,
  headers: { sessionId: "test-session" },
});

describe("getReceiptAdvice", () => {
  test("returns 400 when receiptAdviceId is missing", async () => {
    const response = await getReceiptAdvice(eventWithSession(null));
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("BadRequest");
  });

  test("returns 401 when session is missing or invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const response = await getReceiptAdvice({
      pathParameters: { receiptAdviceId: "RECEIPT-001" },
      headers: {},
    });
    expect(response.statusCode).toBe(401);
    expect(ddbMock.commandCalls(GetItemCommand).length).toBe(0);
  });

  test("returns 404 when receipt advice not found", async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    const response = await getReceiptAdvice(
      eventWithSession({ receiptAdviceId: "INVALID-ID" })
    );
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("NotFound");
  });

  test("returns 401 when caller may not read this receipt", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        receiptAdviceId: "RECEIPT-001",
        despatchAdviceId: "DESPATCH-001",
        documentStatusCode: "RECEIVED",
        issueDate: "2026-03-15",
        senderId: "other-party",
        receiverId: "other-party-2",
      }),
    });
    const response = await getReceiptAdvice(
      eventWithSession({ receiptAdviceId: "RECEIPT-001" })
    );
    expect(response.statusCode).toBe(401);
  });

  test("returns 409 when already fully received", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        receiptAdviceId: "RECEIPT-001",
        despatchAdviceId: "DESPATCH-001",
        documentStatusCode: "FULLY_RECEIVED",
        issueDate: "2026-03-15",
        receiverId: SESSION_CLIENT,
      }),
    });
    const response = await getReceiptAdvice(
      eventWithSession({ receiptAdviceId: "RECEIPT-001" })
    );
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Conflict");
  });

  test("returns 200 with receipt advice document", async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        receiptAdviceId: "RECEIPT-001",
        despatchAdviceId: "DESPATCH-001",
        documentStatusCode: "RECEIVED",
        issueDate: "2026-03-15",
        receiverId: SESSION_CLIENT,
        receiptLines: [
          {
            id: "LINE-001",
            receivedQuantity: 10,
          },
        ],
      }),
    });
    const response = await getReceiptAdvice(
      eventWithSession({ receiptAdviceId: "RECEIPT-001" })
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.receiptAdviceId).toBe("RECEIPT-001");
    expect(body.documentStatusCode).toBe("RECEIVED");
  });

  test("returns 500 on DynamoDB error", async () => {
    ddbMock.on(GetItemCommand).rejects(new Error("DynamoDB connection error"));
    const response = await getReceiptAdvice(
      eventWithSession({ receiptAdviceId: "RECEIPT-001" })
    );
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("InternalServerError");
  });
});

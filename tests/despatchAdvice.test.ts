import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/db.js", () => ({
  dynamo: {
    send: jest.fn(),
  },
  CLIENTS_TABLE: "Clients",
  SESSIONS_TABLE: "Sessions",
  DESPATCH_ADVICES_TABLE: "DespatchAdvices",
}));

const { cancelFulfilment } = await import("../src/routes/despatchAdvice.js");
const { dynamo } = await import("../src/db.js");

const mockSend = dynamo.send as ReturnType<typeof jest.fn>;

describe("despatchAdvice", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe("cancelFulfilment", () => {
    test("returns 404 when despatch advice does not exist", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const res = await cancelFulfilment({}, "nonexistent-id");
      expect(res.statusCode).toBe(404);
    });

    test("returns 409 when despatch advice has already been received", async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          despatchAdviceId: { S: "abc-123" },
          status: { S: "RECEIVED" },
        },
      });

      const res = await cancelFulfilment({}, "abc-123");
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.message).toMatch(/received/i);
    });

    test("returns 409 when despatch advice has already been cancelled", async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          despatchAdviceId: { S: "abc-123" },
          status: { S: "FULFILMENT_CANCELLED" },
        },
      });

      const res = await cancelFulfilment({}, "abc-123");
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.message).toMatch(/cancelled/i);
    });

    test("returns 200 with FULFILMENT_CANCELLED status on success", async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: {
            despatchAdviceId: { S: "abc-123" },
            status: { S: "DESPATCHED" },
          },
        })
        .mockResolvedValueOnce({});

      const res = await cancelFulfilment({}, "abc-123");
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("FULFILMENT_CANCELLED");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});

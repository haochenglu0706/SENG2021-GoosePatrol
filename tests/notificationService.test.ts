import { jest } from "@jest/globals";
import { marshall } from "@aws-sdk/util-dynamodb";

const mockDynamoSend: jest.Mock = jest.fn();
const mockSesSend: jest.Mock = jest.fn();

jest.unstable_mockModule("../src/db.js", () => ({
  dynamo: {
    send: mockDynamoSend,
  },
  CLIENTS_TABLE: "Clients",
}));

jest.unstable_mockModule("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: mockSesSend,
  })),
  SendEmailCommand: class SendEmailCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

const {
  getClientEmail,
  notifyDocumentEvent,
  sendDocumentNotification,
} = await import("../src/services/notificationService.js");

describe("notificationService", () => {
  beforeEach(() => {
    mockDynamoSend.mockReset();
    mockSesSend.mockReset();
    delete process.env.NOTIFICATION_FROM_EMAIL;
  });

  test("getClientEmail returns email from Clients table", async () => {
    (mockDynamoSend as any).mockResolvedValueOnce({
      Item: marshall({ clientId: "c-1", email: "receiver@example.com" }),
    });

    const email = await getClientEmail("c-1");

    expect(email).toBe("receiver@example.com");
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  test("notifyDocumentEvent sends SES email when both client emails exist", async () => {
    process.env.NOTIFICATION_FROM_EMAIL = "verified-sender@example.com";

    (mockDynamoSend as any)
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "counterparty-1", email: "to@example.com" }),
      })
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "session-1", email: "from@example.com" }),
      });

    await notifyDocumentEvent({
      sessionClientId: "session-1",
      counterpartyClientId: "counterparty-1",
      documentType: "Despatch Advice",
      documentId: "DA-100",
      action: "created",
      summary: "New despatch advice DA-100 has been created for you.",
    });

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const command = mockSesSend.mock.calls[0][0] as {
      input: {
        Source: string;
        ReplyToAddresses?: string[];
        Destination: { ToAddresses: string[] };
        Message: { Subject: { Data: string } };
      };
    };
    expect(command.input.Source).toBe("verified-sender@example.com");
    expect(command.input.ReplyToAddresses).toEqual(["from@example.com"]);
    expect(command.input.Destination.ToAddresses).toEqual(["to@example.com"]);
    expect(command.input.Message.Subject.Data).toContain("Despatch Advice created");
  });

  test("notifyDocumentEvent uses NOTIFICATION_FROM_EMAIL when actor email is missing", async () => {
    process.env.NOTIFICATION_FROM_EMAIL = "noreply@goosepatrol.example.com";

    (mockDynamoSend as any)
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "counterparty-1", email: "to@example.com" }),
      })
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "session-1" }),
      });

    await notifyDocumentEvent({
      sessionClientId: "session-1",
      counterpartyClientId: "counterparty-1",
      documentType: "Receipt Advice",
      documentId: "RA-100",
      action: "received",
      summary: "Your despatch advice DA-100 has been received.",
    });

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const command = mockSesSend.mock.calls[0][0] as {
      input: {
        Source: string;
        ReplyToAddresses?: string[];
      };
    };
    expect(command.input.Source).toBe("noreply@goosepatrol.example.com");
    expect(command.input.ReplyToAddresses).toBeUndefined();
  });

  test("notifyDocumentEvent skips sending when NOTIFICATION_FROM_EMAIL is missing", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    (mockDynamoSend as any)
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "counterparty-1", email: "to@example.com" }),
      })
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "session-1", email: "from@example.com" }),
      });

    await notifyDocumentEvent({
      sessionClientId: "session-1",
      counterpartyClientId: "counterparty-1",
      documentType: "Invoice",
      documentId: "INV-101",
      action: "created",
      summary: "A new invoice INV-101 has been created for you.",
    });

    expect(mockSesSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("notifyDocumentEvent skips sending when recipient email is missing", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    (mockDynamoSend as any)
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({
        Item: marshall({ clientId: "session-1", email: "from@example.com" }),
      });

    await notifyDocumentEvent({
      sessionClientId: "session-1",
      counterpartyClientId: "counterparty-1",
      documentType: "Invoice",
      documentId: "INV-100",
      action: "created",
      summary: "A new invoice INV-100 has been created for you.",
    });

    expect(mockSesSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("sendDocumentNotification does not throw when SES send fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (mockSesSend as any).mockRejectedValueOnce(new Error("SES unavailable"));

    await expect(
      sendDocumentNotification({
        toEmail: "to@example.com",
        fromEmail: "from@example.com",
        documentType: "Invoice",
        documentId: "INV-500",
        action: "created",
        timestamp: new Date().toISOString(),
        summary: "A new invoice INV-500 has been created for you.",
      })
    ).resolves.toBeUndefined();

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});

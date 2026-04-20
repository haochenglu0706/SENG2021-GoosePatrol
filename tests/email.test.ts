import { jest } from "@jest/globals";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { mockClient } from "aws-sdk-client-mock";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

jest.unstable_mockModule("../src/routes/auth.js", () => ({
  verifySession: jest.fn(),
}));

jest.unstable_mockModule("../src/routes/despatchAdvice.js", () => ({
  exportDespatchAdviceAsUblXml: jest.fn(),
}));

jest.unstable_mockModule("../src/routes/receiptAdvice.js", () => ({
  exportReceiptAdviceAsUblXml: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic imports (ESM — must come after unstable_mockModule calls)
// ---------------------------------------------------------------------------

const {
  emailInvoiceUbl,
  emailDespatchUbl,
  emailReceiptUbl,
  sanitizeHeader,
  sanitizeBody,
  isValidEmail,
  buildRawMimeEmail,
} = await import("../src/routes/email.js");

const { verifySession } = await import("../src/routes/auth.js");
const { exportDespatchAdviceAsUblXml } = await import(
  "../src/routes/despatchAdvice.js"
);
const { exportReceiptAdviceAsUblXml } = await import(
  "../src/routes/receiptAdvice.js"
);

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockVerifySession = verifySession as unknown as jest.MockedFunction<
  (sessionId: string | undefined) => Promise<string | false>
>;

const mockExportDespatch =
  exportDespatchAdviceAsUblXml as unknown as jest.MockedFunction<
    (id: string) => Promise<{ statusCode: number; headers: any; body: string }>
  >;

const mockExportReceipt =
  exportReceiptAdviceAsUblXml as unknown as jest.MockedFunction<
    (
      id: string,
      event: any
    ) => Promise<{ statusCode: number; headers: any; body: string }>
  >;

// ---------------------------------------------------------------------------
// SES client mock
// ---------------------------------------------------------------------------

const sesMock = mockClient(SESClient);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice><ID>INV-TEST-001</ID></Invoice>`;

const UBL_OK = { statusCode: 200, headers: {}, body: SAMPLE_UBL };
const UBL_NOT_FOUND = {
  statusCode: 404,
  headers: {},
  body: JSON.stringify({ error: "NotFound", message: "Document not found" }),
};
const UBL_SERVER_ERROR = {
  statusCode: 500,
  headers: {},
  body: JSON.stringify({ error: "InternalServerError" }),
};

function makeInvoiceEvent(overrides: Record<string, unknown> = {}) {
  return {
    pathParameters: { invoiceId: "invoice-uuid-0001" },
    headers: {
      sessionId: "valid-session",
      invoiceToken: "tok-abc123",
    },
    body: JSON.stringify({ recipientEmail: "buyer@example.com" }),
    ...overrides,
  };
}

function makeDespatchEvent(overrides: Record<string, unknown> = {}) {
  return {
    headers: { sessionId: "valid-session" },
    body: JSON.stringify({ recipientEmail: "buyer@example.com" }),
    ...overrides,
  };
}

function makeReceiptEvent(overrides: Record<string, unknown> = {}) {
  return {
    pathParameters: { receiptAdviceId: "receipt-uuid-0001" },
    headers: { sessionId: "valid-session" },
    body: JSON.stringify({ recipientEmail: "buyer@example.com" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  sesMock.reset();
  mockVerifySession.mockReset();
  mockExportDespatch.mockReset();
  mockExportReceipt.mockReset();
  (globalThis as any).fetch = undefined;

  // Default: valid session resolves to a client ID
  mockVerifySession.mockResolvedValue("client-001");
  // Default: SES send succeeds
  sesMock.on(SendRawEmailCommand).resolves({ MessageId: "msg-001" });
});

// ===========================================================================
// Pure utility unit tests
// ===========================================================================

describe("sanitizeHeader", () => {
  test("returns the string unchanged when it has no control characters", () => {
    expect(sanitizeHeader("Hello World")).toBe("Hello World");
  });

  test("strips lone CR (\\r)", () => {
    expect(sanitizeHeader("Hello\rWorld")).toBe("Hello World");
  });

  test("strips lone LF (\\n)", () => {
    expect(sanitizeHeader("Hello\nWorld")).toBe("Hello World");
  });

  test("strips CRLF sequences", () => {
    expect(sanitizeHeader("Hello\r\nWorld")).toBe("Hello World");
  });

  test("strips null bytes", () => {
    expect(sanitizeHeader("Hello\x00World")).toBe("Hello World");
  });

  test("collapses multiple consecutive control chars into a single space", () => {
    expect(sanitizeHeader("Hello\r\n\r\nWorld")).toBe("Hello World");
  });

  test("neutralises CRLF injection attempt (Bcc header injection)", () => {
    const malicious = "Legit subject\r\nBcc: attacker@evil.com";
    const safe = sanitizeHeader(malicious);
    expect(safe).not.toContain("\r");
    expect(safe).not.toContain("\n");
    expect(safe).not.toContain("Bcc:");
  });
});

describe("sanitizeBody", () => {
  test("returns body unchanged when no null bytes present", () => {
    expect(sanitizeBody("Hello world")).toBe("Hello world");
  });

  test("strips null bytes", () => {
    expect(sanitizeBody("Hello\x00World")).toBe("HelloWorld");
  });

  test("preserves legitimate CRLF in body text", () => {
    expect(sanitizeBody("Line one\r\nLine two")).toBe("Line one\r\nLine two");
  });

  test("truncates body to MAX_MESSAGE_LENGTH (10 000 chars)", () => {
    const long = "a".repeat(15_000);
    expect(sanitizeBody(long).length).toBe(10_000);
  });
});

describe("isValidEmail", () => {
  test("accepts a standard email address", () => {
    expect(isValidEmail("buyer@example.com")).toBe(true);
  });

  test("accepts a subdomain email address", () => {
    expect(isValidEmail("user@mail.company.org")).toBe(true);
  });

  test("rejects an address with no @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });

  test("rejects an address with no domain part", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  test("rejects an address with no TLD", () => {
    expect(isValidEmail("user@domain")).toBe(false);
  });

  test("rejects an address exceeding 254 chars", () => {
    const long = "a".repeat(245) + "@b.com";
    expect(isValidEmail(long)).toBe(false);
  });

  test("rejects an address containing LF (CRLF injection via To: header)", () => {
    expect(isValidEmail("user@domain.com\nBcc:attack@evil.com")).toBe(false);
  });

  test("rejects an address containing CR", () => {
    expect(isValidEmail("user@domain.com\rBcc:x")).toBe(false);
  });

  test("rejects an address containing a null byte", () => {
    expect(isValidEmail("user\x00@domain.com")).toBe(false);
  });

  test("rejects a non-string value", () => {
    expect(isValidEmail(undefined as any)).toBe(false);
    expect(isValidEmail(null as any)).toBe(false);
    expect(isValidEmail(42 as any)).toBe(false);
  });
});

describe("buildRawMimeEmail", () => {
  const BASE_OPTS = {
    from: "noreply@example.com",
    to: "buyer@example.com",
    subject: "Test subject",
    bodyText: "Hello buyer",
    attachmentXml: SAMPLE_UBL,
    attachmentFilename: "invoice.xml",
  };

  test("output contains the correct To and Subject headers", () => {
    const raw = buildRawMimeEmail(BASE_OPTS);
    expect(raw).toContain("To: buyer@example.com");
    expect(raw).toContain("Subject: Test subject");
  });

  test("output contains the XML attachment encoded as base64", () => {
    const raw = buildRawMimeEmail(BASE_OPTS);
    const expectedB64 = Buffer.from(SAMPLE_UBL).toString("base64").slice(0, 20);
    expect(raw).toContain(expectedB64);
  });

  test("output uses CRLF line endings throughout", () => {
    const raw = buildRawMimeEmail(BASE_OPTS);
    // Every \n should be preceded by \r
    const loneLF = raw.replace(/\r\n/g, "").includes("\n");
    expect(loneLF).toBe(false);
  });

  test("CRLF injection in subject is neutralised", () => {
    const raw = buildRawMimeEmail({
      ...BASE_OPTS,
      subject: "Legit\r\nBcc: attacker@evil.com",
    });
    // The injected Bcc header must not appear as a standalone header line
    const lines = raw.split("\r\n");
    const bccLine = lines.find((l) => l.startsWith("Bcc:"));
    expect(bccLine).toBeUndefined();
  });

  test("subject is truncated to 200 chars", () => {
    const raw = buildRawMimeEmail({
      ...BASE_OPTS,
      subject: "S".repeat(300),
    });
    // Extract the Subject header line value
    const subjectLine = raw.split("\r\n").find((l) => l.startsWith("Subject:"))!;
    const subjectValue = subjectLine.replace("Subject: ", "");
    expect(subjectValue.length).toBeLessThanOrEqual(200);
  });

  test("base64 lines do not exceed 76 characters (RFC 2045)", () => {
    const raw = buildRawMimeEmail(BASE_OPTS);
    const b64Section = raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1];
    const b64Lines = b64Section.split("\r\n").filter((l) => /^[A-Za-z0-9+/=]+$/.test(l));
    for (const line of b64Lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

// ===========================================================================
// emailInvoiceUbl
// ===========================================================================

describe("emailInvoiceUbl — authentication", () => {
  test("returns 401 when sessionId header is absent", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await emailInvoiceUbl({
      pathParameters: { invoiceId: "inv-001" },
      headers: {},
      body: JSON.stringify({ recipientEmail: "x@x.com" }),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Unauthorized");
  });

  test("returns 401 when session token is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await emailInvoiceUbl(makeInvoiceEvent());
    expect(res.statusCode).toBe(401);
  });

  test("does not call SES when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    await emailInvoiceUbl(makeInvoiceEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailInvoiceUbl — input validation", () => {
  test("returns 400 when invoiceId path parameter is missing", async () => {
    const res = await emailInvoiceUbl({
      pathParameters: {},
      headers: { sessionId: "s", invoiceToken: "t" },
      body: JSON.stringify({ recipientEmail: "x@x.com" }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("BadRequest");
  });

  test("returns 400 when invoiceToken header is missing", async () => {
    const res = await emailInvoiceUbl({
      pathParameters: { invoiceId: "inv-001" },
      headers: { sessionId: "valid-session" },
      body: JSON.stringify({ recipientEmail: "x@x.com" }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/invoiceToken/i);
  });

  test("returns 400 when request body is missing", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({ body: null })
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when request body is not valid JSON", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({ body: "not { json" })
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when recipientEmail is missing", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({ body: JSON.stringify({}) })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/recipientEmail/i);
  });

  test("returns 400 when recipientEmail is not a valid address", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({ body: JSON.stringify({ recipientEmail: "notanemail" }) })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/valid email/i);
  });

  test("returns 400 when recipientEmail contains a CRLF injection attempt", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com\r\nBcc: attacker@evil.com",
        }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when subject is not a string", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({
        body: JSON.stringify({ recipientEmail: "x@x.com", subject: 42 }),
      })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("emailInvoiceUbl — upstream fetch errors", () => {
  test("propagates upstream non-OK status from Invoice API", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    });
    const res = await emailInvoiceUbl(makeInvoiceEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("UpstreamError");
  });

  test("returns 502 when fetch throws (network failure)", async () => {
    (globalThis as any).fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await emailInvoiceUbl(makeInvoiceEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe("BadGateway");
    expect(JSON.parse(res.body).message).toMatch(/ECONNREFUSED/);
  });

  test("does not call SES when upstream fetch fails", async () => {
    (globalThis as any).fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("timeout"));
    await emailInvoiceUbl(makeInvoiceEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailInvoiceUbl — SES failure", () => {
  test("returns 500 when SES send throws", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_UBL,
    });
    sesMock
      .on(SendRawEmailCommand)
      .rejects(new Error("SES: Address not verified"));

    const res = await emailInvoiceUbl(makeInvoiceEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe("EmailError");
    expect(JSON.parse(res.body).message).toMatch(/Address not verified/i);
  });
});

describe("emailInvoiceUbl — success", () => {
  beforeEach(() => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_UBL,
    });
  });

  test("returns 200 with correct response shape", async () => {
    const res = await emailInvoiceUbl(makeInvoiceEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invoiceId).toBe("invoice-uuid-0001");
    expect(body.recipientEmail).toBe("buyer@example.com");
    expect(body.message).toMatch(/emailed successfully/i);
  });

  test("calls SES exactly once", async () => {
    await emailInvoiceUbl(makeInvoiceEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(1);
  });

  test("passes the correct recipient to SES Destinations", async () => {
    await emailInvoiceUbl(makeInvoiceEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    expect(call.args[0].input.Destinations).toEqual(["buyer@example.com"]);
  });

  test("uses caller-supplied subject when provided", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com",
          subject: "Please pay ASAP",
        }),
      })
    );
    expect(res.statusCode).toBe(200);
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Subject: Please pay ASAP");
  });

  test("falls back to a default subject when subject is omitted", async () => {
    await emailInvoiceUbl(makeInvoiceEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Subject: eInvoice UBL Document");
  });

  test("uses caller-supplied message body when provided", async () => {
    const res = await emailInvoiceUbl(
      makeInvoiceEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com",
          message: "Please process urgently.",
        }),
      })
    );
    expect(res.statusCode).toBe(200);
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Please process urgently.");
  });

  test("raw MIME email contains the XML attachment", async () => {
    await emailInvoiceUbl(makeInvoiceEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Content-Type: application/xml");
  });

  test("CRLF-injected subject is sanitised before being sent via SES", async () => {
    await emailInvoiceUbl(
      makeInvoiceEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com",
          subject: "Normal\r\nBcc: attacker@evil.com",
        }),
      })
    );
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    // The injected Bcc header must not appear as a real header line
    const lines = rawEmail.split("\r\n");
    const bccLine = lines.find((l) => l.startsWith("Bcc:"));
    expect(bccLine).toBeUndefined();
  });
});

// ===========================================================================
// emailDespatchUbl
// ===========================================================================

describe("emailDespatchUbl — authentication", () => {
  test("returns 401 when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    expect(res.statusCode).toBe(401);
  });

  test("does not call SES when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailDespatchUbl — input validation", () => {
  test("returns 400 when body is absent", async () => {
    const res = await emailDespatchUbl(
      makeDespatchEvent({ body: null }),
      "despatch-001"
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when recipientEmail is missing", async () => {
    const res = await emailDespatchUbl(
      makeDespatchEvent({ body: JSON.stringify({}) }),
      "despatch-001"
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/recipientEmail/i);
  });

  test("returns 400 when recipientEmail is invalid", async () => {
    const res = await emailDespatchUbl(
      makeDespatchEvent({
        body: JSON.stringify({ recipientEmail: "bad-email" }),
      }),
      "despatch-001"
    );
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when recipientEmail contains control characters", async () => {
    const res = await emailDespatchUbl(
      makeDespatchEvent({
        body: JSON.stringify({ recipientEmail: "ok@ok.com\nBcc:x@x.com" }),
      }),
      "despatch-001"
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("emailDespatchUbl — UBL export errors", () => {
  test("propagates 404 when despatch document is not found", async () => {
    mockExportDespatch.mockResolvedValueOnce(UBL_NOT_FOUND);
    const res = await emailDespatchUbl(makeDespatchEvent(), "despatch-missing");
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("NotFound");
  });

  test("propagates 500 when UBL exporter encounters a server error", async () => {
    mockExportDespatch.mockResolvedValueOnce(UBL_SERVER_ERROR);
    const res = await emailDespatchUbl(makeDespatchEvent(), "despatch-broken");
    expect(res.statusCode).toBe(500);
  });

  test("does not call SES when UBL export fails", async () => {
    mockExportDespatch.mockResolvedValueOnce(UBL_NOT_FOUND);
    await emailDespatchUbl(makeDespatchEvent(), "despatch-missing");
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailDespatchUbl — SES failure", () => {
  test("returns 500 when SES send throws", async () => {
    mockExportDespatch.mockResolvedValueOnce(UBL_OK);
    sesMock
      .on(SendRawEmailCommand)
      .rejects(new Error("SES: Daily sending quota exceeded"));

    const res = await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe("EmailError");
    expect(JSON.parse(res.body).message).toMatch(/quota exceeded/i);
  });
});

describe("emailDespatchUbl — success", () => {
  beforeEach(() => {
    mockExportDespatch.mockResolvedValue(UBL_OK);
  });

  test("returns 200 with correct response shape", async () => {
    const res = await emailDespatchUbl(makeDespatchEvent(), "despatch-uuid-001");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.despatchId).toBe("despatch-uuid-001");
    expect(body.recipientEmail).toBe("buyer@example.com");
    expect(body.message).toMatch(/emailed successfully/i);
  });

  test("calls SES exactly once", async () => {
    await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(1);
  });

  test("passes the correct recipient to SES Destinations", async () => {
    await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    expect(call.args[0].input.Destinations).toEqual(["buyer@example.com"]);
  });

  test("uses caller-supplied custom subject", async () => {
    await emailDespatchUbl(
      makeDespatchEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com",
          subject: "Your order has shipped",
        }),
      }),
      "despatch-001"
    );
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Subject: Your order has shipped");
  });

  test("falls back to a default subject when subject is omitted", async () => {
    await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Subject: Despatch Advice UBL Document");
  });

  test("raw MIME email contains the XML attachment", async () => {
    await emailDespatchUbl(makeDespatchEvent(), "despatch-001");
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Content-Type: application/xml");
  });
});

// ===========================================================================
// emailReceiptUbl
// ===========================================================================

describe("emailReceiptUbl — authentication", () => {
  test("returns 401 when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await emailReceiptUbl(makeReceiptEvent());
    expect(res.statusCode).toBe(401);
  });

  test("does not call SES when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    await emailReceiptUbl(makeReceiptEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailReceiptUbl — input validation", () => {
  test("returns 400 when receiptAdviceId path parameter is missing", async () => {
    const res = await emailReceiptUbl({
      pathParameters: {},
      headers: { sessionId: "valid-session" },
      body: JSON.stringify({ recipientEmail: "x@x.com" }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/receiptAdviceId/i);
  });

  test("returns 400 when body is absent", async () => {
    const res = await emailReceiptUbl(makeReceiptEvent({ body: null }));
    expect(res.statusCode).toBe(400);
  });

  test("returns 400 when recipientEmail is missing", async () => {
    const res = await emailReceiptUbl(
      makeReceiptEvent({ body: JSON.stringify({}) })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/recipientEmail/i);
  });

  test("returns 400 when recipientEmail is invalid", async () => {
    const res = await emailReceiptUbl(
      makeReceiptEvent({
        body: JSON.stringify({ recipientEmail: "@missinglocal.com" }),
      })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("emailReceiptUbl — UBL export errors", () => {
  test("propagates 404 when receipt document is not found", async () => {
    mockExportReceipt.mockResolvedValueOnce(UBL_NOT_FOUND);
    const res = await emailReceiptUbl(makeReceiptEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("NotFound");
  });

  test("propagates 500 when UBL exporter encounters a server error", async () => {
    mockExportReceipt.mockResolvedValueOnce(UBL_SERVER_ERROR);
    const res = await emailReceiptUbl(makeReceiptEvent());
    expect(res.statusCode).toBe(500);
  });

  test("does not call SES when UBL export fails", async () => {
    mockExportReceipt.mockResolvedValueOnce(UBL_NOT_FOUND);
    await emailReceiptUbl(makeReceiptEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(0);
  });
});

describe("emailReceiptUbl — SES failure", () => {
  test("returns 500 when SES send throws", async () => {
    mockExportReceipt.mockResolvedValueOnce(UBL_OK);
    sesMock.on(SendRawEmailCommand).rejects(new Error("SES: Access denied"));

    const res = await emailReceiptUbl(makeReceiptEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe("EmailError");
    expect(JSON.parse(res.body).message).toMatch(/access denied/i);
  });
});

describe("emailReceiptUbl — success", () => {
  beforeEach(() => {
    mockExportReceipt.mockResolvedValue(UBL_OK);
  });

  test("returns 200 with correct response shape", async () => {
    const res = await emailReceiptUbl(makeReceiptEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.receiptAdviceId).toBe("receipt-uuid-0001");
    expect(body.recipientEmail).toBe("buyer@example.com");
    expect(body.message).toMatch(/emailed successfully/i);
  });

  test("calls SES exactly once", async () => {
    await emailReceiptUbl(makeReceiptEvent());
    expect(sesMock.commandCalls(SendRawEmailCommand).length).toBe(1);
  });

  test("passes the correct recipient to SES Destinations", async () => {
    await emailReceiptUbl(makeReceiptEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    expect(call.args[0].input.Destinations).toEqual(["buyer@example.com"]);
  });

  test("falls back to a default subject when subject is omitted", async () => {
    await emailReceiptUbl(makeReceiptEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Subject: Receipt Advice UBL Document");
  });

  test("uses caller-supplied custom message body", async () => {
    const res = await emailReceiptUbl(
      makeReceiptEvent({
        body: JSON.stringify({
          recipientEmail: "buyer@example.com",
          message: "Your goods have been received.",
        }),
      })
    );
    expect(res.statusCode).toBe(200);
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Your goods have been received.");
  });

  test("raw MIME email contains the XML attachment", async () => {
    await emailReceiptUbl(makeReceiptEvent());
    const call = sesMock.commandCalls(SendRawEmailCommand)[0];
    const rawEmail = call.args[0].input.RawMessage!.Data!.toString();
    expect(rawEmail).toContain("Content-Type: application/xml");
  });
});
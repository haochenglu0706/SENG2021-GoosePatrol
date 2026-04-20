import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { CORS_HEADERS } from "../cors.js";
import { verifySession } from "./auth.js";
import { exportDespatchAdviceAsUblXml } from "./despatchAdvice.js";
import { exportReceiptAdviceAsUblXml } from "./receiptAdvice.js";

const ses = new SESClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" });

const SENDER_EMAIL =
  process.env.SES_SENDER_EMAIL ?? "noreply@einvoice-goosepatrol.example.com";
const INVOICE_BASE =
  process.env.INVOICE_BASE_URL ?? "http://3.106.79.128:3000";

// ---------------------------------------------------------------------------
// Security limits
// ---------------------------------------------------------------------------

/** RFC 5321 §4.5.3.1.3 — forward-path max length. */
const MAX_EMAIL_LENGTH = 254;

/**
 * RFC 2822 §2.1.1 limits a header line to 998 chars. We apply a much tighter
 * cap to prevent long header-fold abuse and keep subjects readable.
 */
const MAX_SUBJECT_LENGTH = 200;

/** Reasonable cap on free-form body message to prevent abuse. */
const MAX_MESSAGE_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function getHeader(event: any, ...names: string[]): string | undefined {
  const headers = event?.headers ?? {};
  for (const name of names) {
    const v = headers[name];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function getSessionId(event: any): string | undefined {
  return getHeader(event, "sessionId", "sessionid", "session-id", "Session-Id");
}

function getInvoiceToken(event: any): string | undefined {
  return getHeader(event, "invoiceToken", "invoicetoken", "InvoiceToken");
}

function badRequest(message: string) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "BadRequest", message }),
  };
}

function unauthorized(message: string) {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized", message }),
  };
}

function parseBody(event: any): Record<string, unknown> | null {
  try {
    if (!event.body) return null;
    return typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Security: input sanitisation
// ---------------------------------------------------------------------------

/**
 * Strips carriage returns, line feeds, and null bytes from a string destined
 * for a MIME header field value.
 *
 * Without this, an attacker who controls a header field value can inject extra
 * headers or alter the recipient list by embedding CRLF sequences, e.g.:
 *   subject = "Hello\r\nBcc: attacker@evil.com"
 * would cause a second Bcc header to be injected into the raw MIME message,
 * silently forwarding every email to the attacker.
 */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

/**
 * Strips null bytes from free-form body text and enforces the message length
 * cap. CRLF is intentionally preserved here because it is valid plain-text
 * content (unlike in header fields, where it is a field terminator).
 */
export function sanitizeBody(value: string): string {
  return value.replace(/\0/g, "").slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Validates an email address:
 *   - Must be a string
 *   - Must not exceed RFC 5321 max length (254 chars)
 *   - Must not contain control characters (prevents CRLF injection via To: header)
 *   - Must match a basic local@domain.tld pattern
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  if (email.length > MAX_EMAIL_LENGTH) return false;
  // Any ASCII control character (0x00–0x1F, 0x7F) is illegal in a header value
  if (/[\x00-\x1F\x7F]/.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// MIME builder
// ---------------------------------------------------------------------------

/**
 * Builds a raw MIME multipart/mixed message with the UBL document attached as
 * application/xml. All caller-supplied strings are sanitised before they are
 * placed into header fields to prevent header-injection attacks.
 *
 * SES SendRawEmailCommand is required because SendEmailCommand does not support
 * file attachments.
 */
export function buildRawMimeEmail(opts: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  attachmentXml: string;
  attachmentFilename: string;
}): string {
  const boundary = `----=_GoosePatrol_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  // Every caller-supplied value that ends up in a header field is sanitised
  const safeSubject  = sanitizeHeader(opts.subject).slice(0, MAX_SUBJECT_LENGTH);
  const safeTo       = sanitizeHeader(opts.to);
  const safeFrom     = sanitizeHeader(opts.from);
  const safeBody     = sanitizeBody(opts.bodyText);
  const safeFilename = sanitizeHeader(opts.attachmentFilename);

  const xmlBase64 = Buffer.from(opts.attachmentXml, "utf-8").toString("base64");

  const lines: string[] = [
    `From: GoosePatrol eInvoicing <${safeFrom}>`,
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    safeBody,
    "",
    `--${boundary}`,
    `Content-Type: application/xml; name="${safeFilename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    "",
    // RFC 2045 §6.8 — base64 lines must not exceed 76 chars
    ...(xmlBase64.match(/.{1,76}/g) ?? [xmlBase64]),
    "",
    `--${boundary}--`,
  ];

  return lines.join("\r\n");
}

/**
 * Dispatches the raw MIME message via SES.
 */
async function sendViaSes(raw: string, to: string): Promise<void> {
  const command = new SendRawEmailCommand({
    Destinations: [to],
    RawMessage: { Data: Buffer.from(raw, "utf-8") },
  });
  await ses.send(command);
}

// ---------------------------------------------------------------------------
// Shared request validation
// ---------------------------------------------------------------------------

interface EmailBody {
  recipientEmail: string;
  subject?: string;
  message?: string;
}

function validateEmailBody(
  body: Record<string, unknown> | null
):
  | { ok: true; data: EmailBody }
  | { ok: false; response: ReturnType<typeof badRequest> } {
  if (!body) {
    return { ok: false, response: badRequest("Request body is required") };
  }

  const { recipientEmail, subject, message } = body as Record<string, unknown>;

  if (typeof recipientEmail !== "string" || !recipientEmail.trim()) {
    return { ok: false, response: badRequest("recipientEmail is required") };
  }

  if (!isValidEmail(recipientEmail.trim())) {
    return {
      ok: false,
      response: badRequest(
        "recipientEmail must be a valid email address " +
          "(max 254 chars, no control characters)"
      ),
    };
  }

  if (subject !== undefined && typeof subject !== "string") {
    return { ok: false, response: badRequest("subject must be a string") };
  }

  if (message !== undefined && typeof message !== "string") {
    return { ok: false, response: badRequest("message must be a string") };
  }

  return {
    ok: true,
    data: {
      recipientEmail: recipientEmail.trim(),
      subject: typeof subject === "string" ? subject : undefined,
      message: typeof message === "string" ? message : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /invoices/{invoiceId}/email
// ---------------------------------------------------------------------------

export async function emailInvoiceUbl(event: any) {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) return unauthorized("Invalid or missing session");

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  const invoiceToken = getInvoiceToken(event);
  if (!invoiceToken) {
    return badRequest(
      "An Invoice API token is required — pass it via the `invoiceToken` header"
    );
  }

  const validation = validateEmailBody(parseBody(event));
  if (!validation.ok) return validation.response;
  const { recipientEmail, subject, message } = validation.data;

  // Fetch UBL XML from upstream Invoice API
  let ublXml: string;
  try {
    const upstream = await fetch(
      `${INVOICE_BASE}/invoices/${encodeURIComponent(invoiceId)}/download`,
      { headers: { Authorization: `Bearer ${invoiceToken}` } }
    );
    if (!upstream.ok) {
      const text = await upstream.text();
      return {
        statusCode: upstream.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "UpstreamError",
          message: `Invoice API returned ${upstream.status}: ${text.slice(0, 200)}`,
        }),
      };
    }
    ublXml = await upstream.text();
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadGateway",
        message: `Failed to reach Invoice API: ${(err as Error).message}`,
      }),
    };
  }

  const emailSubject =
    subject?.trim() || `eInvoice UBL Document — ${invoiceId.slice(0, 8)}`;

  const emailBody =
    message?.trim() ||
    `Please find the UBL invoice document attached.\n\nInvoice ID: ${invoiceId}\n\nThis email was sent via Goose API eInvoicing.`;

  const raw = buildRawMimeEmail({
    from: SENDER_EMAIL,
    to: recipientEmail,
    subject: emailSubject,
    bodyText: emailBody,
    attachmentXml: ublXml,
    attachmentFilename: `invoice-${invoiceId.slice(0, 8)}.xml`,
  });

  try {
    await sendViaSes(raw, recipientEmail);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "EmailError",
        message: `Failed to send email via SES: ${(err as Error).message}`,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `UBL invoice document emailed successfully to ${recipientEmail}`,
      invoiceId,
      recipientEmail,
    }),
  };
}

// ---------------------------------------------------------------------------
// POST /despatch-advices/{despatchId}/email
// ---------------------------------------------------------------------------

export async function emailDespatchUbl(event: any, despatchId: string) {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) return unauthorized("Invalid or missing session");

  const validation = validateEmailBody(parseBody(event));
  if (!validation.ok) return validation.response;
  const { recipientEmail, subject, message } = validation.data;

  // Delegate to the existing UBL exporter; it handles DynamoDB lookup and
  // document-not-found / server errors. Non-200 responses are bubbled up as-is
  // so the caller receives the correct status code (404, 500, etc.).
  const ublResponse = await exportDespatchAdviceAsUblXml(despatchId);
  if (ublResponse.statusCode !== 200) {
    return ublResponse;
  }

  const ublXml: string = ublResponse.body;

  const emailSubject =
    subject?.trim() ||
    `Despatch Advice UBL Document — ${despatchId.slice(0, 8)}`;

  const emailBody =
    message?.trim() ||
    `Please find the UBL despatch advice document attached.\n\nDespatch ID: ${despatchId}\n\nThis email was sent via Goose API eInvoicing.`;

  const raw = buildRawMimeEmail({
    from: SENDER_EMAIL,
    to: recipientEmail,
    subject: emailSubject,
    bodyText: emailBody,
    attachmentXml: ublXml,
    attachmentFilename: `despatch-advice-${despatchId.slice(0, 8)}.xml`,
  });

  try {
    await sendViaSes(raw, recipientEmail);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "EmailError",
        message: `Failed to send email via SES: ${(err as Error).message}`,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `UBL despatch advice document emailed successfully to ${recipientEmail}`,
      despatchId,
      recipientEmail,
    }),
  };
}

// ---------------------------------------------------------------------------
// POST /receipt-advices/{receiptAdviceId}/email
// ---------------------------------------------------------------------------

export async function emailReceiptUbl(event: any) {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) return unauthorized("Invalid or missing session");

  const receiptAdviceId: string | undefined =
    event.pathParameters?.receiptAdviceId;
  if (!receiptAdviceId)
    return badRequest("receiptAdviceId path parameter is required");

  const validation = validateEmailBody(parseBody(event));
  if (!validation.ok) return validation.response;
  const { recipientEmail, subject, message } = validation.data;

  const ublResponse = await exportReceiptAdviceAsUblXml(receiptAdviceId, event);
  if (ublResponse.statusCode !== 200) {
    return ublResponse;
  }

  const ublXml: string = ublResponse.body;

  const emailSubject =
    subject?.trim() ||
    `Receipt Advice UBL Document — ${receiptAdviceId.slice(0, 8)}`;

  const emailBody =
    message?.trim() ||
    `Please find the UBL receipt advice document attached.\n\nReceipt Advice ID: ${receiptAdviceId}\n\nThis email was sent via Goose API eInvoicing.`;

  const raw = buildRawMimeEmail({
    from: SENDER_EMAIL,
    to: recipientEmail,
    subject: emailSubject,
    bodyText: emailBody,
    attachmentXml: ublXml,
    attachmentFilename: `receipt-advice-${receiptAdviceId.slice(0, 8)}.xml`,
  });

  try {
    await sendViaSes(raw, recipientEmail);
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "EmailError",
        message: `Failed to send email via SES: ${(err as Error).message}`,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `UBL receipt advice document emailed successfully to ${recipientEmail}`,
      receiptAdviceId,
      recipientEmail,
    }),
  };
}
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CORS_HEADERS } from "../cors.js";
import { dynamo, INVOICE_REFS_TABLE } from "../db.js";
import { verifySession } from "./auth.js";

const INVOICE_BASE =
  process.env.INVOICE_BASE_URL ?? "http://3.106.79.128:3000";

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

function unauthorized(message: string) {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized", message }),
  };
}

function badRequest(message: string) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "BadRequest", message }),
  };
}

function badGateway(message: string) {
  return {
    statusCode: 502,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "BadGateway", message }),
  };
}

async function authorise(event: any): Promise<
  | { ok: true; invoiceToken: string | undefined }
  | { ok: false; response: { statusCode: number; headers: any; body: string } }
> {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) {
    return { ok: false, response: unauthorized("Invalid or missing session") };
  }
  return { ok: true, invoiceToken: getInvoiceToken(event) };
}

async function proxy(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    invoiceToken?: string;
    expectXml?: boolean;
  } = {}
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const url = `${INVOICE_BASE}${path}`;

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.invoiceToken) headers["Authorization"] = `Bearer ${opts.invoiceToken}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    return badGateway(`Failed to reach Invoice API: ${(err as Error).message}`);
  }

  const text = await upstream.text();
  const responseHeaders: Record<string, string> = { ...CORS_HEADERS };

  if (opts.expectXml) {
    responseHeaders["Content-Type"] = "application/xml";
    return { statusCode: upstream.status, headers: responseHeaders, body: text };
  }

  responseHeaders["Content-Type"] = "application/json";
  try {
    JSON.parse(text);
    return { statusCode: upstream.status, headers: responseHeaders, body: text };
  } catch {
    return {
      statusCode: upstream.status,
      headers: responseHeaders,
      body: JSON.stringify({ message: text }),
    };
  }
}

function parseBody(event: any): unknown | { error: object } {
  if (event.body == null || event.body === "") return undefined;
  if (typeof event.body !== "string") return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return { error: badRequest("Invalid JSON body") };
  }
}

// ---------------------------------------------------------------------------
// Invoice API auth helpers — auto-register + login, similar to OrderMS
// ---------------------------------------------------------------------------

export async function invoiceLogin(
  email: string,
  password: string
): Promise<{ token: string; userId: string } | null> {
  try {
    const res = await fetch(`${INVOICE_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      const data = (await res.json()) as { token?: string; userId?: string };
      if (data.token && data.userId) return { token: data.token, userId: data.userId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function invoiceRegister(
  email: string,
  password: string,
  companyName: string
): Promise<{ token: string; userId: string } | null> {
  try {
    const res = await fetch(`${INVOICE_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, companyName }),
    });
    if (res.ok || res.status === 201) {
      const data = (await res.json()) as { token?: string; userId?: string };
      if (data.token && data.userId) return { token: data.token, userId: data.userId };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /invoices  → Invoice API GET /invoices/user/{userId}
// ---------------------------------------------------------------------------
export async function listInvoices(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  if (!auth.invoiceToken) {
    return badRequest(
      "Listing invoices requires an Invoice API token — pass it via the `invoiceToken` header"
    );
  }

  const invoiceUserId = getHeader(event, "invoiceUserId", "invoiceuserid", "InvoiceUserId");
  if (!invoiceUserId) {
    return badRequest("invoiceUserId header is required to list invoices");
  }

  return proxy("GET", `/invoices/user/${encodeURIComponent(invoiceUserId)}`, {
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// POST /invoices  → Invoice API POST /invoices
// ---------------------------------------------------------------------------
export async function createInvoice(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  if (!auth.invoiceToken) {
    return badRequest("Creating invoices requires an Invoice API token");
  }

  const body = parseBody(event);
  if (body && typeof body === "object" && "error" in (body as any)) {
    return (body as { error: any }).error;
  }
  if (body === undefined) return badRequest("Request body is required");

  return proxy("POST", "/invoices", {
    body,
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// GET /invoices/{invoiceId}  → Invoice API GET /invoices/{invoiceId}
// ---------------------------------------------------------------------------
export async function getInvoice(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  return proxy("GET", `/invoices/${encodeURIComponent(invoiceId)}`, {
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// DELETE /invoices/{invoiceId}  → Invoice API DELETE /invoices/{invoiceId}
// ---------------------------------------------------------------------------
export async function deleteInvoice(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  return proxy("DELETE", `/invoices/${encodeURIComponent(invoiceId)}`, {
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// POST /invoices/{invoiceId}/transform  → generate UBL XML
// ---------------------------------------------------------------------------
export async function transformInvoice(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  return proxy("POST", `/invoices/${encodeURIComponent(invoiceId)}/transform`, {
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// POST /invoices/{invoiceId}/validate  → validate invoice
// ---------------------------------------------------------------------------
export async function validateInvoice(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  return proxy("POST", `/invoices/${encodeURIComponent(invoiceId)}/validate`, {
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// PUT /invoices/{invoiceId}/status  → update invoice status
// ---------------------------------------------------------------------------
export async function updateInvoiceStatus(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  const body = parseBody(event);
  if (body && typeof body === "object" && "error" in (body as any)) {
    return (body as { error: any }).error;
  }
  if (body === undefined) return badRequest("Request body is required");

  return proxy("PUT", `/invoices/${encodeURIComponent(invoiceId)}/status`, {
    body,
    invoiceToken: auth.invoiceToken,
  });
}

// ---------------------------------------------------------------------------
// GET /invoices/{invoiceId}/xml  → download invoice XML
// ---------------------------------------------------------------------------
export async function getInvoiceXml(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const invoiceId: string | undefined = event.pathParameters?.invoiceId;
  if (!invoiceId) return badRequest("invoiceId path parameter is required");

  return proxy("GET", `/invoices/${encodeURIComponent(invoiceId)}/download`, {
    invoiceToken: auth.invoiceToken,
    expectXml: true,
  });
}

// ---------------------------------------------------------------------------
// POST /invoice-references  → save a reference so the receiver can see it
// ---------------------------------------------------------------------------
export async function saveInvoiceRef(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const body = parseBody(event) as {
    invoiceId?: string;
    senderId?: string;
    receiverId?: string;
    despatchAdviceId?: string;
  } | undefined;
  if (!body) return badRequest("Request body is required");
  if (!body.invoiceId || !body.senderId || !body.receiverId) {
    return badRequest("invoiceId, senderId, and receiverId are required");
  }

  await dynamo.send(
    new PutItemCommand({
      TableName: INVOICE_REFS_TABLE,
      Item: marshall({
        invoiceId: body.invoiceId,
        senderId: body.senderId,
        receiverId: body.receiverId,
        despatchAdviceId: body.despatchAdviceId ?? null,
        createdAt: new Date().toISOString(),
      }),
    })
  );

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({ invoiceId: body.invoiceId }),
  };
}

// ---------------------------------------------------------------------------
// GET /invoice-references/received  → list invoice refs where current user is receiver
// ---------------------------------------------------------------------------
export async function listReceivedInvoiceRefs(event: any) {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) {
    return unauthorized("Invalid or missing session");
  }

  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: INVOICE_REFS_TABLE,
        IndexName: "receiver-index",
        KeyConditionExpression: "receiverId = :r",
        ExpressionAttributeValues: marshall({ ":r": sessionClientId }),
      })
    );

    const refs = (result.Items ?? []).map((item) => unmarshall(item));

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(refs),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "InternalError", message: (err as Error).message }),
    };
  }
}

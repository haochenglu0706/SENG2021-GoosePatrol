import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CORS_HEADERS } from "../cors.js";
import { dynamo, CLIENTS_TABLE } from "../db.js";
import { verifySession } from "./auth.js";

/**
 * Thin proxy to the OrderMS UBL Ordering API (https://api.orderms.tech).
 * Uses the v1 endpoint family.
 *
 * Auth model:
 *  - Caller must present a valid GoosePatrol session via the `sessionId` header.
 *  - Caller may additionally present an `orderMsToken` header; if present, it is
 *    forwarded to OrderMS as the `token` header so the request runs against
 *    that user's OrderMS account. If omitted, anonymous OrderMS calls are made
 *    (only the routes where OrderMS marks `token` as optional will succeed).
 */

const ORDERMS_BASE =
  process.env.ORDERMS_BASE_URL ?? "https://api.orderms.tech";

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

function getOrderMsToken(event: any): string | undefined {
  return getHeader(event, "orderMsToken", "ordermstoken", "OrderMsToken");
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

/**
 * Verifies the GoosePatrol session and returns the OrderMS token (if provided).
 * On failure returns a Lambda-style error response; on success returns
 * `{ ok: true, orderMsToken }`.
 */
async function authorise(event: any): Promise<
  | { ok: true; orderMsToken: string | undefined }
  | { ok: false; response: { statusCode: number; headers: any; body: string } }
> {
  const sessionId = getSessionId(event);
  const sessionClientId = await verifySession(sessionId);
  if (!sessionClientId) {
    return { ok: false, response: unauthorized("Invalid or missing session") };
  }
  return { ok: true, orderMsToken: getOrderMsToken(event) };
}

/**
 * Forwards a request to OrderMS, returning a Lambda response. If `expectXml`
 * is true the response body is treated as text; otherwise as JSON (with a
 * graceful fallback to text on parse failure).
 */
async function proxy(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    orderMsToken?: string;
    expectXml?: boolean;
    query?: Record<string, string | undefined>;
  } = {}
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  let url = `${ORDERMS_BASE}${path}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.orderMsToken) headers.token = opts.orderMsToken;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    return badGateway(`Failed to reach OrderMS: ${(err as Error).message}`);
  }

  const text = await upstream.text();
  const responseHeaders: Record<string, string> = { ...CORS_HEADERS };

  if (opts.expectXml) {
    responseHeaders["Content-Type"] = "application/xml";
    return { statusCode: upstream.status, headers: responseHeaders, body: text };
  }

  responseHeaders["Content-Type"] = "application/json";
  // Pass through OrderMS's body verbatim if it's already JSON; otherwise wrap.
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
// GET /orders  → OrderMS GET /v1/orders
// ---------------------------------------------------------------------------
export async function listOrders(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  if (!auth.orderMsToken) {
    return badRequest(
      "Listing orders requires an OrderMS token — pass it via the `orderMsToken` header"
    );
  }

  return proxy("GET", "/v1/orders", { orderMsToken: auth.orderMsToken });
}

// ---------------------------------------------------------------------------
// POST /orders  → OrderMS POST /v1/orders
// ---------------------------------------------------------------------------
export async function createOrder(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const body = parseBody(event);
  if (body && typeof body === "object" && "error" in (body as any)) {
    return (body as { error: any }).error;
  }
  if (body === undefined) return badRequest("Request body is required");

  return proxy("POST", "/v1/orders", { body, orderMsToken: auth.orderMsToken });
}

// ---------------------------------------------------------------------------
// GET /orders/{orderId}  → OrderMS GET /v1/orders/{orderId}
// ---------------------------------------------------------------------------
export async function getOrder(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const orderId: string | undefined = event.pathParameters?.orderId;
  if (!orderId) return badRequest("orderId path parameter is required");

  return proxy("GET", `/v1/orders/${encodeURIComponent(orderId)}`, {
    orderMsToken: auth.orderMsToken,
  });
}

// ---------------------------------------------------------------------------
// PUT /orders/{orderId}  → OrderMS PUT /v1/orders/{orderId}
// ---------------------------------------------------------------------------
export async function updateOrder(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const orderId: string | undefined = event.pathParameters?.orderId;
  if (!orderId) return badRequest("orderId path parameter is required");

  const body = parseBody(event);
  if (body && typeof body === "object" && "error" in (body as any)) {
    return (body as { error: any }).error;
  }
  if (body === undefined) return badRequest("Request body is required");

  return proxy("PUT", `/v1/orders/${encodeURIComponent(orderId)}`, {
    body,
    orderMsToken: auth.orderMsToken,
  });
}

// ---------------------------------------------------------------------------
// DELETE /orders/{orderId}  → OrderMS DELETE /v1/orders/{orderId}
// ---------------------------------------------------------------------------
export async function deleteOrder(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const orderId: string | undefined = event.pathParameters?.orderId;
  if (!orderId) return badRequest("orderId path parameter is required");

  return proxy("DELETE", `/v1/orders/${encodeURIComponent(orderId)}`, {
    orderMsToken: auth.orderMsToken,
  });
}

// ---------------------------------------------------------------------------
// GET /orders/{orderId}/xml  → OrderMS GET /v1/orders/{orderId}/xml
// ---------------------------------------------------------------------------
export async function getOrderXml(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const orderId: string | undefined = event.pathParameters?.orderId;
  if (!orderId) return badRequest("orderId path parameter is required");

  return proxy("GET", `/v1/orders/${encodeURIComponent(orderId)}/xml`, {
    orderMsToken: auth.orderMsToken,
    expectXml: true,
  });
}

// ---------------------------------------------------------------------------
// GET /clients/{clientId}/orders  → fetch orders for a specific client
// using their stored OrderMS token
// ---------------------------------------------------------------------------
export async function listOrdersForClient(event: any) {
  const auth = await authorise(event);
  if (!auth.ok) return auth.response;

  const param: string | undefined = event.pathParameters?.clientIdOrUsername;
  if (!param) return badRequest("clientId or username path parameter is required");

  // Try direct lookup by clientId first
  let item = (
    await dynamo.send(
      new GetItemCommand({
        TableName: CLIENTS_TABLE,
        Key: marshall({ clientId: param }),
      })
    )
  ).Item;

  // If not found, try lookup by username via GSI
  if (!item) {
    const q = await dynamo.send(
      new QueryCommand({
        TableName: CLIENTS_TABLE,
        IndexName: "username-index",
        KeyConditionExpression: "username = :u",
        ExpressionAttributeValues: marshall({ ":u": param }),
        Limit: 1,
      })
    );
    item = q.Items?.[0];
  }

  if (!item) {
    return badRequest("Client not found");
  }

  const client = unmarshall(item) as { orderMsToken?: string };
  if (!client.orderMsToken) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify([]),
    };
  }

  return proxy("GET", "/v1/orders", { orderMsToken: client.orderMsToken });
}

import * as auth from "./routes/auth.js";
import * as despatch from "./routes/despatchAdvice.js";
import * as receipt from "./routes/receiptAdvice.js";
import * as orders from "./routes/orders.js";
import * as health from "./routes/health.js";
import * as docs from "./routes/docs.js";
import * as translate from "./routes/translate.js";
import { CORS_HEADERS } from "./cors.js";
import openapiYaml from "../swagger.yaml";

/**
 * Simple router that inspects the incoming API Gateway event
 * and dispatches to the appropriate route handler.
 */
export async function route(event: any) {
  const method: string = event.httpMethod;
  const path: string = event.path;

  // Handle CORS preflight for ALL routes
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  // AUTH ROUTES

  if (method === "POST" && path === "/sessions") {
    return auth.login(event);
  }

  if (method === "POST" && path === "/clients") {
    return auth.register(event);
  }

  // GET /clients/{username}/client-id
  const clientIdByUsernameMatch = path.match(/^\/clients\/([^/]+)\/client-id$/);
  if (method === "GET" && clientIdByUsernameMatch) {
    event.pathParameters = {
      ...event.pathParameters,
      username: clientIdByUsernameMatch[1],
    };
    return auth.getClientIdByUsername(event);
  }
  if (method === "GET" && path === "/clients") {
    return auth.listClients(event);
  }

  // DELETE /sessions/{sessionId} — logout
  const sessionDeleteMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (method === "DELETE" && sessionDeleteMatch) {
    event.pathParameters = {
      ...event.pathParameters,
      sessionId: sessionDeleteMatch[1],
    };
    return auth.logout(event);
  }

  // DESPATCH ROUTES

  if (method === "GET" && path === "/despatch-advices") {
    return despatch.listDespatchAdvices(event);
  }

  if (method === "POST" && path === "/despatch-advices") {
    return despatch.createDespatchAdvice(event);
  }

  // POST /despatch-advices/{despatchId}/fulfilment-cancellation
  // *** Must be matched BEFORE the broad startsWith block below ***
  const fulfilmentCancelMatch = path.match(
    /^\/despatch-advices\/([^/]+)\/fulfilment-cancellation$/
  );
  if (method === "POST" && fulfilmentCancelMatch) {
    return despatch.cancelFulfilment(event, fulfilmentCancelMatch[1]);
  }

  const despatchUblMatch = path.match(/^\/despatch-advices\/([^/]+)\/ubl$/);
  if (method === "GET" && despatchUblMatch) {
    return despatch.exportDespatchAdviceAsUblXml(despatchUblMatch[1]);
  }

  // Despatch advice item routes (/despatch-advices/{documentId})

  if (path.startsWith("/despatch-advices/")) {
    const documentId = path.substring("/despatch-advices/".length);
    const sessionId =
      event.headers?.sessionId ??
      event.headers?.sessionid ??
      event.headers?.["session-id"];

    if (method === "PUT") {
      return despatch.updateDespatchAdvice(event, documentId, sessionId);
    }

    if (method === "DELETE") {
      return despatch.deleteDespatchAdvice(event, documentId, sessionId);
    }

    // GET /despatch-advices/{despatchId}
    const despatchAdviceMatch = path.match(/^\/despatch-advices\/([^/]+)$/);
    if (method === "GET" && despatchAdviceMatch) {
      event.pathParameters = {
        ...event.pathParameters,
        despatchId: despatchAdviceMatch[1],
      };
      return despatch.getDespatchAdvice(event);
    }
  }

  // RECEIPT ADVICE ROUTES
 
  // POST /despatch-advices/{despatchAdviceId}/receipt-advices
  const receiptAdviceCreateMatch = path.match(
    /^\/despatch-advices\/([^/]+)\/receipt-advices$/
  );
  if (method === "POST" && receiptAdviceCreateMatch) {
    // Inject the path parameter so the handler can read it uniformly
    event.pathParameters = {
      ...event.pathParameters,
      despatchAdviceId: receiptAdviceCreateMatch[1],
    };
    return receipt.createReceiptAdvice(event);
  }
  if (method === "GET" && (path === "/health" || path === "/health/")) {
    return health.getHealth(event);
  }

  // GET /receipt-advices — list all receipt advices for the session user
  if (method === "GET" && path === "/receipt-advices") {
    return receipt.listReceiptAdvices(event);
  }

  const receiptUblMatch = path.match(/^\/receipt-advices\/([^/]+)\/ubl$/);
  if (method === "GET" && receiptUblMatch) {
    return receipt.exportReceiptAdviceAsUblXml(receiptUblMatch[1], event);
  }

  // GET /receipt-advices/{receiptAdviceId}
  const receiptAdviceGetMatch = path.match(/^\/receipt-advices\/([^/]+)$/);
  if (method === "GET" && receiptAdviceGetMatch) {
    event.pathParameters = {
      ...event.pathParameters,
      receiptAdviceId: receiptAdviceGetMatch[1],
    };
    return receipt.getReceiptAdvice(event);
  }

  // ORDERS ROUTES (proxy to OrderMS v1 API)

  if (method === "GET" && path === "/orders") {
    return orders.listOrders(event);
  }

  if (method === "POST" && path === "/orders") {
    return orders.createOrder(event);
  }

  // GET /orders/{orderId}/xml  — must be matched BEFORE /orders/{orderId}
  const orderXmlMatch = path.match(/^\/orders\/([^/]+)\/xml$/);
  if (method === "GET" && orderXmlMatch) {
    event.pathParameters = {
      ...event.pathParameters,
      orderId: orderXmlMatch[1],
    };
    return orders.getOrderXml(event);
  }

  const orderIdMatch = path.match(/^\/orders\/([^/]+)$/);
  if (orderIdMatch) {
    event.pathParameters = {
      ...event.pathParameters,
      orderId: orderIdMatch[1],
    };
    if (method === "GET") return orders.getOrder(event);
    if (method === "PUT") return orders.updateOrder(event);
    if (method === "DELETE") return orders.deleteOrder(event);
  }

  // DOCS ROUTE — redirect to Swagger UI
  // Use getDocsInline(event) here if you want the inline Swagger UI instead.
  if (method === "GET" && (path === "/docs" || path === "/docs/")) {
    return docs.getDocs(event);
  }

  // REST API + stage: path may be /Prod/swagger.yaml; Lambda proxy may also use /swagger.yaml
  const segs = path.split("/").filter(Boolean);
  const isSwaggerYamlGet =
    method === "GET" &&
    ((segs.length === 1 && segs[0] === "swagger.yaml") ||
      (segs.length === 2 && segs[1] === "swagger.yaml"));

  if (isSwaggerYamlGet) {
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/yaml; charset=utf-8",
      },
      body: openapiYaml,
    };
  }

  // TRANSLATE ROUTE
  if (method === "POST" && path === "/translate") {
    return translate.translateDocument(event);
  }

  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: "NotFound",
      message: "Route not found",
    }),
  };
}

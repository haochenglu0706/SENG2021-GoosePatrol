import * as auth from "./routes/auth.js";
import * as despatch from "./routes/despatchAdvice.js";
import * as receipt from "./routes/receiptAdvice.js";
import * as health from "./routes/health.js";
import * as docs from "./routes/docs.js"
import { readFileSync } from "fs";
import { join } from "path";
import { CORS_HEADERS } from "./cors.js";

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

  // DESPATCH ROUTES

  if (method === "GET" && path === "/despatch-advices") {
    return despatch.listDespatchAdvices(event);
  }

  if (method === "POST" && path === "/despatch-advices") {
    return despatch.createDespatchAdvice(event);
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

  // DOCS ROUTE — redirect to Swagger UI
  // Use getDocsInline(event) here if you want the inline Swagger UI instead.
  if (method === "GET" && (path === "/docs" || path === "/docs/")) {
    return docs.getDocs(event);
  }

  if (method === "GET" && path === "/swagger.yaml") {
    const { readFileSync } = await import("fs");

    const yaml = readFileSync("/var/task/swagger.yaml", "utf-8");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/yaml",
        "Access-Control-Allow-Origin": "*",
      },
      body: yaml,
    };
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


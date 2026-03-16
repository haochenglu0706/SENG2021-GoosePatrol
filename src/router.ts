import * as auth from "./routes/auth.js";
import * as despatch from "./routes/despatchAdvice.js";
import * as receipt from "./routes/receiptAdvice.js";

/**
 * Simple router that inspects the incoming API Gateway event
 * and dispatches to the appropriate route handler.
 */
export async function route(event: any) {
  const method: string = event.httpMethod;
  const path: string = event.path;

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

  return {
    statusCode: 404,
    body: JSON.stringify({
      error: "NotFound",
      message: "Route not found",
    }),
  };
}


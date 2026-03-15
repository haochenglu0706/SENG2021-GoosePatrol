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
    return despatch.list(event);
  }

  if (method === "POST" && path === "/despatch-advices") {
    return despatch.create(event);
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


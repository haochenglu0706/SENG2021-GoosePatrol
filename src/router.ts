import * as auth from "./routes/auth.js";
import * as despatch from "./routes/despatchAdvice.js";

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

  return {
    statusCode: 404,
    body: JSON.stringify({
      error: "NotFound",
      message: "Route not found",
    }),
  };
}


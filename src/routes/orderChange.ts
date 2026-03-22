import { CORS_HEADERS } from "../cors.js";

/**
 * Placeholder implementations for order change routes.
 * Wire these up from the router when you add the paths.
 */

export async function list(event: any) {
  // TODO: implement real order-change list logic
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "NotImplemented",
      message: "list order-changes route is not implemented yet",
    }),
  };
}

export async function create(event: any) {
  // TODO: implement real order-change create logic
  return {
    statusCode: 501,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: "NotImplemented",
      message: "create order-change route is not implemented yet",
    }),
  };
}


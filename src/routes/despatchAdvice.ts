/**
 * Placeholder implementations for despatch advice routes.
 * These will eventually contain the real DynamoDB logic.
 */

export async function list(event: any) {
  // TODO: implement real list logic
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "NotImplemented",
      message: "list despatch-advices route is not implemented yet",
    }),
  };
}

export async function create(event: any) {
  // TODO: implement real create logic
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "NotImplemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}


import { CORS_HEADERS } from "./cors.js";
import { route } from "./router.js";

/**
 * Top-level Lambda handler.
 * This is the single entrypoint that AWS Lambda will invoke.
 */
export const lambdaHandler = async (event: any, context: any) => {
  try {
    return await route(event);
  } catch (err) {
    console.error("Unhandled error in lambdaHandler:", err);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "InternalServerError",
        message: "Unexpected error",
      }),
    };
  }
};


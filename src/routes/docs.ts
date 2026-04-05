const BASE_URL = "https://e6kttv9em1.execute-api.ap-southeast-2.amazonaws.com/Prod";
const SPEC_URL = encodeURIComponent(`${BASE_URL}/swagger.yaml`);
import { CORS_HEADERS } from "../cors.js";

export async function getDocs(_event: any) {
  return {
    statusCode: 302,
    headers: {
      Location: `https://petstore.swagger.io/?url=${SPEC_URL}`,
    },
    body: "",
  };
}
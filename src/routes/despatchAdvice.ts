import { randomBytes, scryptSync } from "crypto";
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, CLIENTS_TABLE, SESSIONS_TABLE } from "../db.js";

/**
 * Placeholder implementations for despatch advice routes.
 * These will eventually contain the real DynamoDB logic.
 */

export async function createDespatchAdvice(event: any) {
  // TODO: implement this 
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "Not implemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}

export async function listDespatchAdvices(event: any) {
  // TODO: Implement this 
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "Not implemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}

export async function getDespatchAdvice(event: any) {
  // TODO: implement this 
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "Not implemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}

export async function updateDespatchAdvice(event: any) {
  // TODO: implement this
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "Not implemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}

export async function deleteDespatchAdvice(event: any) {
  // TODO: implement this
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "Not implemented",
      message: "create despatch-advice route is not implemented yet",
    }),
  };
}

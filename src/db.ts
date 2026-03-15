import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export const dynamo = new DynamoDBClient({});

export const CLIENTS_TABLE =
  (process.env.CLIENTS_TABLE_NAME as string) || "Clients";

export const SESSIONS_TABLE =
  (process.env.SESSIONS_TABLE_NAME as string) || "Sessions";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export const dynamo = new DynamoDBClient({});

export const CLIENTS_TABLE =
  (process.env.CLIENTS_TABLE_NAME as string) || "Clients";

export const SESSIONS_TABLE =
  (process.env.SESSIONS_TABLE_NAME as string) || "Sessions";

export const DESPATCH_ADVICES_TABLE =
  (process.env.DESPATCH_ADVICES_TABLE_NAME as string) || "DespatchAdvices";

export const RECEIPT_ADVICES_TABLE =
  (process.env.RECEIPT_ADVICES_TABLE_NAME as string) || "ReceiptAdvices";

export const INVOICE_REFS_TABLE =
  (process.env.INVOICE_REFS_TABLE_NAME as string) || "InvoiceReferences";
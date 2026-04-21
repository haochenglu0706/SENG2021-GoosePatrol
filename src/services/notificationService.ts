import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { CLIENTS_TABLE, dynamo } from "../db.js";

const sesClient = new SESClient({
  region: process.env.AWS_REGION ?? "ap-southeast-2",
});

export type NotificationPayload = {
  toEmail: string;
  fromEmail: string;
  replyToEmail?: string;
  documentType: string;
  documentId: string;
  action: "created" | "updated" | "received" | "cancelled";
  timestamp: string;
  summary: string;
  extraDetails?: Record<string, string>;
};

export async function getClientEmail(clientId: string): Promise<string | null> {
  if (!clientId) return null;

  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: CLIENTS_TABLE,
        Key: { clientId: { S: clientId } },
      })
    );

    if (!result.Item) return null;

    const row = unmarshall(result.Item) as { email?: unknown };
    if (typeof row.email !== "string" || row.email.trim().length === 0) {
      return null;
    }
    return row.email.trim();
  } catch (error) {
    console.error("Failed to fetch client email", { clientId, error });
    return null;
  }
}

export async function sendDocumentNotification(payload: NotificationPayload): Promise<void> {
  const fromEmail = payload.fromEmail.trim();
  const toEmail = payload.toEmail.trim();
  const replyToEmail = payload.replyToEmail?.trim();

  if (!toEmail) {
    console.warn("Skipping notification: missing recipient email", {
      documentType: payload.documentType,
      documentId: payload.documentId,
    });
    return;
  }

  if (!fromEmail) {
    console.warn("Skipping notification: missing sender email", {
      documentType: payload.documentType,
      documentId: payload.documentId,
    });
    return;
  }

  const details = payload.extraDetails
    ? Object.entries(payload.extraDetails)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  const subject = `[GoosePatrol] ${payload.documentType} ${payload.action}: ${payload.documentId}`;
  const textBody = [
    payload.summary,
    "",
    `Document Type: ${payload.documentType}`,
    `Document ID: ${payload.documentId}`,
    `Action: ${payload.action}`,
    `Timestamp: ${payload.timestamp}`,
    details ? "" : undefined,
    details || undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: fromEmail,
        ReplyToAddresses: replyToEmail ? [replyToEmail] : undefined,
        Destination: {
          ToAddresses: [toEmail],
        },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
      })
    );
  } catch (error) {
    console.error("Failed to send document notification", {
      documentType: payload.documentType,
      documentId: payload.documentId,
      toEmail,
      fromEmail,
      error,
    });
  }
}

export async function notifyDocumentEvent(options: {
  sessionClientId: string;
  counterpartyClientId: string;
  documentType: string;
  documentId: string;
  action: NotificationPayload["action"];
  summary: string;
}): Promise<void> {
  const configuredFromEmail = process.env.NOTIFICATION_FROM_EMAIL?.trim() ?? "";

  if (!options.sessionClientId || !options.counterpartyClientId) {
    console.warn("Skipping notification: missing client ids", options);
    return;
  }

  const [toEmail, actorEmail] = await Promise.all([
    getClientEmail(options.counterpartyClientId),
    getClientEmail(options.sessionClientId),
  ]);

  if (!toEmail) {
    console.warn("Skipping notification: no counterparty email", {
      counterpartyClientId: options.counterpartyClientId,
      documentType: options.documentType,
      documentId: options.documentId,
    });
    return;
  }

  if (!configuredFromEmail) {
    console.warn("Skipping notification: no sender email configured", {
      sessionClientId: options.sessionClientId,
      documentType: options.documentType,
      documentId: options.documentId,
    });
    return;
  }

  await sendDocumentNotification({
    toEmail,
    fromEmail: configuredFromEmail,
    replyToEmail: actorEmail ?? undefined,
    documentType: options.documentType,
    documentId: options.documentId,
    action: options.action,
    timestamp: new Date().toISOString(),
    summary: options.summary,
  });
}

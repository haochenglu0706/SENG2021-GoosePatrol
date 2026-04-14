import { randomBytes, scryptSync } from "crypto";
import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, CLIENTS_TABLE, SESSIONS_TABLE } from "../db.js";
import { CORS_HEADERS } from "../cors.js";

const USERNAME_INDEX = "username-index";

function isPasswordWeak(password: string): boolean {
  if (password.length < 8) return true;
  if (!/[a-zA-Z]/.test(password)) return true;
  if (!/\d/.test(password)) return true;
  return false;
}

function isEmailInvalid(email: string): boolean {
  return !email.includes("@") || email.trim().length < 3;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, keyHex] = storedHash.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const key = scryptSync(password, salt, 64);
  return key.toString("hex") === keyHex;
}

/**
 * Verifies that a session exists and returns the user ID (clientId) for it.
 * @param sessionId - The session ID (e.g. from a request header).
 * @returns The clientId (userId) if the session is valid, or false if missing/invalid.
 */
export async function verifySession(
  sessionId: string | undefined
): Promise<string | false> {
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return false;
  }
  const result = await dynamo.send(
    new GetItemCommand({
      TableName: SESSIONS_TABLE,
      Key: marshall({ sessionId: sessionId.trim() }),
    })
  );
  if (!result.Item) {
    return false;
  }
  const { clientId } = unmarshall(result.Item) as { clientId?: string };
  if (typeof clientId !== "string") {
    return false;
  }
  return clientId;
}

export async function login(event: any) {
  let body: { username?: string; password?: string; email?: string };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? {};
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadRequest",
        message: "Invalid JSON body",
      }),
    };
  }

  const { username, password, email } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "username and password are required",
      }),
    };
  }

  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "username and password are required",
      }),
    };
  }
  // Validate email if provided
  if (typeof username !== "string" || typeof password !== "string" || typeof email !== "string") {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "username, email and password are required",
      }),
    };
  }

  const queryResult = await dynamo.send(
    new QueryCommand({
      TableName: CLIENTS_TABLE,
      IndexName: USERNAME_INDEX,
      KeyConditionExpression: "username = :u",
      ExpressionAttributeValues: marshall({ ":u": trimmedUsername }),
    })
  );

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "Invalid username or password",
      }),
    };
  }

  const clientItem = queryResult.Items[0];
  if (!clientItem) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "Invalid username or password",
      }),
    };
  }
  const { passwordHash, clientId, email: storedEmail } = unmarshall(clientItem) as {
    passwordHash?: string;
    clientId?: string;
    email?: string;
  };

  if (
    typeof passwordHash !== "string" ||
    typeof clientId !== "string" ||
    typeof storedEmail !== "string" ||
    email.trim().toLowerCase() !== storedEmail.trim().toLowerCase() ||
    !verifyPassword(password, passwordHash)
  ) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Unauthorized",
        message: "Invalid username or password",
      }),
    };
  }

  const sessionId = uuidv4();

  await dynamo.send(
    new PutItemCommand({
      TableName: SESSIONS_TABLE,
      Item: marshall({
        sessionId: sessionId,
        clientId: clientId,
      }),
    })
  );

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      sessionId: sessionId,
      clientId: clientId,
    }),
  };
}

export async function register(event: any) {
  let body: { username?: string; password?: string; email?: string; };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? {};
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadRequest",
        message: "Invalid JSON body",
      }),
    };
  }

  const { username, password, email } = body;
  if (typeof username !== "string" || typeof password !== "string" || typeof email !== "string") {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: "BadRequest",
      message: "username, email and password are required",
    }),
  };
}

  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadRequest",
        message: "username cannot be empty",
      }),
    };
  }

  if (isPasswordWeak(password)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadRequest",
        message:
          "Password must be at least 8 characters and contain at least one letter and one digit",
      }),
    };
  }

  if (isEmailInvalid(email)) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: "BadRequest",
      message: "Invalid email address — must contain @",
    }),
  };
}

  const queryResult = await dynamo.send(
    new QueryCommand({
      TableName: CLIENTS_TABLE,
      IndexName: USERNAME_INDEX,
      KeyConditionExpression: "username = :u",
      ExpressionAttributeValues: marshall({ ":u": trimmedUsername }),
    })
  );

  if (queryResult.Items && queryResult.Items.length > 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Conflict",
        message: "A client with this username already exists",
      }),
    };
  }

  const clientId = uuidv4();
  const passwordHash = hashPassword(password);

  await dynamo.send(
    new PutItemCommand({
      TableName: CLIENTS_TABLE,
      Item: marshall({
        clientId: clientId,
        username: trimmedUsername,
        passwordHash: passwordHash,
        email: email.trim(),
      }),
    })
  );

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      clientId: clientId,
      username: trimmedUsername,
      email: email.trim(),
    }),
  };
}

export async function getClientIdByUsername(event: any) {
  const username = event.pathParameters?.username;
  if (typeof username !== "string" || !username.trim()) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "BadRequest",
        message: "username is required",
      }),
    };
  }

  const trimmedUsername = username.trim();
  const queryResult = await dynamo.send(
    new QueryCommand({
      TableName: CLIENTS_TABLE,
      IndexName: USERNAME_INDEX,
      KeyConditionExpression: "username = :u",
      ExpressionAttributeValues: marshall({ ":u": trimmedUsername }),
      Limit: 1,
    })
  );

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "NotFound",
        message: "Client not found",
      }),
    };
  }

  const { clientId } = unmarshall(queryResult.Items[0]!) as { clientId?: string };
  if (typeof clientId !== "string" || !clientId.trim()) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "NotFound",
        message: "Client not found",
      }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ clientId }),
  };
/**
 * GET /clients — returns all registered users (username + clientId only).
 * Requires a valid session.
 */
export async function listClients(event: any) {
  const sessionId =
    event.headers?.sessionId ??
    event.headers?.sessionid ??
    event.headers?.["session-id"];

  const valid = await verifySession(sessionId);
  if (!valid) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Unauthorized", message: "Invalid or missing session" }),
    };
  }

  try {
    const clients: { clientId: string; username: string }[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: CLIENTS_TABLE,
          ProjectionExpression: "clientId, username",
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      for (const raw of result.Items ?? []) {
        const item = unmarshall(raw) as { clientId?: string; username?: string };
        if (item.clientId && item.username) {
          clients.push({ clientId: item.clientId, username: item.username });
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    clients.sort((a, b) => a.username.localeCompare(b.username));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(clients),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "InternalError", message: (err as Error).message }),
    };
  }
}

export async function logout(event: any) {
  const sessionId =
    event.pathParameters?.sessionId ?? event.pathParameters?.sessionid;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "NotFound",
        message: "Session not found",
      }),
    };
  }
  const trimmed = sessionId.trim();
  const existing = await dynamo.send(
    new GetItemCommand({
      TableName: SESSIONS_TABLE,
      Key: marshall({ sessionId: trimmed }),
    })
  );
  if (!existing.Item) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "NotFound",
        message: "Session not found",
      }),
    };
  }
  await dynamo.send(
    new DeleteItemCommand({
      TableName: SESSIONS_TABLE,
      Key: marshall({ sessionId: trimmed }),
    })
  );
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: "",
  };
}

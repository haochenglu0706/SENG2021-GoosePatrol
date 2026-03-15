import { randomBytes, scryptSync } from "crypto";
import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, CLIENTS_TABLE, SESSIONS_TABLE } from "../db.js";

const USERNAME_INDEX = "username-index";

function isPasswordWeak(password: string): boolean {
  if (password.length < 8) return true;
  if (!/[a-zA-Z]/.test(password)) return true;
  if (!/\d/.test(password)) return true;
  return false;
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

export async function login(event: any) {
  let body: { username?: string; password?: string };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? {};
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "Invalid JSON body",
      }),
    };
  }

  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return {
      statusCode: 401,
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
      body: JSON.stringify({
        error: "Unauthorized",
        message: "username and password are required",
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
      body: JSON.stringify({
        error: "Unauthorized",
        message: "Invalid username or password",
      }),
    };
  }
  const { passwordHash, clientId } = unmarshall(clientItem) as {
    passwordHash?: string;
    clientId?: string;
  };

  if (
    typeof passwordHash !== "string" ||
    typeof clientId !== "string" ||
    !verifyPassword(password, passwordHash)
  ) {
    return {
      statusCode: 401,
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
        sessionId,
        clientId,
      }),
    })
  );

  return {
    statusCode: 201,
    body: JSON.stringify({
      sessionId,
      clientId,
    }),
  };
}

export async function register(event: any) {
  let body: { username?: string; password?: string };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? {};
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "Invalid JSON body",
      }),
    };
  }

  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "username and password are required",
      }),
    };
  }

  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message: "username cannot be empty",
      }),
    };
  }

  if (isPasswordWeak(password)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "BadRequest",
        message:
          "Password must be at least 8 characters and contain at least one letter and one digit",
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
        clientId,
        username: trimmedUsername,
        passwordHash,
      }),
    })
  );

  return {
    statusCode: 201,
    body: JSON.stringify({
      clientId,
      username: trimmedUsername,
    }),
  };
}

export async function logout(event: any) {
  return {
    statusCode: 501,
    body: JSON.stringify({
      error: "NotImplemented",
      message: "logout route is not implemented yet",
    }),
  };
}

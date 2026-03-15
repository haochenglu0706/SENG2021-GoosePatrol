import { jest } from "@jest/globals";
import { randomBytes, scryptSync } from "crypto";

jest.unstable_mockModule("../src/db.js", () => ({
  dynamo: {
    send: jest.fn(),
  },
  CLIENTS_TABLE: "Clients",
  SESSIONS_TABLE: "Sessions",
}));

const { login, register, logout } = await import("../src/routes/auth.js");
const { dynamo } = await import("../src/db.js");

const mockSend = dynamo.send as ReturnType<typeof jest.fn>;

describe("auth", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe("login", () => {
    test("returns 400 when body is invalid JSON", async () => {
      const res = await login({ body: "not json {" });
      expect(res.statusCode).toBe(400);
    });

    test("returns 401 when username and password are missing", async () => {
      const res = await login({});
      expect(res.statusCode).toBe(401);
    });

    test("returns 401 when username or password are not strings", async () => {
      const res = await login({
        body: JSON.stringify({ username: 123, password: "pass1234" }),
      });
      expect(res.statusCode).toBe(401);
    });

    test("returns 401 when username is empty or whitespace", async () => {
      const res = await login({
        body: JSON.stringify({ username: "   ", password: "goodPass1" }),
      });
      expect(res.statusCode).toBe(401);
    });

    test("returns 401 when user not found", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const res = await login({
        body: JSON.stringify({ username: "nobody", password: "goodPass1" }),
      });

      expect(res.statusCode).toBe(401);
    });

    test("returns 401 when client item is missing", async () => {
      mockSend.mockResolvedValueOnce({ Items: [null] });

      const res = await login({
        body: JSON.stringify({ username: "alice", password: "goodPass1" }),
      });

      expect(res.statusCode).toBe(401);
    });

    test("returns 401 when password is wrong", async () => {
      const salt = randomBytes(16);
      const key = scryptSync("goodPass1", salt, 64);
      const storedHash = `${salt.toString("hex")}:${key.toString("hex")}`;
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            clientId: { S: "client-123" },
            username: { S: "alice" },
            passwordHash: { S: storedHash },
          },
        ],
      });

      const res = await login({
        body: JSON.stringify({ username: "alice", password: "wrongPass1" }),
      });

      expect(res.statusCode).toBe(401);
    });

    test("returns 201 and sessionId and clientId when credentials valid", async () => {
      const salt = randomBytes(16);
      const key = scryptSync("goodPass1", salt, 64);
      const storedHash = `${salt.toString("hex")}:${key.toString("hex")}`;
      mockSend
        .mockResolvedValueOnce({
          Items: [
            {
              clientId: { S: "client-123" },
              username: { S: "alice" },
              passwordHash: { S: storedHash },
            },
          ],
        })
        .mockResolvedValueOnce({});

      const res = await login({
        body: JSON.stringify({ username: "alice", password: "goodPass1" }),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.sessionId).toBeDefined();
      expect(body.clientId).toBe("client-123");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("logout", () => {
    test("returns 501 Not Implemented", async () => {
      const res = await logout({});
      expect(res.statusCode).toBe(501);
    });
  });

  describe("register", () => {
    test("returns 400 when body is invalid JSON", async () => {
      const res = await register({ body: "not json {" });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when username and password are missing", async () => {
      const res = await register({ body: "{}" });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when username is empty string", async () => {
      const res = await register({
        body: JSON.stringify({ username: "   ", password: "pass1234" }),
      });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when password is too short", async () => {
      const res = await register({
        body: JSON.stringify({ username: "alice", password: "short1" }),
      });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when password has no letter", async () => {
      const res = await register({
        body: JSON.stringify({ username: "alice", password: "12345678" }),
      });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when password has no digit", async () => {
      const res = await register({
        body: JSON.stringify({ username: "alice", password: "password" }),
      });
      expect(res.statusCode).toBe(400);
    });

    test("returns 400 when username already exists", async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ id: "existing" }] });

      const res = await register({
        body: JSON.stringify({ username: "taken", password: "validPass1" }),
      });
      expect(res.statusCode).toBe(400);
    });

    test("returns 201 and creates client when valid", async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) 
        .mockResolvedValueOnce({}); 

      const res = await register({
        body: JSON.stringify({ username: "newuser", password: "securePass1" }),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.username).toBe("newuser");
      expect(body.clientId).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});

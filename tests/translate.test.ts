import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mock auth module so we control session verification
// ---------------------------------------------------------------------------
jest.unstable_mockModule("../src/routes/auth.js", () => ({
  verifySession: jest.fn(),
}));

const { translateDocument, callDeepL } = await import("../src/routes/translate.js");
const { verifySession } = await import("../src/routes/auth.js");

const mockVerifySession = verifySession as unknown as jest.MockedFunction<
  (sessionId: string | undefined) => Promise<string | false>
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice>
  <ID>DA-001</ID>
  <Note>Please deliver before noon</Note>
</DespatchAdvice>`;

const TRANSLATED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice>
  <ID>DA-001</ID>
  <Note>Bitte vor zwölf Uhr liefern</Note>
</DespatchAdvice>`;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    headers: { sessionId: "valid-session" },
    body: JSON.stringify({
      xml: VALID_XML,
      sourceLang: "EN",
      targetLang: "DE",
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// beforeEach: default to valid session and set DeepL key env var
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockVerifySession.mockReset();
  mockVerifySession.mockResolvedValue("client-001");
  process.env.DEEPL_API_KEY = "test-deepl-key-xxxx";
  // Reset any global fetch mock
  (globalThis as any).fetch = undefined;
});

afterEach(() => {
  delete process.env.DEEPL_API_KEY;
});

// ---------------------------------------------------------------------------
// translateDocument — authentication
// ---------------------------------------------------------------------------

describe("translateDocument — authentication", () => {
  test("returns 401 when sessionId header is missing", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await translateDocument({ headers: {}, body: JSON.stringify({ xml: VALID_XML, targetLang: "DE" }) });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Unauthorized");
  });

  test("returns 401 when session is invalid", async () => {
    mockVerifySession.mockResolvedValueOnce(false);
    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// translateDocument — input validation
// ---------------------------------------------------------------------------

describe("translateDocument — input validation", () => {
  test("returns 400 when body is not valid JSON", async () => {
    const res = await translateDocument({ headers: { sessionId: "valid-session" }, body: "not-json" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("BadRequest");
  });

  test("returns 400 when xml field is missing", async () => {
    const res = await translateDocument(makeEvent({ body: JSON.stringify({ targetLang: "DE" }) }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toMatch(/xml/i);
  });

  test("returns 400 when xml field is an empty string", async () => {
    const res = await translateDocument(makeEvent({ body: JSON.stringify({ xml: "   ", targetLang: "DE" }) }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("BadRequest");
  });

  test("returns 400 when targetLang is missing", async () => {
    const res = await translateDocument(makeEvent({ body: JSON.stringify({ xml: VALID_XML }) }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toMatch(/targetLang/i);
  });

  test("returns 400 for unsupported targetLang", async () => {
    const res = await translateDocument(makeEvent({ body: JSON.stringify({ xml: VALID_XML, targetLang: "XX" }) }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toMatch(/targetLang/i);
  });

  test("returns 400 for unsupported sourceLang", async () => {
    const res = await translateDocument(
      makeEvent({ body: JSON.stringify({ xml: VALID_XML, sourceLang: "ZZ", targetLang: "DE" }) })
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("BadRequest");
    expect(body.message).toMatch(/sourceLang/i);
  });

  test("returns 400 when xml does not start with <", async () => {
    const res = await translateDocument(
      makeEvent({ body: JSON.stringify({ xml: "plain text, not XML", targetLang: "FR" }) })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("BadRequest");
  });
});

// ---------------------------------------------------------------------------
// translateDocument — missing API key
// ---------------------------------------------------------------------------

describe("translateDocument — configuration", () => {
  test("returns 500 when DEEPL_API_KEY is not set", async () => {
    delete process.env.DEEPL_API_KEY;
    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toMatch(/DEEPL_API_KEY/i);
  });
});

// ---------------------------------------------------------------------------
// translateDocument — successful translation (mocked fetch)
// ---------------------------------------------------------------------------

describe("translateDocument — successful translation", () => {
  test("returns 200 with translated XML and correct Content-Type", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        translations: [{ detected_source_language: "EN", text: TRANSLATED_XML }],
      }),
    });

    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Content-Type"]).toContain("application/xml");
    expect(res.body).toBe(TRANSLATED_XML);
  });

  test("uses AUTO source language when sourceLang is omitted", async () => {
    let capturedBody: any;
    (globalThis as any).fetch = jest.fn().mockImplementationOnce((_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ translations: [{ detected_source_language: "EN", text: TRANSLATED_XML }] }),
      });
    });

    const res = await translateDocument(makeEvent({ body: JSON.stringify({ xml: VALID_XML, targetLang: "FR" }) }));
    expect(res.statusCode).toBe(200);
    // source_lang should NOT be present when AUTO is selected
    expect(capturedBody.source_lang).toBeUndefined();
    expect(capturedBody.target_lang).toBe("FR");
  });

  test("includes tag_handling=xml in the DeepL request", async () => {
    let capturedBody: any;
    (globalThis as any).fetch = jest.fn().mockImplementationOnce((_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ translations: [{ detected_source_language: "EN", text: TRANSLATED_XML }] }),
      });
    });

    await translateDocument(makeEvent());
    expect(capturedBody.tag_handling).toBe("xml");
  });
});

// ---------------------------------------------------------------------------
// translateDocument — DeepL API errors
// ---------------------------------------------------------------------------

describe("translateDocument — DeepL API error handling", () => {
  test("returns 500 when DeepL returns a non-OK response", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 456,
      text: async () => JSON.stringify({ message: "Quota exceeded" }),
    });

    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toMatch(/Quota exceeded/i);
  });

  test("returns 500 when the fetch call throws (network error)", async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValueOnce(
      new Error("Network unreachable")
    );

    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toMatch(/Network unreachable/i);
  });

  test("returns 500 when DeepL response is missing translations array", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    });

    const res = await translateDocument(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe("InternalServerError");
  });
});

// ---------------------------------------------------------------------------
// callDeepL unit tests (tests the helper directly)
// ---------------------------------------------------------------------------

describe("callDeepL", () => {
  test("sends Authorization header with the API key", async () => {
    let capturedHeaders: any;
    (globalThis as any).fetch = jest.fn().mockImplementationOnce((_url: string, opts: any) => {
      capturedHeaders = opts.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ translations: [{ detected_source_language: "EN", text: "translated" }] }),
      });
    });

    await callDeepL(VALID_XML, "EN", "DE", "my-api-key");
    expect(capturedHeaders["Authorization"]).toBe("DeepL-Auth-Key my-api-key");
  });

  test("does not send source_lang when AUTO is specified", async () => {
    let body: any;
    (globalThis as any).fetch = jest.fn().mockImplementationOnce((_url: string, opts: any) => {
      body = JSON.parse(opts.body as string);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ translations: [{ detected_source_language: "DE", text: "result" }] }),
      });
    });

    await callDeepL(VALID_XML, "AUTO", "FR", "key");
    expect(body.source_lang).toBeUndefined();
  });

  test("throws when DeepL API returns an error status", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "Authorization failure" }),
    });

    await expect(callDeepL(VALID_XML, "EN", "DE", "bad-key")).rejects.toThrow(
      /Authorization failure/
    );
  });

  test("returns the translated text string on success", async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        translations: [{ detected_source_language: "EN", text: TRANSLATED_XML }],
      }),
    });

    const result = await callDeepL(VALID_XML, "EN", "DE", "my-key");
    expect(result).toBe(TRANSLATED_XML);
  });
});
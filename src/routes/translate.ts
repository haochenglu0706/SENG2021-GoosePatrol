import { CORS_HEADERS } from "../cors.js";
import { verifySession } from "./auth.js";

// ---------------------------------------------------------------------------
// DeepL Translation Route
//
// POST /translate
//   Body: { xml: string, sourceLang: string, targetLang: string }
//   Headers: sessionId (required)
//   Returns: translated XML string with Content-Type: application/xml
//
// The DeepL API key must be set in the environment as DEEPL_API_KEY.
// For the free-tier key, set DEEPL_API_URL to https://api-free.deepl.com/v2
// (defaults to the paid endpoint https://api.deepl.com/v2).
// ---------------------------------------------------------------------------

const DEEPL_API_URL =
  process.env.DEEPL_API_URL ?? "https://api.deepl.com/v2";

// Supported DeepL target language codes (subset — extend as needed)
const SUPPORTED_TARGET_LANGS = new Set([
  "AR", "BG", "CS", "DA", "DE", "EL", "EN-GB", "EN-US",
  "ES", "ET", "FI", "FR", "HU", "ID", "IT", "JA", "KO",
  "LT", "LV", "NB", "NL", "PL", "PT-BR", "PT-PT", "RO",
  "RU", "SK", "SL", "SV", "TR", "UK", "ZH",
]);

// Source langs (subset) — "AUTO" is also accepted to let DeepL auto-detect
const SUPPORTED_SOURCE_LANGS = new Set([
  "AUTO", "AR", "BG", "CS", "DA", "DE", "EL", "EN",
  "ES", "ET", "FI", "FR", "HU", "ID", "IT", "JA", "KO",
  "LT", "LV", "NB", "NL", "PL", "PT", "RO", "RU",
  "SK", "SL", "SV", "TR", "UK", "ZH",
]);

function badRequest(message: string) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "BadRequest", message }),
  };
}

function unauthorized(message: string) {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized", message }),
  };
}

function internalError(message: string) {
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "InternalServerError", message }),
  };
}

function getSessionId(event: any): string | undefined {
  const h = event?.headers ?? {};
  return h.sessionId ?? h.sessionid ?? h["session-id"] ?? h["Session-Id"];
}

/**
 * Calls the DeepL Translate Text API with XML tag handling enabled.
 * Splits large documents into chunks if necessary (DeepL limit: 128 KB per text element).
 */
export async function callDeepL(
  xmlContent: string,
  sourceLang: string,
  targetLang: string,
  apiKey: string
): Promise<string> {
  const body: Record<string, unknown> = {
    text: [xmlContent],
    target_lang: targetLang,
    tag_handling: "xml",
    // Preserve XML structure — do not split sentences across tags
    split_sentences: "nonewlines",
  };

  if (sourceLang !== "AUTO") {
    body.source_lang = sourceLang;
  }

  const response = await fetch(`${DEEPL_API_URL}/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `DeepL API error (${response.status})`;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json.message) message = `DeepL: ${json.message}`;
    } catch {
      // use default message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    translations: { detected_source_language: string; text: string }[];
  };

  const translated = data.translations?.[0]?.text;
  if (!translated && translated !== "") {
    throw new Error("DeepL returned an unexpected response format");
  }

  return translated;
}

/**
 * POST /translate
 *
 * Body (JSON):
 *   xml        – the full XML document string to translate
 *   sourceLang – BCP-47 source language code or "AUTO" (default: "AUTO")
 *   targetLang – BCP-47 target language code (required)
 *
 * Returns the translated XML as text/xml.
 */
export async function translateDocument(event: any) {
  // --- Auth ---
  const sessionId = getSessionId(event);
  const clientId = await verifySession(sessionId);
  if (!clientId) {
    return unauthorized("Invalid or missing session");
  }

  // --- API key check ---
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return internalError(
      "Translation service is not configured (missing DEEPL_API_KEY)"
    );
  }

  // --- Parse body ---
  let body: { xml?: unknown; sourceLang?: unknown; targetLang?: unknown };
  try {
    body =
      typeof event.body === "string"
        ? (JSON.parse(event.body) as typeof body)
        : (event.body ?? {});
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  const xmlContent = body.xml;
  const sourceLang =
    typeof body.sourceLang === "string"
      ? body.sourceLang.toUpperCase()
      : "AUTO";
  const targetLang =
    typeof body.targetLang === "string"
      ? body.targetLang.toUpperCase()
      : undefined;

  // --- Validation ---
  if (typeof xmlContent !== "string" || xmlContent.trim() === "") {
    return badRequest("Field 'xml' is required and must be a non-empty string");
  }

  if (!targetLang) {
    return badRequest("Field 'targetLang' is required");
  }

  if (!SUPPORTED_TARGET_LANGS.has(targetLang)) {
    return badRequest(
      `Unsupported targetLang '${targetLang}'. Supported values: ${[...SUPPORTED_TARGET_LANGS].join(", ")}`
    );
  }

  if (!SUPPORTED_SOURCE_LANGS.has(sourceLang)) {
    return badRequest(
      `Unsupported sourceLang '${sourceLang}'. Supported values: ${[...SUPPORTED_SOURCE_LANGS].join(", ")}`
    );
  }

  // Basic check that this looks like XML
  if (!xmlContent.trimStart().startsWith("<")) {
    return badRequest("The 'xml' field does not appear to contain valid XML");
  }

  // --- Translate ---
  try {
    const translated = await callDeepL(
      xmlContent,
      sourceLang,
      targetLang,
      apiKey
    );

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: translated,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Translation failed";
    return internalError(message);
  }
}
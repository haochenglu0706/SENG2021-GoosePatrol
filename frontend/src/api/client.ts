const DEFAULT_API =
  process.env.REACT_APP_API_BASE ??
  "https://e6kttv9em1.execute-api.ap-southeast-2.amazonaws.com/Prod";

export const API_BASE = DEFAULT_API.replace(/\/$/, "");

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
  sessionId: string | null = null
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (sessionId) headers.sessionId = sessionId;
  const res = await fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    ...opts,
    headers,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { message?: string; error?: string } | unknown[];
    if (!res.ok) {
      const errObj = data as { message?: string; error?: string };
      throw new Error(errObj.message ?? errObj.error ?? `HTTP ${res.status}`);
    }
    return data as T;
  }
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { message?: string };
      throw new Error(j.message ?? `HTTP ${res.status}`);
    } catch {
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  return text as T;
}

export async function downloadXml(
  path: string,
  filename: string,
  sessionId: string | null,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (sessionId) headers.sessionId = sessionId;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { message?: string };
      throw new Error(j.message ?? `HTTP ${res.status}`);
    } catch {
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  const blob = new Blob([text], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

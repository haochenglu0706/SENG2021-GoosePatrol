/** Receipt advice IDs this browser has created or registered for the current client (no list API). */

const key = (clientId: string) => `gp_receiptIds_${clientId}`;

export function loadReceiptIds(clientId: string): string[] {
  try {
    const raw = localStorage.getItem(key(clientId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberReceiptId(clientId: string, receiptAdviceId: string): void {
  const ids = new Set(loadReceiptIds(clientId));
  ids.add(receiptAdviceId);
  localStorage.setItem(key(clientId), JSON.stringify(Array.from(ids)));
}

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/order.module.css";
import createStyles from "./style/create.module.css";

const TOKEN_KEY = "orderms_token"; // fallback for manually-entered tokens

type OrderData = {
  ID?: string;
  IssueDate?: string;
  BuyerCustomerParty?: { Party?: { PartyName?: { Name?: string }[] } };
  SellerSupplierParty?: { Party?: { PartyName?: { Name?: string }[] } };
  OrderLine?: unknown[];
} & Record<string, unknown>;

type OrderRecord = {
  orderId: string;
  data?: OrderData;
  createdAt?: string;
  modifiedAt?: string;
  url?: string;
  userId?: string;
} & OrderData;

function partyName(p?: { Party?: { PartyName?: { Name?: string }[] } }): string {
  return p?.Party?.PartyName?.[0]?.Name ?? "—";
}

function orderFields(o: OrderRecord): OrderData {
  return o.data ?? o;
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

function OrderDetailModal({
  order,
  onClose,
}: {
  order: OrderRecord;
  onClose: () => void;
}) {
  const f = orderFields(order);
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-labelledby="order-detail-title">
        <div className="modal-header">
          <div>
            <div className="card-title" id="order-detail-title">
              {f.ID ?? order.orderId.slice(0, 18) + "…"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {f.IssueDate ?? "—"}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="section-label">Order Info</div>
          <div className="detail-grid">
            <div>
              <div className="detail-key">Order ID</div>
              <div className="detail-val">{order.orderId}</div>
            </div>
            <div>
              <div className="detail-key">Document ID</div>
              <div className="detail-val">{f.ID ?? "—"}</div>
            </div>
            <div>
              <div className="detail-key">Buyer</div>
              <div className="detail-val">{partyName(f.BuyerCustomerParty)}</div>
            </div>
            <div>
              <div className="detail-key">Seller</div>
              <div className="detail-val">{partyName(f.SellerSupplierParty)}</div>
            </div>
            <div>
              <div className="detail-key">Created</div>
              <div className="detail-val">{order.createdAt ?? "—"}</div>
            </div>
            <div>
              <div className="detail-key">Modified</div>
              <div className="detail-val">{order.modifiedAt ?? "—"}</div>
            </div>
          </div>

          <div className="section-label">Raw payload</div>
          <pre className={styles.rawJson}>{JSON.stringify(f, null, 2)}</pre>

          <div style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor modal — used for both create and update
// ---------------------------------------------------------------------------

type EditLine = { id: string; name: string; desc: string; model: string; note: string; qty: string; unit: string };

function extractEditState(order: OrderRecord) {
  const f = orderFields(order);
  const buyerParty = f.BuyerCustomerParty?.Party as any ?? {};
  const buyerAddr = buyerParty.PostalAddress ?? {};

  const lines = (f.OrderLine ?? []) as any[];
  const line1 = lines[0] ?? {};
  const li1 = line1.LineItem ?? {};
  const item1 = li1.Item ?? {};

  const extra: EditLine[] = lines.slice(1).map((l: any) => {
    const li = l.LineItem ?? {};
    const it = li.Item ?? {};
    return {
      id: li.ID ?? "",
      name: it.Name ?? "",
      desc: Array.isArray(it.Description) ? it.Description[0] ?? "" : it.Description ?? "",
      model: it.Model ?? "",
      note: Array.isArray(l.Note) ? l.Note[0] ?? "" : l.Note ?? "",
      qty: String(l.Quantity ?? li.Quantity ?? 1),
      unit: l.QuantityUnitCode ?? li.QuantityUnitCode ?? "EA",
    };
  });

  return {
    fields: {
      ublVersion: (f as any).UBLVersionID ?? "2.1",
      note: Array.isArray((f as any).Note) ? (f as any).Note[0] ?? "" : (f as any).Note ?? "",
      buyerName: buyerParty.PartyName?.[0]?.Name ?? "",
      buyerAccountId: (f.BuyerCustomerParty as any)?.CustomerAssignedAccountID ?? "",
      buyerPartyId: buyerParty.PartyIdentification?.[0]?.ID ?? "",
      buyerStreet: buyerAddr.StreetName ?? "",
      buyerCity: buyerAddr.CityName ?? "",
      buyerZone: buyerAddr.PostalZone ?? "",
      buyerCountryCode: buyerAddr.Country?.IdentificationCode ?? "AU",
      buyerCountryName: buyerAddr.Country?.Name ?? "Australia",
      sellerName: (f.SellerSupplierParty as any)?.Party?.PartyName?.[0]?.Name ?? "",
      line1Id: li1.ID ?? "LINE-001",
      line1Name: item1.Name ?? "",
      line1Desc: Array.isArray(item1.Description) ? item1.Description[0] ?? "" : item1.Description ?? "",
      line1Model: item1.Model ?? "",
      line1Note: Array.isArray(line1.Note) ? line1.Note[0] ?? "" : line1.Note ?? "",
      line1Qty: String(line1.Quantity ?? li1.Quantity ?? 1),
      line1Unit: line1.QuantityUnitCode ?? li1.QuantityUnitCode ?? "EA",
    },
    extraLines: extra,
  };
}

function OrderEditorModal({
  order,
  onSubmit,
  onClose,
}: {
  order: OrderRecord;
  onSubmit: (body: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const initial = extractEditState(order);
  const f0 = orderFields(order);
  const [f, setF] = useState(initial.fields);
  const [extraLines, setExtraLines] = useState<EditLine[]>(initial.extraLines);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const set =
    (k: keyof typeof f) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const updateLine = (idx: number, key: string, val: string) =>
    setExtraLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));

  const removeLine = (idx: number) =>
    setExtraLines((prev) => prev.filter((_, i) => i !== idx));

  const addLine = () =>
    setExtraLines((prev) => [
      ...prev,
      { id: `LINE-${String(prev.length + 2).padStart(3, "0")}`, name: "", desc: "", model: "", note: "", qty: "1", unit: "EA" },
    ]);

  const submit = async () => {
    setSubmitting(true);
    setErr("");
    try {
      const allLines = [
        {
          ...(f.line1Note ? { Note: [f.line1Note] } : {}),
          LineItem: {
            ID: f.line1Id,
            Item: {
              Name: f.line1Name,
              Description: f.line1Desc ? [f.line1Desc] : undefined,
              Model: f.line1Model || undefined,
            },
          },
          Quantity: parseFloat(f.line1Qty) || 1,
          QuantityUnitCode: f.line1Unit || "EA",
        },
        ...extraLines.map((l) => ({
          ...(l.note ? { Note: [l.note] } : {}),
          LineItem: {
            ID: l.id,
            Item: {
              Name: l.name,
              Description: l.desc ? [l.desc] : undefined,
              Model: l.model || undefined,
            },
          },
          Quantity: parseFloat(l.qty) || 1,
          QuantityUnitCode: l.unit || "EA",
        })),
      ];

      const body: Record<string, unknown> = {
        ID: f0.ID ?? order.orderId,
        IssueDate: f0.IssueDate,
        UBLVersionID: f.ublVersion,
        ...(f.note.trim() ? { Note: [f.note.trim()] } : {}),
        BuyerCustomerParty: {
          ...(f.buyerAccountId ? { CustomerAssignedAccountID: f.buyerAccountId } : {}),
          Party: {
            ...(f.buyerPartyId ? { PartyIdentification: [{ ID: f.buyerPartyId }] } : {}),
            PartyName: [{ Name: f.buyerName }],
            PostalAddress: {
              StreetName: f.buyerStreet,
              CityName: f.buyerCity,
              PostalZone: f.buyerZone,
              Country: { IdentificationCode: f.buyerCountryCode, Name: f.buyerCountryName },
            },
          },
        },
        SellerSupplierParty: {
          Party: {
            PartyName: [{ Name: f.sellerName || "TBD" }],
          },
        },
        OrderLine: allLines,
      };

      await onSubmit(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const valid = [f.buyerName, f.line1Name].every((v) => v && v.trim());

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" style={{ maxWidth: 920 }}>
        <div className="modal-header">
          <div className="card-title">Edit order — {f0.ID ?? order.orderId}</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={submitting}>✕</button>
        </div>
        <div className="modal-body">
          {err ? <div className="alert alert-err">{err}</div> : null}

          <div className="section-label">Document info</div>
          <div className="field-row">
            <div className="field">
              <label>Order ID</label>
              <input value={f0.ID ?? order.orderId} readOnly disabled />
            </div>
            <div className="field">
              <label>Issue date</label>
              <input value={f0.IssueDate ?? "—"} readOnly disabled />
            </div>
          </div>
          <div className="field">
            <label>UBL version</label>
            <select value={f.ublVersion} onChange={set("ublVersion")}>
              <option value="2.1">2.1</option>
              <option value="2.4">2.4</option>
            </select>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <textarea placeholder="General note" value={f.note} onChange={set("note")} style={{ minHeight: 50 }} />
          </div>

          <div className="section-label">Buyer customer party</div>
          <div className="field-row">
            <div className="field"><label>Party name *</label><input value={f.buyerName} onChange={set("buyerName")} /></div>
            <div className="field"><label>Account ID</label><input value={f.buyerAccountId} onChange={set("buyerAccountId")} /></div>
          </div>
          <div className="field"><label>Party identification (ABN / ID)</label><input value={f.buyerPartyId} onChange={set("buyerPartyId")} /></div>
          <div className="field-row">
            <div className="field"><label>Street</label><input value={f.buyerStreet} onChange={set("buyerStreet")} /></div>
            <div className="field"><label>City</label><input value={f.buyerCity} onChange={set("buyerCity")} /></div>
          </div>
          <div className="field-row-3">
            <div className="field"><label>Postal zone</label><input value={f.buyerZone} onChange={set("buyerZone")} /></div>
            <div className="field"><label>Country code</label><input maxLength={2} value={f.buyerCountryCode} onChange={set("buyerCountryCode")} /></div>
            <div className="field"><label>Country name</label><input value={f.buyerCountryName} onChange={set("buyerCountryName")} /></div>
          </div>

          <div className="section-label">Seller supplier party</div>
          <div className="field">
            <label>Seller name (optional)</label>
            <input placeholder="Leave blank if unknown" value={f.sellerName} onChange={set("sellerName")} />
          </div>

          <div className="section-label">Order lines</div>
          <div className={createStyles.lineCard}>
            <div className={createStyles.lineHeader}><span className={createStyles.lineLabel}>Line 1</span></div>
            <div className="field-row">
              <div className="field"><label>Item name *</label><input value={f.line1Name} onChange={set("line1Name")} /></div>
              <div className="field"><label>Line ID</label><input value={f.line1Id} onChange={set("line1Id")} /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Description</label><input value={f.line1Desc} onChange={set("line1Desc")} /></div>
              <div className="field"><label>Model</label><input value={f.line1Model} onChange={set("line1Model")} /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Quantity</label><input type="number" min="1" value={f.line1Qty} onChange={set("line1Qty")} /></div>
              <div className="field"><label>Unit code</label><input value={f.line1Unit} onChange={set("line1Unit")} /></div>
            </div>
            <div className="field"><label>Line note</label><input value={f.line1Note} onChange={set("line1Note")} /></div>
          </div>

          {extraLines.map((line, i) => (
            <div key={i} className={createStyles.lineCard}>
              <div className={createStyles.lineHeader}>
                <span className={createStyles.lineLabel}>Line {i + 2}</span>
                <button type="button" className="btn btn-danger" style={{ fontSize: 10, padding: "3px 8px" }} onClick={() => removeLine(i)}>Remove</button>
              </div>
              <div className="field-row">
                <div className="field"><label>Item name *</label><input value={line.name} onChange={(e) => updateLine(i, "name", e.target.value)} /></div>
                <div className="field"><label>Line ID</label><input value={line.id} onChange={(e) => updateLine(i, "id", e.target.value)} /></div>
              </div>
              <div className="field-row">
                <div className="field"><label>Description</label><input value={line.desc} onChange={(e) => updateLine(i, "desc", e.target.value)} /></div>
                <div className="field"><label>Model</label><input value={line.model} onChange={(e) => updateLine(i, "model", e.target.value)} /></div>
              </div>
              <div className="field-row">
                <div className="field"><label>Quantity</label><input type="number" min="1" value={line.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} /></div>
                <div className="field"><label>Unit code</label><input value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} /></div>
              </div>
              <div className="field"><label>Line note</label><input value={line.note} onChange={(e) => updateLine(i, "note", e.target.value)} /></div>
            </div>
          ))}

          <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} onClick={addLine}>+ Add another line</button>

          <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitting || !valid}>
              {submitting ? <><span className="spinner" /> Saving…</> : "Save changes"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OrdersPage() {
  const navigate = useNavigate();
  const { sessionId, orderMsToken: authToken } = useAuth();
  const [manualToken, setManualToken] = useState<string>(
    () => localStorage.getItem(TOKEN_KEY) ?? ""
  );
  const [tokenInput, setTokenInput] = useState(manualToken);
  // Prefer the auto-generated token from login; fall back to manually entered one
  const token = authToken ?? manualToken;
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<OrderRecord | null>(null);
  const [editing, setEditing] = useState<OrderRecord | null>(null);
  const [showToken, setShowToken] = useState(false);

  const setBusyFor = (id: string, val: string | undefined) =>
    setBusy((b) => ({ ...b, [id]: val }));

  const headers = token ? { orderMsToken: token } : undefined;

  const load = useCallback(async () => {
    if (!sessionId) return;
    if (!token) {
      setOrders([]);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch<OrderRecord[] | { orders?: OrderRecord[] }>(
        "/orders",
        { headers: { orderMsToken: token } },
        sessionId
      );
      // OrderMS v1 returns an array; v2 returns { orders: [...] } — handle both.
      const arr = Array.isArray(data) ? data : data.orders ?? [];
      setOrders(arr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveToken = () => {
    const t = tokenInput.trim();
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setManualToken(t);
    setToast(t ? "OrderMS token saved" : "OrderMS token cleared");
    setTimeout(() => setToast(""), 2500);
  };

  const downloadOrderXml = async (orderId: string) => {
    if (!sessionId) return;
    setBusyFor(orderId, "xml");
    setToast("");
    try {
      await downloadXml(
        `/orders/${encodeURIComponent(orderId)}/xml`,
        `order-${orderId}.xml`,
        sessionId,
        headers ?? {}
      );
    } catch (e) {
      setToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(orderId, undefined);
    }
  };

  const deleteOrder = async (orderId: string) => {
    if (!sessionId) return;
    if (!window.confirm(`Delete order ${orderId}? This cannot be undone.`)) return;
    setBusyFor(orderId, "delete");
    setToast("");
    try {
      await apiFetch(
        `/orders/${encodeURIComponent(orderId)}`,
        { method: "DELETE", headers: headers ?? {} },
        sessionId
      );
      setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      setToast(`Deleted order ${orderId}`);
    } catch (e) {
      setToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(orderId, undefined);
    }
  };

  const submitUpdate = async (body: unknown) => {
    if (!sessionId || !editing) return;
    await apiFetch(
      `/orders/${encodeURIComponent(editing.orderId)}`,
      {
        method: "PUT",
        headers: headers ?? {},
        body: JSON.stringify(body),
      },
      sessionId
    );
    setEditing(null);
    setToast("Order updated");
    void load();
  };

  return (
    <>
      <TopBar
        title="Orders"
        subtitle="OrderMS UBL Ordering integration"
        right={
          <Link
            to="/app/orders/create"
            className="btn btn-primary"
            style={{ textDecoration: "none" }}
          >
            + New order
          </Link>
        }
      />

      <div className={`page-body ${styles.page}`}>
        {toast ? (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            {toast}
          </div>
        ) : null}

        {/* ── OrderMS token ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">OrderMS token</div>
          {authToken ? (
            <>
              <div className="card-sub">
                A token was automatically generated when you logged in.
              </div>
              <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>
                ✓ Token active (auto-generated)
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 8, fontSize: 12 }}
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? "Hide token" : "View token"}
              </button>
              {showToken && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    wordBreak: "break-all",
                    color: "var(--text)",
                    userSelect: "all",
                  }}
                >
                  {authToken}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="card-sub">
                No auto-token was returned at login. You can paste one manually from{" "}
                <a
                  href="https://docs.orderms.tech/"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  docs.orderms.tech
                </a>
                .
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label htmlFor="orderms-token">Token</label>
                  <input
                    id="orderms-token"
                    placeholder="Paste OrderMS token"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    type="password"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={saveToken}
                  style={{ flexShrink: 0 }}
                >
                  {tokenInput.trim() ? "Save" : "Clear"}
                </button>
              </div>
              {manualToken ? (
                <div style={{ fontSize: 11, color: "var(--green)", marginTop: 8 }}>
                  ✓ Manual token saved
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                  No token — you can still create orders anonymously, but the list
                  below will stay empty.
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Orders table ── */}
        <div className="card">
          <div className="card-title">Your orders</div>
          <div className="card-sub">Orders associated with your OrderMS token.</div>

          {err ? <div className="alert alert-err">{err}</div> : null}

          {loading ? (
            <div className={styles.centerMuted}>
              <span className="spinner" />
            </div>
          ) : !token ? (
            <div className="empty-state">
              <div className="empty-icon">🔐</div>
              <div className="empty-title">Set an OrderMS token to see your orders</div>
              <div className="empty-sub">Or click + New order to create one anonymously.</div>
            </div>
          ) : orders.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-title">No orders yet</div>
              <div className="empty-sub">Click + New order to create your first one.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document ID</th>
                    <th>Issue Date</th>
                    <th>Buyer</th>
                    <th>Created</th>
                    <th>Lines</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const f = orderFields(o);
                    const id = o.orderId;
                    return (
                      <tr key={id}>
                        <td className="primary">
                          {f.ID ?? id.slice(0, 12) + "…"}
                        </td>
                        <td>{f.IssueDate ?? "—"}</td>
                        <td>{partyName(f.BuyerCustomerParty)}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {o.createdAt ? o.createdAt.slice(0, 10) : "—"}
                        </td>
                        <td>{f.OrderLine?.length ?? 0}</td>
                        <td>
                          <div className={styles.actions}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => setSelected(o)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => setEditing(o)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => void downloadOrderXml(id)}
                              disabled={!!busy[id]}
                            >
                              {busy[id] === "xml" ? <span className="spinner" /> : "↓ XML"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => void deleteOrder(id)}
                              disabled={!!busy[id]}
                            >
                              {busy[id] === "delete" ? <span className="spinner" /> : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <OrderDetailModal order={selected} onClose={() => setSelected(null)} />
      ) : null}

      {editing ? (
        <OrderEditorModal
          order={editing}
          onSubmit={submitUpdate}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/order.module.css";

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

function OrderEditorModal({
  title,
  initialBody,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialBody: string;
  submitLabel: string;
  onSubmit: (body: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialBody);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErr(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setSubmitting(true);
    setErr("");
    try {
      await onSubmit(parsed);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <div className="card-title">{title}</div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          {err ? <div className="alert alert-err">{err}</div> : null}
          <div className="card-sub" style={{ marginBottom: 8 }}>
            Edit the UBL JSON body. The example matches the OrderMS v1 schema.
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={styles.editor}
            spellCheck={false}
          />
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? <span className="spinner" /> : submitLabel}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
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
                    <th>Seller</th>
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
                        <td>{partyName(f.SellerSupplierParty)}</td>
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
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px", color: "var(--green)" }}
                              onClick={() =>
                                navigate("/app/despatch/create", {
                                  state: { fromOrder: { ...o, _fields: f } },
                                })
                              }
                            >
                              Fulfil
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
          title={`Edit order — ${orderFields(editing).ID ?? editing.orderId}`}
          initialBody={JSON.stringify(orderFields(editing), null, 2)}
          submitLabel="Save changes →"
          onSubmit={submitUpdate}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/invoices.module.css";

type InvoiceRaw = {
  ID?: string;
  id?: string;
  user_id?: string;
  status?: string;
  created_at?: string;
  invoice_data?: Record<string, unknown>;
  xmlS3Key?: string;
};

type InvoiceRecord = InvoiceRaw & { _id: string };

function normalise(raw: InvoiceRaw): InvoiceRecord {
  return { ...raw, _id: raw.ID ?? raw.id ?? "" };
}

type InvoiceRef = {
  invoiceId: string;
  senderId: string;
  receiverId: string;
  despatchAdviceId?: string;
  createdAt?: string;
};

function statusColor(s?: string) {
  switch (s) {
    case "transformed":
    case "sent":
    case "paid":
      return "var(--green)";
    case "failed":
    case "overdue":
    case "cancelled":
      return "var(--red)";
    case "created":
    default:
      return "var(--muted)";
  }
}

function InvoiceDetailModal({
  invoice,
  onClose,
}: {
  invoice: InvoiceRecord;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-labelledby="invoice-detail-title">
        <div className="modal-header">
          <div>
            <div className="card-title" id="invoice-detail-title">
              Invoice {invoice._id.slice(0, 8)}...
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {invoice.created_at ?? "—"}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="section-label">Invoice Info</div>
          <div className="detail-grid">
            <div>
              <div className="detail-key">Invoice ID</div>
              <div className="detail-val">{invoice._id}</div>
            </div>
            <div>
              <div className="detail-key">Status</div>
              <div className="detail-val" style={{ color: statusColor(invoice.status) }}>
                {invoice.status ?? "—"}
              </div>
            </div>
            <div>
              <div className="detail-key">Created</div>
              <div className="detail-val">{invoice.created_at ?? "—"}</div>
            </div>
          </div>

          <div className="section-label">Raw payload</div>
          <pre className={styles.rawJson}>{JSON.stringify(invoice, null, 2)}</pre>

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

export default function InvoicesPage() {
  const { sessionId, invoiceToken, invoiceUserId } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<InvoiceRecord | null>(null);

  // Received invoices
  const [receivedRefs, setReceivedRefs] = useState<InvoiceRef[]>([]);
  const [receivedDetails, setReceivedDetails] = useState<Record<string, InvoiceRecord>>({});
  const [receivedLoading, setReceivedLoading] = useState(false);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});

  const setBusyFor = (id: string, val: string | undefined) =>
    setBusy((b) => ({ ...b, [id]: val }));

  const extraHeaders: Record<string, string> = {};
  if (invoiceToken) extraHeaders.invoiceToken = invoiceToken;
  if (invoiceUserId) extraHeaders.invoiceUserId = invoiceUserId;

  const load = useCallback(async () => {
    if (!sessionId || !invoiceToken || !invoiceUserId) {
      setInvoices([]);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch<InvoiceRaw[]>(
        "/invoices",
        { headers: { invoiceToken, invoiceUserId } },
        sessionId
      );
      const arr = Array.isArray(data) ? data.map(normalise) : [];
      setInvoices(arr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, invoiceToken, invoiceUserId]);

  const loadReceived = useCallback(async () => {
    if (!sessionId) return;
    setReceivedLoading(true);
    try {
      const refs = await apiFetch<InvoiceRef[]>(
        "/invoice-references/received",
        {},
        sessionId
      );
      const arr = Array.isArray(refs) ? refs : [];
      setReceivedRefs(arr);

      // Load sender usernames
      const clients = await apiFetch<{ clientId: string; username: string }[]>(
        "/clients",
        {},
        sessionId
      );
      const nameMap: Record<string, string> = {};
      for (const c of clients) {
        nameMap[c.clientId] = c.username;
      }
      setSenderNames(nameMap);

      // Fetch invoice details for each ref (best-effort, needs invoice token)
      if (invoiceToken) {
        const details: Record<string, InvoiceRecord> = {};
        for (const ref of arr) {
          try {
            const raw = await apiFetch<InvoiceRaw>(
              `/invoices/${encodeURIComponent(ref.invoiceId)}`,
              { headers: { invoiceToken } },
              sessionId
            );
            details[ref.invoiceId] = normalise(raw);
          } catch {
            // Seller's invoice — may not be accessible with buyer's token
          }
        }
        setReceivedDetails(details);
      }
    } catch {
      setReceivedRefs([]);
    } finally {
      setReceivedLoading(false);
    }
  }, [sessionId, invoiceToken]);

  useEffect(() => {
    void load();
    void loadReceived();
  }, [load, loadReceived]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const transformInvoice = async (invoiceId: string) => {
    if (!sessionId) return;
    setBusyFor(invoiceId, "transform");
    try {
      await apiFetch(
        `/invoices/${encodeURIComponent(invoiceId)}/transform`,
        { method: "POST", headers: extraHeaders },
        sessionId
      );
      flash("Invoice transformed to UBL XML");
      void load();
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(invoiceId, undefined);
    }
  };

  const validateInvoice = async (invoiceId: string) => {
    if (!sessionId) return;
    setBusyFor(invoiceId, "validate");
    try {
      const res = await apiFetch<{ valid?: boolean; errors?: string[]; message?: string }>(
        `/invoices/${encodeURIComponent(invoiceId)}/validate`,
        { method: "POST", headers: extraHeaders },
        sessionId
      );
      flash(
        res.valid !== false
          ? "Invoice is valid"
          : `Validation failed: ${res.message ?? res.errors?.join(", ") ?? "see details"}`
      );
      void load();
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(invoiceId, undefined);
    }
  };

  const downloadInvoiceXml = async (invoiceId: string) => {
    if (!sessionId) return;
    setBusyFor(invoiceId, "xml");
    try {
      await downloadXml(
        `/invoices/${encodeURIComponent(invoiceId)}/xml`,
        `invoice-${invoiceId}.xml`,
        sessionId,
        extraHeaders
      );
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(invoiceId, undefined);
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!sessionId) return;
    if (!window.confirm(`Delete invoice ${invoiceId.slice(0, 8)}...? This cannot be undone.`))
      return;
    setBusyFor(invoiceId, "delete");
    try {
      await apiFetch(
        `/invoices/${encodeURIComponent(invoiceId)}`,
        { method: "DELETE", headers: extraHeaders },
        sessionId
      );
      setInvoices((prev) => prev.filter((i) => i._id !== invoiceId));
      flash(`Deleted invoice ${invoiceId.slice(0, 8)}...`);
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(invoiceId, undefined);
    }
  };

  const hasToken = !!invoiceToken && !!invoiceUserId;

  return (
    <>
      <TopBar
        title="Invoices"
        subtitle="Invoice Generator API integration"
        right={
          hasToken ? (
            <Link
              to="/app/invoices/create"
              className="btn btn-primary"
              style={{ textDecoration: "none" }}
            >
              + New invoice
            </Link>
          ) : undefined
        }
      />

      <div className={`page-body ${styles.page}`}>
        {toast ? (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            {toast}
          </div>
        ) : null}

        {!hasToken && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Invoice API</div>
            <div className="card-sub">
              No Invoice API token was returned at login. Please log out and log back in
              to generate one automatically.
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              The token is created automatically during login — no manual setup required.
            </div>
          </div>
        )}

        {/* ── Sent invoices (your invoices) ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Sent invoices</div>
          <div className="card-sub">Invoices you have created and sent.</div>

          {err ? <div className="alert alert-err">{err}</div> : null}

          {loading ? (
            <div className={styles.centerMuted}>
              <span className="spinner" />
            </div>
          ) : !hasToken ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <div className="empty-title">Log in again to activate invoices</div>
              <div className="empty-sub">
                Your account will be linked to the Invoice API on next login.
              </div>
            </div>
          ) : invoices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <div className="empty-title">No sent invoices yet</div>
              <div className="empty-sub">Click + New invoice to create your first one.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice ID</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv._id}>
                      <td className="primary mono" style={{ fontSize: 11 }}>
                        {inv._id.slice(0, 12)}...
                      </td>
                      <td>
                        <span
                          style={{
                            color: statusColor(inv.status),
                            fontWeight: 600,
                            fontSize: 11,
                            textTransform: "uppercase",
                          }}
                        >
                          {inv.status ?? "—"}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {inv.created_at ? inv.created_at.slice(0, 10) : "—"}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => setSelected(inv)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void transformInvoice(inv._id)}
                            disabled={!!busy[inv._id]}
                          >
                            {busy[inv._id] === "transform" ? (
                              <span className="spinner" />
                            ) : (
                              "Transform"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void validateInvoice(inv._id)}
                            disabled={!!busy[inv._id]}
                          >
                            {busy[inv._id] === "validate" ? (
                              <span className="spinner" />
                            ) : (
                              "Validate"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void downloadInvoiceXml(inv._id)}
                            disabled={!!busy[inv._id]}
                          >
                            {busy[inv._id] === "xml" ? (
                              <span className="spinner" />
                            ) : (
                              "↓ XML"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void deleteInvoice(inv._id)}
                            disabled={!!busy[inv._id]}
                          >
                            {busy[inv._id] === "delete" ? (
                              <span className="spinner" />
                            ) : (
                              "Delete"
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Received invoices ── */}
        <div className="card">
          <div className="card-title">Received invoices</div>
          <div className="card-sub">Invoices sent to you by other users.</div>

          {receivedLoading ? (
            <div className={styles.centerMuted}>
              <span className="spinner" />
            </div>
          ) : receivedRefs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📥</div>
              <div className="empty-title">No received invoices</div>
              <div className="empty-sub">
                Invoices sent to you by sellers will appear here.
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice ID</th>
                    <th>From</th>
                    <th>Despatch Ref</th>
                    <th>Status</th>
                    <th>Received</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receivedRefs.map((ref) => {
                    const detail = receivedDetails[ref.invoiceId];
                    const senderName =
                      senderNames[ref.senderId] ?? ref.senderId.slice(0, 12) + "...";
                    return (
                      <tr key={ref.invoiceId}>
                        <td className="primary mono" style={{ fontSize: 11 }}>
                          {ref.invoiceId.slice(0, 12)}...
                        </td>
                        <td style={{ fontSize: 12 }}>{senderName}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {ref.despatchAdviceId
                            ? ref.despatchAdviceId.slice(0, 12) + "..."
                            : "—"}
                        </td>
                        <td>
                          <span
                            style={{
                              color: statusColor(detail?.status),
                              fontWeight: 600,
                              fontSize: 11,
                              textTransform: "uppercase",
                            }}
                          >
                            {detail?.status ?? "—"}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {ref.createdAt ? ref.createdAt.slice(0, 10) : "—"}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            {detail ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: 11, padding: "5px 8px" }}
                                onClick={() => setSelected(detail)}
                              >
                                View
                              </button>
                            ) : (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "var(--dim)",
                                  padding: "5px 8px",
                                }}
                              >
                                Details unavailable
                              </span>
                            )}
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
        <InvoiceDetailModal invoice={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

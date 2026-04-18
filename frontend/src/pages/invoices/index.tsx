import { useCallback, useEffect, useState } from "react";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/invoices.module.css";

type InvoiceRecord = {
  id: string;
  userId?: string;
  buyer_name?: string;
  total_amount?: string | number;
  currency?: string;
  status?: string;
  file_path?: string;
  created_at?: string;
  invoiceData?: Record<string, unknown>;
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
              Invoice {invoice.id.slice(0, 8)}...
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
              <div className="detail-val">{invoice.id}</div>
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

function InvoiceEditorModal({
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
            Edit the invoice JSON body. The schema matches the Invoice Generator API.
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

export default function InvoicesPage() {
  const { sessionId, invoiceToken, invoiceUserId } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<InvoiceRecord | null>(null);
  const [creating, setCreating] = useState(false);

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
      const data = await apiFetch<InvoiceRecord[]>(
        "/invoices",
        { headers: { invoiceToken, invoiceUserId } },
        sessionId
      );
      const arr = Array.isArray(data) ? data : [];
      setInvoices(arr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, invoiceToken, invoiceUserId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      flash(res.valid !== false ? "Invoice is valid" : `Validation failed: ${res.message ?? res.errors?.join(", ") ?? "see details"}`);
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
      setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
      flash(`Deleted invoice ${invoiceId.slice(0, 8)}...`);
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(invoiceId, undefined);
    }
  };

  const createTemplate = JSON.stringify(
    {
      userId: invoiceUserId ?? "",
      invoiceData: {
        ProfileID: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
        IssueDate: new Date().toISOString().slice(0, 10),
        DueDate: "",
        OrderReference: { ID: "" },
        Delivery: {
          ActualDeliveryDate: "",
          ActualDeliveryTime: "",
        },
        PaymentMeans: {
          PaymentMeansCode: "30",
          PaymentDueDate: "",
          PayeeFinancialAccount: { ID: "", Name: "", Currency: "AUD" },
        },
        Supplier: { Name: "", ID: "" },
        Customer: { Name: "", ID: "" },
        LegalMonetaryTotal: {
          Currency: "AUD",
          LineExtensionAmount: 0,
          TaxExclusiveAmount: 0,
          TaxInclusiveAmount: 0,
          AllowanceTotalAmount: 0,
          ChargeTotalAmount: 0,
          PrepaidAmount: 0,
          PayableAmount: 0,
        },
      },
    },
    null,
    2
  );

  const submitCreate = async (body: unknown) => {
    if (!sessionId) return;
    await apiFetch(
      "/invoices",
      {
        method: "POST",
        headers: extraHeaders,
        body: JSON.stringify(body),
      },
      sessionId
    );
    setCreating(false);
    flash("Invoice created");
    void load();
  };

  const hasToken = !!invoiceToken && !!invoiceUserId;

  return (
    <>
      <TopBar
        title="Invoices"
        subtitle="Invoice Generator API integration"
        right={
          hasToken ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              + New invoice
            </button>
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

        <div className="card">
          <div className="card-title">Your invoices</div>
          <div className="card-sub">Invoices from your linked Invoice API account.</div>

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
              <div className="empty-title">No invoices yet</div>
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
                    <tr key={inv.id}>
                      <td className="primary mono" style={{ fontSize: 11 }}>
                        {inv.id.slice(0, 12)}...
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
                            onClick={() => void transformInvoice(inv.id)}
                            disabled={!!busy[inv.id]}
                          >
                            {busy[inv.id] === "transform" ? (
                              <span className="spinner" />
                            ) : (
                              "Transform"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void validateInvoice(inv.id)}
                            disabled={!!busy[inv.id]}
                          >
                            {busy[inv.id] === "validate" ? (
                              <span className="spinner" />
                            ) : (
                              "Validate"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void downloadInvoiceXml(inv.id)}
                            disabled={!!busy[inv.id]}
                          >
                            {busy[inv.id] === "xml" ? (
                              <span className="spinner" />
                            ) : (
                              "↓ XML"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ fontSize: 11, padding: "5px 8px" }}
                            onClick={() => void deleteInvoice(inv.id)}
                            disabled={!!busy[inv.id]}
                          >
                            {busy[inv.id] === "delete" ? (
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
      </div>

      {selected ? (
        <InvoiceDetailModal invoice={selected} onClose={() => setSelected(null)} />
      ) : null}

      {creating ? (
        <InvoiceEditorModal
          title="Create invoice"
          initialBody={createTemplate}
          submitLabel="Create →"
          onSubmit={submitCreate}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

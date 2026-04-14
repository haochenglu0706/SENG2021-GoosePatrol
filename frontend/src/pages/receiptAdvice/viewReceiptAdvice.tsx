import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/view.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReceiptLine = {
  id?: string;
  receivedQuantity?: number;
  receivedQuantityUnitCode?: string;
  shortQuantity?: number;
  shortQuantityUnitCode?: string;
  note?: string;
  item?: { name?: string; description?: string };
};

type ReceiptAdviceRow = {
  receiptAdviceId: string;
  documentId?: string;
  despatchAdviceId?: string;
  senderId?: string;
  receiverId?: string;
  clientId?: string;
  documentStatusCode?: string;
  issueDate?: string;
  note?: string;
  receiptLines?: ReceiptLine[];
};

// ---------------------------------------------------------------------------
// Sub-component: detail modal
// ---------------------------------------------------------------------------

function ReceiptDetailModal({
  receipt: r,
  onClose,
}: {
  receipt: ReceiptAdviceRow;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-labelledby="receipt-detail-title">
        <div className="modal-header">
          <div>
            <div className="card-title" id="receipt-detail-title">
              {r.documentId ?? r.receiptAdviceId.slice(0, 18) + "…"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {r.documentStatusCode ?? "—"}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="section-label">Document Info</div>
          <div className={styles.detailGrid}>
            <div>
              <div className={styles.detailKey}>Receipt Advice ID</div>
              <div className={styles.detailVal}>{r.receiptAdviceId}</div>
            </div>
            <div>
              <div className={styles.detailKey}>Linked Despatch ID</div>
              <div className={styles.detailVal}>{r.despatchAdviceId ?? "—"}</div>
            </div>
            <div>
              <div className={styles.detailKey}>Sender</div>
              <div className={styles.detailVal}>{r.senderId ?? "—"}</div>
            </div>
            <div>
              <div className={styles.detailKey}>Receiver</div>
              <div className={styles.detailVal}>{r.receiverId ?? "—"}</div>
            </div>
            <div>
              <div className={styles.detailKey}>Issue Date</div>
              <div className={styles.detailVal}>{r.issueDate ?? "—"}</div>
            </div>
            <div>
              <div className={styles.detailKey}>Status</div>
              <div className={styles.detailVal} style={{ color: "var(--green)" }}>
                {r.documentStatusCode ?? "—"}
              </div>
            </div>
          </div>

          {r.note ? (
            <>
              <div className="section-label">Note</div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>{r.note}</p>
            </>
          ) : null}

          {r.receiptLines && r.receiptLines.length > 0 ? (
            <>
              <div className="section-label">
                Receipt Lines ({r.receiptLines.length})
              </div>
              {r.receiptLines.map((line, i) => (
                <div key={line.id ?? i} className={styles.lineCard}>
                  <div className={styles.lineCardHeader}>
                    <span className={styles.lineCardName}>
                      {line.item?.name ?? `Line ${i + 1}`}
                    </span>
                    <span className={styles.lineCardQty}>
                      {line.receivedQuantity ?? "?"} {line.receivedQuantityUnitCode ?? "EA"}
                      {line.shortQuantity != null && line.shortQuantity > 0 ? (
                        <span className={styles.shortBadge}>
                          −{line.shortQuantity} short
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {line.item?.description ? (
                    <div className={styles.lineCardDesc}>{line.item.description}</div>
                  ) : null}
                  {line.note ? (
                    <div className={styles.lineCardDesc} style={{ marginTop: 4, fontStyle: "italic" }}>
                      Note: {line.note}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}

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
// Main page
// ---------------------------------------------------------------------------

export default function ViewReceiptAdvicePage() {
  const { sessionId } = useAuth();

  const [receipts, setReceipts] = useState<ReceiptAdviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [selected, setSelected] = useState<ReceiptAdviceRow | null>(null);
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState("");

  const [addId, setAddId] = useState("");
  const [addErr, setAddErr] = useState("");

  // Load all receipt advices for this user from the server
  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setErr("");

    try {
      const rows = await apiFetch<ReceiptAdviceRow[]>(
        `/receipt-advices`,
        {},
        sessionId
      );
      setReceipts(rows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setBusyFor = (id: string, val: string | undefined) =>
    setBusy((b) => ({ ...b, [id]: val }));

  const downloadXmlForReceipt = async (id: string) => {
    if (!sessionId) return;
    setBusyFor(id, "xml");
    setToast("");
    try {
      await downloadXml(
        `/receipt-advices/${encodeURIComponent(id)}/ubl`,
        `receipt-${id}.xml`,
        sessionId
      );
    } catch (e) {
      setToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(id, undefined);
    }
  };

  const registerById = async () => {
    if (!sessionId || !addId.trim()) return;
    setAddErr("");
    try {
      await apiFetch<ReceiptAdviceRow>(
        `/receipt-advices/${encodeURIComponent(addId.trim())}`,
        {},
        sessionId
      );
      setAddId("");
      void load();
    } catch (e) {
      setAddErr((e as Error).message);
    }
  };

  return (
    <>
      <TopBar
        title="Receipt advices"
        subtitle="Receipts you have created or registered"
        right={
          <Link
            to="/app/receipt-advices/create"
            className="btn btn-primary"
            style={{ textDecoration: "none" }}
          >
            + New receipt
          </Link>
        }
      />

      <div className={`page-body ${styles.page}`}>
        {toast ? (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            {toast}
          </div>
        ) : null}

        <div className="card">
          <div className="card-title">Your receipt advices</div>
          <div className="card-sub">
            Showing receipts where you are the sender (receiver of goods). You can also register a
            receipt advice ID if it was shared with you.
          </div>

          {/* ── Register by ID ── */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 18 }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="add-receipt-id">Register receipt advice by ID</label>
              <input
                id="add-receipt-id"
                placeholder="Paste receipt advice UUID"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flexShrink: 0 }}
              onClick={() => void registerById()}
              disabled={!addId.trim()}
            >
              Register
            </button>
          </div>
          {addErr ? (
            <div className="alert alert-err" style={{ marginBottom: 12 }}>
              {addErr}
            </div>
          ) : null}

          {err ? <div className="alert alert-err">{err}</div> : null}

          {/* ── Table ── */}
          {loading ? (
            <div className={styles.centerMuted}>
              <span className="spinner" />
            </div>
          ) : receipts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <div className="empty-title">No receipt advices yet</div>
              <div className="empty-sub">
                <Link to="/app/receipt-advices/create">Create your first receipt advice</Link> by
                selecting a despatch sent to you.
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document ID</th>
                    <th>Linked Despatch</th>
                    <th>Status</th>
                    <th>Issue Date</th>
                    <th>Lines</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => {
                    const id = r.receiptAdviceId;
                    return (
                      <tr key={id}>
                        <td className="primary">{r.documentId ?? id.slice(0, 12) + "…"}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {r.despatchAdviceId
                            ? r.despatchAdviceId.slice(0, 14) + "…"
                            : "—"}
                        </td>
                        <td>
                          <span className="badge badge-green">
                            {r.documentStatusCode ?? "RECEIVED"}
                          </span>
                        </td>
                        <td>{r.issueDate ?? "—"}</td>
                        <td>
                          {r.receiptLines && r.receiptLines.length > 0 ? (
                            <div className={styles.linesSummary}>
                              {r.receiptLines.slice(0, 2).map((line, i) => (
                                <div key={line.id ?? i} className={styles.lineRow}>
                                  <div className={styles.lineDot} />
                                  {line.item?.name ?? `Line ${i + 1}`} ×{" "}
                                  {line.receivedQuantity ?? "?"}
                                </div>
                              ))}
                              {r.receiptLines.length > 2 ? (
                                <div className={styles.lineRow} style={{ color: "var(--dim)" }}>
                                  +{r.receiptLines.length - 2} more
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span style={{ color: "var(--dim)", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => setSelected(r)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => void downloadXmlForReceipt(id)}
                              disabled={!!busy[id]}
                            >
                              {busy[id] === "xml" ? <span className="spinner" /> : "↓ XML"}
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
        <ReceiptDetailModal receipt={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
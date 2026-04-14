import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, downloadXml } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import { DespatchDetailModal } from "../../components/despatch/DespatchDetailModal";
import { ReceiptAdviceCreateModal } from "../../components/despatch/ReceiptAdviceCreateModal";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { DespatchAdviceRow } from "../../types/despatch";
import { loadReceiptIds, rememberReceiptId } from "../../utils/receiptIndex";
import styles from "./style/view.module.css";

type ReceiptRow = {
  receiptAdviceId?: string;
  documentId?: string;
  despatchAdviceId?: string;
  documentStatusCode?: string;
  senderId?: string;
  receiverId?: string;
};

function docId(d: DespatchAdviceRow): string {
  return d.documentId ?? d.documentID ?? "—";
}

/** Statuses that prevent editing */
function canEdit(d: DespatchAdviceRow): boolean {
  const s = (d.status ?? "").toUpperCase();
  return s !== "RECEIVED" && s !== "FULFILMENT_CANCELLED";
}

export default function DespatchViewPage() {
  const { clientId, sessionId } = useAuth();
  const navigate = useNavigate();

  const [despatches, setDespatches] = useState<DespatchAdviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<DespatchAdviceRow | null>(null);
  const [receiptFor, setReceiptFor] = useState<DespatchAdviceRow | null>(null);
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState("");

  const [tab, setTab] = useState<"despatch" | "receipts">("despatch");
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptErr, setReceiptErr] = useState("");
  const [addReceiptId, setAddReceiptId] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch<DespatchAdviceRow[]>("/despatch-advices", {}, sessionId);
      setDespatches(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = despatches.filter((d) => d.senderId === clientId);

  const refreshReceipts = useCallback(async () => {
    if (!clientId || !sessionId) return;
    setReceiptLoading(true);
    setReceiptErr("");
    const ids = loadReceiptIds(clientId);
    const rows: ReceiptRow[] = [];
    for (const id of ids) {
      try {
        const row = await apiFetch<ReceiptRow>(`/receipt-advices/${encodeURIComponent(id)}`, {}, sessionId);
        const allowed =
          row.senderId === clientId ||
          row.receiverId === clientId ||
          (row as { clientId?: string }).clientId === clientId;
        if (allowed) rows.push({ ...row, receiptAdviceId: row.receiptAdviceId ?? id });
      } catch {
        /* skip removed or forbidden */
      }
    }
    setReceiptRows(rows);
    setReceiptLoading(false);
  }, [clientId, sessionId]);

  useEffect(() => {
    if (tab === "receipts") void refreshReceipts();
  }, [tab, refreshReceipts]);

  const setBusyFor = (id: string, val: string | undefined) =>
    setBusy((b) => ({ ...b, [id]: val }));

  const cancel = async (id: string) => {
    if (!sessionId) return;
    if (!window.confirm("Cancel this despatch? This cannot be undone.")) return;
    setBusyFor(id, "cancel");
    setToast("");
    try {
      await apiFetch(
        `/despatch-advices/${encodeURIComponent(id)}/fulfilment-cancellation`,
        { method: "POST", body: "{}" },
        sessionId
      );
      setToast("Despatch cancelled.");
      void load();
    } catch (e) {
      setToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(id, undefined);
    }
  };

  const downloadDespatchXml = async (id: string) => {
    setBusyFor(id, "xml");
    setToast("");
    try {
      await downloadXml(
        `/despatch-advices/${encodeURIComponent(id)}/ubl`,
        `despatch-${id}.xml`,
        null
      );
    } catch (e) {
      setToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusyFor(id, undefined);
    }
  };

  const downloadReceiptXml = async (id: string) => {
    if (!sessionId) return;
    setBusyFor(id, "rxml");
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

  const registerReceiptId = async () => {
    if (!clientId || !sessionId || !addReceiptId.trim()) return;
    setReceiptErr("");
    try {
      const row = await apiFetch<ReceiptRow>(
        `/receipt-advices/${encodeURIComponent(addReceiptId.trim())}`,
        {},
        sessionId
      );
      const allowed =
        row.senderId === clientId ||
        row.receiverId === clientId ||
        (row as { clientId?: string }).clientId === clientId;
      if (!allowed) {
        setReceiptErr("You do not have access to this receipt advice.");
        return;
      }
      rememberReceiptId(clientId, addReceiptId.trim());
      setAddReceiptId("");
      void refreshReceipts();
    } catch (e) {
      setReceiptErr((e as Error).message);
    }
  };

  const canCancel = (d: DespatchAdviceRow) => {
    const s = (d.status ?? "").toUpperCase();
    return s !== "RECEIVED" && s !== "FULFILMENT_CANCELLED";
  };

  const canReceipt = (d: DespatchAdviceRow) =>
    d.receiverId === clientId &&
    (d.status ?? "").toUpperCase() !== "RECEIVED" &&
    (d.status ?? "").toUpperCase() !== "FULFILMENT_CANCELLED";

  return (
    <>
      <TopBar
        title="Despatch advices"
        subtitle="Documents you send and receipt advices linked to your account"
        right={
          clientId ? (
            <div className="topbar-client">
              Client <span>{clientId.slice(0, 16)}…</span>
            </div>
          ) : null
        }
      />
      <div className={`page-body ${styles.page}`}>
        <div className="tabs">
          <button
            type="button"
            className={`tab${tab === "despatch" ? " active" : ""}`}
            onClick={() => setTab("despatch")}
          >
            My despatches
          </button>
          <button
            type="button"
            className={`tab${tab === "receipts" ? " active" : ""}`}
            onClick={() => setTab("receipts")}
          >
            Receipt advices
          </button>
          <Link to="/app/despatch/create" className="tab">
            + New despatch
          </Link>
          <Link to="/app/despatch/status" className="tab">
            Status
          </Link>
        </div>

        {toast ? (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            {toast}
          </div>
        ) : null}

        {tab === "despatch" ? (
          <div className="card">
            <div className="card-title">Sent by you</div>
            <div className="card-sub">
              Only rows where senderId matches your client ID are shown. Edit is available for
              despatches that are not yet received or cancelled.
            </div>
            {err ? <div className="alert alert-err">{err}</div> : null}
            {loading ? (
              <div className={styles.centerMuted}>
                <span className="spinner" />
              </div>
            ) : mine.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <div className="empty-title">No despatch advices yet</div>
                <div className="empty-sub">
                  <Link to="/app/despatch/create">Create your first despatch advice</Link>
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Document ID</th>
                      <th>Receiver</th>
                      <th>Issue date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((d) => (
                      <tr key={d.despatchAdviceId}>
                        <td className="primary">{docId(d)}</td>
                        <td className="mono">{d.receiverId}</td>
                        <td>{d.issueDate ?? "—"}</td>
                        <td>
                          <StatusBadge status={d.status} />
                        </td>
                        <td>
                          <div className={styles.actions}>
                            {/* View */}
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => setSelected(d)}
                            >
                              View
                            </button>

                            {/* ── Edit button (NEW) ── */}
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{
                                fontSize: 11,
                                padding: "5px 8px",
                                color: canEdit(d) ? "var(--blue)" : "var(--dim)",
                                cursor: canEdit(d) ? "pointer" : "not-allowed",
                              }}
                              title={
                                canEdit(d)
                                  ? "Edit this despatch advice"
                                  : `Cannot edit — status is ${d.status}`
                              }
                              onClick={() =>
                                canEdit(d) &&
                                navigate(`/app/despatch/edit/${encodeURIComponent(d.despatchAdviceId)}`)
                              }
                              disabled={!canEdit(d) || !!busy[d.despatchAdviceId]}
                            >
                              ✏ Edit
                            </button>

                            {/* Download XML */}
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => void downloadDespatchXml(d.despatchAdviceId)}
                              disabled={!!busy[d.despatchAdviceId]}
                            >
                              {busy[d.despatchAdviceId] === "xml" ? (
                                <span className="spinner" />
                              ) : (
                                "↓ XML"
                              )}
                            </button>

                            {/* Receipt */}
                            {canReceipt(d) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: 11, padding: "5px 8px" }}
                                onClick={() => setReceiptFor(d)}
                              >
                                Receipt
                              </button>
                            ) : null}

                            {/* Cancel */}
                            {canCancel(d) ? (
                              <button
                                type="button"
                                className="btn btn-danger"
                                style={{ fontSize: 11, padding: "5px 8px" }}
                                onClick={() => void cancel(d.despatchAdviceId)}
                                disabled={!!busy[d.despatchAdviceId]}
                              >
                                {busy[d.despatchAdviceId] === "cancel" ? (
                                  <span className="spinner" />
                                ) : (
                                  "Cancel"
                                )}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="card-title">Receipt advices</div>
            <div className="card-sub">
              Receipts you created or registered by ID (stored in this browser for your client).
            </div>
            {receiptErr ? <div className="alert alert-err">{receiptErr}</div> : null}
            <div className={`field-row ${styles.registerRow}`}>
              <div className="field" style={{ flex: 1 }}>
                <label>Add receipt advice ID</label>
                <input
                  placeholder="UUID from API or email"
                  value={addReceiptId}
                  onChange={(e) => setAddReceiptId(e.target.value)}
                />
              </div>
              <div className={styles.registerBtn}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void registerReceiptId()}
                  disabled={!addReceiptId.trim()}
                >
                  Register
                </button>
              </div>
            </div>
            {receiptLoading ? (
              <div className={styles.centerMuted}>
                <span className="spinner" />
              </div>
            ) : receiptRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🧾</div>
                <div className="empty-title">No receipt advices registered</div>
                <div className="empty-sub">
                  Create one from a despatch where you are the receiver, or paste an ID you are
                  allowed to read.
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Receipt ID</th>
                      <th>Document ID</th>
                      <th>Despatch</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptRows.map((r) => {
                      const id = r.receiptAdviceId ?? "";
                      return (
                        <tr key={id}>
                          <td className="mono primary">{id.slice(0, 12)}…</td>
                          <td>{r.documentId ?? "—"}</td>
                          <td className="mono">{r.despatchAdviceId ?? "—"}</td>
                          <td>{r.documentStatusCode ?? "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "5px 8px" }}
                              onClick={() => void downloadReceiptXml(id)}
                              disabled={!!busy[id]}
                            >
                              {busy[id] === "rxml" ? (
                                <span className="spinner" />
                              ) : (
                                "↓ XML"
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {selected ? (
        <DespatchDetailModal despatch={selected} onClose={() => setSelected(null)} />
      ) : null}
      {receiptFor && sessionId && clientId ? (
        <ReceiptAdviceCreateModal
          despatch={receiptFor}
          sessionId={sessionId}
          clientId={clientId}
          onClose={() => setReceiptFor(null)}
          onCreated={() => {
            void load();
            void refreshReceipts();
          }}
        />
      ) : null}
    </>
  );
}
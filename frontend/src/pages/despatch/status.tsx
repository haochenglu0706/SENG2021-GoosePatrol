import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import { despatchStatusLabel } from "../../components/ui/StatusBadge";
import type { DespatchAdviceRow } from "../../types/despatch";
import styles from "./style/status.module.css";

export default function DespatchStatusPage() {
  const { clientId, sessionId } = useAuth();
  const [rows, setRows] = useState<DespatchAdviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiFetch<DespatchAdviceRow[]>("/despatch-advices", {}, sessionId);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(() => rows.filter((d) => d.senderId === clientId), [rows, clientId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of mine) {
      const key = despatchStatusLabel(d.status);
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [mine]);

  return (
    <>
      <TopBar
        title="Despatch status"
        subtitle="Summary for documents you have sent"
        right={
          <Link to="/app/despatch/view" className="btn btn-secondary" style={{ textDecoration: "none" }}>
            Open list
          </Link>
        }
      />
      <div className={`page-body ${styles.page}`}>
        {err ? <div className="alert alert-err">{err}</div> : null}
        {loading ? (
          <div className={styles.center}>
            <span className="spinner" />
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              {Object.entries(counts).map(([label, n]) => (
                <div key={label} className="card">
                  <div className={styles.count}>{n}</div>
                  <div className={styles.label}>{label}</div>
                </div>
              ))}
              {mine.length === 0 ? (
                <div className="card" style={{ gridColumn: "1 / -1" }}>
                  <div className="card-title">No data</div>
                  <div className="card-sub">
                    <Link to="/app/despatch/create">Create a despatch advice</Link> to see status counts
                    here.
                  </div>
                </div>
              ) : null}
            </div>
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-title">By document</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Issue date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((d) => (
                      <tr key={d.despatchAdviceId}>
                        <td className="primary">{d.documentId ?? d.documentID ?? "—"}</td>
                        <td>{d.issueDate ?? "—"}</td>
                        <td>{despatchStatusLabel(d.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

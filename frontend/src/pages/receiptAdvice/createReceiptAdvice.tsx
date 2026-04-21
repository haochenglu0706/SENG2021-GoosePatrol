import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { rememberReceiptId } from "../../utils/receiptIndex";
import type { DespatchAdviceRow } from "../../types/despatch";
import styles from "./style/create.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreatedResult = {
  receiptAdviceId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docId(d: DespatchAdviceRow): string {
  return d.documentId ?? d.documentID ?? "—";
}

/**
 * Build the ReceiptAdviceCreateRequest body from a selected despatch advice.
 * Maps DespatchLines → ReceiptLines and copies all relevant party/shipment info.
 */
function buildReceiptBody(
  despatch: DespatchAdviceRow,
  clientId: string
): Record<string, unknown> {
  const sup = despatch.despatchSupplierParty?.party;
  const supAddr = sup?.postalAddress ?? {};
  const cust = despatch.deliveryCustomerParty?.party;
  const custAddr = cust?.postalAddress ?? {};

  // Map despatch lines → receipt lines
  const receiptLines = (despatch.despatchLines ?? []).map((line, i) => ({
    id: line.id ?? `LINE-${i + 1}`,
    receivedQuantity: line.deliveredQuantity ?? 1,
    receivedQuantityUnitCode: line.deliveredQuantityUnitCode ?? "EA",
    item: {
      name: line.item?.name ?? "Item",
      description: line.item?.description ?? "Received item",
    },
  }));

  // Fallback postal address if missing (required by API)
  const fallbackAddr = {
    streetName: "Unknown St",
    cityName: "Unknown",
    postalZone: "0000",
    countryIdentificationCode: "AU",
  };

  return {
    documentId: `RA-${docId(despatch)}-${Date.now().toString(36).toUpperCase()}`,
    senderId: clientId,
    receiverId: despatch.senderId ?? "",
    copyIndicator: false,
    documentStatusCode: "RECEIVED",
    issueDate: new Date().toISOString().slice(0, 10),
    orderReference: { id: despatch.orderReference?.id ?? "ORD-REF" },
    despatchDocumentReference: { id: docId(despatch) },
    despatchSupplierParty: {
      party: {
        name: sup?.name ?? "Supplier",
        postalAddress: {
          streetName: supAddr.streetName ?? fallbackAddr.streetName,
          cityName: supAddr.cityName ?? fallbackAddr.cityName,
          postalZone: supAddr.postalZone ?? fallbackAddr.postalZone,
          countryIdentificationCode:
            supAddr.countryIdentificationCode ?? fallbackAddr.countryIdentificationCode,
          ...(supAddr.buildingName ? { buildingName: supAddr.buildingName } : {}),
          ...(supAddr.addressLine ? { addressLine: supAddr.addressLine } : {}),
        },
      },
    },
    deliveryCustomerParty: {
      party: {
        name: cust?.name ?? "Customer",
        postalAddress: {
          streetName: custAddr.streetName ?? fallbackAddr.streetName,
          cityName: custAddr.cityName ?? fallbackAddr.cityName,
          postalZone: custAddr.postalZone ?? fallbackAddr.postalZone,
          countryIdentificationCode:
            custAddr.countryIdentificationCode ?? fallbackAddr.countryIdentificationCode,
        },
      },
    },
    shipment: {
      id: `SHIP-REC-${Date.now().toString(36).toUpperCase()}`,
      consignmentId: `CONS-REC-${Date.now().toString(36).toUpperCase()}`,
      delivery: {},
    },
    receiptLines,
  };
}

function buildInvoiceBody(
  despatch: DespatchAdviceRow,
  invoiceUserId: string
): Record<string, unknown> {
  const today = new Date();
  const issueDate = today.toISOString().split("T")[0];
  const dueDate = new Date(today.getTime() + 30 * 86400000).toISOString().split("T")[0];

  return {
    userId: invoiceUserId,
    invoiceData: {
      ProfileID: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      IssueDate: issueDate,
      DueDate: dueDate,
      OrderReference: { ID: despatch.orderReference?.id ?? undefined },
      Delivery: {
        ActualDeliveryDate: despatch.issueDate ?? issueDate,
      },
      PaymentMeans: {
        PaymentMeansCode: "30",
        PaymentDueDate: dueDate,
        PayeeFinancialAccount: {
          Currency: "AUD",
        },
      },
      Supplier: {
        Name: despatch.despatchSupplierParty?.party?.name ?? "Supplier",
        ID: despatch.senderId ?? undefined,
      },
      Customer: {
        Name: despatch.deliveryCustomerParty?.party?.name ?? "Customer",
        ID: despatch.receiverId ?? undefined,
      },
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
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateReceiptAdvicePage() {
  const navigate = useNavigate();
  const { clientId, sessionId, invoiceToken, invoiceUserId } = useAuth();

  const [despatches, setDespatches] = useState<DespatchAdviceRow[]>([]);
  const [loadingDespatches, setLoadingDespatches] = useState(false);
  const [fetchErr, setFetchErr] = useState("");

  const [selected, setSelected] = useState<DespatchAdviceRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<"idle" | "generating" | "done" | "failed">("idle");
  const [emailStatus, setEmailStatus] = useState<"sent" | "failed" | "unknown">("unknown");
  const autoInvoiceTriggeredRef = useRef(false);

  // Load receivable despatches — rows where I am the receiver and not yet received/cancelled
  const loadDespatches = useCallback(async () => {
    if (!sessionId) return;
    setLoadingDespatches(true);
    setFetchErr("");
    try {
      const data = await apiFetch<DespatchAdviceRow[]>("/despatch-advices", {}, sessionId);
      const eligible = (Array.isArray(data) ? data : []).filter((d) => {
        const s = (d.status ?? "").toUpperCase();
        return (
          d.receiverId === clientId &&
          s !== "RECEIVED" &&
          s !== "FULFILMENT_CANCELLED"
        );
      });
      setDespatches(eligible);
    } catch (e) {
      setFetchErr((e as Error).message);
    } finally {
      setLoadingDespatches(false);
    }
  }, [sessionId, clientId]);

  useEffect(() => {
    void loadDespatches();
  }, [loadDespatches]);

  const submit = async () => {
    if (!selected || !clientId || !sessionId) return;
    setErr("");
    setLoading(true);
    autoInvoiceTriggeredRef.current = false;
    setInvoiceStatus("idle");
    setEmailStatus("unknown");
    try {
      const body = buildReceiptBody(selected, clientId);
      const res = await apiFetch<CreatedResult>(
        `/despatch-advices/${selected.despatchAdviceId}/receipt-advices`,
        { method: "POST", body: JSON.stringify(body) },
        sessionId
      );
      setCreatedId(res.receiptAdviceId);
      rememberReceiptId(clientId, res.receiptAdviceId);

      if (
        autoInvoiceTriggeredRef.current ||
        !invoiceToken ||
        !invoiceUserId
      ) {
        return;
      }

      autoInvoiceTriggeredRef.current = true;
      setInvoiceStatus("generating");

      try {
        const invoiceRes = await apiFetch<{ invoiceId?: string }>(
          "/invoices",
          {
            method: "POST",
            headers: {
              invoiceToken,
              invoiceUserId,
            },
            body: JSON.stringify(buildInvoiceBody(selected, invoiceUserId)),
          },
          sessionId
        );

        if (!invoiceRes.invoiceId) {
          throw new Error("Invoice API did not return an invoiceId");
        }

        await apiFetch(
          "/invoice-references",
          {
            method: "POST",
            body: JSON.stringify({
              invoiceId: invoiceRes.invoiceId,
              senderId: clientId,
              receiverId: selected.senderId,
              despatchAdviceId: selected.despatchAdviceId,
            }),
          },
          sessionId
        );

        setInvoiceStatus("done");
        setEmailStatus("sent");
      } catch (invoiceError) {
        console.warn("Auto invoice generation failed", invoiceError);
        setInvoiceStatus("failed");
        setEmailStatus("failed");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = selected !== null && !loading && !createdId;

  return (
    <>
      <TopBar
        title="Create receipt advice"
        subtitle="Auto-generated from a selected despatch advice"
        right={
          clientId ? (
            <div className="topbar-client">
              Client <span>{clientId.slice(0, 16)}…</span>
            </div>
          ) : null
        }
      />

      <div className={`page-body ${styles.page}`}>
        {/* ── Success state ── */}
        {createdId ? (
          <div className="card">
            <div className={styles.successBox}>
              <div className={styles.successIcon}>✅</div>
              <div className="card-title">Receipt advice created</div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                Your receipt advice has been submitted and the despatch status has been updated to{" "}
                <strong style={{ color: "var(--green)" }}>RECEIVED</strong>.
              </p>
              <div className={styles.successId}>
                Receipt Advice ID: <strong>{createdId}</strong>
              </div>
              {invoiceStatus === "generating" && (
                <div className="alert alert-info">⚙ Generating invoice automatically…</div>
              )}
              {invoiceStatus === "done" && (
                <div className="alert alert-ok">✅ Invoice auto-generated and sent to supplier.</div>
              )}
              {invoiceStatus === "failed" && (
                <div className="alert alert-err">
                  ⚠ Receipt confirmed, but invoice generation failed. You can create it manually.
                  <Link to="/app/invoices/create"> Create Invoice →</Link>
                </div>
              )}
              {emailStatus === "failed" && (
                <div className="alert alert-info">Notification status unknown. Receipt remains confirmed.</div>
              )}
              <div className={styles.actions} style={{ justifyContent: "center", marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate("/app/receipt-advices/view")}
                >
                  View receipt advices →
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setCreatedId(null);
                    setSelected(null);
                    setInvoiceStatus("idle");
                    setEmailStatus("unknown");
                    autoInvoiceTriggeredRef.current = false;
                    void loadDespatches();
                  }}
                >
                  Create another
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-title">Select a despatch advice to receive</div>
            <div className="card-sub">
              Only despatches sent to you that are not yet received or cancelled are shown. The
              receipt advice is built automatically from the selected despatch — no manual input
              required.
            </div>

            {err ? <div className="alert alert-err">{err}</div> : null}
            {fetchErr ? <div className="alert alert-err">{fetchErr}</div> : null}

            {/* ── Despatch picker ── */}
            <div className="section-label">Available despatches</div>

            {loadingDespatches ? (
              <div className={styles.centerMuted ?? "alert alert-info"} style={{ textAlign: "center", padding: 32 }}>
                <span className="spinner" />
              </div>
            ) : despatches.length === 0 ? (
              <div className={styles.emptySelect}>
                <div className={styles.emptySelectIcon}>📭</div>
                <div className={styles.emptySelectText}>
                  No eligible despatches found. You must be the <strong>receiver</strong> of a
                  despatch that is not yet received or cancelled.
                </div>
              </div>
            ) : (
              <div className={styles.scrollList}>
                {despatches.map((d) => (
                  <div
                    key={d.despatchAdviceId}
                    className={`${styles.selectCard} ${
                      selected?.despatchAdviceId === d.despatchAdviceId
                        ? styles.selectCardSelected
                        : ""
                    }`}
                    onClick={() => setSelected(d)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(d)}
                  >
                    <div className={styles.selectCardLeft}>
                      <div className={styles.selectCardId}>{docId(d)}</div>
                      <div className={styles.selectCardMeta}>
                        From: {d.senderId} · {d.issueDate ?? "—"} ·{" "}
                        {(d.despatchLines ?? []).length} line(s)
                      </div>
                    </div>
                    <div className={styles.selectCardRight}>
                      <StatusBadge status={d.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Preview of what will be submitted ── */}
            {selected ? (
              <>
                <div className="section-label">Receipt preview</div>
                <div className={styles.previewCard}>
                  <div className={styles.previewGrid}>
                    <div>
                      <div className={styles.previewKey}>Receipt Document ID</div>
                      <div className={styles.previewVal} style={{ color: "var(--accent)" }}>
                        RA-{docId(selected)}-&lt;auto&gt;
                      </div>
                    </div>
                    <div>
                      <div className={styles.previewKey}>Issue Date</div>
                      <div className={styles.previewVal}>
                        {new Date().toISOString().slice(0, 10)}
                      </div>
                    </div>
                    <div>
                      <div className={styles.previewKey}>Sender (you)</div>
                      <div className={styles.previewVal}>{clientId}</div>
                    </div>
                    <div>
                      <div className={styles.previewKey}>Receiver (supplier)</div>
                      <div className={styles.previewVal}>{selected.senderId}</div>
                    </div>
                    <div>
                      <div className={styles.previewKey}>Order Reference</div>
                      <div className={styles.previewVal}>
                        {selected.orderReference?.id ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className={styles.previewKey}>Status</div>
                      <div className={styles.previewVal} style={{ color: "var(--green)" }}>
                        RECEIVED
                      </div>
                    </div>
                  </div>
                </div>

                <div className="section-label">
                  Receipt lines ({(selected.despatchLines ?? []).length})
                </div>
                {(selected.despatchLines ?? []).map((line, i) => (
                  <div key={line.id ?? i} className={styles.lineItem}>
                    <div className={styles.lineLeft}>
                      <div className={styles.lineName}>{line.item?.name ?? `Line ${i + 1}`}</div>
                      <div className={styles.lineDesc}>{line.item?.description ?? "—"}</div>
                    </div>
                    <div className={styles.lineRight}>
                      <div className={styles.lineQty}>{line.deliveredQuantity ?? "?"}</div>
                      <div className={styles.lineUnit}>{line.deliveredQuantityUnitCode ?? "EA"}</div>
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            <div className={styles.actions}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {loading ? (
                  <>
                    <span className="spinner" /> Submitting…
                  </>
                ) : (
                  "Confirm receipt →"
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate("/app/receipt-advices/view")}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
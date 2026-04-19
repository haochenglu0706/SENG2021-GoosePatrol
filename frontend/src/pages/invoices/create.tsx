import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import type { DespatchAdviceRow } from "../../types/despatch";
import styles from "./style/create.module.css";

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const { clientId, sessionId, invoiceToken, invoiceUserId } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  const dueDateDefault = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .split("T")[0];

  const [f, setF] = useState({
    issueDate: today,
    dueDate: dueDateDefault,
    orderRefId: "",
    supplierName: "",
    supplierId: "",
    customerName: "",
    customerId: "",
    currency: "AUD",
    lineExtensionAmount: "0",
    taxExclusiveAmount: "0",
    taxInclusiveAmount: "0",
    allowanceTotalAmount: "0",
    chargeTotalAmount: "0",
    prepaidAmount: "0",
    payableAmount: "0",
    paymentMeansCode: "30",
    paymentDueDate: dueDateDefault,
    accountId: "",
    accountName: "",
    accountCurrency: "AUD",
    deliveryDate: "",
    deliveryTime: "",
    note: "",
  });

  const [clients, setClients] = useState<{ clientId: string; username: string }[]>([]);
  const [clientsErr, setClientsErr] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [receiverOpen, setReceiverOpen] = useState(false);
  const receiverRef = useRef<HTMLDivElement>(null);

  const [receiverDespatches, setReceiverDespatches] = useState<DespatchAdviceRow[]>([]);
  const [despatchesLoading, setDespatchesLoading] = useState(false);
  const [selectedDespatchId, setSelectedDespatchId] = useState<string | null>(null);
  const [preSnapshot, setPreSnapshot] = useState<typeof f | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const extraHeaders: Record<string, string> = {};
  if (invoiceToken) extraHeaders.invoiceToken = invoiceToken;
  if (invoiceUserId) extraHeaders.invoiceUserId = invoiceUserId;

  useEffect(() => {
    if (!sessionId) return;
    apiFetch<{ clientId: string; username: string }[]>("/clients", {}, sessionId)
      .then((data) => setClients(data.filter((c) => c.clientId !== clientId)))
      .catch((e: Error) => setClientsErr(e.message));
  }, [sessionId, clientId]);

  // Fetch despatches where this receiver is the receiverId
  useEffect(() => {
    if (!receiverId || !sessionId) {
      setReceiverDespatches([]);
      setSelectedDespatchId(null);
      return;
    }
    setDespatchesLoading(true);
    setReceiverDespatches([]);
    setSelectedDespatchId(null);
    apiFetch<DespatchAdviceRow[]>("/despatch-advices", {}, sessionId)
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setReceiverDespatches(
          list.filter((d) => d.receiverId === receiverId)
        );
      })
      .catch(() => setReceiverDespatches([]))
      .finally(() => setDespatchesLoading(false));
  }, [receiverId, sessionId]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (receiverRef.current && !receiverRef.current.contains(e.target as Node)) {
        setReceiverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function applyDespatch(desp: DespatchAdviceRow) {
    const id = desp.despatchAdviceId;

    if (selectedDespatchId === id) {
      if (preSnapshot) setF(preSnapshot);
      setPreSnapshot(null);
      setSelectedDespatchId(null);
      return;
    }

    if (!selectedDespatchId) {
      setPreSnapshot({ ...f });
    }

    const supplier = desp.despatchSupplierParty?.party;
    const customer = desp.deliveryCustomerParty?.party;
    const firstLine = desp.despatchLines?.[0];
    const base = preSnapshot ?? f;

    setF({
      ...base,
      orderRefId: desp.orderReference?.id ?? base.orderRefId,
      supplierName: supplier?.name ?? base.supplierName,
      supplierId: desp.senderId ?? base.supplierId,
      customerName: customer?.name ?? base.customerName,
      customerId: desp.receiverId ?? base.customerId,
      note: desp.note ?? base.note,
      deliveryDate: desp.issueDate ?? base.deliveryDate,
    });
    setSelectedDespatchId(id);
  }

  const set =
    (k: keyof typeof f) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!sessionId || !invoiceToken || !invoiceUserId) return;
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const body = {
        userId: invoiceUserId,
        invoiceData: {
          ProfileID: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
          IssueDate: f.issueDate,
          DueDate: f.dueDate,
          OrderReference: { ID: f.orderRefId || undefined },
          Delivery: {
            ActualDeliveryDate: f.deliveryDate || undefined,
            ActualDeliveryTime: f.deliveryTime || undefined,
          },
          PaymentMeans: {
            PaymentMeansCode: f.paymentMeansCode,
            PaymentDueDate: f.paymentDueDate,
            PayeeFinancialAccount: {
              ID: f.accountId || undefined,
              Name: f.accountName || undefined,
              Currency: f.accountCurrency,
            },
          },
          Supplier: { Name: f.supplierName, ID: f.supplierId || undefined },
          Customer: { Name: f.customerName, ID: f.customerId || undefined },
          LegalMonetaryTotal: {
            Currency: f.currency,
            LineExtensionAmount: parseFloat(f.lineExtensionAmount) || 0,
            TaxExclusiveAmount: parseFloat(f.taxExclusiveAmount) || 0,
            TaxInclusiveAmount: parseFloat(f.taxInclusiveAmount) || 0,
            AllowanceTotalAmount: parseFloat(f.allowanceTotalAmount) || 0,
            ChargeTotalAmount: parseFloat(f.chargeTotalAmount) || 0,
            PrepaidAmount: parseFloat(f.prepaidAmount) || 0,
            PayableAmount: parseFloat(f.payableAmount) || 0,
          },
        },
      };
      const res = await apiFetch<{ invoiceId?: string }>(
        "/invoices",
        {
          method: "POST",
          headers: extraHeaders,
          body: JSON.stringify(body),
        },
        sessionId
      );

      // Save reference so the receiver can see this invoice
      if (res.invoiceId && receiverId && clientId) {
        await apiFetch(
          "/invoice-references",
          {
            method: "POST",
            body: JSON.stringify({
              invoiceId: res.invoiceId,
              senderId: clientId,
              receiverId,
              despatchAdviceId: selectedDespatchId ?? undefined,
            }),
          },
          sessionId
        ).catch(() => {});
      }

      setOk("Invoice created successfully!");
      setTimeout(() => navigate("/app/invoices"), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const valid = f.supplierName.trim() && f.customerName.trim();

  if (!invoiceToken || !invoiceUserId) {
    return (
      <>
        <TopBar title="Create invoice" subtitle="Invoice Generator API" />
        <div className={`page-body ${styles.page}`}>
          <div className="card">
            <div className="card-title">No Invoice API token</div>
            <div className="card-sub">
              Please log out and log back in to generate an invoice token automatically.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Create invoice"
        subtitle="Auto-fill from a despatch advice"
        right={
          clientId ? (
            <div className="topbar-client">
              Sender ID <span>{clientId.slice(0, 18)}...</span>
            </div>
          ) : null
        }
      />
      <div className={`page-body ${styles.page}`}>
        <div className="card">
          <div className="card-title">New invoice</div>
          <div className="card-sub">
            Select a receiver to see their despatch advices, then pick one to auto-fill.
          </div>

          {err ? <div className="alert alert-err">{err}</div> : null}
          {ok ? <div className="alert alert-ok">{ok}</div> : null}

          {/* ── Receiver picker ── */}
          <div className="section-label">Receiver</div>
          <div className={styles.receiverDropdown} ref={receiverRef}>
            <button
              type="button"
              className={styles.receiverTrigger}
              onClick={() => setReceiverOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={receiverOpen}
            >
              {receiverId ? (() => {
                const c = clients.find((c) => c.clientId === receiverId);
                return c ? (
                  <div>
                    <div className={styles.receiverTriggerName}>{c.username}</div>
                    <div className={styles.receiverTriggerSub}>{c.clientId}</div>
                  </div>
                ) : (
                  <span className={styles.receiverTriggerPlaceholder}>
                    — Select a receiver —
                  </span>
                );
              })() : (
                <span className={styles.receiverTriggerPlaceholder}>
                  — Select a receiver —
                </span>
              )}
              <span style={{ fontSize: 9, color: "var(--dim)" }}>
                {receiverOpen ? "▲" : "▼"}
              </span>
            </button>
            {receiverOpen && (
              <div className={styles.receiverMenu} role="listbox">
                {clientsErr ? (
                  <div
                    className={styles.receiverOption}
                    style={{ color: "var(--red)", cursor: "default" }}
                  >
                    Error: {clientsErr}
                  </div>
                ) : clients.length === 0 ? (
                  <div
                    className={styles.receiverOption}
                    style={{ color: "var(--muted)", cursor: "default" }}
                  >
                    No other users found
                  </div>
                ) : (
                  clients.map((c) => (
                    <div
                      key={c.clientId}
                      role="option"
                      aria-selected={receiverId === c.clientId}
                      className={`${styles.receiverOption} ${
                        receiverId === c.clientId ? styles.receiverOptionActive : ""
                      }`}
                      onClick={() => {
                        setReceiverId(c.clientId);
                        setReceiverOpen(false);
                      }}
                    >
                      <div className={styles.receiverOptionName}>{c.username}</div>
                      <div className={styles.receiverOptionId}>{c.clientId}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Despatch picker ── */}
          {receiverId && (
            <div className={styles.despatchPicker}>
              <div className={styles.despatchPickerTitle}>
                Despatches for{" "}
                {clients.find((c) => c.clientId === receiverId)?.username ?? "this user"}
              </div>
              {despatchesLoading ? (
                <div className={styles.despatchPickerEmpty}>
                  <span className="spinner" /> Loading despatches...
                </div>
              ) : receiverDespatches.length === 0 ? (
                <div className={styles.despatchPickerEmpty}>
                  No despatches found for this receiver
                </div>
              ) : (
                <div className={styles.despatchList}>
                  {receiverDespatches.map((d) => {
                    const id = d.despatchAdviceId;
                    const supplier = d.despatchSupplierParty?.party?.name ?? "—";
                    const customer = d.deliveryCustomerParty?.party?.name ?? "—";
                    const lines = d.despatchLines?.length ?? 0;
                    const isSelected = selectedDespatchId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`${styles.despatchCard} ${
                          isSelected ? styles.despatchCardActive : ""
                        }`}
                        onClick={() => applyDespatch(d)}
                      >
                        <div className={styles.despatchCardId}>
                          {d.documentId ?? d.documentID ?? id.slice(0, 12) + "..."}
                        </div>
                        <div className={styles.despatchCardMeta}>
                          {supplier} → {customer} · {lines} line
                          {lines !== 1 ? "s" : ""}
                        </div>
                        <div className={styles.despatchCardDate}>
                          {d.issueDate ?? "—"} · {d.status ?? "—"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selectedDespatchId && (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              Auto-filled from despatch{" "}
              <strong>
                {receiverDespatches.find((d) => d.despatchAdviceId === selectedDespatchId)
                  ?.documentId ?? selectedDespatchId.slice(0, 12) + "..."}
              </strong>
              . Review and adjust fields below.
            </div>
          )}

          {/* ── Invoice fields ── */}
          <div className="section-label">Document info</div>
          <div className="field-row">
            <div className="field">
              <label>Issue date</label>
              <input type="date" value={f.issueDate} onChange={set("issueDate")} />
            </div>
            <div className="field">
              <label>Due date</label>
              <input type="date" value={f.dueDate} onChange={set("dueDate")} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Order reference ID</label>
              <input
                placeholder="ORD-001"
                value={f.orderRefId}
                onChange={set("orderRefId")}
              />
            </div>
            <div className="field">
              <label>Currency</label>
              <input
                placeholder="AUD"
                value={f.currency}
                onChange={set("currency")}
                maxLength={3}
              />
            </div>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <textarea
              placeholder="General note"
              value={f.note}
              onChange={set("note")}
              style={{ minHeight: 50 }}
            />
          </div>

          <div className="section-label">Supplier (seller)</div>
          <div className="field-row">
            <div className="field">
              <label>Name *</label>
              <input
                placeholder="Acme Supplies Ltd"
                value={f.supplierName}
                onChange={set("supplierName")}
              />
            </div>
            <div className="field">
              <label>Supplier ID</label>
              <input
                placeholder="SUP-001"
                value={f.supplierId}
                onChange={set("supplierId")}
              />
            </div>
          </div>

          <div className="section-label">Customer (buyer)</div>
          <div className="field-row">
            <div className="field">
              <label>Name *</label>
              <input
                placeholder="Client Co"
                value={f.customerName}
                onChange={set("customerName")}
              />
            </div>
            <div className="field">
              <label>Customer ID</label>
              <input
                placeholder="CUST-001"
                value={f.customerId}
                onChange={set("customerId")}
              />
            </div>
          </div>

          <div className="section-label">Delivery</div>
          <div className="field-row">
            <div className="field">
              <label>Delivery date</label>
              <input
                type="date"
                value={f.deliveryDate}
                onChange={set("deliveryDate")}
              />
            </div>
            <div className="field">
              <label>Delivery time</label>
              <input
                type="time"
                value={f.deliveryTime}
                onChange={set("deliveryTime")}
              />
            </div>
          </div>

          <div className="section-label">Payment means</div>
          <div className="field-row-3">
            <div className="field">
              <label>Payment means code</label>
              <input value={f.paymentMeansCode} onChange={set("paymentMeansCode")} />
            </div>
            <div className="field">
              <label>Payment due date</label>
              <input
                type="date"
                value={f.paymentDueDate}
                onChange={set("paymentDueDate")}
              />
            </div>
            <div className="field">
              <label>Account currency</label>
              <input
                value={f.accountCurrency}
                onChange={set("accountCurrency")}
                maxLength={3}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Account ID (IBAN etc.)</label>
              <input
                placeholder="GB29NWBK60161331926819"
                value={f.accountId}
                onChange={set("accountId")}
              />
            </div>
            <div className="field">
              <label>Account name</label>
              <input
                placeholder="Acme Supplies"
                value={f.accountName}
                onChange={set("accountName")}
              />
            </div>
          </div>

          <div className="section-label">Legal monetary total</div>
          <div className="field-row-3">
            <div className="field">
              <label>Line extension</label>
              <input
                type="number"
                step="0.01"
                value={f.lineExtensionAmount}
                onChange={set("lineExtensionAmount")}
              />
            </div>
            <div className="field">
              <label>Tax exclusive</label>
              <input
                type="number"
                step="0.01"
                value={f.taxExclusiveAmount}
                onChange={set("taxExclusiveAmount")}
              />
            </div>
            <div className="field">
              <label>Tax inclusive</label>
              <input
                type="number"
                step="0.01"
                value={f.taxInclusiveAmount}
                onChange={set("taxInclusiveAmount")}
              />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Allowance total</label>
              <input
                type="number"
                step="0.01"
                value={f.allowanceTotalAmount}
                onChange={set("allowanceTotalAmount")}
              />
            </div>
            <div className="field">
              <label>Charge total</label>
              <input
                type="number"
                step="0.01"
                value={f.chargeTotalAmount}
                onChange={set("chargeTotalAmount")}
              />
            </div>
            <div className="field">
              <label>Prepaid</label>
              <input
                type="number"
                step="0.01"
                value={f.prepaidAmount}
                onChange={set("prepaidAmount")}
              />
            </div>
          </div>
          <div className="field">
            <label>Payable amount</label>
            <input
              type="number"
              step="0.01"
              value={f.payableAmount}
              onChange={set("payableAmount")}
            />
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={loading || !valid}
            >
              {loading ? (
                <>
                  <span className="spinner" /> Creating...
                </>
              ) : (
                "Create invoice →"
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/app/invoices")}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

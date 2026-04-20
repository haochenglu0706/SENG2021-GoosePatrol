import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/create.module.css";

type DespatchLine = {
  id: string;
  qty: string;
  unit: string;
  orderRef: string;
  itemName: string;
  itemDesc: string;
};

function orderLinesToDespatchLines(orderLines: any[], orderId: string): DespatchLine[] {
  if (!Array.isArray(orderLines) || orderLines.length === 0) {
    return [{ id: "LINE-1", qty: "1", unit: "EA", orderRef: orderId, itemName: "", itemDesc: "" }];
  }
  return orderLines.map((ol: any, i: number) => {
    const li = ol.LineItem ?? {};
    const item = li.Item ?? {};
    const qty = ol.Quantity ?? li.Quantity ?? 1;
    const unit = ol.QuantityUnitCode ?? li.QuantityUnitCode ?? "EA";
    return {
      id: li.ID ?? `LINE-${i + 1}`,
      qty: String(qty),
      unit: String(unit),
      orderRef: orderId,
      itemName: item.Name ?? "",
      itemDesc: Array.isArray(item.Description)
        ? item.Description.join(", ")
        : item.Description ?? "",
    };
  });
}

function defaultLine(idx: number, orderRef: string): DespatchLine {
  return {
    id: `LINE-${idx + 1}`,
    qty: "1",
    unit: "EA",
    orderRef,
    itemName: "",
    itemDesc: "",
  };
}

export default function DespatchCreatePage() {
  const navigate = useNavigate();
  const { clientId, sessionId } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const [f, setF] = useState({
    documentId: "",
    receiverId: "",
    copyIndicator: false,
    issueDate: today,
    documentStatusCode: "Active",
    orderRefId: "ORD-001",
    supplierName: "",
    supplierStreet: "",
    supplierCity: "",
    supplierZone: "2000",
    supplierCountry: "AU",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    customerName: "",
    customerStreet: "",
    customerCity: "",
    customerZone: "2000",
    customerCountry: "AU",
    shipId: "SHIP-001",
    consId: "CONS-001",
    delivStreet: "",
    delivCity: "",
    delivZone: "2000",
    delivCountry: "AU",
    periodStart: today,
    periodEnd: future,
    note: "",
  });

  const [lines, setLines] = useState<DespatchLine[]>([defaultLine(0, "ORD-001")]);

  const [clients, setClients] = useState<{ clientId: string; username: string }[]>([]);
  const [clientsErr, setClientsErr] = useState("");
  const [receiverOpen, setReceiverOpen] = useState(false);
  const receiverRef = useRef<HTMLDivElement>(null);

  const [receiverOrders, setReceiverOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [preOrderSnapshot, setPreOrderSnapshot] = useState<{ f: typeof f; lines: DespatchLine[] } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    apiFetch<{ clientId: string; username: string }[]>("/clients", {}, sessionId)
      .then((data) => {
        setClients(data.filter((c) => c.clientId !== clientId));
      })
      .catch((e: Error) => {
        console.error("GET /clients error:", e);
        setClientsErr(e.message);
      });
  }, [sessionId, clientId]);

  useEffect(() => {
    if (!f.receiverId || !sessionId) {
      setReceiverOrders([]);
      setSelectedOrderId(null);
      return;
    }
    setOrdersLoading(true);
    setReceiverOrders([]);
    setSelectedOrderId(null);
    apiFetch<any>(`/clients/${encodeURIComponent(f.receiverId)}/orders`, {}, sessionId)
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setReceiverOrders(list);
      })
      .catch(() => setReceiverOrders([]))
      .finally(() => setOrdersLoading(false));
  }, [f.receiverId, sessionId]);

  function applyOrder(order: any) {
    const d = order.data ?? order;
    const id = order.orderId ?? d.ID ?? null;

    if (selectedOrderId === id) {
      if (preOrderSnapshot) {
        setF(preOrderSnapshot.f);
        setLines(preOrderSnapshot.lines);
      }
      setPreOrderSnapshot(null);
      setSelectedOrderId(null);
      return;
    }

    if (!selectedOrderId) {
      setPreOrderSnapshot({ f: { ...f }, lines: [...lines] });
    }

    const buyer = d.BuyerCustomerParty?.Party ?? {};
    const seller = d.SellerSupplierParty?.Party ?? {};
    const buyerAddr = buyer.PostalAddress ?? {};
    const sellerAddr = seller.PostalAddress ?? {};
    const base = preOrderSnapshot?.f ?? f;

    setF({
      ...base,
      documentId: `DA-${d.ID ?? ""}`,
      orderRefId: d.ID ?? "",
      note: Array.isArray(d.Note) ? d.Note.join("; ") : d.Note ?? base.note,
      supplierName: seller.PartyName?.[0]?.Name ?? base.supplierName,
      supplierStreet: sellerAddr.StreetName ?? base.supplierStreet,
      supplierCity: sellerAddr.CityName ?? base.supplierCity,
      supplierZone: sellerAddr.PostalZone ?? base.supplierZone,
      supplierCountry: sellerAddr.Country?.IdentificationCode ?? base.supplierCountry,
      customerName: buyer.PartyName?.[0]?.Name ?? base.customerName,
      customerStreet: buyerAddr.StreetName ?? base.customerStreet,
      customerCity: buyerAddr.CityName ?? base.customerCity,
      customerZone: buyerAddr.PostalZone ?? base.customerZone,
      customerCountry: buyerAddr.Country?.IdentificationCode ?? base.customerCountry,
      delivStreet: buyerAddr.StreetName ?? base.delivStreet,
      delivCity: buyerAddr.CityName ?? base.delivCity,
      delivZone: buyerAddr.PostalZone ?? base.delivZone,
      delivCountry: buyerAddr.Country?.IdentificationCode ?? base.delivCountry,
    });

    setLines(orderLinesToDespatchLines(d.OrderLine ?? [], d.ID ?? ""));
    setSelectedOrderId(id);
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (receiverRef.current && !receiverRef.current.contains(e.target as Node)) {
        setReceiverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const set =
    (k: keyof typeof f) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const setC = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.checked }));

  const updateLine = (idx: number, key: keyof DespatchLine, val: string) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));

  const addLine = () =>
    setLines((prev) => [...prev, defaultLine(prev.length, f.orderRefId)]);

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!clientId || !sessionId) return;
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const body = {
        documentId: f.documentId,
        senderId: clientId,
        receiverId: f.receiverId,
        copyIndicator: f.copyIndicator,
        issueDate: f.issueDate,
        documentStatusCode: f.documentStatusCode,
        orderReference: { id: f.orderRefId },
        note: f.note.trim() ? f.note : undefined,
        despatchSupplierParty: {
          party: {
            name: f.supplierName,
            postalAddress: {
              streetName: f.supplierStreet,
              cityName: f.supplierCity,
              postalZone: f.supplierZone,
              countryIdentificationCode: f.supplierCountry,
            },
            contact: {
              name: f.contactName || undefined,
              telephone: f.contactPhone || undefined,
              email: f.contactEmail || undefined,
            },
          },
        },
        deliveryCustomerParty: {
          party: {
            name: f.customerName,
            postalAddress: {
              streetName: f.customerStreet,
              cityName: f.customerCity,
              postalZone: f.customerZone,
              countryIdentificationCode: f.customerCountry,
            },
          },
        },
        shipment: {
          id: f.shipId,
          consignmentId: f.consId,
          delivery: {
            deliveryAddress: {
              streetName: f.delivStreet,
              cityName: f.delivCity,
              postalZone: f.delivZone,
              countryIdentificationCode: f.delivCountry,
            },
            requestedDeliveryPeriod: { startDate: f.periodStart, endDate: f.periodEnd },
          },
        },
        despatchLines: lines.map((l, i) => ({
          id: l.id || `LINE-${i + 1}`,
          deliveredQuantity: parseFloat(l.qty) || 1,
          deliveredQuantityUnitCode: l.unit || "EA",
          orderLineReference: {
            lineId: String(i + 1),
            orderReference: { id: l.orderRef || f.orderRefId },
          },
          item: { name: l.itemName, description: l.itemDesc || l.itemName },
        })),
      };
      const res = await apiFetch<{ despatchAdviceId: string }>(
        "/despatch-advices",
        { method: "POST", body: JSON.stringify(body) },
        sessionId
      );
      setOk(`Created. Despatch advice ID: ${res.despatchAdviceId}`);
      setTimeout(() => navigate("/app/despatch/view"), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const req = [
    f.documentId,
    f.receiverId,
    f.supplierName,
    f.supplierStreet,
    f.supplierCity,
    f.customerName,
    f.customerStreet,
    f.customerCity,
    f.delivStreet,
    f.delivCity,
    ...lines.map((l) => l.itemName),
  ];
  const valid = req.every((v) => v && String(v).trim());

  return (
    <>
      <TopBar
        title="Create despatch advice"
        subtitle="UBL-aligned document sections"
        right={
          clientId ? (
            <div className="topbar-client">
              Sender ID <span>{clientId.slice(0, 18)}…</span>
            </div>
          ) : null
        }
      />
      <div className={`page-body ${styles.page}`}>
        <div className="card">
          <div className="card-title">New despatch advice</div>
          <div className="card-sub">Sender is fixed to your logged-in client ID.</div>

          {err ? <div className="alert alert-err">{err}</div> : null}
          {ok ? <div className="alert alert-ok">{ok}</div> : null}

          <div className="section-label">Document info</div>
          <div className="field-row">
            <div className="field">
              <label>Document ID *</label>
              <input placeholder="DA-001" value={f.documentId} onChange={set("documentId")} />
            </div>
            <div className="field">
              <label>Receiver *</label>
              <div className={styles.receiverDropdown} ref={receiverRef}>
                <button
                  type="button"
                  className={styles.receiverTrigger}
                  onClick={() => setReceiverOpen((o) => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={receiverOpen}
                >
                  {f.receiverId ? (() => {
                    const c = clients.find((c) => c.clientId === f.receiverId);
                    return c ? (
                      <div>
                        <div className={styles.receiverTriggerName}>{c.username}</div>
                        <div className={styles.receiverTriggerSub}>{c.clientId}</div>
                      </div>
                    ) : (
                      <span className={styles.receiverTriggerPlaceholder}>— Select a receiver —</span>
                    );
                  })() : (
                    <span className={styles.receiverTriggerPlaceholder}>— Select a receiver —</span>
                  )}
                  <span style={{ fontSize: 9, color: "var(--dim)" }}>{receiverOpen ? "▲" : "▼"}</span>
                </button>
                {receiverOpen && (
                  <div className={styles.receiverMenu} role="listbox">
                    {clientsErr ? (
                      <div className={styles.receiverOption} style={{ color: "var(--red, #c00)", cursor: "default" }}>
                        Error: {clientsErr}
                      </div>
                    ) : clients.length === 0 ? (
                      <div className={styles.receiverOption} style={{ color: "var(--muted)", cursor: "default" }}>
                        No other users found
                      </div>
                    ) : (
                      clients.map((c) => (
                        <div
                          key={c.clientId}
                          role="option"
                          aria-selected={f.receiverId === c.clientId}
                          className={`${styles.receiverOption} ${f.receiverId === c.clientId ? styles.receiverOptionActive : ""}`}
                          onClick={() => {
                            setF((p) => ({ ...p, receiverId: c.clientId }));
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
            </div>
          </div>

          {f.receiverId && (
            <div className={styles.orderPicker}>
              <div className={styles.orderPickerTitle}>
                Orders from {clients.find((c) => c.clientId === f.receiverId)?.username ?? "this user"}
              </div>
              {ordersLoading ? (
                <div className={styles.orderPickerEmpty}><span className="spinner" /> Loading orders…</div>
              ) : receiverOrders.length === 0 ? (
                <div className={styles.orderPickerEmpty}>No orders found for this user</div>
              ) : (
                <div className={styles.orderList}>
                  {receiverOrders.map((o: any) => {
                    const d = o.data ?? o;
                    const id = o.orderId ?? d.ID ?? "?";
                    const buyer = d.BuyerCustomerParty?.Party?.PartyName?.[0]?.Name ?? "—";
                    const lineCount = d.OrderLine?.length ?? 0;
                    const isSelected = selectedOrderId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`${styles.orderCard} ${isSelected ? styles.orderCardActive : ""}`}
                        onClick={() => applyOrder(o)}
                      >
                        <div className={styles.orderCardId}>{d.ID ?? id}</div>
                        <div className={styles.orderCardMeta}>
                          {buyer} · {lineCount} line{lineCount !== 1 ? "s" : ""}
                        </div>
                        {d.IssueDate && <div className={styles.orderCardDate}>{d.IssueDate}</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selectedOrderId && (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              Auto-filled from order <strong>{selectedOrderId}</strong> — all {lines.length} line{lines.length !== 1 ? "s" : ""} imported. Review and adjust before creating.
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label>Sender ID (locked)</label>
              <input value={clientId ?? ""} readOnly />
            </div>
            <div className="field">
              <label>Issue date</label>
              <input type="date" value={f.issueDate} onChange={set("issueDate")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Document status code</label>
              <input value={f.documentStatusCode} onChange={set("documentStatusCode")} />
            </div>
            <div className="field">
              <label>Order reference ID</label>
              <input value={f.orderRefId} onChange={set("orderRefId")} />
            </div>
            <div className="field">
              <label>Copy indicator</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", fontSize: 12, cursor: "pointer", marginTop: 8 }}>
                <input type="checkbox" checked={f.copyIndicator} onChange={setC("copyIndicator")} />
                Copy
              </label>
            </div>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <textarea placeholder="General note" value={f.note} onChange={set("note")} style={{ minHeight: 50 }} />
          </div>

          <div className="section-label">Despatch supplier party</div>
          <div className="field-row">
            <div className="field">
              <label>Party name *</label>
              <input placeholder="Acme Supplies Ltd" value={f.supplierName} onChange={set("supplierName")} />
            </div>
            <div className="field">
              <label>Street *</label>
              <input placeholder="1 Warehouse Rd" value={f.supplierStreet} onChange={set("supplierStreet")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>City *</label>
              <input placeholder="Sydney" value={f.supplierCity} onChange={set("supplierCity")} />
            </div>
            <div className="field">
              <label>Postal zone</label>
              <input value={f.supplierZone} onChange={set("supplierZone")} />
            </div>
            <div className="field">
              <label>Country (ISO)</label>
              <input maxLength={2} value={f.supplierCountry} onChange={set("supplierCountry")} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Contact name</label>
              <input value={f.contactName} onChange={set("contactName")} />
            </div>
            <div className="field">
              <label>Contact phone</label>
              <input value={f.contactPhone} onChange={set("contactPhone")} />
            </div>
          </div>
          <div className="field">
            <label>Contact email</label>
            <input type="email" value={f.contactEmail} onChange={set("contactEmail")} />
          </div>

          <div className="section-label">Delivery customer party</div>
          <div className="field-row">
            <div className="field">
              <label>Party name *</label>
              <input placeholder="Customer Co" value={f.customerName} onChange={set("customerName")} />
            </div>
            <div className="field">
              <label>Street *</label>
              <input value={f.customerStreet} onChange={set("customerStreet")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>City *</label>
              <input value={f.customerCity} onChange={set("customerCity")} />
            </div>
            <div className="field">
              <label>Postal zone</label>
              <input value={f.customerZone} onChange={set("customerZone")} />
            </div>
            <div className="field">
              <label>Country (ISO)</label>
              <input maxLength={2} value={f.customerCountry} onChange={set("customerCountry")} />
            </div>
          </div>

          <div className="section-label">Shipment &amp; delivery</div>
          <div className="field-row">
            <div className="field">
              <label>Shipment ID</label>
              <input value={f.shipId} onChange={set("shipId")} />
            </div>
            <div className="field">
              <label>Consignment ID</label>
              <input value={f.consId} onChange={set("consId")} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Delivery street *</label>
              <input value={f.delivStreet} onChange={set("delivStreet")} />
            </div>
            <div className="field">
              <label>Delivery city *</label>
              <input value={f.delivCity} onChange={set("delivCity")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Postal zone</label>
              <input value={f.delivZone} onChange={set("delivZone")} />
            </div>
            <div className="field">
              <label>Country</label>
              <input maxLength={2} value={f.delivCountry} onChange={set("delivCountry")} />
            </div>
            <div className="field" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Delivery window start</label>
              <input type="date" value={f.periodStart} onChange={set("periodStart")} />
            </div>
            <div className="field">
              <label>Delivery window end</label>
              <input type="date" value={f.periodEnd} onChange={set("periodEnd")} />
            </div>
          </div>

          <div className="section-label">Despatch lines</div>

          {lines.map((line, i) => (
            <div key={i} className={styles.lineCard}>
              <div className={styles.lineHeader}>
                <span className={styles.lineLabel}>Line {i + 1}</span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ fontSize: 10, padding: "3px 8px" }}
                    onClick={() => removeLine(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Item name *</label>
                  <input value={line.itemName} onChange={(e) => updateLine(i, "itemName", e.target.value)} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input value={line.itemDesc} onChange={(e) => updateLine(i, "itemDesc", e.target.value)} />
                </div>
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label>Quantity</label>
                  <input type="number" min="1" value={line.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} />
                </div>
                <div className="field">
                  <label>Unit code</label>
                  <input value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                </div>
                <div className="field">
                  <label>Line ID</label>
                  <input value={line.id} onChange={(e) => updateLine(i, "id", e.target.value)} />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 6 }}
            onClick={addLine}
          >
            + Add another line
          </button>

          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={loading || !valid}>
              {loading ? (
                <><span className="spinner" /> Creating…</>
              ) : (
                "Create despatch advice →"
              )}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/app/despatch/view")}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

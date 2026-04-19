import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/create.module.css";

function extractOrderDefaults(loc: any) {
  const order = loc?.state?.fromOrder;
  if (!order) return null;
  // order is an OrderRecord: { data?: {...}, orderId, ... } merged with _fields
  const d = order.data ?? order;
  const buyer = d.BuyerCustomerParty?.Party ?? {};
  const seller = d.SellerSupplierParty?.Party ?? {};
  const buyerAddr = buyer.PostalAddress ?? {};
  const sellerAddr = seller.PostalAddress ?? {};
  const firstLine = d.OrderLine?.[0]?.LineItem ?? {};
  const item = firstLine.Item ?? {};
  return {
    documentId: `DA-${d.ID ?? ""}`,
    orderRefId: d.ID ?? "",
    note: Array.isArray(d.Note) ? d.Note.join("; ") : "",
    // Seller ships → despatch supplier party
    supplierName: seller.PartyName?.[0]?.Name ?? "",
    supplierStreet: sellerAddr.StreetName ?? "",
    supplierCity: sellerAddr.CityName ?? "",
    supplierZone: sellerAddr.PostalZone ?? "",
    supplierCountry: sellerAddr.Country?.IdentificationCode ?? "AU",
    // Buyer receives → delivery customer party + delivery address
    customerName: buyer.PartyName?.[0]?.Name ?? "",
    customerStreet: buyerAddr.StreetName ?? "",
    customerCity: buyerAddr.CityName ?? "",
    customerZone: buyerAddr.PostalZone ?? "",
    customerCountry: buyerAddr.Country?.IdentificationCode ?? "AU",
    delivStreet: buyerAddr.StreetName ?? "",
    delivCity: buyerAddr.CityName ?? "",
    delivZone: buyerAddr.PostalZone ?? "",
    delivCountry: buyerAddr.Country?.IdentificationCode ?? "AU",
    // First line item
    lineId: firstLine.ID ?? "LINE-1",
    lineItemName: item.Name ?? "",
    lineItemDesc: Array.isArray(item.Description)
      ? item.Description.join(", ")
      : item.Description ?? "",
    lineOrderRef: d.ID ?? "ORD-001",
  };
}

export default function DespatchCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clientId, sessionId } = useAuth();
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const orderDefaults = extractOrderDefaults(location);
  const fromOrder = !!orderDefaults;

  const [f, setF] = useState({
    documentId: orderDefaults?.documentId ?? "",
    receiverId: "",
    copyIndicator: false,
    issueDate: today,
    documentStatusCode: "Active",
    orderRefId: orderDefaults?.orderRefId ?? "ORD-001",
    supplierName: orderDefaults?.supplierName ?? "",
    supplierStreet: orderDefaults?.supplierStreet ?? "",
    supplierCity: orderDefaults?.supplierCity ?? "",
    supplierZone: orderDefaults?.supplierZone ?? "2000",
    supplierCountry: orderDefaults?.supplierCountry ?? "AU",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    customerName: orderDefaults?.customerName ?? "",
    customerStreet: orderDefaults?.customerStreet ?? "",
    customerCity: orderDefaults?.customerCity ?? "",
    customerZone: orderDefaults?.customerZone ?? "2000",
    customerCountry: orderDefaults?.customerCountry ?? "AU",
    shipId: "SHIP-001",
    consId: "CONS-001",
    delivStreet: orderDefaults?.delivStreet ?? "1 Customer Rd",
    delivCity: orderDefaults?.delivCity ?? "Sydney",
    delivZone: orderDefaults?.delivZone ?? "2000",
    delivCountry: orderDefaults?.delivCountry ?? "AU",
    periodStart: today,
    periodEnd: future,
    lineId: orderDefaults?.lineId ?? "LINE-1",
    lineQty: "10",
    lineUnit: "EA",
    lineOrderRef: orderDefaults?.lineOrderRef ?? "ORD-001",
    lineItemName: orderDefaults?.lineItemName ?? "",
    lineItemDesc: orderDefaults?.lineItemDesc ?? "",
    note: orderDefaults?.note ?? "",
  });

  const [clients, setClients] = useState<{ clientId: string; username: string }[]>([]);
  const [clientsErr, setClientsErr] = useState("");
  const [receiverOpen, setReceiverOpen] = useState(false);
  const receiverRef = useRef<HTMLDivElement>(null);

  // Orders for the selected receiver
  const [receiverOrders, setReceiverOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [preOrderSnapshot, setPreOrderSnapshot] = useState<typeof f | null>(null);

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

  // Fetch orders when receiver changes
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
      .catch(() => {
        setReceiverOrders([]);
      })
      .finally(() => setOrdersLoading(false));
  }, [f.receiverId, sessionId]);

  function applyOrder(order: any) {
    const d = order.data ?? order;
    const id = order.orderId ?? d.ID ?? null;

    // Deselect: restore the snapshot
    if (selectedOrderId === id) {
      if (preOrderSnapshot) setF(preOrderSnapshot);
      setPreOrderSnapshot(null);
      setSelectedOrderId(null);
      return;
    }

    // Save current form state before overwriting (only if no order is selected yet)
    if (!selectedOrderId) {
      setPreOrderSnapshot({ ...f });
    }

    const buyer = d.BuyerCustomerParty?.Party ?? {};
    const seller = d.SellerSupplierParty?.Party ?? {};
    const buyerAddr = buyer.PostalAddress ?? {};
    const sellerAddr = seller.PostalAddress ?? {};
    const firstLine = d.OrderLine?.[0]?.LineItem ?? {};
    const item = firstLine.Item ?? {};
    const base = preOrderSnapshot ?? f;

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
      lineId: firstLine.ID ?? base.lineId,
      lineItemName: item.Name ?? base.lineItemName,
      lineItemDesc: Array.isArray(item.Description)
        ? item.Description.join(", ")
        : item.Description ?? base.lineItemDesc,
      lineOrderRef: d.ID ?? base.lineOrderRef,
    });
    setSelectedOrderId(id);
  }

  // Close receiver dropdown on outside click
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
        despatchLines: [
          {
            id: f.lineId,
            deliveredQuantity: parseFloat(f.lineQty) || 1,
            deliveredQuantityUnitCode: f.lineUnit,
            orderLineReference: {
              lineId: "1",
              orderReference: { id: f.lineOrderRef },
            },
            item: { name: f.lineItemName, description: f.lineItemDesc },
          },
        ],
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
    f.lineItemName,
    f.lineItemDesc,
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

          {fromOrder ? (
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              Pre-filled from order <strong>{orderDefaults.orderRefId}</strong>. Review
              the fields below, select a receiver, and adjust quantities before creating.
            </div>
          ) : null}

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
                    const seller = d.SellerSupplierParty?.Party?.PartyName?.[0]?.Name ?? "—";
                    const lines = d.OrderLine?.length ?? 0;
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
                          {buyer} → {seller} · {lines} line{lines !== 1 ? "s" : ""}
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
              Auto-filled from order <strong>{selectedOrderId}</strong>. Review and adjust fields below before creating.
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
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textTransform: "none",
                  fontSize: 12,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                <input type="checkbox" checked={f.copyIndicator} onChange={setC("copyIndicator")} />
                Copy
              </label>
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

          <div className="section-label">Despatch line</div>
          <div className="field-row">
            <div className="field">
              <label>Item name *</label>
              <input value={f.lineItemName} onChange={set("lineItemName")} />
            </div>
            <div className="field">
              <label>Description *</label>
              <input value={f.lineItemDesc} onChange={set("lineItemDesc")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Quantity</label>
              <input type="number" value={f.lineQty} onChange={set("lineQty")} />
            </div>
            <div className="field">
              <label>Unit code</label>
              <input value={f.lineUnit} onChange={set("lineUnit")} />
            </div>
            <div className="field">
              <label>Line ID</label>
              <input value={f.lineId} onChange={set("lineId")} />
            </div>
          </div>

          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={loading || !valid}>
              {loading ? (
                <>
                  <span className="spinner" /> Creating…
                </>
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

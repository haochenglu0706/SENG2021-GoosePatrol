import { useRef, useState } from "react";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { DespatchAdviceRow } from "../../types/despatch";
import { rememberReceiptId } from "../../utils/receiptIndex";

function docId(d: DespatchAdviceRow): string {
  return d.documentId ?? d.documentID ?? "";
}

const REQ_POSTAL = (street: string, city: string, zone: string, country: string) => ({
  streetName: street,
  cityName: city,
  postalZone: zone,
  countryIdentificationCode: country,
});

function buildInvoiceBody(despatch: DespatchAdviceRow, invoiceUserId: string): Record<string, unknown> {
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

export function ReceiptAdviceCreateModal({
  despatch,
  sessionId,
  clientId,
  onClose,
  onCreated,
}: {
  despatch: DespatchAdviceRow;
  sessionId: string;
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { invoiceToken, invoiceUserId } = useAuth();
  const sup = despatch.despatchSupplierParty?.party;
  const supAddr = sup?.postalAddress;
  const cust = despatch.deliveryCustomerParty?.party;
  const custAddr = cust?.postalAddress;
  const line0 = despatch.despatchLines?.[0];

  const [documentId, setDocumentId] = useState(`RA-${docId(despatch) || "NEW"}`);
  const [documentStatusCode, setDocumentStatusCode] = useState("RECEIVED");
  const [orderRefId, setOrderRefId] = useState(despatch.orderReference?.id ?? "ORD-001");
  const [supplierName, setSupplierName] = useState(sup?.name ?? "");
  const [supplierStreet, setSupplierStreet] = useState(supAddr?.streetName ?? "");
  const [supplierCity, setSupplierCity] = useState(supAddr?.cityName ?? "");
  const [supplierZone, setSupplierZone] = useState(supAddr?.postalZone ?? "2000");
  const [supplierCountry, setSupplierCountry] = useState(supAddr?.countryIdentificationCode ?? "AU");
  const [customerName, setCustomerName] = useState(cust?.name ?? "");
  const [customerStreet, setCustomerStreet] = useState(custAddr?.streetName ?? "");
  const [customerCity, setCustomerCity] = useState(custAddr?.cityName ?? "");
  const [customerZone, setCustomerZone] = useState(custAddr?.postalZone ?? "2000");
  const [customerCountry, setCustomerCountry] = useState(
    custAddr?.countryIdentificationCode ?? "AU"
  );
  const [shipId, setShipId] = useState("SHIP-REC-001");
  const [consId, setConsId] = useState("CONS-REC-001");
  const [lineId, setLineId] = useState(line0?.id ?? "LINE-1");
  const [receivedQty, setReceivedQty] = useState(String(line0?.deliveredQuantity ?? 1));
  const [unit, setUnit] = useState(line0?.deliveredQuantityUnitCode ?? "EA");
  const [itemName, setItemName] = useState(line0?.item?.name ?? "Item");
  const [itemDesc, setItemDesc] = useState(line0?.item?.description ?? "Description");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<"idle" | "done" | "failed">("idle");
  const autoInvoiceTriggeredRef = useRef(false);

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      const body = {
        documentId,
        senderId: clientId,
        receiverId: despatch.senderId,
        copyIndicator: false,
        documentStatusCode,
        orderReference: { id: orderRefId },
        despatchDocumentReference: { id: docId(despatch) },
        despatchSupplierParty: {
          party: {
            name: supplierName,
            postalAddress: REQ_POSTAL(supplierStreet, supplierCity, supplierZone, supplierCountry),
          },
        },
        deliveryCustomerParty: {
          party: {
            name: customerName,
            postalAddress: REQ_POSTAL(customerStreet, customerCity, customerZone, customerCountry),
          },
        },
        shipment: { id: shipId, consignmentId: consId, delivery: {} },
        receiptLines: [
          {
            id: lineId,
            receivedQuantity: parseFloat(receivedQty) || 1,
            receivedQuantityUnitCode: unit,
            item: { name: itemName, description: itemDesc },
          },
        ],
      };
      const res = await apiFetch<{ receiptAdviceId: string }>(
        `/despatch-advices/${despatch.despatchAdviceId}/receipt-advices`,
        { method: "POST", body: JSON.stringify(body) },
        sessionId
      );
      setCreatedId(res.receiptAdviceId);
      rememberReceiptId(clientId, res.receiptAdviceId);

      if (autoInvoiceTriggeredRef.current || !invoiceToken || !invoiceUserId) {
        return;
      }

      autoInvoiceTriggeredRef.current = true;
      try {
        const invoiceRes = await apiFetch<{ invoiceId?: string }>(
          "/invoices",
          {
            method: "POST",
            headers: {
              invoiceToken,
              invoiceUserId,
            },
            body: JSON.stringify(buildInvoiceBody(despatch, invoiceUserId)),
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
              receiverId: despatch.senderId,
              despatchAdviceId: despatch.despatchAdviceId,
            }),
          },
          sessionId
        );

        setInvoiceStatus("done");
      } catch (invoiceError) {
        console.warn("Auto invoice generation failed in receipt modal", invoiceError);
        setInvoiceStatus("failed");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const valid =
    documentId.trim() &&
    supplierName.trim() &&
    supplierStreet.trim() &&
    supplierCity.trim() &&
    customerName.trim() &&
    customerStreet.trim() &&
    customerCity.trim() &&
    itemName.trim() &&
    itemDesc.trim();

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-labelledby="receipt-modal-title">
        <div className="modal-header">
          <div>
            <div className="card-title" id="receipt-modal-title">
              Create Receipt Advice
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              For despatch: {docId(despatch) || despatch.despatchAdviceId}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {err ? <div className="alert alert-err">{err}</div> : null}
          {createdId ? (
            <div className="alert alert-ok">
              Receipt advice created. ID: <strong>{createdId}</strong>
            </div>
          ) : null}
          {createdId && invoiceStatus === "done" ? (
            <div className="alert alert-info">📧 Invoice auto-generated</div>
          ) : null}
          {createdId && invoiceStatus === "failed" ? (
            <div className="alert alert-info">⚠ Invoice not created</div>
          ) : null}

          {!createdId ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ra-doc-id">Document ID</label>
                  <input
                    id="ra-doc-id"
                    value={documentId}
                    onChange={(e) => setDocumentId(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ra-status">Status code</label>
                  <input
                    id="ra-status"
                    value={documentStatusCode}
                    onChange={(e) => setDocumentStatusCode(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ra-order">Order reference ID</label>
                <input
                  id="ra-order"
                  value={orderRefId}
                  onChange={(e) => setOrderRefId(e.target.value)}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Sender (you)</label>
                  <input value={clientId} readOnly />
                </div>
                <div className="field">
                  <label>Receiver (supplier)</label>
                  <input value={despatch.senderId ?? ""} readOnly />
                </div>
              </div>

              <div className="section-label">Supplier party</div>
              <div className="field-row">
                <div className="field">
                  <label>Name</label>
                  <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Street</label>
                  <input value={supplierStreet} onChange={(e) => setSupplierStreet(e.target.value)} />
                </div>
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label>City</label>
                  <input value={supplierCity} onChange={(e) => setSupplierCity(e.target.value)} />
                </div>
                <div className="field">
                  <label>Postal zone</label>
                  <input value={supplierZone} onChange={(e) => setSupplierZone(e.target.value)} />
                </div>
                <div className="field">
                  <label>Country</label>
                  <input
                    maxLength={2}
                    value={supplierCountry}
                    onChange={(e) => setSupplierCountry(e.target.value.toUpperCase())}
                  />
                </div>
              </div>

              <div className="section-label">Customer party (you)</div>
              <div className="field-row">
                <div className="field">
                  <label>Name</label>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Street</label>
                  <input
                    value={customerStreet}
                    onChange={(e) => setCustomerStreet(e.target.value)}
                  />
                </div>
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label>City</label>
                  <input value={customerCity} onChange={(e) => setCustomerCity(e.target.value)} />
                </div>
                <div className="field">
                  <label>Postal zone</label>
                  <input value={customerZone} onChange={(e) => setCustomerZone(e.target.value)} />
                </div>
                <div className="field">
                  <label>Country</label>
                  <input
                    maxLength={2}
                    value={customerCountry}
                    onChange={(e) => setCustomerCountry(e.target.value.toUpperCase())}
                  />
                </div>
              </div>

              <div className="section-label">Shipment</div>
              <div className="field-row">
                <div className="field">
                  <label>Shipment ID</label>
                  <input value={shipId} onChange={(e) => setShipId(e.target.value)} />
                </div>
                <div className="field">
                  <label>Consignment ID</label>
                  <input value={consId} onChange={(e) => setConsId(e.target.value)} />
                </div>
              </div>

              <div className="section-label">Receipt line</div>
              <div className="field-row">
                <div className="field">
                  <label>Item name</label>
                  <input value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Received quantity</label>
                  <input
                    type="number"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Unit code</label>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div className="field">
                  <label>Line ID</label>
                  <input value={lineId} onChange={(e) => setLineId(e.target.value)} />
                </div>
              </div>
            </>
          ) : null}

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            {!createdId ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={loading || !valid}
              >
                {loading ? (
                  <>
                    <span className="spinner" /> Creating…
                  </>
                ) : (
                  "Create receipt →"
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onCreated();
                  onClose();
                }}
              >
                Done
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

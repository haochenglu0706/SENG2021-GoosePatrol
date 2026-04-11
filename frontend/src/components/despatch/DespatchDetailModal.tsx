import type { DespatchAdviceRow } from "../../types/despatch";
import { StatusBadge } from "../ui/StatusBadge";

function docId(d: DespatchAdviceRow): string {
  return d.documentId ?? d.documentID ?? "—";
}

export function DespatchDetailModal({
  despatch: d,
  onClose,
}: {
  despatch: DespatchAdviceRow;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-labelledby="despatch-detail-title">
        <div className="modal-header">
          <div>
            <div className="card-title" id="despatch-detail-title">
              {docId(d)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <StatusBadge status={d.status} />
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="section-label">Document Info</div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-key">Despatch Advice ID</div>
              <div className="detail-val">{d.despatchAdviceId}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Sender</div>
              <div className="detail-val">{d.senderId}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Receiver</div>
              <div className="detail-val">{d.receiverId}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Issue Date</div>
              <div className="detail-val">{d.issueDate ?? "—"}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Status Code</div>
              <div className="detail-val">{d.documentStatusCode ?? "—"}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Copy Indicator</div>
              <div className="detail-val">{String(d.copyIndicator)}</div>
            </div>
          </div>

          {d.orderReference ? (
            <>
              <div className="section-label">Order Reference</div>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-key">Order ID</div>
                  <div className="detail-val">{d.orderReference.id}</div>
                </div>
              </div>
            </>
          ) : null}

          {d.despatchSupplierParty?.party ? (
            <>
              <div className="section-label">Supplier Party</div>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-key">Name</div>
                  <div className="detail-val">{d.despatchSupplierParty.party.name}</div>
                </div>
                {d.despatchSupplierParty.party.postalAddress ? (
                  <>
                    <div className="detail-item">
                      <div className="detail-key">Street</div>
                      <div className="detail-val">
                        {d.despatchSupplierParty.party.postalAddress.streetName}
                      </div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-key">City</div>
                      <div className="detail-val">
                        {d.despatchSupplierParty.party.postalAddress.cityName}
                      </div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-key">Country</div>
                      <div className="detail-val">
                        {d.despatchSupplierParty.party.postalAddress.countryIdentificationCode}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {d.despatchLines && d.despatchLines.length > 0 ? (
            <>
              <div className="section-label">Despatch Lines</div>
              {d.despatchLines.map((line, i) => (
                <div
                  key={line.id ?? i}
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                      {line.item?.name ?? line.id}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {line.deliveredQuantity} {line.deliveredQuantityUnitCode}
                    </span>
                  </div>
                  {line.item?.description ? (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{line.item.description}</div>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}

          {d.note ? (
            <>
              <div className="section-label">Note</div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>{d.note}</p>
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

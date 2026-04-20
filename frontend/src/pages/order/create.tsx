import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import styles from "./style/create.module.css";

export default function OrderCreatePage() {
  const navigate = useNavigate();
  const { sessionId, orderMsToken } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  const orderId = `ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const [f, setF] = useState({
    orderId,
    issueDate: today,
    ublVersion: "2.1",
    note: "",
    // buyer
    buyerAccountId: "",
    buyerPartyId: "",
    buyerName: "",
    buyerStreet: "",
    buyerCity: "",
    buyerZone: "",
    buyerCountryCode: "AU",
    buyerCountryName: "Australia",
    // line 1
    line1Id: "LINE-001",
    line1Name: "",
    line1Desc: "",
    line1Model: "",
    line1Note: "",
    line1Qty: "1",
    line1Unit: "EA",
  });

  const [extraLines, setExtraLines] = useState<
    { id: string; name: string; desc: string; model: string; note: string; qty: string; unit: string }[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const set =
    (k: keyof typeof f) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const addLine = () =>
    setExtraLines((prev) => [
      ...prev,
      { id: `LINE-${String(prev.length + 2).padStart(3, "0")}`, name: "", desc: "", model: "", note: "", qty: "1", unit: "EA" },
    ]);

  const updateLine = (idx: number, key: string, val: string) =>
    setExtraLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [key]: val } : l))
    );

  const removeLine = (idx: number) =>
    setExtraLines((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!sessionId) return;
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const allLines = [
        {
          ...(f.line1Note ? { Note: [f.line1Note] } : {}),
          LineItem: {
            ID: f.line1Id,
            Item: {
              Name: f.line1Name,
              Description: f.line1Desc ? [f.line1Desc] : undefined,
              Model: f.line1Model || undefined,
            },
          },
          Quantity: parseFloat(f.line1Qty) || 1,
          QuantityUnitCode: f.line1Unit || "EA",
        },
        ...extraLines.map((l) => ({
          ...(l.note ? { Note: [l.note] } : {}),
          LineItem: {
            ID: l.id,
            Item: {
              Name: l.name,
              Description: l.desc ? [l.desc] : undefined,
              Model: l.model || undefined,
            },
          },
          Quantity: parseFloat(l.qty) || 1,
          QuantityUnitCode: l.unit || "EA",
        })),
      ];

      const body: Record<string, unknown> = {
        ID: f.orderId,
        IssueDate: f.issueDate,
        UBLVersionID: f.ublVersion,
        ...(f.note.trim() ? { Note: [f.note.trim()] } : {}),
        BuyerCustomerParty: {
          ...(f.buyerAccountId ? { CustomerAssignedAccountID: f.buyerAccountId } : {}),
          Party: {
            ...(f.buyerPartyId
              ? { PartyIdentification: [{ ID: f.buyerPartyId }] }
              : {}),
            PartyName: [{ Name: f.buyerName }],
            PostalAddress: {
              StreetName: f.buyerStreet,
              CityName: f.buyerCity,
              PostalZone: f.buyerZone,
              Country: {
                IdentificationCode: f.buyerCountryCode,
                Name: f.buyerCountryName,
              },
            },
          },
        },
        OrderLine: allLines,
      };

      const headers: Record<string, string> = {};
      if (orderMsToken) headers.orderMsToken = orderMsToken;

      const res = await apiFetch<{ orderId: string }>(
        "/orders",
        { method: "POST", headers, body: JSON.stringify(body) },
        sessionId
      );
      setOk(`Created. Order ID: ${res.orderId}`);
      setTimeout(() => navigate("/app/orders"), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const req = [f.buyerName, f.line1Name];
  const valid = req.every((v) => v && v.trim());

  return (
    <>
      <TopBar
        title="Create order"
        subtitle="UBL-aligned order sent to OrderMS"
      />
      <div className={`page-body ${styles.page}`}>
        <div className="card">
          <div className="card-title">New order</div>
          <div className="card-sub">
            Fields marked * are required. The order is sent to OrderMS and a UBL
            XML document is generated.
          </div>

          {err ? <div className="alert alert-err">{err}</div> : null}
          {ok ? <div className="alert alert-ok">{ok}</div> : null}

          {/* ── Document info ── */}
          <div className="section-label">Document info</div>
          <div className="field-row">
            <div className="field">
              <label>Order ID</label>
              <input value={f.orderId} readOnly disabled />
            </div>
            <div className="field">
              <label>Issue date</label>
              <input type="date" value={f.issueDate} readOnly disabled />
            </div>
          </div>
          <div className="field">
            <label>UBL version</label>
            <select value={f.ublVersion} onChange={set("ublVersion")}>
              <option value="2.1">2.1</option>
              <option value="2.4">2.4</option>
            </select>
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

          {/* ── Buyer ── */}
          <div className="section-label">Buyer customer party</div>
          <div className="field-row">
            <div className="field">
              <label>Party name *</label>
              <input placeholder="MS Retail Pty Ltd" value={f.buyerName} onChange={set("buyerName")} />
            </div>
            <div className="field">
              <label>Account ID</label>
              <input placeholder="CUST-1001" value={f.buyerAccountId} onChange={set("buyerAccountId")} />
            </div>
          </div>
          <div className="field">
            <label>Party identification (ABN / ID)</label>
            <input placeholder="BUYER-ABN-53000111222" value={f.buyerPartyId} onChange={set("buyerPartyId")} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Street</label>
              <input placeholder="123 Collins Street" value={f.buyerStreet} onChange={set("buyerStreet")} />
            </div>
            <div className="field">
              <label>City</label>
              <input placeholder="Melbourne" value={f.buyerCity} onChange={set("buyerCity")} />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Postal zone</label>
              <input placeholder="3000" value={f.buyerZone} onChange={set("buyerZone")} />
            </div>
            <div className="field">
              <label>Country code</label>
              <input maxLength={2} value={f.buyerCountryCode} onChange={set("buyerCountryCode")} />
            </div>
            <div className="field">
              <label>Country name</label>
              <input value={f.buyerCountryName} onChange={set("buyerCountryName")} />
            </div>
          </div>

          {/* ── Order lines ── */}
          <div className="section-label">Order lines</div>

          {/* Line 1 (always present) */}
          <div className={styles.lineCard}>
            <div className={styles.lineHeader}>
              <span className={styles.lineLabel}>Line 1</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Item name *</label>
                <input placeholder="Ergonomic Chair" value={f.line1Name} onChange={set("line1Name")} />
              </div>
              <div className="field">
                <label>Line ID</label>
                <input value={f.line1Id} onChange={set("line1Id")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Description</label>
                <input placeholder="Mesh back, adjustable" value={f.line1Desc} onChange={set("line1Desc")} />
              </div>
              <div className="field">
                <label>Model</label>
                <input placeholder="ERGO-MESH-BLK" value={f.line1Model} onChange={set("line1Model")} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Quantity</label>
                <input type="number" min="1" value={f.line1Qty} onChange={set("line1Qty")} />
              </div>
              <div className="field">
                <label>Unit code</label>
                <input placeholder="EA" value={f.line1Unit} onChange={set("line1Unit")} />
              </div>
            </div>
            <div className="field">
              <label>Line note</label>
              <input placeholder="For Level 2 fitout" value={f.line1Note} onChange={set("line1Note")} />
            </div>
          </div>

          {/* Extra lines */}
          {extraLines.map((line, i) => (
            <div key={i} className={styles.lineCard}>
              <div className={styles.lineHeader}>
                <span className={styles.lineLabel}>Line {i + 2}</span>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ fontSize: 10, padding: "3px 8px" }}
                  onClick={() => removeLine(i)}
                >
                  Remove
                </button>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Item name *</label>
                  <input
                    placeholder="27-inch Monitor"
                    value={line.name}
                    onChange={(e) => updateLine(i, "name", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Line ID</label>
                  <input
                    value={line.id}
                    onChange={(e) => updateLine(i, "id", e.target.value)}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Description</label>
                  <input
                    placeholder="QHD IPS monitor"
                    value={line.desc}
                    onChange={(e) => updateLine(i, "desc", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Model</label>
                  <input
                    placeholder="MON-27-QHD"
                    value={line.model}
                    onChange={(e) => updateLine(i, "model", e.target.value)}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={line.qty}
                    onChange={(e) => updateLine(i, "qty", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Unit code</label>
                  <input
                    placeholder="EA"
                    value={line.unit}
                    onChange={(e) => updateLine(i, "unit", e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>Line note</label>
                <input
                  value={line.note}
                  onChange={(e) => updateLine(i, "note", e.target.value)}
                />
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

          {/* ── Actions ── */}
          <div className={styles.actions}>
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
                "Create order →"
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/app/orders")}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

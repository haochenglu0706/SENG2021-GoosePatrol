import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { TopBar } from "../../components/layout/TopBar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { DespatchAdviceRow } from "../../types/despatch";
import styles from "./style/edit.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldErrors = Record<string, string>;

type EditLine = {
  id: string;
  qty: string;
  unit: string;
  itemName: string;
  itemDesc: string;
};

type FormState = {
  documentId: string;
  receiverId: string;
  issueDate: string;
  documentStatusCode: string;
  orderRefId: string;
  note: string;
  // Supplier party
  supplierName: string;
  supplierStreet: string;
  supplierCity: string;
  supplierZone: string;
  supplierCountry: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  // Customer party
  customerName: string;
  customerStreet: string;
  customerCity: string;
  customerZone: string;
  customerCountry: string;
  // Shipment / delivery
  shipId: string;
  consId: string;
  delivStreet: string;
  delivCity: string;
  delivZone: string;
  delivCountry: string;
  periodStart: string;
  periodEnd: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Statuses that prevent editing */
const LOCKED_STATUSES = new Set(["RECEIVED", "FULFILMENT_CANCELLED"]);

function isEditLocked(status: string | undefined): boolean {
  return LOCKED_STATUSES.has((status ?? "").toUpperCase());
}

function docId(d: DespatchAdviceRow): string {
  return d.documentId ?? d.documentID ?? "";
}

/** Map API response → form state + lines */
function toFormState(d: DespatchAdviceRow): { form: FormState; lines: EditLine[] } {
  const sup = d.despatchSupplierParty?.party;
  const supAddr = sup?.postalAddress ?? {};
  const contact = sup?.contact ?? {};
  const cust = d.deliveryCustomerParty?.party;
  const custAddr = cust?.postalAddress ?? {};
  const ship = d.shipment as Record<string, unknown> | undefined;
  const delivery = (ship?.delivery ?? {}) as Record<string, unknown>;
  const delivAddr = (delivery.deliveryAddress ?? {}) as Record<string, string>;
  const period = (delivery.requestedDeliveryPeriod ?? {}) as Record<string, string>;

  const lines: EditLine[] = (d.despatchLines ?? []).map((l, i) => ({
    id: l.id ?? `LINE-${i + 1}`,
    qty: String(l.deliveredQuantity ?? 1),
    unit: l.deliveredQuantityUnitCode ?? "EA",
    itemName: l.item?.name ?? "",
    itemDesc: l.item?.description ?? "",
  }));

  if (lines.length === 0) {
    lines.push({ id: "LINE-1", qty: "1", unit: "EA", itemName: "", itemDesc: "" });
  }

  return {
    form: {
      documentId: docId(d),
      receiverId: d.receiverId ?? "",
      issueDate: d.issueDate ?? "",
      documentStatusCode: d.documentStatusCode ?? "",
      orderRefId: d.orderReference?.id ?? "",
      note: d.note ?? "",
      supplierName: sup?.name ?? "",
      supplierStreet: (supAddr.streetName as string) ?? "",
      supplierCity: (supAddr.cityName as string) ?? "",
      supplierZone: (supAddr.postalZone as string) ?? "",
      supplierCountry: (supAddr.countryIdentificationCode as string) ?? "",
      contactName: (contact.name as string) ?? "",
      contactPhone: (contact.telephone as string) ?? "",
      contactEmail: (contact.email as string) ?? "",
      customerName: cust?.name ?? "",
      customerStreet: (custAddr.streetName as string) ?? "",
      customerCity: (custAddr.cityName as string) ?? "",
      customerZone: (custAddr.postalZone as string) ?? "",
      customerCountry: (custAddr.countryIdentificationCode as string) ?? "",
      shipId: (ship?.id as string) ?? "",
      consId: (ship?.consignmentId as string) ?? "",
      delivStreet: delivAddr.streetName ?? "",
      delivCity: delivAddr.cityName ?? "",
      delivZone: delivAddr.postalZone ?? "",
      delivCountry: delivAddr.countryIdentificationCode ?? "",
      periodStart: period.startDate ?? "",
      periodEnd: period.endDate ?? "",
    },
    lines,
  };
}

/** Build the PUT body from current form + lines */
function buildPutBody(
  f: FormState,
  lines: EditLine[],
  original: DespatchAdviceRow
): Record<string, unknown> {
  return {
    documentId: f.documentId,
    senderId: original.senderId,
    receiverId: f.receiverId,
    copyIndicator: original.copyIndicator ?? false,
    issueDate: f.issueDate,
    documentStatusCode: f.documentStatusCode,
    orderReference: { id: f.orderRefId },
    note: f.note.trim() || undefined,
    despatchAdviceTypeCode: (original as Record<string, unknown>).despatchAdviceTypeCode as string ?? "delivery",
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
        requestedDeliveryPeriod: {
          startDate: f.periodStart,
          endDate: f.periodEnd,
        },
      },
    },
    despatchLines: lines.map((l, i) => ({
      id: l.id || `LINE-${i + 1}`,
      deliveredQuantity: parseFloat(l.qty) || 1,
      deliveredQuantityUnitCode: l.unit || "EA",
      orderLineReference: {
        lineId: String(i + 1),
        orderReference: { id: f.orderRefId },
      },
      item: { name: l.itemName, description: l.itemDesc || l.itemName },
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(f: FormState): FieldErrors {
  const errs: FieldErrors = {};
  const req = (key: keyof FormState, label: string) => {
    if (!f[key] || !String(f[key]).trim()) errs[key] = `${label} is required`;
  };

  req("documentId", "Document ID");
  req("receiverId", "Receiver ID");
  req("issueDate", "Issue date");
  req("documentStatusCode", "Document status code");
  req("orderRefId", "Order reference ID");
  req("supplierName", "Supplier name");
  req("supplierStreet", "Supplier street");
  req("supplierCity", "Supplier city");
  req("supplierCountry", "Supplier country");
  req("customerName", "Customer name");
  req("customerStreet", "Customer street");
  req("customerCity", "Customer city");
  req("customerCountry", "Customer country");
  req("delivStreet", "Delivery street");
  req("delivCity", "Delivery city");
  req("delivCountry", "Delivery country");
  req("periodStart", "Delivery window start");
  req("periodEnd", "Delivery window end");

  if (f.supplierCountry && f.supplierCountry.length !== 2)
    errs.supplierCountry = "Must be exactly 2 characters (e.g. AU)";
  if (f.customerCountry && f.customerCountry.length !== 2)
    errs.customerCountry = "Must be exactly 2 characters (e.g. AU)";
  if (f.delivCountry && f.delivCountry.length !== 2)
    errs.delivCountry = "Must be exactly 2 characters (e.g. AU)";

  if (f.periodStart && f.periodEnd && f.periodEnd < f.periodStart)
    errs.periodEnd = "End date must be after start date";

  return errs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditDespatchPage() {
  const { despatchId } = useParams<{ despatchId: string }>();
  const navigate = useNavigate();
  const { clientId, sessionId } = useAuth();

  const [original, setOriginal] = useState<DespatchAdviceRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [initialForm, setInitialForm] = useState<FormState | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [initialLines, setInitialLines] = useState<EditLine[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [submitOk, setSubmitOk] = useState(false);

  // Ref to scroll to first error
  const firstErrRef = useRef<HTMLDivElement>(null);

  // ── Fetch despatch ──────────────────────────────────────────────────────
  const fetchDespatch = useCallback(async () => {
    if (!despatchId || !sessionId) return;
    setFetchLoading(true);
    setFetchErr("");
    try {
      const data = await apiFetch<DespatchAdviceRow>(
        `/despatch-advices/${encodeURIComponent(despatchId)}`,
        {},
        sessionId
      );
      setOriginal(data);
      const { form: fs, lines: ls } = toFormState(data);
      setForm(fs);
      setInitialForm(fs);
      setLines(ls);
      setInitialLines(ls);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("404") || msg.toLowerCase().includes("not found"))
        setFetchErr("404");
      else if (msg.includes("401") || msg.includes("403"))
        setFetchErr("401");
      else
        setFetchErr(msg);
    } finally {
      setFetchLoading(false);
    }
  }, [despatchId, sessionId]);

  useEffect(() => {
    void fetchDespatch();
  }, [fetchDespatch]);

  // ── Dirty tracking ──────────────────────────────────────────────────────
  const changedFields = useMemo(() => {
    if (!form || !initialForm) return 0;
    const formChanges = (Object.keys(form) as (keyof FormState)[]).filter(
      (k) => form[k] !== initialForm[k]
    ).length;
    const linesChanged = JSON.stringify(lines) !== JSON.stringify(initialLines) ? 1 : 0;
    return formChanges + linesChanged;
  }, [form, initialForm, lines, initialLines]);

  // ── Field helpers ───────────────────────────────────────────────────────
  const set =
    (k: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((p) => p ? { ...p, [k]: e.target.value } : p);
      // Clear field error on change
      if (fieldErrors[k]) setFieldErrors((p) => { const n = { ...p }; delete n[k]; return n; });
    };

  // ── Submit ──────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form || !original || !sessionId || !despatchId) return;
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setTimeout(() => firstErrRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    setFieldErrors({});
    setSubmitErr("");
    setSubmitLoading(true);
    try {
      const body = buildPutBody(form, lines, original);
      await apiFetch(
        `/despatch-advices/${encodeURIComponent(despatchId)}`,
        { method: "PUT", body: JSON.stringify(body) },
        sessionId
      );
      setSubmitOk(true);
      setTimeout(() => navigate("/app/despatch/view"), 1800);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("401") || msg.includes("403"))
        setSubmitErr("You are not authorised to edit this despatch advice.");
      else if (msg.includes("404") || msg.toLowerCase().includes("not found"))
        setSubmitErr("Despatch advice not found. It may have been deleted.");
      else if (msg.includes("400"))
        setSubmitErr(`Validation error: ${msg}`);
      else if (msg.includes("500"))
        setSubmitErr("Server error. Please try again later.");
      else
        setSubmitErr(msg || "An unexpected error occurred. Please try again.");
    } finally {
      setSubmitLoading(false);
    }
  };

  // ── Guard: ownership ────────────────────────────────────────────────────
  const isOwner = original ? original.senderId === clientId : true;
  const locked = original ? isEditLocked(original.status) : false;

  // ── Field renderer helper ───────────────────────────────────────────────
  const Field = ({
    id,
    label,
    fkey,
    placeholder,
    type = "text",
    maxLength,
    readOnly = false,
    locked: isLocked = false,
  }: {
    id: string;
    label: string;
    fkey: keyof FormState;
    placeholder?: string;
    type?: string;
    maxLength?: number;
    readOnly?: boolean;
    locked?: boolean;
  }) => {
    const hasErr = !!fieldErrors[fkey];
    const isChanged = form && initialForm && form[fkey] !== initialForm[fkey];
    return (
      <div className={`field ${isLocked ? styles.lockedField : ""}`}>
        <label htmlFor={id}>
          {label}
          {isChanged ? <span className={styles.changeDot} title="Modified" /> : null}
        </label>
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={form ? String(form[fkey]) : ""}
          onChange={isLocked || readOnly ? undefined : set(fkey)}
          readOnly={isLocked || readOnly}
          maxLength={maxLength}
          className={[
            isLocked || readOnly ? styles.lockedInput : "",
            hasErr ? styles.inputError : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {isLocked || readOnly ? <span className={styles.lockIcon}>🔒</span> : null}
        {hasErr ? <div className={styles.fieldError}>{fieldErrors[fkey]}</div> : null}
      </div>
    );
  };

  // ── Render states ───────────────────────────────────────────────────────

  if (fetchLoading) {
    return (
      <>
        <TopBar title="Edit despatch advice" subtitle="Loading…" />
        <div className="page-body" style={{ textAlign: "center", paddingTop: 60 }}>
          <span className="spinner" />
        </div>
      </>
    );
  }

  if (fetchErr === "404") {
    return (
      <>
        <TopBar title="Edit despatch advice" />
        <div className="page-body">
          <div className="card" style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
            <div className="card-title">Despatch not found</div>
            <div className="card-sub">
              This despatch advice no longer exists or the ID is incorrect.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 20 }}
              onClick={() => navigate("/app/despatch/view")}
            >
              ← Back to despatches
            </button>
          </div>
        </div>
      </>
    );
  }

  if (fetchErr === "401") {
    return (
      <>
        <TopBar title="Edit despatch advice" />
        <div className="page-body">
          <div className="card" style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
            <div className="card-title">Unauthorised</div>
            <div className="card-sub">
              You do not have permission to view this despatch advice.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 20 }}
              onClick={() => navigate("/app/despatch/view")}
            >
              ← Back to despatches
            </button>
          </div>
        </div>
      </>
    );
  }

  if (fetchErr) {
    return (
      <>
        <TopBar title="Edit despatch advice" />
        <div className="page-body">
          <div className="alert alert-err">{fetchErr}</div>
          <button type="button" className="btn btn-secondary" onClick={() => void fetchDespatch()}>
            Retry
          </button>
        </div>
      </>
    );
  }

  if (!isOwner) {
    return (
      <>
        <TopBar title="Edit despatch advice" />
        <div className="page-body">
          <div className="card" style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🚫</div>
            <div className="card-title">Not your despatch</div>
            <div className="card-sub">
              You can only edit despatch advices where you are the sender.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 20 }}
              onClick={() => navigate("/app/despatch/view")}
            >
              ← Back
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Edit despatch advice"
        subtitle={original ? `Editing: ${docId(original)}` : ""}
        right={
          original ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={original.status} />
              {changedFields > 0 ? (
                <span className={styles.changesChip}>
                  ✏ {changedFields} change{changedFields !== 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className={`page-body ${styles.page}`}>
        {/* ── Cannot-edit banner ── */}
        {locked ? (
          <div className={styles.blockedBanner}>
            <div className={styles.blockedIcon}>🔒</div>
            <div>
              <div className={styles.blockedTitle}>This despatch can no longer be edited</div>
              <div className={styles.blockedSub}>
                Despatch advices with status{" "}
                <strong>{original?.status}</strong> are locked. Cancel and create a new
                despatch if changes are required.
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Success banner ── */}
        {submitOk ? (
          <div className="alert alert-ok" style={{ marginBottom: 16 }}>
            ✓ Changes saved successfully. Redirecting…
          </div>
        ) : null}

        {/* ── Submit error ── */}
        {submitErr ? (
          <div className="alert alert-err" style={{ marginBottom: 16 }} ref={firstErrRef}>
            {submitErr}
          </div>
        ) : null}

        <div className="card">
          {/* ── Meta strip (read-only overview) ── */}
          {original ? (
            <div className={styles.metaStrip}>
              <div className={styles.metaItem}>
                <div className={styles.metaKey}>Despatch Advice ID</div>
                <div className={styles.metaVal}>{original.despatchAdviceId}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaKey}>Sender (you)</div>
                <div className={styles.metaVal}>{original.senderId}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaKey}>Current status</div>
                <div className={styles.metaValAccent}>
                  {original.status ?? "draft"}
                </div>
              </div>
            </div>
          ) : null}

          {/* ── Document info ── */}
          <div className="section-label">Document info</div>
          <div className="field-row">
            <Field id="edit-docId" label="Document ID *" fkey="documentId" placeholder="DA-001" />
            <Field
              id="edit-receiverId"
              label="Receiver ID *"
              fkey="receiverId"
              placeholder="Client UUID of receiver"
            />
          </div>
          <div className="field-row">
            <Field
              id="edit-senderId"
              label="Sender ID (locked)"
              fkey="documentId"  /* value doesn't matter — we render clientId directly */
              placeholder=""
              readOnly
              locked
            />
            <Field
              id="edit-issueDate"
              label="Issue date *"
              fkey="issueDate"
              type="date"
            />
          </div>
          {/* Override the locked sender field to show actual clientId */}
          {/* (We render it manually below to avoid binding to wrong fkey) */}
          <div className="field-row">
            <div className={`field ${styles.lockedField}`}>
              <label>Sender ID (locked)</label>
              <input
                value={original?.senderId ?? ""}
                readOnly
                className={styles.lockedInput}
              />
              <span className={styles.lockIcon}>🔒</span>
            </div>
            <div className="field-row" style={{ padding: 0, gap: 12, gridColumn: "unset" }}>
              <Field
                id="edit-statusCode"
                label="Document status code *"
                fkey="documentStatusCode"
                placeholder="Active"
              />
            </div>
          </div>
          <div className="field-row">
            <Field id="edit-orderRef" label="Order reference ID *" fkey="orderRefId" placeholder="ORD-001" />
            <div className="field">
              <label htmlFor="edit-note">Note (optional)</label>
              <textarea
                id="edit-note"
                placeholder="General note or instructions"
                value={form?.note ?? ""}
                onChange={set("note")}
                style={{ minHeight: 50 }}
              />
            </div>
          </div>

          {/* ── Supplier party ── */}
          <div className="section-label">Despatch supplier party</div>
          <div className="field-row">
            <Field id="edit-supName" label="Party name *" fkey="supplierName" placeholder="Acme Supplies Ltd" />
            <Field id="edit-supStreet" label="Street *" fkey="supplierStreet" placeholder="1 Warehouse Rd" />
          </div>
          <div className="field-row-3">
            <Field id="edit-supCity" label="City *" fkey="supplierCity" placeholder="Sydney" />
            <Field id="edit-supZone" label="Postal zone" fkey="supplierZone" placeholder="2000" />
            <Field id="edit-supCountry" label="Country (ISO 2) *" fkey="supplierCountry" maxLength={2} placeholder="AU" />
          </div>
          <div className="field-row">
            <Field id="edit-conName" label="Contact name" fkey="contactName" placeholder="Jane Smith" />
            <Field id="edit-conPhone" label="Contact phone" fkey="contactPhone" placeholder="0412345678" />
          </div>
          <div className="field">
            <label htmlFor="edit-conEmail">Contact email</label>
            <input
              id="edit-conEmail"
              type="email"
              placeholder="jane@supplier.com"
              value={form?.contactEmail ?? ""}
              onChange={set("contactEmail")}
            />
          </div>

          {/* ── Customer party ── */}
          <div className="section-label">Delivery customer party</div>
          <div className="field-row">
            <Field id="edit-custName" label="Party name *" fkey="customerName" placeholder="Buyer Co" />
            <Field id="edit-custStreet" label="Street *" fkey="customerStreet" placeholder="2 Buyer St" />
          </div>
          <div className="field-row-3">
            <Field id="edit-custCity" label="City *" fkey="customerCity" placeholder="Sydney" />
            <Field id="edit-custZone" label="Postal zone" fkey="customerZone" placeholder="2000" />
            <Field id="edit-custCountry" label="Country (ISO 2) *" fkey="customerCountry" maxLength={2} placeholder="AU" />
          </div>

          {/* ── Shipment & delivery ── */}
          <div className="section-label">Shipment &amp; delivery</div>
          <div className="field-row">
            <Field id="edit-shipId" label="Shipment ID *" fkey="shipId" placeholder="SHIP-001" />
            <Field id="edit-consId" label="Consignment ID *" fkey="consId" placeholder="CONS-001" />
          </div>
          <div className="field-row">
            <Field id="edit-delivStreet" label="Delivery street *" fkey="delivStreet" placeholder="2 Buyer St" />
            <Field id="edit-delivCity" label="Delivery city *" fkey="delivCity" placeholder="Sydney" />
          </div>
          <div className="field-row-3">
            <Field id="edit-delivZone" label="Postal zone" fkey="delivZone" placeholder="2000" />
            <Field id="edit-delivCountry" label="Country (ISO 2) *" fkey="delivCountry" maxLength={2} placeholder="AU" />
            <div className="field" />
          </div>
          <div className="field-row">
            <Field id="edit-periodStart" label="Delivery window start *" fkey="periodStart" type="date" />
            <Field id="edit-periodEnd" label="Delivery window end *" fkey="periodEnd" type="date" />
          </div>
          {fieldErrors.periodEnd ? (
            <div className={styles.fieldError} style={{ marginTop: -10, marginBottom: 10 }}>
              {fieldErrors.periodEnd}
            </div>
          ) : null}

          {/* ── Despatch lines ── */}
          <div className="section-label">Despatch lines</div>
          {lines.map((line, i) => (
            <div key={i} className={styles.lineEditor}>
              <div className={styles.lineEditorHeader}>
                <span className={styles.lineEditorTitle}>Line {i + 1}</span>
                {!locked && lines.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ fontSize: 10, padding: "3px 8px" }}
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Item name *</label>
                  <input
                    value={line.itemName}
                    onChange={(e) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, itemName: e.target.value } : l))}
                    readOnly={locked}
                  />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input
                    value={line.itemDesc}
                    onChange={(e) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, itemDesc: e.target.value } : l))}
                    readOnly={locked}
                  />
                </div>
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label>Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    value={line.qty}
                    onChange={(e) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, qty: e.target.value } : l))}
                    readOnly={locked}
                  />
                </div>
                <div className="field">
                  <label>Unit code</label>
                  <input
                    value={line.unit}
                    onChange={(e) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, unit: e.target.value } : l))}
                    readOnly={locked}
                  />
                </div>
                <div className="field">
                  <label>Line ID</label>
                  <input
                    value={line.id}
                    onChange={(e) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, id: e.target.value } : l))}
                    readOnly={locked}
                  />
                </div>
              </div>
            </div>
          ))}
          {!locked && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 6 }}
              onClick={() => setLines((prev) => [...prev, { id: `LINE-${prev.length + 1}`, qty: "1", unit: "EA", itemName: "", itemDesc: "" }])}
            >
              + Add another line
            </button>
          )}

          {/* ── Actions ── */}
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitLoading || locked || !isOwner || submitOk}
            >
              {submitLoading ? (
                <>
                  <span className="spinner" /> Saving…
                </>
              ) : (
                "Save changes →"
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/app/despatch/view")}
              disabled={submitLoading}
            >
              Cancel
            </button>
            <div className={styles.actionsSpacer} />
            {changedFields > 0 && !submitOk ? (
              <span className={styles.changesChip}>
                ✏ {changedFields} unsaved change{changedFields !== 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
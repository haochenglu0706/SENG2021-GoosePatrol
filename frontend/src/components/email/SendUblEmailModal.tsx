import { useState } from "react";
import { apiFetch } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentType = "invoice" | "despatch" | "receipt";

interface SendUblEmailModalProps {
  /** Which kind of UBL document is being emailed. */
  documentType: DocumentType;
  /** The document's UUID (invoiceId / despatchId / receiptAdviceId). */
  documentId: string;
  /** Short human-readable label shown in the modal title, e.g. "INV-abc123". */
  documentLabel: string;
  /** Required only when documentType === "invoice" */
  invoiceToken?: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emailApiPath(documentType: DocumentType, documentId: string): string {
  switch (documentType) {
    case "invoice":
      return `/invoices/${encodeURIComponent(documentId)}/email`;
    case "despatch":
      return `/despatch-advices/${encodeURIComponent(documentId)}/email`;
    case "receipt":
      return `/receipt-advices/${encodeURIComponent(documentId)}/email`;
  }
}

function documentLabel(documentType: DocumentType): string {
  switch (documentType) {
    case "invoice":
      return "Invoice";
    case "despatch":
      return "Despatch Advice";
    case "receipt":
      return "Receipt Advice";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendUblEmailModal({
  documentType,
  documentId,
  documentLabel: label,
  invoiceToken,
  onClose,
}: SendUblEmailModalProps) {
  const { sessionId } = useAuth();

  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState(
    `${documentLabel(documentType)} UBL Document — ${label}`
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSend() {
    setError(null);

    if (!recipientEmail.trim()) {
      setError("Please enter a recipient email address.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setBusy(true);
    try {
      const extraHeaders: Record<string, string> = {};
      if (documentType === "invoice" && invoiceToken) {
        extraHeaders["invoiceToken"] = invoiceToken;
      }

      await apiFetch(
        emailApiPath(documentType, documentId),
        {
          method: "POST",
          headers: extraHeaders,
          body: JSON.stringify({
            recipientEmail: recipientEmail.trim(),
            subject: subject.trim() || undefined,
            message: message.trim() || undefined,
          }),
        },
        sessionId
      );

      setSuccess(true);
    } catch (err) {
      setError((err as Error).message ?? "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-labelledby="email-modal-title"
        style={{ maxWidth: 480 }}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="card-title" id="email-modal-title">
              ✉ Email {documentLabel(documentType)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {label}
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {success ? (
            <div
              style={{
                textAlign: "center",
                padding: "32px 0",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  color: "var(--green)",
                  marginBottom: 6,
                }}
              >
                Email sent successfully!
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                The UBL document was delivered to{" "}
                <strong>{recipientEmail}</strong>.
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 24 }}
                onClick={onClose}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Recipient */}
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="email-recipient"
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: "var(--text)",
                  }}
                >
                  Recipient email address <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  id="email-recipient"
                  type="email"
                  className="input"
                  placeholder="buyer@example.com"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>

              {/* Subject */}
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="email-subject"
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: "var(--text)",
                  }}
                >
                  Subject
                </label>
                <input
                  id="email-subject"
                  type="text"
                  className="input"
                  placeholder="Leave blank to use the default subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={busy}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>

              {/* Custom message */}
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="email-message"
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: "var(--text)",
                  }}
                >
                  Custom message{" "}
                  <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                    (optional)
                  </span>
                </label>
                <textarea
                  id="email-message"
                  className="input"
                  rows={4}
                  placeholder="Add a personal note to the recipient…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Attachment note */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  background: "var(--surface2, #f4f4f5)",
                  borderRadius: 6,
                  marginBottom: 20,
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                <span style={{ fontSize: 16 }}>📎</span>
                <span>
                  The UBL XML document for{" "}
                  <strong style={{ color: "var(--text)" }}>{label}</strong>{" "}
                  will be attached automatically.
                </span>
              </div>

              {/* Error */}
              {error && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--red-bg, #fef2f2)",
                    border: "1px solid var(--red, #ef4444)",
                    borderRadius: 6,
                    color: "var(--red, #ef4444)",
                    fontSize: 12,
                    marginBottom: 16,
                  }}
                >
                  {error}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSend()}
                  disabled={busy || !recipientEmail.trim()}
                >
                  {busy ? (
                    <>
                      <span className="spinner" style={{ marginRight: 6 }} />
                      Sending…
                    </>
                  ) : (
                    "Send Email"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
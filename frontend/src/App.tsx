import { useState } from "react";

const API_BASE = "https://e6kttv9em1.execute-api.ap-southeast-2.amazonaws.com/Prod";

const STEPS = ["Register", "Login", "Create Despatch", "Get Despatch", "Create Receipt", "Get Receipt", "Cancel Despatch"];

interface DespatchState {
  documentId: string;
  senderId: string;
  receiverId: string;
  partyName: string;
  streetName: string;
  cityName: string;
  postalZone: string;
  country: string;
  countryCode: string;
  contactName: string;
  telephone: string;
  email: string;
}

interface ApiResponse {
  status: number;
  data: unknown;
}

const initialDespatch: DespatchState = {
  documentId: "",
  senderId: "",
  receiverId: "",
  partyName: "",
  streetName: "",
  cityName: "",
  postalZone: "",
  country: "Australia",
  countryCode: "AU",
  contactName: "",
  telephone: "",
  email: "",
};

export default function App() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [savedDespatchId, setSavedDespatchId] = useState("");

  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [despatch, setDespatch] = useState<DespatchState>(initialDespatch);

  // Get Despatch
  const [getDespatchId, setGetDespatchId] = useState("");

  // Receipt Advice
  const [receiptDespatchId, setReceiptDespatchId] = useState("");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [receiptLineId, setReceiptLineId] = useState("");

  // Get Receipt
  const [getReceiptId, setGetReceiptId] = useState("");
  const [savedReceiptId, setSavedReceiptId] = useState("");

  // Cancel Despatch
  const [cancelDespatchId, setCancelDespatchId] = useState("");

  const call = async (url: string, options: RequestInit): Promise<unknown> => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string }).message || JSON.stringify(data));
      setResponse({ status: res.status, data });
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regEmail.includes("@")) {
      setError("Invalid email address — must contain @");
      return;
    }
    await call(`${API_BASE}/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        username: regUsername, 
        password: regPassword,
        email: regEmail,
      }),
    });
  };

  const handleLogin = async () => {
    if (!loginEmail.includes("@")) {
      setError("Invalid email address — must contain @");
      return;
    }
    const data = await call(`${API_BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        username: loginUsername, 
        password: loginPassword,
        email: loginEmail,
      }),
    });
    if (data && (data as { sessionId?: string }).sessionId) {
      setSessionId((data as { sessionId: string }).sessionId);
    }
  };

  const handleDespatch = async () => {
    const data = await call(`${API_BASE}/despatch-advices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", sessionId },
      body: JSON.stringify({
        documentId: despatch.documentId,
        senderId: despatch.senderId,
        receiverId: despatch.receiverId,
        despatchSupplierParty: {
          customerAssignedAccountId: "account-123",
          party: {
            name: despatch.partyName,
            postalAddress: {
              streetName: despatch.streetName,
              cityName: despatch.cityName,
              postalZone: despatch.postalZone,
              country: despatch.country,
              countryIdentificationCode: despatch.countryCode,
            },
            contact: {
              name: despatch.contactName,
              telephone: despatch.telephone,
              email: despatch.email,
            },
          },
        },
      }),
    });
    if (data && (data as { despatchAdviceId?: string }).despatchAdviceId) {
      setSavedDespatchId((data as { despatchAdviceId: string }).despatchAdviceId);
    }
  };

  const handleGetDespatch = async () => {
    await call(`${API_BASE}/despatch-advices/${getDespatchId}`, {
      method: "GET",
      headers: { sessionId },
    });
  };

  const handleCreateReceipt = async () => {
    const data = await call(`${API_BASE}/despatch-advices/${receiptDespatchId}/receipt-advices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", sessionId },
      body: JSON.stringify({
        receiptLines: [
          {
            id: receiptLineId || "LINE-001",
            receivedQuantity: Number(receivedQuantity),
          },
        ],
      }),
    });
    if (data && (data as { receiptAdviceId?: string }).receiptAdviceId) {
      setSavedReceiptId((data as { receiptAdviceId: string }).receiptAdviceId);
    }
  };

  const handleGetReceipt = async () => {
    await call(`${API_BASE}/receipt-advices/${getReceiptId}`, {
      method: "GET",
      headers: { sessionId },
    });
  };

  const handleCancelDespatch = async () => {
    await call(`${API_BASE}/despatch-advices/${cancelDespatchId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", sessionId },
      body: JSON.stringify({}),
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: "6px",
    padding: "10px 14px",
    color: "#e6edf3",
    fontSize: "13px",
    fontFamily: "'IBM Plex Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "11px",
    color: "#8b949e",
    marginBottom: "5px",
    fontFamily: "'IBM Plex Mono', monospace",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };

  const fieldStyle: React.CSSProperties = { marginBottom: "14px" };

  const sectionLabel: React.CSSProperties = {
    fontSize: "10px",
    color: "#f97316",
    margin: "14px 0 10px",
    letterSpacing: "0.08em",
  };

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "11px",
    background: disabled ? "#21262d" : "#f97316",
    border: "none",
    borderRadius: "6px",
    color: disabled ? "#8b949e" : "#0d1117",
    fontWeight: 600,
    fontSize: "13px",
    fontFamily: "'IBM Plex Mono', monospace",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s",
    marginTop: "4px",
  });

  const hintBox = (text: string, value: string, onUse: () => void): React.ReactNode => value ? (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: "6px", padding: "8px 12px", marginBottom: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ fontSize: "11px", color: "#6b7280", flex: 1, wordBreak: "break-all" }}>{text}: <span style={{ color: "#f97316" }}>{value.slice(0, 30)}...</span></span>
      <button onClick={onUse} style={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "4px", color: "#9ca3af", fontSize: "10px", padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'IBM Plex Mono', monospace" }}>Use →</button>
    </div>
  ) : null;

  const sessionWarning = !sessionId ? (
    <p style={{ fontSize: "11px", color: "#f85149", margin: "0 0 16px" }}>⚠ No session — complete Step 2 first</p>
  ) : (
    <p style={{ fontSize: "11px", color: "#3fb950", margin: "0 0 16px" }}>✓ Session active: {sessionId.slice(0, 24)}...</p>
  );

  const despatchFields: [keyof DespatchState, string, string][] = [
    ["documentId", "Document ID", "DA-001"],
    ["senderId", "Sender ID", "sender-123"],
    ["receiverId", "Receiver ID", "receiver-456"],
  ];

  const supplierFields: [keyof DespatchState, string, string][] = [
    ["partyName", "Party Name", "Acme Supplies"],
    ["streetName", "Street Name", "1 Warehouse Rd"],
    ["cityName", "City", "Sydney"],
    ["postalZone", "Postal Zone", "2000"],
    ["contactName", "Contact Name", "Jane Smith"],
    ["telephone", "Telephone", "0412345678"],
    ["email", "Email", "jane@acme.com"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#010409", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", fontFamily: "'IBM Plex Mono', monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@700;800&display=swap" rel="stylesheet" />

      <div style={{ width: "100%", maxWidth: "560px" }}>

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "linear-gradient(135deg, #f97316, #ea580c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>📦</div>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "#f0f6fc", letterSpacing: "-0.5px" }}>GoosePatrol</span>
            <span style={{ fontSize: "10px", color: "#f97316", background: "#f9731615", border: "1px solid #f9731630", padding: "2px 7px", borderRadius: "4px" }}>API Console</span>
          </div>
          <p style={{ color: "#8b949e", fontSize: "12px", margin: 0 }}>Delivery document exchange — proof of concept frontend</p>
        </div>

        {/* Step tabs — two rows */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", gap: "4px", background: "#0d1117", padding: "4px", borderRadius: "8px", border: "1px solid #21262d", marginBottom: "4px" }}>
            {STEPS.slice(0, 4).map((s, i) => (
              <button key={s} onClick={() => { setStep(i); setResponse(null); setError(null); }}
                style={{ flex: 1, padding: "7px 4px", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "10px", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, background: step === i ? "#21262d" : "transparent", color: step === i ? "#f0f6fc" : "#8b949e", transition: "all 0.15s" }}>
                <span style={{ color: step === i ? "#f97316" : "#484f58", marginRight: "4px" }}>{`0${i + 1}`}</span>{s}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px", background: "#0d1117", padding: "4px", borderRadius: "8px", border: "1px solid #21262d" }}>
            {STEPS.slice(4).map((s, i) => (
              <button key={s} onClick={() => { setStep(i + 4); setResponse(null); setError(null); }}
                style={{ flex: 1, padding: "7px 4px", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "10px", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, background: step === i + 4 ? "#21262d" : "transparent", color: step === i + 4 ? "#f0f6fc" : "#8b949e", transition: "all 0.15s" }}>
                <span style={{ color: step === i + 4 ? "#f97316" : "#484f58", marginRight: "4px" }}>{`0${i + 5}`}</span>{s}
              </button>
            ))}
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "12px", padding: "24px" }}>

          {/* Step 1 — Register */}
          {step === 0 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Register a client</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 20px" }}>Create a new account with a username and password.</p>
              <div style={fieldStyle}><label style={labelStyle}>Username</label><input style={inputStyle} placeholder="your-username" value={regUsername} onChange={e => setRegUsername(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Email</label><input style={inputStyle} type="email" placeholder="jane@acme.com" value={regEmail} onChange={e => setRegEmail(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Password</label><input style={inputStyle} type="password" placeholder="YourPassword1" value={regPassword} onChange={e => setRegPassword(e.target.value)} /></div>
              <p style={{ fontSize: "11px", color: "#6e7681", margin: "0 0 16px" }}>Min 8 characters · must contain a letter and a digit</p>  
              <button onClick={handleRegister} disabled={loading || !regUsername || !regPassword || !regEmail} style={btnStyle(loading || !regUsername || !regPassword || !regEmail)}>
                {loading ? "Registering..." : "Register →"}
              </button>
            </div>
          )}

          {/* Step 2 — Login */}
          {step === 1 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Create a session</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 20px" }}>Login to get a sessionId used for all subsequent requests.</p>
              <div style={fieldStyle}><label style={labelStyle}>Username</label><input style={inputStyle} placeholder="your-username" value={loginUsername} onChange={e => setLoginUsername(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Email</label><input style={inputStyle} type="email" placeholder="jane@acme.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Password</label><input style={inputStyle} type="password" placeholder="YourPassword1" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} /></div>
              {sessionId && (
                <div style={{ background: "#0f2a1a", border: "1px solid #1a4731", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
                  <p style={{ fontSize: "10px", color: "#3fb950", margin: "0 0 3px", letterSpacing: "0.05em" }}>SESSION ACTIVE</p>
                  <p style={{ fontSize: "11px", color: "#8b949e", margin: 0, wordBreak: "break-all" }}>{sessionId}</p>
                </div>
              )}
              <button onClick={handleLogin} disabled={loading || !loginUsername || !loginPassword || !loginEmail} style={btnStyle(loading || !loginUsername || !loginPassword || !loginEmail)}>
                {loading ? "Logging in..." : "Login →"}
              </button>
            </div>
          )}

          {/* Step 3 — Create Despatch */}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Create despatch advice</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 8px" }}>Submit a new despatch advice document.</p>
              {sessionWarning}
              <p style={sectionLabel}>DOCUMENT INFO</p>
              {despatchFields.map(([key, label, ph]) => (
                <div key={key} style={fieldStyle}><label style={labelStyle}>{label}</label><input style={inputStyle} placeholder={ph} value={despatch[key]} onChange={e => setDespatch(p => ({ ...p, [key]: e.target.value }))} /></div>
              ))}
              <p style={sectionLabel}>SUPPLIER PARTY</p>
              {supplierFields.map(([key, label, ph]) => (
                <div key={key} style={fieldStyle}><label style={labelStyle}>{label}</label><input style={inputStyle} placeholder={ph} value={despatch[key]} onChange={e => setDespatch(p => ({ ...p, [key]: e.target.value }))} /></div>
              ))}
              <button onClick={handleDespatch} disabled={loading || !sessionId || !despatch.documentId || !despatch.senderId || !despatch.receiverId || !despatch.partyName} style={btnStyle(loading || !sessionId || !despatch.documentId || !despatch.senderId || !despatch.receiverId || !despatch.partyName)}>
                {loading ? "Submitting..." : "Create Despatch Advice →"}
              </button>
            </div>
          )}

          {/* Step 4 — Get Despatch */}
          {step === 3 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Get despatch advice</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 8px" }}>Retrieve a despatch advice document by ID.</p>
              {sessionWarning}
              {hintBox("Saved despatch", savedDespatchId, () => setGetDespatchId(savedDespatchId))}
              <div style={fieldStyle}><label style={labelStyle}>Despatch Advice ID</label><input style={inputStyle} placeholder="e.g. f3a2b1c4-..." value={getDespatchId} onChange={e => setGetDespatchId(e.target.value)} /></div>
              <button onClick={handleGetDespatch} disabled={loading || !sessionId || !getDespatchId} style={btnStyle(loading || !sessionId || !getDespatchId)}>
                {loading ? "Fetching..." : "Get Despatch Advice →"}
              </button>
            </div>
          )}

          {/* Step 5 — Create Receipt */}
          {step === 4 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Create receipt advice</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 8px" }}>Confirm receipt of a despatch advice.</p>
              {sessionWarning}
              {hintBox("Saved despatch", savedDespatchId, () => setReceiptDespatchId(savedDespatchId))}
              <div style={fieldStyle}><label style={labelStyle}>Despatch Advice ID</label><input style={inputStyle} placeholder="e.g. f3a2b1c4-..." value={receiptDespatchId} onChange={e => setReceiptDespatchId(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Line ID</label><input style={inputStyle} placeholder="LINE-001" value={receiptLineId} onChange={e => setReceiptLineId(e.target.value)} /></div>
              <div style={fieldStyle}><label style={labelStyle}>Received Quantity</label><input style={inputStyle} type="number" placeholder="10" value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)} /></div>
              <button onClick={handleCreateReceipt} disabled={loading || !sessionId || !receiptDespatchId || !receivedQuantity} style={btnStyle(loading || !sessionId || !receiptDespatchId || !receivedQuantity)}>
                {loading ? "Submitting..." : "Create Receipt Advice →"}
              </button>
            </div>
          )}

          {/* Step 6 — Get Receipt */}
          {step === 5 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Get receipt advice</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 8px" }}>Retrieve a receipt advice document by ID.</p>
              {sessionWarning}
              {hintBox("Saved receipt", savedReceiptId, () => setGetReceiptId(savedReceiptId))}
              <div style={fieldStyle}><label style={labelStyle}>Receipt Advice ID</label><input style={inputStyle} placeholder="e.g. a1b2c3d4-..." value={getReceiptId} onChange={e => setGetReceiptId(e.target.value)} /></div>
              <button onClick={handleGetReceipt} disabled={loading || !sessionId || !getReceiptId} style={btnStyle(loading || !sessionId || !getReceiptId)}>
                {loading ? "Fetching..." : "Get Receipt Advice →"}
              </button>
            </div>
          )}

          {/* Step 7 — Cancel Despatch */}
          {step === 6 && (
            <div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#f0f6fc", fontSize: "16px", fontWeight: 700, margin: "0 0 4px" }}>Cancel despatch</h2>
              <p style={{ color: "#8b949e", fontSize: "12px", margin: "0 0 8px" }}>Perform fulfilment cancellation of a despatch advice.</p>
              {sessionWarning}
              {hintBox("Saved despatch", savedDespatchId, () => setCancelDespatchId(savedDespatchId))}
              <div style={fieldStyle}><label style={labelStyle}>Despatch Advice ID</label><input style={inputStyle} placeholder="e.g. f3a2b1c4-..." value={cancelDespatchId} onChange={e => setCancelDespatchId(e.target.value)} /></div>
              <div style={{ background: "#2a1215", border: "1px solid #4a1e24", borderRadius: "6px", padding: "10px 14px", marginBottom: "16px" }}>
                <p style={{ fontSize: "11px", color: "#f85149", margin: 0 }}>⚠ This action is irreversible — the despatch will be marked as FULFILMENT_CANCELLED</p>
              </div>
              <button onClick={handleCancelDespatch} disabled={loading || !sessionId || !cancelDespatchId} style={{ ...btnStyle(loading || !sessionId || !cancelDespatchId), background: loading || !sessionId || !cancelDespatchId ? "#21262d" : "#dc2626" }}>
                {loading ? "Cancelling..." : "Cancel Despatch →"}
              </button>
            </div>
          )}
        </div>

        {/* Response panel */}
        {(response || error) && (
          <div style={{ marginTop: "16px", background: "#0d1117", border: `1px solid ${error ? "#f8514930" : "#3fb95030"}`, borderRadius: "12px", padding: "16px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: error ? "#f85149" : "#3fb950" }}>
              {error ? "ERROR" : `${response?.status} SUCCESS`}
            </span>
            <pre style={{ margin: "10px 0 0", fontSize: "11px", color: error ? "#f85149" : "#8b949e", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
              {error || JSON.stringify(response?.data, null, 2)}
            </pre>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: "10px", color: "#484f58", marginTop: "24px" }}>
          GoosePatrol · SENG2021 · ap-southeast-2
        </p>
      </div>
    </div>
  );
}
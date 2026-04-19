import React, { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { API_BASE } from "../../api/client";

// ---------------------------------------------------------------------------
// Language options presented to the user
// ---------------------------------------------------------------------------

const SOURCE_LANGS = [
  { code: "AUTO", label: "Auto-detect" },
  { code: "EN", label: "English" },
  { code: "DE", label: "German" },
  { code: "FR", label: "French" },
  { code: "ES", label: "Spanish" },
  { code: "IT", label: "Italian" },
  { code: "PT", label: "Portuguese" },
  { code: "NL", label: "Dutch" },
  { code: "PL", label: "Polish" },
  { code: "RU", label: "Russian" },
  { code: "JA", label: "Japanese" },
  { code: "ZH", label: "Chinese" },
  { code: "KO", label: "Korean" },
  { code: "AR", label: "Arabic" },
  { code: "TR", label: "Turkish" },
  { code: "SV", label: "Swedish" },
  { code: "DA", label: "Danish" },
  { code: "FI", label: "Finnish" },
  { code: "NB", label: "Norwegian" },
];

const TARGET_LANGS = [
  { code: "EN-GB", label: "English (UK)" },
  { code: "EN-US", label: "English (US)" },
  { code: "DE", label: "German" },
  { code: "FR", label: "French" },
  { code: "ES", label: "Spanish" },
  { code: "IT", label: "Italian" },
  { code: "PT-PT", label: "Portuguese (EU)" },
  { code: "PT-BR", label: "Portuguese (Brazil)" },
  { code: "NL", label: "Dutch" },
  { code: "PL", label: "Polish" },
  { code: "RU", label: "Russian" },
  { code: "JA", label: "Japanese" },
  { code: "ZH", label: "Chinese" },
  { code: "KO", label: "Korean" },
  { code: "AR", label: "Arabic" },
  { code: "TR", label: "Turkish" },
  { code: "SV", label: "Swedish" },
  { code: "DA", label: "Danish" },
  { code: "FI", label: "Finnish" },
  { code: "NB", label: "Norwegian" },
  { code: "CS", label: "Czech" },
  { code: "SK", label: "Slovak" },
  { code: "HU", label: "Hungarian" },
  { code: "RO", label: "Romanian" },
  { code: "BG", label: "Bulgarian" },
  { code: "EL", label: "Greek" },
  { code: "UK", label: "Ukrainian" },
  { code: "ET", label: "Estonian" },
  { code: "LV", label: "Latvian" },
  { code: "LT", label: "Lithuanian" },
  { code: "SL", label: "Slovenian" },
  { code: "ID", label: "Indonesian" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TranslatePage() {
  const { sessionId } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState("AUTO");
  const [targetLang, setTargetLang] = useState("EN-GB");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // The translated XML string ready for download
  const [translatedXml, setTranslatedXml] = useState<string | null>(null);
  const [translatedFilename, setTranslatedFilename] = useState("translated.xml");

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setTranslatedXml(null);
    setStatus("idle");
    setErrorMsg("");
  }

  async function handleTranslate() {
    if (!selectedFile) {
      setErrorMsg("Please select an XML file first.");
      setStatus("error");
      return;
    }

    if (!sessionId) {
      setErrorMsg("You must be logged in to translate documents.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMsg("");
    setTranslatedXml(null);

    let xmlContent: string;
    try {
      xmlContent = await selectedFile.text();
    } catch {
      setErrorMsg("Failed to read the selected file.");
      setStatus("error");
      return;
    }

    if (!xmlContent.trimStart().startsWith("<")) {
      setErrorMsg("The selected file does not appear to be a valid XML document.");
      setStatus("error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          sessionId,
        },
        body: JSON.stringify({ xml: xmlContent, sourceLang, targetLang }),
      });

      const body = await res.text();

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const json = JSON.parse(body) as { message?: string; error?: string };
          message = json.message ?? json.error ?? message;
        } catch {
          message = body || message;
        }
        throw new Error(message);
      }

      setTranslatedXml(body);

      // Build a download filename based on the original: foo.xml → foo_DE.xml
      const ext = selectedFile.name.endsWith(".xml") ? ".xml" : "";
      const base = selectedFile.name.replace(/\.xml$/i, "");
      setTranslatedFilename(`${base}_${targetLang}${ext}`);

      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStatus("error");
    }
  }

  function handleDownload() {
    if (!translatedXml) return;
    const blob = new Blob([translatedXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = translatedFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    setSelectedFile(null);
    setTranslatedXml(null);
    setStatus("idle");
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerIcon}>🌐</span>
          <div>
            <h2 style={styles.title}>Translate Document</h2>
            <p style={styles.subtitle}>
              Translate UBL despatch or order XML documents using DeepL.
            </p>
          </div>
        </div>

        {/* File upload */}
        <section style={styles.section}>
          <label style={styles.label}>XML Document</label>
          <div
            style={{
              ...styles.dropZone,
              ...(selectedFile ? styles.dropZoneActive : {}),
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,application/xml,text/xml"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            {selectedFile ? (
              <div style={styles.fileInfo}>
                <span style={styles.fileIcon}>📄</span>
                <span style={styles.fileName}>{selectedFile.name}</span>
                <span style={styles.fileSize}>
                  ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div style={styles.uploadPrompt}>
                <span style={{ fontSize: 28 }}>📂</span>
                <span style={styles.uploadText}>
                  Click to upload an XML file
                </span>
                <span style={styles.uploadHint}>.xml files only</span>
              </div>
            )}
          </div>
        </section>

        {/* Language selectors */}
        <section style={styles.langRow}>
          <div style={styles.langGroup}>
            <label style={styles.label}>Source Language</label>
            <select
              style={styles.select}
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {SOURCE_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.arrow}>→</div>

          <div style={styles.langGroup}>
            <label style={styles.label}>Target Language</label>
            <select
              style={styles.select}
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              {TARGET_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Action buttons */}
        <div style={styles.actions}>
          <button
            style={{
              ...styles.btn,
              ...styles.btnPrimary,
              ...(status === "loading" ? styles.btnDisabled : {}),
            }}
            onClick={() => void handleTranslate()}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Translating…" : "🌐 Translate"}
          </button>

          {(selectedFile || translatedXml) && (
            <button
              style={{ ...styles.btn, ...styles.btnSecondary }}
              onClick={handleReset}
            >
              ✕ Reset
            </button>
          )}
        </div>

        {/* Status messages */}
        {status === "error" && (
          <div style={styles.errorBanner}>
            <span>⚠️ {errorMsg}</span>
          </div>
        )}

        {status === "success" && translatedXml && (
          <div style={styles.successBanner}>
            <div style={styles.successText}>
              ✅ Translation complete!
            </div>
            <button
              style={{ ...styles.btn, ...styles.btnDownload }}
              onClick={handleDownload}
            >
              ⬇️ Download {translatedFilename}
            </button>

            {/* Preview (first 400 chars) */}
            <details style={styles.previewDetails}>
              <summary style={styles.previewSummary}>Preview translated XML</summary>
              <pre style={styles.previewCode}>
                {translatedXml.length > 1200
                  ? translatedXml.slice(0, 1200) + "\n…"
                  : translatedXml}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles (no external CSS module needed)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "32px 24px",
    maxWidth: 700,
    margin: "0 auto",
  },
  card: {
    background: "var(--bg-surface, #fff)",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: 12,
    padding: 28,
    boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 28,
  },
  headerIcon: {
    fontSize: 36,
    lineHeight: 1,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary, #1a202c)",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "var(--text-secondary, #718096)",
  },
  section: {
    marginBottom: 24,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary, #4a5568)",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  dropZone: {
    border: "2px dashed var(--border, #cbd5e0)",
    borderRadius: 8,
    padding: "24px 16px",
    cursor: "pointer",
    textAlign: "center",
    transition: "border-color 0.15s, background 0.15s",
    background: "var(--bg-base, #f7fafc)",
  },
  dropZoneActive: {
    borderColor: "var(--accent, #4f46e5)",
    background: "var(--accent-light, #eef2ff)",
  },
  uploadPrompt: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  uploadText: {
    fontWeight: 600,
    fontSize: 14,
    color: "var(--text-primary, #2d3748)",
  },
  uploadHint: {
    fontSize: 12,
    color: "var(--text-secondary, #718096)",
  },
  fileInfo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  fileIcon: { fontSize: 22 },
  fileName: {
    fontWeight: 600,
    fontSize: 14,
    color: "var(--text-primary, #2d3748)",
  },
  fileSize: {
    fontSize: 12,
    color: "var(--text-secondary, #718096)",
  },
  langRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 24,
  },
  langGroup: {
    flex: 1,
  },
  arrow: {
    fontSize: 22,
    paddingBottom: 8,
    color: "var(--text-secondary, #718096)",
  },
  select: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border, #cbd5e0)",
    fontSize: 14,
    background: "var(--bg-base, #fff)",
    color: "var(--text-primary, #2d3748)",
  },
  actions: {
    display: "flex",
    gap: 10,
    marginBottom: 16,
  },
  btn: {
    padding: "9px 18px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    transition: "opacity 0.15s",
  },
  btnPrimary: {
    background: "var(--accent, #4f46e5)",
    color: "#fff",
  },
  btnSecondary: {
    background: "var(--bg-base, #f1f5f9)",
    color: "var(--text-primary, #2d3748)",
    border: "1px solid var(--border, #cbd5e0)",
  },
  btnDownload: {
    background: "var(--success, #059669)",
    color: "#fff",
    marginTop: 10,
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  errorBanner: {
    marginTop: 12,
    padding: "12px 16px",
    borderRadius: 7,
    background: "#fff5f5",
    border: "1px solid #fed7d7",
    color: "#c53030",
    fontSize: 14,
  },
  successBanner: {
    marginTop: 12,
    padding: "16px",
    borderRadius: 7,
    background: "#f0fff4",
    border: "1px solid #9ae6b4",
  },
  successText: {
    fontWeight: 600,
    fontSize: 15,
    color: "#276749",
    marginBottom: 4,
  },
  previewDetails: {
    marginTop: 12,
  },
  previewSummary: {
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-secondary, #4a5568)",
    fontWeight: 600,
    userSelect: "none",
  },
  previewCode: {
    marginTop: 8,
    padding: 12,
    background: "#1a202c",
    color: "#e2e8f0",
    borderRadius: 6,
    fontSize: 11,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 300,
    overflowY: "auto",
  },
};
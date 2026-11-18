import { useEffect, useMemo, useRef, useState } from "react";
import {
  planTerminalCapture,
  renderTerminalCaptureCanvas,
  TERMINAL_CAPTURE_MODES,
  terminalCaptureFilename,
} from "../lib/terminalCapture";

const MAX_REPORT_IMAGE_BYTES = 3 * 1024 * 1024;

const dataUrlBytes = (dataUrl) => {
  const encoded = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil(encoded.length * 0.75);
};

const digest = async (value) => {
  if (!globalThis.crypto?.subtle) return "";
  const bytes = new TextEncoder().encode(value);
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
};

const downloadDataUrl = (dataUrl, filename) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
};

const proofChecks = [
  ["prompt", "Prompt before and after"],
  ["identity", "Identity"],
  ["address", "Target IP"],
  ["path", "Original proof path"],
  ["value", "Proof value"],
];

export default function TerminalCaptureDialog({ session, snapshot, onClose, onSaveProof }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [mode, setMode] = useState(session.proof ? TERMINAL_CAPTURE_MODES.PROOF : TERMINAL_CAPTURE_MODES.VISIBLE);
  const [lastLines, setLastLines] = useState("40");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const timestamp = useMemo(() => new Date().toISOString(), []);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const focusOutside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (focusOutside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focusOutside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const plan = useMemo(() => {
    try {
      return planTerminalCapture(snapshot, {
        mode,
        lineCount: lastLines,
        proofValue: session.proof?.value || "",
        proofPath: session.proof?.flagName || "",
        targetAddress: session.address || "",
        proofCommand: session.proof?.command || "",
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not plan that terminal capture.", pages: [], rows: [], lineCount: 0 };
    }
  }, [lastLines, mode, session.address, session.proof, snapshot]);

  const metadata = {
    targetName: session.targetName,
    address: session.address,
    context: session.context,
    columns: snapshot.columns,
    timestamp,
  };

  const renderPage = (page, part, parts) => {
    const canvas = renderTerminalCaptureCanvas(page, { ...metadata, part, parts });
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, size: dataUrlBytes(dataUrl) };
  };

  const filenameFor = (part, parts) => terminalCaptureFilename({
    targetSlug: session.address || session.targetName,
    proofKind: mode === TERMINAL_CAPTURE_MODES.PROOF ? `${session.proof?.kind || "proof"}-proof` : mode,
    mode,
    timestamp,
    part,
    parts,
  });

  const download = async () => {
    if (plan.error || !plan.pages.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const parts = plan.pages.length;
      for (let index = 0; index < parts; index += 1) {
        const rendered = renderPage(plan.pages[index], index + 1, parts);
        downloadDataUrl(rendered.dataUrl, filenameFor(index + 1, parts));
        if (parts > 1) await new Promise((resolve) => window.setTimeout(resolve, 75));
      }
      setMessage({ type: "success", text: `Downloaded ${parts} terminal-only PNG${parts === 1 ? "" : "s"}.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not render the terminal capture." });
    } finally {
      setBusy(false);
    }
  };

  const saveProof = async () => {
    if (plan.error || plan.reviewRequired || mode !== TERMINAL_CAPTURE_MODES.PROOF || !session.proof) return;
    setBusy(true);
    setMessage(null);
    try {
      const proofPageIndex = Math.max(0, plan.pages.findIndex((page) => plan.proofLine >= page.start && plan.proofLine < page.end));
      const page = plan.pages[proofPageIndex];
      const rendered = renderPage(page, proofPageIndex + 1, plan.pages.length);
      if (rendered.size > MAX_REPORT_IMAGE_BYTES) throw new Error("This PNG exceeds the 3 MB report-evidence limit. Capture fewer rows or download it instead.");
      const filename = filenameFor(proofPageIndex + 1, plan.pages.length);
      const transcript = page.rows.map((row) => row.text).join("\n");
      await onSaveProof({
        dataUrl: rendered.dataUrl,
        filename,
        size: rendered.size,
        sha256: await digest(transcript),
        capture: {
          mode,
          start: page.start,
          end: page.end,
          totalLines: plan.totalLines,
          completeness: plan.completeness,
          capturedAt: timestamp,
        },
      });
      setMessage({ type: "success", text: "Saved this terminal-only image as report proof. Screenshot verification remains a separate manual check." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save this proof image." });
    } finally {
      setBusy(false);
    }
  };

  const previewRows = plan.rows?.slice(0, 32) || [];
  const omittedPreview = Math.max(0, (plan.rows?.length || 0) - previewRows.length);

  return (
    <div className="terminal-capture-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="terminal-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-capture-title" tabIndex={-1}>
        <header>
          <div><span className="eyebrow">Local terminal image</span><h2 id="terminal-capture-title">Capture only this terminal</h2></div>
          <button ref={closeButtonRef} type="button" className="text-button" onClick={onClose}>Close</button>
        </header>

        <p className="terminal-capture-intro">Choose exactly how much scrollback to include. Nothing outside this active Fieldnotes terminal is captured or sent anywhere.</p>

        <fieldset className="terminal-capture-modes">
          <legend>Capture range</legend>
          <label className={!session.proof ? "is-disabled" : ""}>
            <input type="radio" name="terminal-capture-mode" value={TERMINAL_CAPTURE_MODES.PROOF} checked={mode === TERMINAL_CAPTURE_MODES.PROOF} disabled={!session.proof} onChange={(event) => setMode(event.target.value)} />
            <span><strong>Automatic proof context</strong><small>Detect the prompt, identity, target IP, original path, proof value, and returned prompt.</small></span>
          </label>
          <label>
            <input type="radio" name="terminal-capture-mode" value={TERMINAL_CAPTURE_MODES.VISIBLE} checked={mode === TERMINAL_CAPTURE_MODES.VISIBLE} onChange={(event) => setMode(event.target.value)} />
            <span><strong>Current visible terminal</strong><small>Use the rows currently visible in xterm without changing its scroll position.</small></span>
          </label>
          <label>
            <input type="radio" name="terminal-capture-mode" value={TERMINAL_CAPTURE_MODES.LAST} checked={mode === TERMINAL_CAPTURE_MODES.LAST} onChange={(event) => setMode(event.target.value)} />
            <span><strong>Last N terminal rows</strong><small>Choose between 5 and 500 rows.</small></span>
          </label>
          <label>
            <input type="radio" name="terminal-capture-mode" value={TERMINAL_CAPTURE_MODES.FULL} checked={mode === TERMINAL_CAPTURE_MODES.FULL} onChange={(event) => setMode(event.target.value)} />
            <span><strong>Entire terminal scrollback</strong><small>Preserve every buffer row and split safely across numbered PNG files.</small></span>
          </label>
        </fieldset>

        {mode === TERMINAL_CAPTURE_MODES.LAST && (
          <label className="terminal-capture-count"><span>Rows from the end</span><input type="number" min="5" max="500" step="1" value={lastLines} onChange={(event) => setLastLines(event.target.value)} /></label>
        )}

        <div className={`terminal-capture-plan ${plan.error || plan.reviewRequired ? "needs-review" : ""}`}>
          <strong>{plan.error || plan.reason}</strong>
          {!plan.error && <span>{plan.lineCount} row{plan.lineCount === 1 ? "" : "s"} selected · {plan.pages.length} PNG file{plan.pages.length === 1 ? "" : "s"}</span>}
        </div>

        {mode === TERMINAL_CAPTURE_MODES.PROOF && plan.completeness && (
          <div className="terminal-proof-checks" aria-label="Proof screenshot context checks">
            {proofChecks.map(([key, label]) => <span className={plan.completeness[key] ? "is-present" : "is-missing"} key={key}>{plan.completeness[key] ? "✓" : "!"} {label}</span>)}
          </div>
        )}

        {!plan.error && (
          <pre className="terminal-capture-preview" aria-label="Selected terminal rows">{previewRows.map((row) => row.text).join("\n")}{omittedPreview ? `\n… ${omittedPreview} more selected rows` : ""}</pre>
        )}

        <p className="terminal-capture-warning">Terminal images can contain passwords, hashes, proof values, and other secrets. Review the preview before downloading or attaching it.</p>
        {message && <p className={`terminal-capture-message ${message.type}`} role="status">{message.text}</p>}

        <footer>
          <button type="button" className="button secondary" disabled={busy || Boolean(plan.error)} onClick={download}>{busy ? "Rendering…" : `Download ${plan.pages?.length > 1 ? `${plan.pages.length} PNGs` : "PNG"}`}</button>
          {session.proof && (
            <button type="button" className="button" disabled={busy || Boolean(plan.error) || plan.reviewRequired || mode !== TERMINAL_CAPTURE_MODES.PROOF} onClick={saveProof}>Add as {session.proof.kind === "root" ? "Administrator" : "user"} report proof</button>
          )}
        </footer>
      </section>
    </div>
  );
}

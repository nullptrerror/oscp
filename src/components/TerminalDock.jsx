import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTerminalWorkspace } from "../context/TerminalWorkspaceContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { isInterruptInstruction, TERMINAL_CONTEXTS } from "../lib/terminalWorkspace";
import TerminalCaptureDialog from "./TerminalCaptureDialog";

const CommandTerminal = lazy(() => import("./CommandTerminal"));

const terminalScopeLabel = (session) => session?.sessionRole === "machine-log"
  ? `machine transcript scope · opened at ${session.address || "an unassigned endpoint"}`
  : `endpoint ${session?.address || "unassigned"}`;

export default function TerminalDock() {
  const terminal = useTerminalWorkspace();
  const { actions } = useWorkspace();
  const terminalRefs = useRef(new Map());
  const [capture, setCapture] = useState(null);
  const [captureError, setCaptureError] = useState("");
  const active = terminal.activeSession || terminal.sessions[0] || null;
  const busy = Boolean(active?.activeStep || active?.pendingStep);
  const contextLabel = TERMINAL_CONTEXTS.find((entry) => entry.value === active?.context)?.label || active?.context;
  const captureSession = capture ? terminal.sessions.find((session) => session.id === capture.sessionId) : null;
  const roleLabel = active?.sessionRole === "machine-log" ? "Recorded machine shell" : "General command tab";
  const availabilityLabel = active?.pendingStep
    ? "command staged"
    : active?.activeStep
      ? "command running / awaiting prompt review"
      : active?.promptReady
        ? "ready for a reviewed command"
        : active?.status;

  useEffect(() => {
    if (capture && (!captureSession || capture.sessionId !== active?.id)) setCapture(null);
  }, [active?.id, capture, captureSession]);

  if (!active) return null;

  const openCapture = () => {
    const handle = terminalRefs.current.get(active.id);
    const snapshot = handle?.snapshot?.();
    if (!snapshot) {
      setCaptureError("The terminal buffer is still starting. Try capture again after the prompt appears.");
      return;
    }
    setCaptureError("");
    setCapture({ sessionId: active.id, snapshot });
  };

  const activeSnapshot = () => terminalRefs.current.get(active.id)?.snapshot?.();

  const saveProof = async ({ dataUrl, filename, size, sha256, capture: captureMetadata }) => {
    if (!captureSession?.proof) return false;
    const root = captureSession.proof.kind === "root";
    actions.addEvidence("proof-artifacts", {
      targetId: captureSession.targetId,
      endpointId: captureSession.endpointId,
      label: `${root ? "Root / Administrator" : "User"} proof — ${filename}`,
      filename,
      dataUrl,
      mimeType: "image/png",
      size,
      source: "embedded-terminal-capture",
      category: root ? "root-flag" : "user-flag",
      terminalCapture: { ...captureMetadata, sha256, sessionId: captureSession.id },
    });
    return true;
  };

  return (
    <aside className={`terminal-workspace ${terminal.collapsed ? "is-collapsed" : ""}`} aria-label="Embedded terminal workspace">
      <div className="terminal-workspace-heading">
        <div><span className="eyebrow">Embedded terminal workspace</span><strong>{terminal.sessions.length} project session{terminal.sessions.length === 1 ? "" : "s"}</strong></div>
        <button type="button" className="text-button" onClick={() => terminal.setCollapsed(!terminal.collapsed)}>{terminal.collapsed ? "Show" : "Collapse"}</button>
      </div>
      <div className="terminal-session-tabs" role="tablist" aria-label="Terminal sessions">
        {terminal.sessions.map((session) => (
          <button type="button" role="tab" aria-selected={session.id === active?.id} className={session.id === active?.id ? "is-active" : ""} key={session.id} onClick={() => terminal.selectSession(session.id)}>
            <span className={`terminal-state ${session.status}`}>{session.status}</span><strong>{session.targetName}</strong><small>{session.context} · {session.sessionRole || "general"} · {session.promptReady ? "ready" : "busy"} · {terminalScopeLabel(session)} · {session.id.slice(-6)}</small>
          </button>
        ))}
      </div>
      <div className="terminal-workspace-body" aria-hidden={terminal.collapsed}>
        {active && (
          <>
            <div className="terminal-session-toolbar">
              <div className="terminal-session-scope"><strong>{active.label}</strong><span>{active.targetName} · {terminalScopeLabel(active)} · {contextLabel} · {roleLabel} · {availabilityLabel} · tab {active.id.slice(-6)}</span><code>Local PTY workspace · {active.cwd}</code>{active.journeyPath && <small>Transcript · {active.journeyPath}</small>}</div>
              <label><span>Confirmed session context</span><select value={active.context} disabled={active.status !== "running" || busy} onChange={(event) => terminal.confirmContext(active.id, event.target.value)}>{TERMINAL_CONTEXTS.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
              <div className="terminal-session-actions">
                <button type="button" className="text-button" onClick={openCapture}>Capture terminal</button>
                {["running", "connecting"].includes(active.status) && <button type="button" className="text-button danger" onClick={() => terminal.stopSession(active.id)}>Stop PTY</button>}
                {!(["running", "connecting"].includes(active.status)) && <button type="button" className="text-button" disabled={busy} onClick={() => terminal.closeSession(active.id)}>Close tab</button>}
              </div>
            </div>
            {active.pendingStep && (
              <section className="terminal-command-review" aria-label="Reviewed command awaiting execution">
                <div><span>Staged only · not executed</span><strong>{active.pendingStep.label}</strong></div>
                <pre><code>{active.pendingStep.command}</code></pre>
                <p>This exact step will be sent only to tab “{active.label}”, the operator-confirmed {contextLabel} session for {active.targetName}.</p>
                <div><button type="button" className="button" onClick={() => terminal.runStaged(active.id)}>{isInterruptInstruction(active.pendingStep.command) ? "Send Ctrl-C" : "Run reviewed command"}</button><button type="button" className="button secondary" onClick={() => terminal.cancelStaged(active.id)}>Cancel</button></div>
              </section>
            )}
            {active.activeStep && active.status !== "connecting" && (
              <section className="terminal-capture-bar">
                <div><span>Capturing exact step</span><strong>{active.activeStep.label}</strong></div><code>{active.activeStep.command}</code>
                <div className="terminal-capture-actions">
                  <button type="button" className="button secondary" disabled={!active.activeStep.hasCapture} onClick={() => terminal.saveActiveStep(active.id, activeSnapshot())}>{active.activeStep.evidenceSaved ? "Save another snapshot" : "Save output snapshot"}</button>
                  <button type="button" className="button" disabled={!active.activeStep.hasCapture && !active.activeStep.evidenceSaved} title="Use only after this terminal is visibly at a prompt that can accept another command." onClick={() => terminal.markSessionReady(active.id, activeSnapshot())}>{active.terminalBehavior === "interactive-shell" ? "Save step & reuse visible prompt" : "Mark visible prompt ready"}</button>
                </div>
              </section>
            )}
            <div className="terminal-screens">
              {terminal.sessions.map((session) => (
                <Suspense key={session.id} fallback={<p className="terminal-message">Loading embedded terminal…</p>}><CommandTerminal ref={(handle) => { if (handle) terminalRefs.current.set(session.id, handle); else terminalRefs.current.delete(session.id); }} session={session} active={session.id === active.id && !terminal.collapsed} onStarted={(details) => terminal.terminalStarted(session.id, details)} onOutput={(data) => terminal.terminalOutput(session.id, data)} onExit={(details) => terminal.terminalExited(session.id, details)} onFailed={(message, details) => terminal.terminalFailed(session.id, message, details)} onProof={(proof) => terminal.terminalProof(session.id, proof)} /></Suspense>
              ))}
            </div>
            {active.proof && <div className="terminal-proof-alert"><strong>{active.proof.kind === "root" ? "Root / administrator" : "User-level"} proof candidate</strong><code>{active.proof.value}</code><span>Verify identity, target IP, original path, and value together. Automatic proof capture will select the required terminal rows for review.</span><button type="button" className="text-button" onClick={openCapture}>Capture proof</button></div>}
            {captureError && <p className="form-error terminal-workspace-error">{captureError}</p>}
            {active.message && <p className="form-error terminal-workspace-error">{active.message}</p>}
            <p className="terminal-workspace-note">Tabs remain live across checklist navigation and collapse. Recorded machine shells match their machine and transcript folder; other tabs also match their endpoint. Context, role, and a manually confirmed ready prompt must still match, and staging remains separate from execution.</p>
          </>
        )}
      </div>
      {capture && captureSession && <TerminalCaptureDialog session={captureSession} snapshot={capture.snapshot} onClose={() => setCapture(null)} onSaveProof={saveProof} />}
    </aside>
  );
}

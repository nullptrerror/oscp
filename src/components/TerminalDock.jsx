import { lazy, Suspense } from "react";
import { useTerminalWorkspace } from "../context/TerminalWorkspaceContext";
import { isInterruptInstruction, TERMINAL_CONTEXTS } from "../lib/terminalWorkspace";

const CommandTerminal = lazy(() => import("./CommandTerminal"));

export default function TerminalDock() {
  const terminal = useTerminalWorkspace();
  if (terminal.sessions.length === 0) return null;

  const active = terminal.activeSession || terminal.sessions[0];
  const busy = Boolean(active?.activeStep || active?.pendingStep);
  const contextLabel = TERMINAL_CONTEXTS.find((entry) => entry.value === active?.context)?.label || active?.context;

  return (
    <aside className={`terminal-workspace ${terminal.collapsed ? "is-collapsed" : ""}`} aria-label="Embedded terminal workspace">
      <div className="terminal-workspace-heading">
        <div><span className="eyebrow">Embedded terminal workspace</span><strong>{terminal.sessions.length} project session{terminal.sessions.length === 1 ? "" : "s"}</strong></div>
        <button type="button" className="text-button" onClick={() => terminal.setCollapsed(!terminal.collapsed)}>{terminal.collapsed ? "Show" : "Collapse"}</button>
      </div>
      <div className="terminal-session-tabs" role="tablist" aria-label="Terminal sessions">
        {terminal.sessions.map((session) => (
          <button type="button" role="tab" aria-selected={session.id === active?.id} className={session.id === active?.id ? "is-active" : ""} key={session.id} onClick={() => terminal.selectSession(session.id)}>
            <span className={`terminal-state ${session.status}`}>{session.status}</span><strong>{session.targetName}</strong><small>{session.context} · {session.address || "unassigned endpoint"} · {session.id.slice(-6)}</small>
          </button>
        ))}
      </div>
      <div className="terminal-workspace-body" aria-hidden={terminal.collapsed}>
        {active && (
          <>
            <div className="terminal-session-toolbar">
              <div><strong>{active.label}</strong><span>{active.targetName} · {active.address || "unassigned endpoint"} · {contextLabel} · tab {active.id.slice(-6)}</span></div>
              <label><span>Confirmed session context</span><select value={active.context} disabled={active.status !== "running" || busy} onChange={(event) => terminal.confirmContext(active.id, event.target.value)}>{TERMINAL_CONTEXTS.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
              <div className="terminal-session-actions">
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
                  <button type="button" className="button secondary" disabled={!active.activeStep.hasCapture} onClick={() => terminal.saveActiveStep(active.id)}>{active.activeStep.evidenceSaved ? "Save another snapshot" : "Save output snapshot"}</button>
                  <button type="button" className="button" disabled={!active.activeStep.hasCapture && !active.activeStep.evidenceSaved} title="Use only after this terminal is visibly at a prompt that can accept another command." onClick={() => terminal.markSessionReady(active.id)}>Mark prompt ready</button>
                </div>
              </section>
            )}
            <div className="terminal-screens">
              {terminal.sessions.map((session) => (
                <Suspense key={session.id} fallback={<p className="terminal-message">Loading embedded terminal…</p>}><CommandTerminal session={session} active={session.id === active.id && !terminal.collapsed} onStarted={(details) => terminal.terminalStarted(session.id, details)} onOutput={(data) => terminal.terminalOutput(session.id, data)} onExit={(details) => terminal.terminalExited(session.id, details)} onFailed={(message, details) => terminal.terminalFailed(session.id, message, details)} onProof={(proof) => terminal.terminalProof(session.id, proof)} /></Suspense>
              ))}
            </div>
            {active.proof && <div className="terminal-proof-alert"><strong>{active.proof.kind === "root" ? "Root / administrator" : "User-level"} proof candidate</strong><code>{active.proof.value}</code><span>Keep this embedded terminal visible. Verify the identity, target IP, original path, and value together before taking the screenshot.</span></div>}
            {active.message && <p className="form-error terminal-workspace-error">{active.message}</p>}
            <p className="terminal-workspace-note">Tabs remain live across checklist navigation and collapse. Context is never inferred; select it only after verifying the remote shell or console yourself.</p>
          </>
        )}
      </div>
    </aside>
  );
}

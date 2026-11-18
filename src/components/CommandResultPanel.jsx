import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useLocalRunner } from "../context/LocalRunnerContext";
import { useTerminalWorkspace } from "../context/TerminalWorkspaceContext";
import { fileToEvidence } from "../lib/evidence";
import { isInterruptInstruction, normalizeTerminalContext, terminalCommandCwd } from "../lib/terminalWorkspace";
import EvidenceList from "./EvidenceList";

const MAX_RESULT_SIZE = 1024 * 1024;
const sessionRouteLabel = (session) => session.sessionRole === "machine-log"
  ? `machine transcript · opened at ${session.address || "an unassigned endpoint"}`
  : session.address || "unassigned endpoint";

export default function CommandResultPanel({
  itemId,
  commandKey,
  commandLabel,
  commandText,
  missing,
  runnable = true,
  disabledReason = "",
  runsOn = "lhost",
  terminal = "",
  sessionRole = "",
  terminalBehavior = "one-shot",
  requiresExistingSession = false,
  requiresNewSession = false,
  requiresExplicitSession = false,
  resultCategory = "",
  reportContext = {},
  targetId,
  targetName,
  entries,
  expanded,
  onExpandedChange,
}) {
  const { workspace, actions } = useWorkspace();
  const runner = useLocalRunner();
  const terminalWorkspace = useTerminalWorkspace();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const resultBytes = useMemo(() => new Blob([result]).size, [result]);
  const activeTarget = workspace.targets.find((target) => target.id === targetId);
  const activeEndpoint = activeTarget?.endpoints?.find((endpoint) => endpoint.id === activeTarget.activeEndpointId)
    || activeTarget?.endpoints?.[0];
  useEffect(() => {
    setResult("");
    setError("");
    setSelectedSessionId("");
  }, [targetId, activeEndpoint?.id, activeEndpoint?.address, commandKey, commandLabel, commandText]);
  const flagNames = useMemo(() => ({ user: activeTarget?.userFlagName, root: activeTarget?.rootFlagName }), [activeTarget?.rootFlagName, activeTarget?.userFlagName]);
  const cwd = terminalCommandCwd(workspace.variables.workspaceRoot, activeTarget?.slug);
  const requiredContext = normalizeTerminalContext(runsOn, terminal);
  const canOpenNewSession = requiredContext === "lhost" && !terminal && !requiresExistingSession;
  const allowExistingSession = !requiresNewSession;
  const routingRequest = {
    targetId,
    runsOn,
    terminal,
    command: commandText,
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
    cwd,
    sessionRole,
    requiresExplicitSession,
  };
  const ranked = allowExistingSession ? terminalWorkspace.rankedSessions(routingRequest) : [];
  const compatible = ranked.map((entry) => entry.session);
  const suggestion = allowExistingSession ? terminalWorkspace.suggestedSession(routingRequest) : null;
  const mustChooseSession = requiresExplicitSession || isInterruptInstruction(commandText) || (compatible.length > 1 && !suggestion);
  const effectiveSessionId = compatible.some((session) => session.id === selectedSessionId)
    ? selectedSessionId
    : (!mustChooseSession && suggestion?.session.id ? suggestion.session.id : "");

  const metadata = {
    commandKey,
    commandLabel,
    commandText,
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
  };
  const save = (payload) => actions.addEvidence(itemId, { targetId, ...metadata, ...payload });
  const showError = (message) => {
    setError(message);
    onExpandedChange?.(true);
  };

  const savePaste = () => {
    if (!targetId) {
      showError("Select or create a machine before saving command output.");
      return;
    }
    if (!result.trim() || resultBytes > MAX_RESULT_SIZE) return;
    save({ label: `${commandLabel} · pasted result`, content: result, source: "paste" });
    setResult("");
    setError("");
  };

  const addFiles = async (files) => {
    if (!targetId) {
      showError("Select or create a machine before attaching command evidence.");
      return;
    }
    for (const file of files) {
      try {
        save({ ...await fileToEvidence(file), ...metadata, label: `${commandLabel} · ${file.name}` });
        setError("");
      } catch (fileError) {
        showError(fileError instanceof Error ? fileError.message : `Could not read ${file.name}.`);
      }
    }
  };

  const executionRequest = {
    targetId,
    targetName,
    itemId,
    commandKey,
    label: commandLabel,
    command: commandText,
    runsOn,
    terminal,
    cwd,
    flagNames,
    sessionRole,
    terminalBehavior,
    requiresExplicitSession,
    resultCategory,
    reportContext,
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
  };

  const openSession = () => {
    if (!targetId || !runnable || missing.length > 0) {
      showError(disabledReason || "Resolve this command's safety contract and variables before execution.");
      return;
    }
    const sessionId = terminalWorkspace.openCommand(executionRequest);
    if (!sessionId) {
      showError(sessionRole === "machine-log"
        ? "A recorded shell already owns this machine transcript. Reuse or stop that tab before starting another."
        : "Could not open a new terminal tab for this command.");
      return;
    }
    setError("");
  };

  const stageInSession = () => {
    if (!targetId || !runnable || missing.length > 0) {
      showError(disabledReason || "Resolve this command's safety contract and variables before staging it.");
      return;
    }
    if (!effectiveSessionId) {
      showError(`No ready ${requiredContext} session exists for this machine. Create or verify that embedded session first.`);
      return;
    }
    if (!terminalWorkspace.stageCommand(effectiveSessionId, executionRequest)) {
      showError("That session became busy or incompatible. Review the Terminal Workspace and try again.");
      return;
    }
    setError("");
  };

  return (
    <div className="command-results" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
      <div className="command-results-bar">
        <button type="button" className="command-results-toggle" onClick={() => onExpandedChange?.(!expanded)} aria-expanded={expanded}>
          <span>Results · {entries.length}</span><small>{expanded ? "Hide" : "Paste or attach output"}</small>
        </button>
        {runner.available && canOpenNewSession && (
          <button type="button" className="text-button run-command" onClick={openSession} disabled={!runnable || missing.length > 0}>{terminalBehavior === "interactive-shell" ? "Start reusable logged tab" : "Open new terminal tab"}</button>
        )}
        {runner.available && allowExistingSession && (compatible.length > 0 || !canOpenNewSession) && (
          <div className="session-route-control">
            <select aria-label={`Embedded ${requiredContext} session for ${commandLabel}`} value={effectiveSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} disabled={compatible.length === 0}>
              {compatible.length === 0 && <option value="">No ready {requiredContext} session</option>}
              {compatible.length > 0 && mustChooseSession && <option value="">Choose the exact session…</option>}
              {ranked.map(({ session }) => <option value={session.id} key={session.id}>{suggestion?.session.id === session.id ? "Suggested · " : ""}{session.targetName} · {sessionRouteLabel(session)} · {session.context} · {session.sessionRole || "general"} · tab {session.id.slice(-6)}</option>)}
            </select>
            <button type="button" className="text-button run-command" onClick={stageInSession} disabled={!runnable || missing.length > 0 || !effectiveSessionId}>Stage in existing tab</button>
          </div>
        )}
      </div>
      {expanded && <div className="command-results-body">
        <div className="command-result-head"><span>{entries.length} saved result{entries.length === 1 ? "" : "s"}</span><div><label className="text-button result-file-button">Attach file<input type="file" multiple onChange={(event) => { addFiles([...event.target.files]); event.target.value = ""; }} /></label></div></div>
        {!runner.available && <p className="static-runner-note">Execution is unavailable in this review-only build. Start the Vite project with its embedded local runner; no external terminal is required.</p>}
        {runner.available && suggestion && <p className="static-runner-note">Suggested tab {suggestion.session.id.slice(-6)}: {suggestion.reasons.join(", ")}. Selection is automatic; staging and execution remain separate operator actions.</p>}
        {runner.available && allowExistingSession && compatible.length === 0 && <p className="static-runner-note">No reusable {requiredContext} tab matches this machine, terminal scope, working folder, role, and operator-confirmed ready prompt.{canOpenNewSession ? " Open a new tab or ready a matching existing tab." : " Create or verify that embedded session first."}</p>}
        <textarea rows="3" value={result} onChange={(event) => setResult(event.target.value)} placeholder={`Paste only the result for “${commandLabel}”…`} aria-label={`Result for ${commandLabel}`} />
        <div className="results-actions"><span className={resultBytes > MAX_RESULT_SIZE ? "danger-text" : ""}>{(resultBytes / 1024).toFixed(1)} KB</span><button type="button" className="button secondary" onClick={savePaste} disabled={!result.trim() || resultBytes > MAX_RESULT_SIZE}>Save result</button></div>
        {resultBytes > MAX_RESULT_SIZE && <p className="form-error">Result is larger than 1 MB. Attach a useful excerpt; the embedded runner keeps the complete log on disk.</p>}
        {error && <p className="form-error">{error}</p>}
        <EvidenceList entries={entries} itemId={itemId} resultCategory={resultCategory} />
      </div>}
    </div>
  );
}

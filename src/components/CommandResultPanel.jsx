import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useLocalRunner } from "../context/LocalRunnerContext";
import { useTerminalWorkspace } from "../context/TerminalWorkspaceContext";
import { fileToEvidence } from "../lib/evidence";
import { isInterruptInstruction, normalizeTerminalContext } from "../lib/terminalWorkspace";
import EvidenceList from "./EvidenceList";

const MAX_RESULT_SIZE = 1024 * 1024;

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
  const cwd = `${String(workspace.variables.workspaceRoot || "/home/kali/oscp").replace(/\/$/, "")}/${activeTarget?.slug || "unassigned"}`;
  const requiredContext = normalizeTerminalContext(runsOn, terminal);
  const opensNewSession = runsOn === "lhost" && !terminal;
  const compatible = terminalWorkspace.compatibleSessions({
    targetId,
    runsOn,
    terminal,
    command: commandText,
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
  });
  const requiresExplicitSession = compatible.length > 1 || isInterruptInstruction(commandText);
  const effectiveSessionId = compatible.some((session) => session.id === selectedSessionId)
    ? selectedSessionId
    : (!requiresExplicitSession && compatible.length === 1 ? compatible[0].id : "");

  const metadata = {
    commandKey,
    commandLabel,
    commandText,
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
  };
  const save = (payload) => actions.addEvidence(itemId, { targetId, ...metadata, ...payload });

  const savePaste = () => {
    if (!targetId) {
      setError("Select or create a machine before saving command output.");
      return;
    }
    if (!result.trim() || resultBytes > MAX_RESULT_SIZE) return;
    save({ label: `${commandLabel} · pasted result`, content: result, source: "paste" });
    setResult("");
    setError("");
  };

  const addFiles = async (files) => {
    if (!targetId) {
      setError("Select or create a machine before attaching command evidence.");
      return;
    }
    for (const file of files) {
      try {
        save({ ...await fileToEvidence(file), ...metadata, label: `${commandLabel} · ${file.name}` });
        setError("");
      } catch (fileError) {
        setError(fileError instanceof Error ? fileError.message : `Could not read ${file.name}.`);
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
    endpointId: activeEndpoint?.id || null,
    address: activeEndpoint?.address || activeTarget?.host || "",
  };

  const openSession = () => {
    if (!targetId || !runnable || missing.length > 0) {
      setError(disabledReason || "Resolve this command's safety contract and variables before execution.");
      return;
    }
    terminalWorkspace.openCommand(executionRequest);
    setError("");
  };

  const stageInSession = () => {
    if (!targetId || !runnable || missing.length > 0) {
      setError(disabledReason || "Resolve this command's safety contract and variables before staging it.");
      return;
    }
    if (!effectiveSessionId) {
      setError(`No ready ${requiredContext} session exists for this machine. Create or verify that embedded session first.`);
      return;
    }
    if (!terminalWorkspace.stageCommand(effectiveSessionId, executionRequest)) {
      setError("That session became busy or incompatible. Review the Terminal Workspace and try again.");
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
        {runner.available && opensNewSession && (
          <button type="button" className="text-button run-command" onClick={openSession} disabled={!runnable || missing.length > 0}>Run inside Fieldnotes</button>
        )}
        {runner.available && !opensNewSession && (
          <div className="session-route-control">
            <select aria-label={`Embedded ${requiredContext} session for ${commandLabel}`} value={effectiveSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} disabled={compatible.length === 0}>
              {compatible.length === 0 && <option value="">No ready {requiredContext} session</option>}
              {compatible.length > 0 && requiresExplicitSession && <option value="">Choose the exact session…</option>}
              {compatible.map((session) => <option value={session.id} key={session.id}>{session.targetName} · {session.address || "unassigned endpoint"} · {session.label} · tab {session.id.slice(-6)}</option>)}
            </select>
            <button type="button" className="text-button run-command" onClick={stageInSession} disabled={!runnable || missing.length > 0 || !effectiveSessionId}>Stage in Fieldnotes</button>
          </div>
        )}
      </div>
      {expanded && <div className="command-results-body">
        <div className="command-result-head"><span>{entries.length} saved result{entries.length === 1 ? "" : "s"}</span><div><label className="text-button result-file-button">Attach file<input type="file" multiple onChange={(event) => { addFiles([...event.target.files]); event.target.value = ""; }} /></label></div></div>
        {!runner.available && <p className="static-runner-note">Execution is unavailable in this review-only build. Start the Vite project with its embedded local runner; no external terminal is required.</p>}
        {runner.available && !opensNewSession && compatible.length === 0 && <p className="static-runner-note">This step requires an operator-confirmed {requiredContext} tab in the embedded Terminal Workspace. A card never guesses or creates that context.</p>}
        <textarea rows="3" value={result} onChange={(event) => setResult(event.target.value)} placeholder={`Paste only the result for “${commandLabel}”…`} aria-label={`Result for ${commandLabel}`} />
        <div className="results-actions"><span className={resultBytes > MAX_RESULT_SIZE ? "danger-text" : ""}>{(resultBytes / 1024).toFixed(1)} KB</span><button type="button" className="button secondary" onClick={savePaste} disabled={!result.trim() || resultBytes > MAX_RESULT_SIZE}>Save result</button></div>
        {resultBytes > MAX_RESULT_SIZE && <p className="form-error">Result is larger than 1 MB. Attach a useful excerpt; the embedded runner keeps the complete log on disk.</p>}
        {error && <p className="form-error">{error}</p>}
        <EvidenceList entries={entries} itemId={itemId} />
      </div>}
    </div>
  );
}

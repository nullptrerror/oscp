import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useLocalRunner } from "../context/LocalRunnerContext";
import { fileToEvidence } from "../lib/evidence";
import { createId } from "../lib/workspace";
import EvidenceList from "./EvidenceList";

const CommandTerminal = lazy(() => import("./CommandTerminal"));

const MAX_RESULT_SIZE = 1024 * 1024;

export default function CommandResultPanel({ itemId, commandKey, commandLabel, commandText, missing, entries, expanded, onExpandedChange }) {
  const { workspace, actions } = useWorkspace();
  const runner = useLocalRunner();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const activeRunId = useRef(null);
  const recordedRunId = useRef(null);
  const resultBytes = useMemo(() => new Blob([result]).size, [result]);
  const cwd = `${String(workspace.variables.workspaceRoot || "/home/kali/oscp").replace(/\/$/, "")}/${workspace.variables.targetName || "unassigned"}`;

  const metadata = {
    commandKey,
    commandLabel,
    commandText,
  };

  const save = (payload) => actions.addEvidence(itemId, { ...metadata, ...payload });

  const savePaste = () => {
    if (!result.trim() || resultBytes > MAX_RESULT_SIZE) return;
    save({ label: `${commandLabel} · pasted result`, content: result, source: "paste" });
    setResult("");
    setError("");
  };

  const addFiles = async (files) => {
    for (const file of files) {
      try {
        save({ ...await fileToEvidence(file), ...metadata, label: `${commandLabel} · ${file.name}` });
        setError("");
      } catch (fileError) {
        setError(fileError instanceof Error ? fileError.message : `Could not read ${file.name}.`);
      }
    }
  };

  const startTerminal = () => {
    const runId = createId("command");
    activeRunId.current = runId;
    recordedRunId.current = null;
    window.dispatchEvent(new Event("fieldnotes:collapse-terminal-results"));
    onExpandedChange?.(true);
    setTerminalOpen(true);
  };

  const recordTerminalStart = useCallback(() => {
    const runId = activeRunId.current;
    if (!runId || recordedRunId.current === runId) return;
    recordedRunId.current = runId;
    actions.recordCommand(itemId, { id: runId, label: commandLabel, command: commandText, source: "local runner", startedAt: new Date().toISOString() });
  }, [actions, commandLabel, commandText, itemId]);

  const finishTerminal = useCallback((execution) => {
    save({
      label: `${commandLabel} · terminal result`,
      content: execution.content || `[Fieldnotes] Command exited ${execution.exitCode} without captured output.`,
      source: "local-terminal",
      exitCode: execution.exitCode,
      logPath: execution.logPath,
      journeyPath: execution.journeyPath,
      commandRunId: activeRunId.current,
    });
    if (execution.exitCode === 0) actions.setCompleted(itemId, true);
    activeRunId.current = null;
    setTerminalOpen(false);
  }, [actions, commandKey, commandLabel, commandText, itemId]);

  return (
    <div className="command-results" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
      <div className="command-results-bar">
        <button type="button" className="command-results-toggle" onClick={() => onExpandedChange?.(!expanded)} aria-expanded={expanded}>
          <span>Results · {entries.length}</span>
          <small>{expanded ? "Hide" : "Paste or attach output"}</small>
        </button>
        {runner.available && (
          <button type="button" className="text-button run-command" onClick={startTerminal} disabled={missing.length > 0 || terminalOpen}>
            Run in terminal
          </button>
        )}
      </div>
      {expanded && <div className="command-results-body">
      <div className="command-result-head">
        <span>{entries.length} saved result{entries.length === 1 ? "" : "s"}</span>
        <div>
          <label className="text-button result-file-button">
            Attach file
            <input type="file" multiple onChange={(event) => { addFiles([...event.target.files]); event.target.value = ""; }} />
          </label>
        </div>
      </div>
      {!runner.available && <p className="static-runner-note">Static mode: run the command externally, then paste or attach its result here.</p>}
      {terminalOpen && (
        <Suspense fallback={<p className="static-runner-note">Loading terminal…</p>}>
          <CommandTerminal
            command={commandText}
            cwd={cwd}
            label={commandLabel}
            onClose={() => setTerminalOpen(false)}
            onStart={recordTerminalStart}
            onFinish={finishTerminal}
          />
        </Suspense>
      )}
      <textarea rows="3" value={result} onChange={(event) => setResult(event.target.value)} placeholder={`Paste only the result for “${commandLabel}”…`} aria-label={`Result for ${commandLabel}`} />
      <div className="results-actions">
        <span className={resultBytes > MAX_RESULT_SIZE ? "danger-text" : ""}>{(resultBytes / 1024).toFixed(1)} KB</span>
        <button type="button" className="button secondary" onClick={savePaste} disabled={!result.trim() || resultBytes > MAX_RESULT_SIZE}>Save result</button>
      </div>
      {resultBytes > MAX_RESULT_SIZE && <p className="form-error">Result is larger than 1 MB. Attach a useful excerpt; the local terminal keeps the complete log on disk.</p>}
      {error && <p className="form-error">{error}</p>}
      <EvidenceList entries={entries} itemId={itemId} />
      </div>}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { getScopedItemValue } from "../lib/workspace";
import { fileToEvidence } from "../lib/evidence";
import { getChecklistCommands } from "../lib/checklistCommands";
import CommandBlock from "./CommandBlock";

const MAX_RESULT_SIZE = 1024 * 1024;

export default function ChecklistItem({ item, searchActive = false }) {
  const { workspace, actions } = useWorkspace();
  const evidence = getScopedItemValue(workspace.evidence, workspace, item.id, []);
  const completed = Boolean(getScopedItemValue(workspace.completed, workspace, item.id, false));
  const [open, setOpen] = useState(searchActive || evidence.length > 0);
  const [result, setResult] = useState("");
  const [resultLabel, setResultLabel] = useState("");
  const [fileError, setFileError] = useState("");
  const [copiedReminder, setCopiedReminder] = useState(false);

  const resultBytes = useMemo(() => new Blob([result]).size, [result]);
  const commands = useMemo(() => getChecklistCommands(item, workspace), [item, workspace]);

  const saveResult = () => {
    if (!result.trim()) return;
    if (resultBytes > MAX_RESULT_SIZE) {
      setFileError("Result is larger than 400 KB. Save a short excerpt or path instead.");
      return;
    }
    actions.addEvidence(item.id, {
      label: resultLabel.trim() || "Pasted command output",
      content: result,
      source: "paste",
    });
    setResult("");
    setResultLabel("");
    setFileError("");
  };

  const addFiles = async (files) => {
    for (const file of files) {
      try {
        actions.addEvidence(item.id, await fileToEvidence(file));
        setFileError("");
      } catch (error) {
        setFileError(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
  };

  const uploadResult = async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    await addFiles(files);
  };

  const toggleComplete = () => {
    if (!completed && evidence.length === 0) {
      setOpen(true);
      setFileError("Save or upload a result before marking this check complete. A short failure note counts as evidence.");
      return;
    }
    actions.toggleCompleted(item.id);
  };

  return (
    <article id={`item-${item.id}`} className={`check-item ${completed ? "is-complete" : ""}`}>
      <div className="check-item-row">
        <label className="check-control">
          <input
            type="checkbox"
            checked={completed}
            onChange={toggleComplete}
          />
          <span aria-hidden="true">✓</span>
          <span className="sr-only">Mark {item.title} complete</span>
        </label>
        <button type="button" className="item-title-button" onClick={() => setOpen((value) => !value)}>
          <span>{item.title}</span>
          <small>
            {commands.length} {commands.length === 1 ? "command" : "commands"}
            {evidence.length > 0 && ` · ${evidence.length} saved result${evidence.length === 1 ? "" : "s"}`}
          </small>
        </button>
        <button
          type="button"
          className="disclosure-button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${item.title}`}
        >
          {open ? "−" : "+"}
        </button>
      </div>

      {open && (
        <div className="check-item-body">
          {item.detail && <p className="item-detail">{item.detail}</p>}
          <div className="command-list">
            {commands.map((command) => (
              <CommandBlock
                key={command.key ?? `${item.id}-${command.label}`}
                command={command}
                variables={workspace.variables}
                onCopy={() => { setCopiedReminder(true); setOpen(true); }}
              />
            ))}
          </div>
          {copiedReminder && (
            <p className="copy-reminder">After running the command, paste or drop its output below so the report can explain what happened.</p>
          )}

          <div className="operator-notes">
            <label htmlFor={`note-${item.id}`}>Operator note</label>
            <textarea
              id={`note-${item.id}`}
              rows="2"
              value={getScopedItemValue(workspace.notes, workspace, item.id, "")}
              onChange={(event) => actions.updateNote(item.id, event.target.value)}
              placeholder="What changed, what failed, or what to try next…"
            />
          </div>

          <div
            className="results-panel"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}
          >
            <div className="results-head">
              <div>
                <p className="field-label">Command results</p>
                <span>Paste text or drop text/images · 1 MB text / 3 MB file</span>
              </div>
              <label className="button secondary file-button">
                Upload result
                <input
                  type="file"
                  multiple
                  accept=".txt,.log,.nmap,.gnmap,.xml,.json,.md,.csv,.hash,.hashes,.png,.jpg,.jpeg,text/*,image/png,image/jpeg,application/json,application/xml"
                  onChange={uploadResult}
                />
              </label>
            </div>
            <input
              type="text"
              value={resultLabel}
              onChange={(event) => setResultLabel(event.target.value)}
              placeholder="Result label (optional)"
              aria-label="Result label"
            />
            <textarea
              rows="5"
              value={result}
              onChange={(event) => setResult(event.target.value)}
              placeholder="Paste useful command output here…"
              aria-label="Command result"
            />
            <div className="results-actions">
              <span className={resultBytes > MAX_RESULT_SIZE ? "danger-text" : ""}>
                {(resultBytes / 1024).toFixed(1)} KB
              </span>
              <button type="button" className="button secondary" onClick={saveResult} disabled={!result.trim()}>
                Save result
              </button>
            </div>
            {fileError && <p className="form-error">{fileError}</p>}

            {evidence.length > 0 && (
              <div className="evidence-list">
                {evidence.map((entry) => (
                  <details key={entry.id} className="evidence-entry">
                    <summary>
                      <span>{entry.label}</span>
                      <time>{new Date(entry.createdAt).toLocaleString()}</time>
                    </summary>
                    {entry.dataUrl && <img className="evidence-image" src={entry.dataUrl} alt={entry.label} />}
                    {entry.content && <pre>{entry.content}</pre>}
                    {entry.discoveries?.length > 0 && (
                      <div className="discovery-chips">
                        {entry.discoveries.map((discovery) => (
                          <span key={`${discovery.type}-${discovery.value}`}>{discovery.type}: {discovery.value}</span>
                        ))}
                      </div>
                    )}
                    {entry.guidance?.length > 0 && (
                      <div className="evidence-guidance">
                        <strong>Suggested next checks</strong>
                        {entry.guidance.map((step) => (
                          <button
                            type="button"
                            className="text-button"
                            key={`${entry.id}-${step.itemId}`}
                            onClick={() => document.getElementById(`item-${step.itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                          >
                            {step.text}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => actions.deleteEvidence(item.id, entry.id)}
                    >
                      Delete result
                    </button>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

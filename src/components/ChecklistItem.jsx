import { useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { buildSmbDownloadCommands } from "../lib/smbCommands";
import { buildRemoteAccessCommands } from "../lib/remoteAccessCommands";
import { buildSpnTgsCommands } from "../lib/kerberosCommands";
import { getScopedItemValue } from "../lib/workspace";
import CommandBlock from "./CommandBlock";

const MAX_RESULT_SIZE = 400 * 1024;

export default function ChecklistItem({ item, searchActive = false }) {
  const { workspace, actions } = useWorkspace();
  const evidence = getScopedItemValue(workspace.evidence, workspace, item.id, []);
  const completed = Boolean(getScopedItemValue(workspace.completed, workspace, item.id, false));
  const [open, setOpen] = useState(searchActive || evidence.length > 0);
  const [result, setResult] = useState("");
  const [resultLabel, setResultLabel] = useState("");
  const [fileError, setFileError] = useState("");

  const resultBytes = useMemo(() => new Blob([result]).size, [result]);
  const commands = useMemo(() => {
    if (item.id === "svc-smb") {
      return [...item.commands, ...buildSmbDownloadCommands(workspace.accounts, workspace.variables)];
    }
    if (item.id === "access-remote") {
      return [...item.commands, ...buildRemoteAccessCommands(workspace.accounts, workspace.variables)];
    }
    if (item.id === "ad-spn-tgs") {
      return [...item.commands, ...buildSpnTgsCommands(workspace.accounts, workspace.variables)];
    }
    return item.commands;
  }, [item, workspace.accounts, workspace.variables]);

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

  const uploadResult = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_RESULT_SIZE) {
      setFileError("File is larger than 400 KB. Keep large artifacts on disk and paste their path or a useful excerpt.");
      return;
    }
    const content = await file.text();
    actions.addEvidence(item.id, {
      label: file.name,
      content,
      source: "file",
      mimeType: file.type || "text/plain",
      size: file.size,
    });
    setFileError("");
  };

  return (
    <article className={`check-item ${completed ? "is-complete" : ""}`}>
      <div className="check-item-row">
        <label className="check-control">
          <input
            type="checkbox"
            checked={completed}
            onChange={() => actions.toggleCompleted(item.id)}
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
              <CommandBlock key={command.key ?? `${item.id}-${command.label}`} command={command} variables={workspace.variables} />
            ))}
          </div>

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

          <div className="results-panel">
            <div className="results-head">
              <div>
                <p className="field-label">Command results</p>
                <span>Plain text only · 400 KB max per result</span>
              </div>
              <label className="button secondary file-button">
                Upload text output
                <input
                  type="file"
                  accept=".txt,.log,.nmap,.gnmap,.xml,.json,.md,.csv,text/*,application/json,application/xml"
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
                    <pre>{entry.content}</pre>
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

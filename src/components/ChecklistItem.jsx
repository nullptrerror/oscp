import { useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { getScopedItemValue } from "../lib/workspace";
import { getChecklistCommands } from "../lib/checklistCommands";
import CommandBlock from "./CommandBlock";
import EvidenceList from "./EvidenceList";

export default function ChecklistItem({ item, searchActive = false, expandedResultsKey, onExpandedResultsChange }) {
  const { workspace, actions } = useWorkspace();
  const evidence = getScopedItemValue(workspace.evidence, workspace, item.id, []);
  const completed = Boolean(getScopedItemValue(workspace.completed, workspace, item.id, false));
  const [open, setOpen] = useState(searchActive || evidence.length > 0);
  const [completionError, setCompletionError] = useState("");
  const [copiedReminder, setCopiedReminder] = useState(false);
  const commands = useMemo(() => getChecklistCommands(item, workspace), [item, workspace]);
  const unassignedEvidence = evidence.filter((entry) => !entry.commandKey);

  const toggleComplete = () => {
    if (!completed && evidence.length === 0) {
      setOpen(true);
      setCompletionError("Save a result under one of this check's commands before marking it complete.");
      return;
    }
    setCompletionError("");
    actions.toggleCompleted(item.id);
  };

  return (
    <article id={`item-${item.id}`} className={`check-item ${completed ? "is-complete" : ""}`}>
      <div className="check-item-row">
        <label className="check-control">
          <input type="checkbox" checked={completed} onChange={toggleComplete} />
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
        <button type="button" className="disclosure-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${item.title}`}>
          {open ? "−" : "+"}
        </button>
      </div>

      {open && (
        <div className="check-item-body">
          {item.detail && <p className="item-detail">{item.detail}</p>}
          <div className="command-list">
            {commands.map((command, index) => {
              const commandKey = command.key ?? `${item.id}-${index}`;
              return (
                <CommandBlock
                  key={commandKey}
                  command={command}
                  commandKey={commandKey}
                  itemId={item.id}
                  evidence={evidence.filter((entry) => entry.commandKey === commandKey)}
                  variables={workspace.variables}
                  commandHistory={workspace.commandHistory}
                  targetId={workspace.activeTargetId}
                  targetName={workspace.variables.targetName}
                  expandedResultsKey={expandedResultsKey}
                  onExpandedResultsChange={onExpandedResultsChange}
                  onCopy={(copiedCommand, renderedCommand) => {
                    actions.recordCommand(item.id, { label: copiedCommand.label, command: renderedCommand });
                    setCopiedReminder(true);
                    setOpen(true);
                  }}
                />
              );
            })}
          </div>
          {copiedReminder && <p className="copy-reminder">After running the command, save its output directly beneath that command.</p>}

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
          {completionError && <p className="form-error">{completionError}</p>}
          {unassignedEvidence.length > 0 && (
            <div className="legacy-evidence">
              <p className="field-label">Earlier unassigned results</p>
              <EvidenceList entries={unassignedEvidence} itemId={item.id} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

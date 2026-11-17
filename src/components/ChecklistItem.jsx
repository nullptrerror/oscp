import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { getCommandResultStateValue, getScopedItemValue, RESULT_STATES } from "../lib/workspace";
import { getChecklistCommands } from "../lib/checklistCommands";
import CommandBlock from "./CommandBlock";
import EvidenceList from "./EvidenceList";
import { PIVOT_PLAYBOOKS, pivotPlaybookById } from "../data/pivotPlaybooks";

export default function ChecklistItem({ item, searchActive = false, recommended = false, expandedResultsKey, onExpandedResultsChange }) {
  const { workspace, actions } = useWorkspace();
  const evidence = getScopedItemValue(workspace.evidence, workspace, item.id, []);
  const completed = Boolean(getScopedItemValue(workspace.completed, workspace, item.id, false));
  const resultState = getScopedItemValue(
    workspace.resultStates || {},
    workspace,
    item.id,
    completed ? RESULT_STATES.CONFIRMED : "",
  );
  const [open, setOpen] = useState(searchActive || evidence.length > 0);
  const [completionError, setCompletionError] = useState("");
  const [copiedReminder, setCopiedReminder] = useState(false);
  const storedPivotPlaybook = workspace.selectedPivotPlaybooks?.[workspace.activeTargetId];
  const pivotPlaybookId = PIVOT_PLAYBOOKS.some((playbook) => playbook.id === storedPivotPlaybook)
    ? storedPivotPlaybook
    : "pivot-direct";
  const commands = useMemo(() => getChecklistCommands(item, workspace, pivotPlaybookId), [item, workspace, pivotPlaybookId]);
  const pivotPlaybook = item.pivotPlaybookSelector ? pivotPlaybookById(pivotPlaybookId) : null;
  const unassignedEvidence = evidence.filter((entry) => !entry.commandKey);
  const finding = getScopedItemValue(workspace.notes, workspace, item.id, "");
  const nextStep = getScopedItemValue(workspace.nextSteps, workspace, item.id, "");
  useEffect(() => { if (recommended) setOpen(true); }, [recommended]);

  const updateResultState = (state) => {
    if ([RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state) && evidence.length === 0) {
      setOpen(true);
      setCompletionError("Save command output before confirming a finding or recording no finding.");
      return;
    }
    if (item.pivotPlaybookSelector && [RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state)) {
      const pending = commands.filter((command, index) => {
        const key = command.key ?? `${item.id}-${index}`;
        const stepState = getCommandResultStateValue(workspace.commandResultStates, workspace, item.id, key, "");
        return !stepState || stepState === RESULT_STATES.REVIEW;
      });
      if (pending.length > 0) {
        setOpen(true);
        setCompletionError(`Classify every selected playbook step first; ${pending.length} still need review.`);
        return;
      }
    }
    setCompletionError("");
    actions.setResultState(item.id, state);
  };

  return (
    <article id={`item-${item.id}`} className={`check-item ${completed ? "is-complete" : ""} ${recommended ? "is-recommended" : ""}`}>
      <div className="check-item-row">
        <span className="check-control" aria-label={completed ? `${item.title} complete` : `${item.title} not complete`}>
          <span aria-hidden="true">✓</span>
        </span>
        <button type="button" className="item-title-button" onClick={() => setOpen((value) => !value)}>
          <span>{item.title}</span>
          <small>
            {commands.length} {commands.length === 1 ? "command" : "commands"}
            {evidence.length > 0 && ` · ${evidence.length} saved result${evidence.length === 1 ? "" : "s"}`}
            {resultState && ` · ${resultState.replace(/-/g, " ")}`}
            {finding.trim() && nextStep.trim() && " · narrative ready"}
          </small>
        </button>
        <button type="button" className="disclosure-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${item.title}`}>
          {open ? "−" : "+"}
        </button>
      </div>

      {open && (
        <div className="check-item-body">
          {item.detail && <p className="item-detail">{item.detail}</p>}
          {item.pivotPlaybookSelector && (
            <div className="pivot-playbook-selector">
              <label htmlFor={`pivot-playbook-${item.id}`}>
                <span>Manual topology</span>
                <select
                  id={`pivot-playbook-${item.id}`}
                  value={pivotPlaybookId}
                  onChange={(event) => {
                    actions.selectPivotPlaybook(event.target.value);
                    onExpandedResultsChange?.(null);
                  }}
                >
                  {PIVOT_PLAYBOOKS.map((playbook) => (
                    <option value={playbook.id} key={playbook.id}>{playbook.title}</option>
                  ))}
                </select>
              </label>
              <p>{pivotPlaybook?.summary}</p>
              <small>{pivotPlaybook?.topology} · {pivotPlaybook?.scope} · {commands.length} separately confirmable steps</small>
            </div>
          )}
          <div className="result-state-control">
            <label htmlFor={`result-state-${item.id}`}>
              <span>Operator result</span>
              <select
                id={`result-state-${item.id}`}
                value={resultState}
                onChange={(event) => updateResultState(event.target.value)}
              >
                <option value="" disabled>Choose after reviewing evidence…</option>
                <option value={RESULT_STATES.REVIEW}>Needs review</option>
                <option value={RESULT_STATES.CONFIRMED}>Finding confirmed</option>
                <option value={RESULT_STATES.NO_FINDING}>No finding</option>
                <option value={RESULT_STATES.FAILED}>Command failed</option>
                <option value={RESULT_STATES.BLOCKED}>Blocked</option>
              </select>
            </label>
            <p>Only an operator-confirmed finding or no-finding result completes this check. A zero exit status never proves the hypothesis.</p>
          </div>
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
                  resultState={getCommandResultStateValue(workspace.commandResultStates, workspace, item.id, commandKey, "")}
                  onResultStateChange={(state) => actions.setCommandResultState(item.id, commandKey, state)}
                  variables={{
                    ...workspace.variables,
                    selectedCredentialId: workspace.selectedCredentials?.[workspace.activeTargetId] || "",
                  }}
                  commandHistory={workspace.commandHistory}
                  targetId={workspace.activeTargetId}
                  targetName={workspace.variables.targetName}
                  expandedResultsKey={expandedResultsKey}
                  onExpandedResultsChange={onExpandedResultsChange}
                  onCopy={(copiedCommand, renderedCommand) => {
                    actions.recordCommand(item.id, { commandKey, label: copiedCommand.label, command: renderedCommand });
                    setCopiedReminder(true);
                    setOpen(true);
                  }}
                />
              );
            })}
          </div>
          {copiedReminder && <p className="copy-reminder">After running the command, save its output directly beneath that command.</p>}

          <div className="operator-notes narrative-prompts">
            <div className="narrative-prompt-head">
              <span>Report narrative</span>
              <small>Explain the reasoning; the PDF pairs it with each exact command in one compact attack path.</small>
            </div>
            <label htmlFor={`note-${item.id}`}>
              <span>What this established</span>
              <textarea
                id={`note-${item.id}`}
                rows="3"
                value={finding}
                onChange={(event) => actions.updateNote(item.id, event.target.value)}
                placeholder="In plain language: what useful fact did the output prove? Include the relevant service, access, weakness, or failed hypothesis—not the command itself."
              />
            </label>
            <label htmlFor={`next-step-${item.id}`}>
              <span>Why the next action followed</span>
              <textarea
                id={`next-step-${item.id}`}
                rows="3"
                value={nextStep}
                onChange={(event) => actions.updateNextStep(item.id, event.target.value)}
                placeholder="Explain the decision: how did this finding narrow the attack path, and what did it justify testing next?"
              />
            </label>
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

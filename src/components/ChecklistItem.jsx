import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  COMPLETING_RESULT_STATES,
  getCommandRunResultStateValue,
  getScopedItemValue,
  latestCommandResultReference,
  RESULT_STATES,
} from "../lib/workspace";
import { getChecklistCommands } from "../lib/checklistCommands";
import { buildTargetNarrativeModel, isAutomaticNarrative } from "../lib/narrative";
import { classifyItemResult, resultCategoryLabel, resultStateOptions } from "../lib/resultClassification";
import CommandBlock from "./CommandBlock";
import EvidenceList from "./EvidenceList";
import { PIVOT_PLAYBOOKS, pivotPlaybookById } from "../data/pivotPlaybooks";

export default function ChecklistItem({ item, searchActive = false, recommended = false, expandedResultsKey, onExpandedResultsChange }) {
  const { workspace, actions } = useWorkspace();
  const evidence = getScopedItemValue(workspace.evidence, workspace, item.id, []);
  const substantiveEvidence = evidence.filter((entry) => entry.substantive !== false);
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
  const resultCategory = classifyItemResult(item, commands);
  const resultOptions = resultStateOptions(resultCategory);
  const pivotPlaybook = item.pivotPlaybookSelector ? pivotPlaybookById(pivotPlaybookId) : null;
  const unassignedEvidence = evidence.filter((entry) => !entry.commandKey);
  const finding = getScopedItemValue(workspace.notes, workspace, item.id, "");
  const nextStep = getScopedItemValue(workspace.nextSteps, workspace, item.id, "");
  const narrative = useMemo(
    () => buildTargetNarrativeModel(workspace, [item], workspace.activeTargetId).items[item.id],
    [item, workspace],
  ) || {
    finding,
    nextStep,
    ready: false,
    resultState,
    manualFinding: !isAutomaticNarrative(finding),
    manualNextStep: !isAutomaticNarrative(nextStep),
  };
  const effectiveResultState = resultState && resultState !== RESULT_STATES.REVIEW
    ? resultState
    : narrative.resultState || resultState;
  const effectiveCompleted = completed || [RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(effectiveResultState);
  const findingOverride = !isAutomaticNarrative(finding) ? finding : "";
  const nextStepOverride = !isAutomaticNarrative(nextStep) ? nextStep : "";
  useEffect(() => { if (recommended) setOpen(true); }, [recommended]);
  useEffect(() => {
    const rolledState = narrative.resultState;
    if (!rolledState || rolledState === RESULT_STATES.REVIEW || rolledState === resultState) return;
    if (COMPLETING_RESULT_STATES.has(rolledState) && substantiveEvidence.length === 0) return;
    actions.setResultState(item.id, rolledState);
  }, [actions, item.id, narrative.resultState, resultState, substantiveEvidence.length]);

  const updateResultState = (state) => {
    if ([RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state) && substantiveEvidence.length === 0) {
      setOpen(true);
      setCompletionError("Save command output before confirming a finding or recording no finding.");
      return;
    }
    if (item.pivotPlaybookSelector && [RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state)) {
      const pending = commands.filter((command, index) => {
        const key = command.key ?? `${item.id}-${index}`;
        const entries = evidence.filter((entry) => entry.commandKey === key);
        const resultReference = latestCommandResultReference(entries, key);
        const stepState = getCommandRunResultStateValue(
          workspace.commandResultStates,
          workspace,
          item.id,
          key,
          resultReference,
          "",
          { allowLegacy: true },
        );
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
    <article id={`item-${item.id}`} className={`check-item ${effectiveCompleted ? "is-complete" : ""} ${recommended ? "is-recommended" : ""}`}>
      <div className="check-item-row">
        <span className="check-control" aria-label={effectiveCompleted ? `${item.title} complete` : `${item.title} not complete`}>
          <span aria-hidden="true">✓</span>
        </span>
        <button type="button" className="item-title-button" onClick={() => setOpen((value) => !value)}>
          <span>{item.title}</span>
          <small>
            {commands.length} {commands.length === 1 ? "command" : "commands"}
            {evidence.length > 0 && ` · ${evidence.length} saved result${evidence.length === 1 ? "" : "s"}`}
            {effectiveResultState && ` · ${effectiveResultState.replace(/-/g, " ")}`}
            {narrative.ready && " · narrative ready"}
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
              <span>Operator result · {resultCategoryLabel(resultCategory)}</span>
              <select
                id={`result-state-${item.id}`}
                value={effectiveResultState}
                onChange={(event) => updateResultState(event.target.value)}
              >
                <option value="" disabled>Classify this {resultCategoryLabel(resultCategory).toLowerCase()} activity after review…</option>
                {resultOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p>The activity category is derived locally from the checklist contract. Its outcome still requires operator review; a zero exit status never proves the hypothesis. Fieldnotes rolls up only fully classified command results.</p>
          </div>
          <div className="command-list">
            {commands.map((command, index) => {
              const commandKey = command.key ?? `${item.id}-${index}`;
              const commandEvidence = evidence.filter((entry) => entry.commandKey === commandKey);
              const resultReference = latestCommandResultReference(commandEvidence, commandKey);
              return (
                <CommandBlock
                  key={commandKey}
                  command={command}
                  commandKey={commandKey}
                  itemId={item.id}
                  evidence={commandEvidence}
                  resultReference={resultReference}
                  resultState={getCommandRunResultStateValue(
                    workspace.commandResultStates,
                    workspace,
                    item.id,
                    commandKey,
                    resultReference,
                    "",
                    { allowLegacy: true },
                  )}
                  onResultStateChange={(state, reference = resultReference) => actions.setCommandResultState(item.id, commandKey, state, reference)}
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
                    actions.recordCommand(item.id, {
                      commandKey,
                      label: copiedCommand.label,
                      command: renderedCommand,
                      resultCategory: copiedCommand.resultCategory,
                      reportContext: {
                        resultCategory: copiedCommand.resultCategory,
                        purpose: copiedCommand.purpose,
                        positiveBranch: copiedCommand.positiveBranch,
                        negativeBranch: copiedCommand.negativeBranch,
                      },
                    });
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
              <span>Deterministic report narrative</span>
              <small>Built locally from the exact command, confirmed facts, and operator-classified result. The PDF pairs it with the saved output.</small>
            </div>
            <p><strong>What this established</strong>{narrative.finding}</p>
            <p><strong>Why the next action followed</strong>{narrative.nextStep}</p>
            <details>
              <summary>Optional narrative override</summary>
              <p>Use this only when the deterministic wording would misrepresent reviewed evidence. Clearing an override restores automatic text.</p>
              <label htmlFor={`note-${item.id}`}>
                <span>Override what this established</span>
                <textarea
                  id={`note-${item.id}`}
                  rows="3"
                  value={findingOverride}
                  onChange={(event) => actions.updateNote(item.id, event.target.value)}
                  placeholder="Optional: replace the deterministic finding with a precise operator-reviewed correction."
                />
              </label>
              <label htmlFor={`next-step-${item.id}`}>
                <span>Override why the next action followed</span>
                <textarea
                  id={`next-step-${item.id}`}
                  rows="3"
                  value={nextStepOverride}
                  onChange={(event) => actions.updateNextStep(item.id, event.target.value)}
                  placeholder="Optional: replace the deterministic decision with a precise operator-reviewed correction."
                />
              </label>
            </details>
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

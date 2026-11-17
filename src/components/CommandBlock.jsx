import { useState } from "react";
import { describeCommand, exactCommandRunCount } from "../lib/commandInsights";
import { renderCommandRecord, renderCommandTemplate } from "../lib/commandContract";
import { RESULT_STATES } from "../lib/workspace";
import CommandResultPanel from "./CommandResultPanel";

export default function CommandBlock({ command, variables, onCopy, itemId, commandKey, evidence, resultState = "", onResultStateChange, expandedResultsKey, onExpandedResultsChange, commandHistory, targetId, targetName }) {
  const [copied, setCopied] = useState(false);
  const [contextError, setContextError] = useState("");
  const [stepStateError, setStepStateError] = useState("");
  const rendered = renderCommandRecord(command, variables);
  const insight = describeCommand(rendered.command, command.label);
  const runCount = exactCommandRunCount(commandHistory, rendered.command, { targetId, targetName });
  const cleanup = command.cleanupCommand ? renderCommandTemplate(command.cleanupCommand, variables).command : "";
  const verification = command.verificationCommand ? renderCommandTemplate(command.verificationCommand, variables).command : "";
  const substantiveEvidence = evidence.filter((entry) => entry.substantive !== false);
  const copyableInstruction = command.policy === "exam-core"
    && Boolean(command.terminal)
    && rendered.missing.length === 0
    && Object.keys(rendered.invalid || {}).length === 0;
  const copyable = rendered.runnable || copyableInstruction;
  const terminalWorkspaceRunnable = rendered.runnable || copyableInstruction;

  const copy = async () => {
    if (!targetId) {
      setContextError("Select or create a machine before copying this command.");
      return;
    }
    if (!copyable) {
      setContextError(command.disabledReason || (command.executionEnabled === false
        ? `This ${command.policy} card is instructional and cannot be copied or run in exam-safe mode.`
        : "Resolve and validate every required variable before copying this command."));
      return;
    }
    await navigator.clipboard.writeText(rendered.command);
    onCopy?.(command, rendered.command);
    setContextError("");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const updateStepResult = (state) => {
    if ([RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state) && substantiveEvidence.length === 0) {
      setStepStateError("Save output for this exact command before confirming its result.");
      return;
    }
    setStepStateError("");
    onResultStateChange?.(state);
  };

  return (
    <div className="command-block">
      <div className="command-head">
        <span>{command.label}{runCount > 0 && <em className="command-run-count">Ran {runCount}×</em>}</span>
        <button type="button" className="text-button" onClick={copy} disabled={!copyable} title={!copyable ? command.disabledReason || "Command is not copyable in its current state." : undefined}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="command-contract-summary" aria-label="Command safety contract">
        <span><strong>Run on</strong>{command.runsOn}</span>
        <span><strong>Risk</strong>{command.risk}</span>
        <span><strong>Policy</strong>{command.policy}</span>
        <span><strong>Change</strong>{command.stateChange}</span>
        {command.routeOwner && <span><strong>Route owner</strong>{command.routeOwner}</span>}
        {command.direction && <span><strong>Direction</strong>{command.direction}</span>}
      </div>
      <label className="command-step-result">
        <span>Step result</span>
        <select value={resultState} onChange={(event) => updateStepResult(event.target.value)}>
          <option value="" disabled>Classify after review…</option>
          <option value={RESULT_STATES.REVIEW}>Needs review</option>
          <option value={RESULT_STATES.CONFIRMED}>Finding confirmed</option>
          <option value={RESULT_STATES.NO_FINDING}>No finding</option>
          <option value={RESULT_STATES.FAILED}>Command failed</option>
          <option value={RESULT_STATES.BLOCKED}>Blocked</option>
        </select>
      </label>
      {stepStateError && <p className="command-warning">{stepStateError}</p>}
      <pre><code>{rendered.command}</code></pre>
      <div className="command-explanation">
        <p><strong>Purpose</strong>{command.purpose || insight.purpose}</p>
        <p><strong>Positive</strong>{command.expectedPositiveSignal || insight.returns}</p>
        <p><strong>Negative</strong>{command.expectedNegativeSignal}</p>
      </div>
      <details className="command-contract-details">
        <summary>Prerequisites, branches, evidence, and cleanup</summary>
        <div>
          <section><strong>Prerequisites</strong><ul>{(command.prerequisites || []).map((entry) => <li key={entry}>{entry}</li>)}</ul></section>
          <section><strong>Positive branch</strong><p>{command.positiveBranch}</p></section>
          <section><strong>Negative branch</strong><p>{command.negativeBranch}</p></section>
          <section><strong>Side effects / noise</strong><p>{command.sideEffects}</p></section>
          <section><strong>Evidence to preserve</strong><ul>{(command.evidence || []).map((entry) => <li key={entry}>{entry}</li>)}</ul></section>
          <section><strong>Verification</strong><code>{verification}</code></section>
          <section><strong>Cleanup / rollback</strong><code>{cleanup || command.cleanup?.note || "No persistent state change expected."}</code></section>
          <section><strong>Fallback</strong><p>{command.fallback}</p></section>
        </div>
      </details>
      {command.warning && <p className={`command-policy-warning risk-${command.risk}`}>{command.warning}</p>}
      {rendered.missing.length > 0 && (
        <p className="command-warning">Set {rendered.missing.join(", ")} before running.</p>
      )}
      {Object.keys(rendered.invalid || {}).length > 0 && (
        <p className="command-warning">Invalid values: {Object.entries(rendered.invalid).map(([name, message]) => `${name} (${message})`).join("; ")}</p>
      )}
      {command.executionEnabled === false && !copyableInstruction && <p className="command-warning">Execution disabled: {command.disabledReason || `${command.policy} actions are never runnable in exam-safe mode.`}</p>}
      {copyableInstruction && <p className="command-warning">Manual console step: stage this exact input to an operator-confirmed {command.terminal} tab in the embedded Terminal Workspace.</p>}
      {contextError && <p className="command-warning">{contextError}</p>}
      <CommandResultPanel
        itemId={itemId}
        commandKey={commandKey}
        commandLabel={command.label}
        commandText={rendered.command}
        missing={rendered.missing}
        runnable={terminalWorkspaceRunnable}
        disabledReason={command.disabledReason || (command.executionEnabled === false ? `${command.policy} command is instructional only.` : "")}
        runsOn={command.runsOn}
        terminal={command.terminal || ""}
        targetId={targetId}
        targetName={targetName}
        entries={evidence}
        expanded={expandedResultsKey === `${itemId}::${commandKey}`}
        onExpandedChange={(open) => onExpandedResultsChange?.(open ? `${itemId}::${commandKey}` : null)}
      />
    </div>
  );
}

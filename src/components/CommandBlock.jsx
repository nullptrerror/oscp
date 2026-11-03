import { useState } from "react";
import { renderCommand } from "../lib/workspace";
import { describeCommand, exactCommandRunCount } from "../lib/commandInsights";
import CommandResultPanel from "./CommandResultPanel";

export default function CommandBlock({ command, variables, onCopy, itemId, commandKey, evidence, expandedResultsKey, onExpandedResultsChange, commandHistory, targetId, targetName }) {
  const [copied, setCopied] = useState(false);
  const rendered = renderCommand(command.value, variables);
  const insight = describeCommand(rendered.command, command.label);
  const runCount = exactCommandRunCount(commandHistory, rendered.command, { targetId, targetName });

  const copy = async () => {
    await navigator.clipboard.writeText(rendered.command);
    onCopy?.(command, rendered.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="command-block">
      <div className="command-head">
        <span>{command.label}{runCount > 0 && <em className="command-run-count">Ran {runCount}×</em>}</span>
        <button type="button" className="text-button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{rendered.command}</code></pre>
      <div className="command-explanation">
        <p><strong>Purpose</strong>{insight.purpose}</p>
        <p><strong>Returns</strong>{insight.returns}</p>
      </div>
      {rendered.missing.length > 0 && (
        <p className="command-warning">Set {rendered.missing.join(", ")} before running.</p>
      )}
      <CommandResultPanel
        itemId={itemId}
        commandKey={commandKey}
        commandLabel={command.label}
        commandText={rendered.command}
        missing={rendered.missing}
        entries={evidence}
        expanded={expandedResultsKey === `${itemId}::${commandKey}`}
        onExpandedChange={(open) => onExpandedResultsChange?.(open ? `${itemId}::${commandKey}` : null)}
      />
    </div>
  );
}

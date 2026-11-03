import { useState } from "react";
import { renderCommand } from "../lib/workspace";
import CommandResultPanel from "./CommandResultPanel";

export default function CommandBlock({ command, variables, onCopy, itemId, commandKey, evidence }) {
  const [copied, setCopied] = useState(false);
  const rendered = renderCommand(command.value, variables);

  const copy = async () => {
    await navigator.clipboard.writeText(rendered.command);
    onCopy?.(command, rendered.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="command-block">
      <div className="command-head">
        <span>{command.label}</span>
        <button type="button" className="text-button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{rendered.command}</code></pre>
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
      />
    </div>
  );
}

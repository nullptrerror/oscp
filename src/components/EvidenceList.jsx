import { useEffect, useRef } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { discoveryContext, PARSER_TAGS, guidanceForDiscoveries, visibleDiscoveries } from "../lib/evidence";
import TerminalOutput from "./TerminalOutput";

const discoveryLabels = Object.fromEntries(PARSER_TAGS.map((entry) => [entry.type, entry.label]));

const proofCommand = (target, kind) => {
  const filename = kind === "root" ? target?.rootFlagName || "proof.txt" : target?.userFlagName || "local.txt";
  if (target?.os === "Windows") {
    const base = kind === "root" ? "C:\\Users\\Administrator\\Desktop" : "C:\\Users\\%USERNAME%\\Desktop";
    return `hostname & whoami & ipconfig & dir ${base}\\${filename} & type ${base}\\${filename}`;
  }
  const root = kind === "root" ? "/root" : "/home";
  return `hostname; whoami; id; ip addr; find ${root} -name '${filename}' -print -exec cat {} \\; 2>/dev/null`;
};

export default function EvidenceList({ entries, itemId }) {
  const { workspace, actions } = useWorkspace();
  const listRef = useRef(null);
  useEffect(() => {
    const collapse = () => listRef.current?.querySelectorAll("details[open]").forEach((entry) => entry.removeAttribute("open"));
    window.addEventListener("fieldnotes:collapse-terminal-results", collapse);
    return () => window.removeEventListener("fieldnotes:collapse-terminal-results", collapse);
  }, []);
  if (!entries?.length) return null;
  return (
    <div className="evidence-list" ref={listRef}>
      {entries.map((entry) => {
        const discoveries = visibleDiscoveries(entry.discoveries, {
          settings: workspace.parserSettings,
          ignored: workspace.ignoredDiscoveries,
          targetId: entry.targetId ?? workspace.activeTargetId,
        });
        const guidance = guidanceForDiscoveries(discoveries);
        const target = workspace.targets.find((candidate) => candidate.id === (entry.targetId ?? workspace.activeTargetId));
        const flags = discoveries.filter((discovery) => discovery.type === "flag");
        const discoveryGroups = [...new Map(discoveries.map((discovery) => [
          discovery.type,
          discoveries.filter((candidate) => candidate.type === discovery.type),
        ])).entries()];
        return (
          <details key={entry.id} className="evidence-entry">
            <summary>
              <span>{entry.label}{entry.exitCode !== undefined && <em className={entry.exitCode === 0 ? "exit-ok" : "exit-failed"}>Exit {entry.exitCode}</em>}</span>
              <time>{new Date(entry.createdAt).toLocaleString()}</time>
            </summary>
            {entry.logPath && <code className="evidence-path">{entry.logPath}</code>}
            {entry.dataUrl && <img className="evidence-image" src={entry.dataUrl} alt={entry.label} />}
            {entry.content && <TerminalOutput content={entry.content} />}
            {flags.map((flag) => {
              const command = proofCommand(target, flag.kind);
              return (
                <div className="proof-candidate-alert" key={`${flag.kind}-${flag.value}`}>
                  <div><strong>{flag.kind === "root" ? "Root / administrator" : "User-level"} proof candidate</strong><code>{flag.value}</code></div>
                  <p>Rerun the proof command in the target’s interactive shell and capture the entire terminal with identity, IP address, original flag path, and value visible.</p>
                  <pre><code>{command}</code></pre>
                  <button type="button" className="button secondary" onClick={() => navigator.clipboard.writeText(command)}>Copy proof command</button>
                </div>
              );
            })}
            {discoveries.length > 0 && (
              <section className="parsed-findings" aria-label="Parsed findings">
                <header><strong>Parsed findings</strong><span>{discoveries.length} signal{discoveries.length === 1 ? "" : "s"}</span></header>
                <div className="parsed-findings-grid">
                  {discoveryGroups.map(([type, grouped]) => (
                    <article className={`parsed-group parsed-${type}`} key={type}>
                      <h4><span>{discoveryLabels[type] || type.replace(/-/g, " ")}</span><em>{grouped.length}</em></h4>
                      <ul>
                        {grouped.map((discovery) => (
                          <li key={`${discovery.type}-${discovery.protocol || ""}-${discovery.address || ""}-${discovery.value}`}>
                            <div><code>{discovery.value}</code><small>{discoveryContext(discovery)}</small></div>
                            <button type="button" onClick={() => actions.ignoreDiscovery({ ...discovery, targetId: entry.targetId })} aria-label={`Ignore ${discoveryLabels[type] || type} ${discovery.value}`}>Ignore</button>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {guidance.length > 0 && (
              <div className="evidence-guidance">
                <strong>Suggested next checks</strong>
                {guidance.map((step) => (
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
            <button type="button" className="text-button danger evidence-delete" onClick={() => actions.deleteEvidence(itemId, entry.id)}>Delete result</button>
          </details>
        );
      })}
    </div>
  );
}

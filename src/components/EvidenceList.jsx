import { useEffect, useRef } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { discoveryContext, PARSER_TAGS, guidanceForDiscoveries, visibleDiscoveries } from "../lib/evidence";
import TerminalOutput from "./TerminalOutput";

const discoveryLabels = Object.fromEntries(PARSER_TAGS.map((entry) => [entry.type, entry.label]));

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

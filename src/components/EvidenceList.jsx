import { useEffect, useRef } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatDiscovery, guidanceForDiscoveries, visibleDiscoveries } from "../lib/evidence";
import TerminalOutput from "./TerminalOutput";

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
        return (
          <details key={entry.id} className="evidence-entry">
            <summary>
              <span>{entry.label}</span>
              <time>{new Date(entry.createdAt).toLocaleString()}</time>
            </summary>
            {entry.logPath && <code className="evidence-path">{entry.logPath}</code>}
            {entry.dataUrl && <img className="evidence-image" src={entry.dataUrl} alt={entry.label} />}
            {entry.content && <TerminalOutput content={entry.content} />}
            {discoveries.length > 0 && (
              <div className="discovery-chips">
                {discoveries.map((discovery) => (
                  <div className="discovery-chip" key={`${discovery.type}-${discovery.protocol || ""}-${discovery.value}`}>
                    <span>{formatDiscovery(discovery)}</span>
                    <button type="button" onClick={() => actions.ignoreDiscovery({ ...discovery, targetId: entry.targetId })}>Ignore</button>
                  </div>
                ))}
              </div>
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

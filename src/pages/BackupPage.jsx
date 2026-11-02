import { useMemo, useRef, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { ALL_ITEMS } from "../data/checklist";
import { downloadWorkspace, getScopedItemValue, normalizeWorkspace } from "../lib/workspace";

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export default function BackupPage() {
  const { workspace, actions } = useWorkspace();
  const fileInput = useRef(null);
  const [message, setMessage] = useState(null);

  const stats = useMemo(() => {
    const evidenceCount = Object.values(workspace.evidence).reduce((total, entries) => total + entries.length, 0);
    const completedCount = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length;
    const bytes = new Blob([JSON.stringify(workspace)]).size;
    return [
      ["Checklist", `${completedCount} / ${ALL_ITEMS.length}`],
      ["Machines", workspace.targets.length],
      ["Accounts", workspace.accounts.length],
      ["Users", (workspace.users || []).length],
      ["Loot", workspace.loot.length],
      ["Results", evidenceCount],
      ["Local size", formatBytes(bytes)],
    ];
  }, [workspace]);

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: "error", text: "That backup is larger than 10 MB and cannot be imported." });
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeWorkspace(parsed);
      const targetCount = normalized.targets.length;
      if (!window.confirm(`Replace this browser's workspace with ${file.name} (${targetCount} targets)?`)) return;
      actions.importWorkspace(normalized);
      setMessage({ type: "success", text: `Imported ${file.name}. The restored workspace is now saved locally.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not import that backup." });
    }
  };

  const reset = () => {
    if (!window.confirm("Reset every checklist item, target, account, loot record, note, and saved result in this browser?")) return;
    actions.resetWorkspace();
    setMessage({ type: "success", text: "The local workspace was reset." });
  };

  return (
    <main className="page-shell backup-page">
      <section className="section-hero backup-hero">
        <div>
          <p className="eyebrow">Portable workspace</p>
          <h1>One file. Every note.</h1>
          <p>Export before changing browsers or machines. Importing replaces the current local workspace.</p>
        </div>
      </section>

      {message && <div className={`notice ${message.type}`} role="status">{message.text}</div>}

      <section className="backup-card primary-backup-card">
        <div>
          <p className="eyebrow">Recommended routine</p>
          <h2>Export at the end of each target.</h2>
          <p>The JSON file includes variables, passwords, notes, progress, and uploaded text results. Store it like exam evidence.</p>
        </div>
        <div className="backup-actions">
          <button type="button" className="button" onClick={() => downloadWorkspace(workspace)}>Export JSON backup</button>
          <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}>Import JSON backup</button>
          <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={importFile} />
        </div>
      </section>

      <section className="backup-grid">
        <article className="backup-card">
          <div className="finding-section-head no-border">
            <div><p className="eyebrow">Snapshot</p><h2>Current workspace</h2></div>
          </div>
          <dl className="stat-list">
            {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <p className="timestamp">Last changed {new Date(workspace.updatedAt).toLocaleString()}</p>
        </article>

        <article className="backup-card warning-card">
          <div>
            <p className="eyebrow">Plain text warning</p>
            <h2>This is a notebook, not a password manager.</h2>
            <p>Browser storage and exported JSON are not encrypted. Keep the machine locked, protect backups, and remove exam data when you no longer need it.</p>
          </div>
          <button type="button" className="text-button danger reset-button" onClick={reset}>Reset local workspace</button>
        </article>
      </section>
    </main>
  );
}

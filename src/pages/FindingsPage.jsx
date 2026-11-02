import { useMemo, useState } from "react";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { getScopedItemValue } from "../lib/workspace";

const EMPTY_ACCOUNT = { target: "", domain: "", username: "", secret: "", source: "", status: "untested" };
const EMPTY_LOOT = { target: "", label: "", location: "", value: "" };

function EmptyMessage({ children }) {
  return <p className="empty-inline">{children}</p>;
}

export default function FindingsPage() {
  const { workspace, actions } = useWorkspace();
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [loot, setLoot] = useState(EMPTY_LOOT);
  const [showSecrets, setShowSecrets] = useState(false);

  const savedResults = useMemo(
    () => ALL_ITEMS.flatMap((item) =>
      getScopedItemValue(workspace.evidence, workspace, item.id, [])
        .map((entry) => ({ ...entry, itemTitle: item.title, phaseTitle: item.phaseTitle })),
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [workspace],
  );

  const targetAccounts = workspace.accounts.filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId);
  const targetLoot = workspace.loot.filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId);

  const addAccount = (event) => {
    event.preventDefault();
    if (!account.username.trim()) return;
    actions.addRecord("accounts", account);
    setAccount(EMPTY_ACCOUNT);
  };

  const addLoot = (event) => {
    event.preventDefault();
    if (!loot.label.trim()) return;
    actions.addRecord("loot", loot);
    setLoot(EMPTY_LOOT);
  };

  return (
    <main className="page-shell findings-page">
      <section className="section-hero">
        <div>
          <p className="eyebrow">Findings ledger</p>
          <h1>Keep the useful bits.</h1>
          <p>Accounts, loot, and saved command output live here. Everything remains local and exports as plain-text JSON.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => setShowSecrets((value) => !value)}>
          {showSecrets ? "Hide secrets" : "Show secrets"}
        </button>
      </section>

      <div className="finding-columns">
        <section className="finding-section">
          <div className="finding-section-head">
            <div><p className="eyebrow">Credentials</p><h2>Accounts</h2></div>
            <span>{targetAccounts.length}</span>
          </div>
          <form className="inline-entry-form" onSubmit={addAccount}>
            <div className="form-row equal">
              <input type="text" value={account.domain} onChange={(event) => setAccount({ ...account, domain: event.target.value })} placeholder="Domain / host" aria-label="Account domain or host" />
              <input type="text" value={account.target} onChange={(event) => setAccount({ ...account, target: event.target.value })} placeholder="Target" aria-label="Account target" />
            </div>
            <div className="form-row equal">
              <input type="text" value={account.username} onChange={(event) => setAccount({ ...account, username: event.target.value })} placeholder="Username *" aria-label="Username" required />
              <input type="password" value={account.secret} onChange={(event) => setAccount({ ...account, secret: event.target.value })} placeholder="Password / hash" aria-label="Password or hash" />
            </div>
            <div className="form-row equal">
              <input type="text" value={account.source} onChange={(event) => setAccount({ ...account, source: event.target.value })} placeholder="Source / evidence" aria-label="Credential source" />
              <select value={account.status} onChange={(event) => setAccount({ ...account, status: event.target.value })} aria-label="Credential status">
                <option value="untested">Untested</option><option value="valid">Valid</option><option value="invalid">Invalid</option><option value="locked">Locked</option>
              </select>
            </div>
            <button type="submit" className="button">Save account</button>
          </form>
          <div className="ledger-list">
            {targetAccounts.length === 0 ? <EmptyMessage>No saved accounts for this target.</EmptyMessage> : targetAccounts.map((entry) => (
              <article className="ledger-card" key={entry.id}>
                <div className="ledger-card-head">
                  <div><span className={`status-dot ${entry.status}`} /> <strong>{entry.domain ? `${entry.domain}\\` : ""}{entry.username}</strong></div>
                  <button type="button" className="text-button danger" onClick={() => actions.deleteRecord("accounts", entry.id)}>Delete</button>
                </div>
                <code>{showSecrets ? entry.secret || "—" : entry.secret ? "••••••••••••" : "—"}</code>
                <p>{entry.target || "No target"}{entry.source ? ` · ${entry.source}` : ""}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="finding-section">
          <div className="finding-section-head">
            <div><p className="eyebrow">Artifacts</p><h2>Loot</h2></div>
            <span>{targetLoot.length}</span>
          </div>
          <form className="inline-entry-form" onSubmit={addLoot}>
            <div className="form-row equal">
              <input type="text" value={loot.target} onChange={(event) => setLoot({ ...loot, target: event.target.value })} placeholder="Target" aria-label="Loot target" />
              <input type="text" value={loot.label} onChange={(event) => setLoot({ ...loot, label: event.target.value })} placeholder="Label *" aria-label="Loot label" required />
            </div>
            <input type="text" value={loot.location} onChange={(event) => setLoot({ ...loot, location: event.target.value })} placeholder="Remote or local path" aria-label="Loot path" />
            <textarea rows="3" value={loot.value} onChange={(event) => setLoot({ ...loot, value: event.target.value })} placeholder="Useful value or short note…" aria-label="Loot value" />
            <button type="submit" className="button">Save loot</button>
          </form>
          <div className="ledger-list">
            {targetLoot.length === 0 ? <EmptyMessage>No saved loot for this target.</EmptyMessage> : targetLoot.map((entry) => (
              <article className="ledger-card" key={entry.id}>
                <div className="ledger-card-head">
                  <strong>{entry.label}</strong>
                  <button type="button" className="text-button danger" onClick={() => actions.deleteRecord("loot", entry.id)}>Delete</button>
                </div>
                {entry.location && <code>{entry.location}</code>}
                <p>{entry.target || "No target"}{entry.value ? ` · ${entry.value}` : ""}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="results-ledger">
        <div className="finding-section-head">
          <div><p className="eyebrow">Checklist evidence</p><h2>Saved command results</h2></div>
          <span>{savedResults.length}</span>
        </div>
        {savedResults.length === 0 ? <EmptyMessage>Upload or paste output under any checklist item and it will appear here.</EmptyMessage> : (
          <div className="results-grid">
            {savedResults.map((entry) => (
              <details className="result-card" key={entry.id}>
                <summary>
                  <div><strong>{entry.label}</strong><span>{entry.itemTitle}</span></div>
                  <time>{new Date(entry.createdAt).toLocaleString()}</time>
                </summary>
                <pre>{entry.content}</pre>
                <p>{entry.phaseTitle}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

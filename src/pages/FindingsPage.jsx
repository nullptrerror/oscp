import { useMemo, useState } from "react";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { getScopedItemValue } from "../lib/workspace";
import { formatDiscovery, PARSER_TAGS, visibleDiscoveries } from "../lib/evidence";
import { credentialVariables } from "../lib/credentials";
import TerminalOutput from "../components/TerminalOutput";

const EMPTY_ACCOUNT = { target: "", domain: "", username: "", secret: "", source: "", status: "untested" };
const EMPTY_LOOT = { target: "", label: "", location: "", value: "" };
const EMPTY_USER = { domain: "", username: "", source: "manual" };

function EmptyMessage({ children }) {
  return <p className="empty-inline">{children}</p>;
}

export default function FindingsPage() {
  const { workspace, actions } = useWorkspace();
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [loot, setLoot] = useState(EMPTY_LOOT);
  const [user, setUser] = useState(EMPTY_USER);
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
  const targetUsers = (workspace.users || []).filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId);
  const targetDiscoveries = visibleDiscoveries(workspace.discoveries, {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId: workspace.activeTargetId,
  }).filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId);
  const targetIgnored = workspace.ignoredDiscoveries.filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId);
  const targetCommands = (workspace.commandHistory || []).filter((entry) => !workspace.activeTargetId || entry.targetId === workspace.activeTargetId).sort((a, b) => b.copiedAt.localeCompare(a.copiedAt));

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

  const addUser = (event) => {
    event.preventDefault();
    if (!user.username.trim()) return;
    actions.addRecord("users", user);
    setUser(EMPTY_USER);
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

      <details className="parser-controls">
        <summary>
          <div><p className="eyebrow">Output parser</p><h2>Automatic tag controls</h2></div>
          <span>{PARSER_TAGS.filter(({ type }) => workspace.parserSettings[type] !== false).length}/{PARSER_TAGS.length} enabled</span>
        </summary>
        <p className="parser-help">These switches are global. Disabled tags stay in raw evidence but are hidden and are not added from new output. Ignored values are remembered only for the current machine.</p>
        <div className="parser-toggle-grid">
          {PARSER_TAGS.map(({ type, label }) => (
            <label className="toggle-field" key={type}>
              <input
                type="checkbox"
                checked={workspace.parserSettings[type] !== false}
                onChange={(event) => actions.updateParserSetting(type, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {targetIgnored.length > 0 && (
          <div className="ignored-findings">
            <strong>Ignored on this machine</strong>
            <div className="discovery-chips">
              {targetIgnored.map((entry) => (
                <div className="discovery-chip is-ignored" key={entry.id}>
                  <span>{formatDiscovery(entry)}</span>
                  <button type="button" onClick={() => actions.restoreIgnoredDiscovery(entry.id)}>Restore</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </details>

      <section className="finding-section users-ledger">
        <div className="finding-section-head">
          <div><p className="eyebrow">Enumeration</p><h2>Tracked users</h2></div>
          <span>{targetUsers.length}</span>
        </div>
        <form className="inline-entry-form user-entry-form" onSubmit={addUser}>
          <input type="text" value={user.domain} onChange={(event) => setUser({ ...user, domain: event.target.value })} placeholder={workspace.variables.domain || "Domain"} aria-label="User domain" />
          <input type="text" value={user.username} onChange={(event) => setUser({ ...user, username: event.target.value })} placeholder="Username" aria-label="Tracked username" required />
          <input type="text" value={user.source} onChange={(event) => setUser({ ...user, source: event.target.value })} placeholder="Source" aria-label="Username source" />
          <button type="submit" className="button">Track user</button>
        </form>
        <div className="tracked-users-list">
          {targetUsers.length === 0 ? <EmptyMessage>Paste enumeration output or add usernames manually. They will populate the target users file.</EmptyMessage> : targetUsers.map((entry) => (
            <div className="tracked-user" key={entry.id}>
              <code>{entry.domain ? `${entry.domain}\\` : ""}{entry.username}</code>
              <span>{entry.source || "manual"}</span>
              <button type="button" className="text-button" onClick={() => actions.updateVariables({ domain: entry.domain || workspace.variables.domain, user: entry.username })}>Use</button>
              <button type="button" className="text-button danger" onClick={() => actions.ignoreDiscovery({ type: "user", value: entry.username, targetId: entry.targetId })}>Ignore</button>
              <button type="button" className="text-button danger" onClick={() => actions.deleteRecord("users", entry.id)}>Delete</button>
            </div>
          ))}
        </div>
      </section>

      <div className="finding-columns">
        <section className="finding-section">
          <div className="finding-section-head">
            <div><p className="eyebrow">Credentials</p><h2>Accounts</h2></div>
            <span>{targetAccounts.length}</span>
          </div>
          <form className="inline-entry-form" onSubmit={addAccount}>
            <p className="form-context">New credentials are saved to <strong>{workspace.variables.targetName}</strong> unless you enter another target.</p>
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
                  <div>
                    <button type="button" className="text-button" onClick={() => actions.updateVariables(credentialVariables(entry))}>Use in commands</button>
                    <button type="button" className="text-button danger" onClick={() => actions.deleteRecord("accounts", entry.id)}>Delete</button>
                  </div>
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

      <section className="results-ledger discoveries-ledger">
        <div className="finding-section-head">
          <div><p className="eyebrow">Parsed automatically</p><h2>Critical discoveries</h2></div>
          <span>{targetDiscoveries.length}</span>
        </div>
        {targetDiscoveries.length === 0 ? <EmptyMessage>No parsed ports, domains, accounts, hashes, or tickets yet.</EmptyMessage> : (
          <div className="discovery-chips discovery-ledger-chips">
            {targetDiscoveries.map((entry) => (
              <div className="discovery-chip" key={entry.id}>
                <span>{formatDiscovery(entry)}</span>
                <button type="button" onClick={() => actions.ignoreDiscovery(entry)}>Ignore</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="results-ledger">
        <div className="finding-section-head">
          <div><p className="eyebrow">Report command history</p><h2>Copied commands</h2></div>
          <span>{targetCommands.length}</span>
        </div>
        {targetCommands.length === 0 ? <EmptyMessage>Only commands copied from the checklist appear here and in the PDF.</EmptyMessage> : (
          <div className="results-grid">
            {targetCommands.map((entry) => <article className="result-card" key={entry.id}><div className="copied-command-head"><strong>{entry.label}</strong><time>{new Date(entry.copiedAt).toLocaleString()}</time></div><pre>{entry.command}</pre><p>{entry.address}</p></article>)}
          </div>
        )}
      </section>

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
                {entry.dataUrl && <img className="evidence-image" src={entry.dataUrl} alt={entry.label} />}
                {entry.content && <TerminalOutput content={entry.content} />}
                <p>{entry.phaseTitle}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

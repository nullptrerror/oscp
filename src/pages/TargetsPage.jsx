import { useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";

const EMPTY_TARGET = { name: "", host: "", port: "", udpPorts: "", os: "Unknown", domain: "", notes: "" };

export default function TargetsPage() {
  const { workspace, actions } = useWorkspace();
  const [draft, setDraft] = useState(EMPTY_TARGET);

  const submit = (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.host.trim()) return;
    actions.addTarget({ ...draft, name: draft.name.trim(), host: draft.host.trim() });
    setDraft(EMPTY_TARGET);
  };

  return (
    <main className="page-shell records-page">
      <section className="section-hero">
        <div>
          <p className="eyebrow">Target book</p>
          <h1>Hosts with context.</h1>
          <p>Keep the target list short. “Use in commands” loads a host into the checklist variables.</p>
        </div>
        <span className="big-count">{workspace.targets.length.toString().padStart(2, "0")}</span>
      </section>

      <div className="records-layout">
        <form className="entry-form" onSubmit={submit}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New record</p>
              <h2>Add target</h2>
            </div>
          </div>
          <label>
            <span>Name *</span>
            <input type="text" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="web-01" required />
          </label>
          <div className="form-row">
            <label>
              <span>Host / IP *</span>
              <input type="text" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="192.168.45.100" required />
            </label>
            <label>
              <span>TCP port(s)</span>
              <input type="text" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} placeholder="80,443" />
            </label>
          </div>
          <label>
            <span>UDP port(s)</span>
            <input type="text" value={draft.udpPorts} onChange={(event) => setDraft({ ...draft, udpPorts: event.target.value })} placeholder="53,88,123" />
          </label>
          <div className="form-row">
            <label>
              <span>OS</span>
              <select value={draft.os} onChange={(event) => setDraft({ ...draft, os: event.target.value })}>
                <option>Unknown</option>
                <option>Linux</option>
                <option>Windows</option>
                <option>Network device</option>
              </select>
            </label>
            <label>
              <span>Domain</span>
              <input type="text" value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="corp.local" />
            </label>
          </div>
          <label>
            <span>Notes</span>
            <textarea rows="4" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Role, vhosts, likely attack path…" />
          </label>
          <button type="submit" className="button" disabled={!draft.name.trim() || !draft.host.trim()}>Add target</button>
        </form>

        <section className="record-list" aria-label="Saved targets">
          {workspace.targets.length === 0 ? (
            <div className="empty-state compact">
              <p className="eyebrow">No targets yet</p>
              <h2>Add the first host you are working.</h2>
            </div>
          ) : workspace.targets.map((target) => {
            const active = workspace.activeTargetId === target.id;
            return (
              <article className={`target-card ${active ? "is-active" : ""}`} key={target.id}>
                <div className="target-card-head">
                  <div>
                    <div className="record-badges">
                      <span>{target.os}</span>
                      {active && <span className="active-badge">Active</span>}
                    </div>
                    <h2>{target.name}</h2>
                    <code>{target.host}{target.port ? `:${target.port}` : ""}</code>
                  </div>
                  <div className="record-actions">
                    <button type="button" className="button secondary" onClick={() => actions.useTarget(target)}>Use in commands</button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => window.confirm(`Delete ${target.name}?`) && actions.deleteTarget(target.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="target-card-grid">
                  <label>
                    <span>Host</span>
                    <input type="text" value={target.host} onChange={(event) => actions.updateTarget(target.id, { host: event.target.value })} />
                  </label>
                  <label>
                    <span>TCP ports</span>
                    <input type="text" value={target.port} onChange={(event) => actions.updateTarget(target.id, { port: event.target.value })} />
                  </label>
                  <label>
                    <span>UDP ports</span>
                    <input type="text" value={target.udpPorts || ""} onChange={(event) => actions.updateTarget(target.id, { udpPorts: event.target.value })} />
                  </label>
                  <label>
                    <span>Domain</span>
                    <input type="text" value={target.domain} onChange={(event) => actions.updateTarget(target.id, { domain: event.target.value })} />
                  </label>
                  <label>
                    <span>OS</span>
                    <select value={target.os} onChange={(event) => actions.updateTarget(target.id, { os: event.target.value })}>
                      <option>Unknown</option><option>Linux</option><option>Windows</option><option>Network device</option>
                    </select>
                  </label>
                </div>
                <label className="card-notes">
                  <span>Notes</span>
                  <textarea rows="3" value={target.notes} onChange={(event) => actions.updateTarget(target.id, { notes: event.target.value })} />
                </label>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

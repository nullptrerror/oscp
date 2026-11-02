import { useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";

const EMPTY_MACHINE = { name: "", host: "", os: "Unknown", domain: "", notes: "" };

export default function TargetsPage() {
  const { workspace, actions } = useWorkspace();
  const [draft, setDraft] = useState(EMPTY_MACHINE);
  const [endpointDrafts, setEndpointDrafts] = useState({});
  const [mergeDestinations, setMergeDestinations] = useState({});

  const submit = (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.host.trim()) return;
    actions.addTarget({ ...draft, name: draft.name.trim(), host: draft.host.trim() });
    setDraft(EMPTY_MACHINE);
  };

  const addEndpoint = (machine) => {
    const value = endpointDrafts[machine.id]?.trim();
    if (!value) return;
    actions.addEndpoint(machine.id, { address: value });
    setEndpointDrafts((current) => ({ ...current, [machine.id]: "" }));
  };

  return (
    <main className="page-shell records-page">
      <section className="section-hero">
        <div><p className="eyebrow">Machine book</p><h1>One box. Every endpoint.</h1><p>The machine name owns the folder. Discovered IPs and hostnames become selectable endpoints inside that machine.</p></div>
        <span className="big-count">{workspace.targets.length.toString().padStart(2, "0")}</span>
      </section>

      <div className="records-layout">
        <form className="entry-form" onSubmit={submit}>
          <div className="panel-heading"><div><p className="eyebrow">New box</p><h2>Add machine</h2></div></div>
          <label><span>Machine / folder name *</span><input type="text" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="active" required /></label>
          <label><span>Initial IP or host *</span><input type="text" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="10.129.81.60" required /></label>
          <div className="form-row">
            <label><span>OS</span><select value={draft.os} onChange={(event) => setDraft({ ...draft, os: event.target.value })}><option>Unknown</option><option>Linux</option><option>Windows</option><option>Network device</option></select></label>
            <label><span>Domain</span><input type="text" value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="active.htb" /></label>
          </div>
          <label><span>Notes</span><textarea rows="4" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Role, scope, or likely attack path…" /></label>
          <button type="submit" className="button" disabled={!draft.name.trim() || !draft.host.trim()}>Add machine</button>
        </form>

        <section className="record-list" aria-label="Saved machines">
          {workspace.targets.length === 0 ? <div className="empty-state compact"><p className="eyebrow">No machines yet</p><h2>Add the first box you are working.</h2></div> : workspace.targets.map((machine) => {
            const active = workspace.activeTargetId === machine.id;
            return (
              <article className={`target-card ${active ? "is-active" : ""}`} key={machine.id}>
                <div className="target-card-head">
                  <div><div className="record-badges"><span>{machine.os}</span>{active && <span className="active-badge">Active machine</span>}</div><h2>{machine.name}</h2><code>/home/kali/oscp/{machine.name}</code></div>
                  <div className="record-actions"><button type="button" className="button secondary" onClick={() => actions.useTarget(machine)}>Use machine</button><button type="button" className="text-button danger" onClick={() => window.confirm(`Delete ${machine.name} and its case data?`) && actions.deleteTarget(machine.id)}>Delete</button></div>
                </div>

                <div className="machine-fields">
                  <label><span>Domain</span><input type="text" value={machine.domain || ""} onChange={(event) => actions.updateTarget(machine.id, { domain: event.target.value })} /></label>
                  <label><span>OS</span><select value={machine.os} onChange={(event) => actions.updateTarget(machine.id, { os: event.target.value })}><option>Unknown</option><option>Linux</option><option>Windows</option><option>Network device</option></select></label>
                </div>

                <div className="endpoint-list">
                  {(machine.endpoints || []).map((endpoint) => {
                    const selected = active && machine.activeEndpointId === endpoint.id;
                    return (
                      <div className={`endpoint-card ${selected ? "is-selected" : ""}`} key={endpoint.id}>
                        <div className="endpoint-head"><strong>{endpoint.address}</strong>{selected && <span>Command target</span>}</div>
                        <div className="endpoint-grid">
                          <label><span>IP / host</span><input type="text" value={endpoint.address} onChange={(event) => actions.updateEndpoint(machine.id, endpoint.id, { address: event.target.value })} /></label>
                          <label><span>Hostnames</span><input type="text" value={(endpoint.hostnames || []).join(", ")} onChange={(event) => actions.updateEndpoint(machine.id, endpoint.id, { hostnames: event.target.value.split(",").map((name) => name.trim()).filter(Boolean) })} placeholder="dc.active.htb" /></label>
                          <label><span>TCP</span><input type="text" value={endpoint.tcpPorts || ""} onChange={(event) => actions.updateEndpoint(machine.id, endpoint.id, { tcpPorts: event.target.value })} /></label>
                          <label><span>UDP</span><input type="text" value={endpoint.udpPorts || ""} onChange={(event) => actions.updateEndpoint(machine.id, endpoint.id, { udpPorts: event.target.value })} /></label>
                        </div>
                        <div className="endpoint-actions"><small>{endpoint.source || "manual"}</small><button type="button" className="button secondary" onClick={() => actions.useEndpoint(machine, endpoint)}>Use endpoint</button>{(machine.endpoints || []).length > 1 && <button type="button" className="text-button danger" onClick={() => actions.deleteEndpoint(machine.id, endpoint.id)}>Delete</button>}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="add-endpoint-row"><input type="text" value={endpointDrafts[machine.id] || ""} onChange={(event) => setEndpointDrafts((current) => ({ ...current, [machine.id]: event.target.value }))} placeholder="Discovered IP or hostname" /><button type="button" className="button secondary" onClick={() => addEndpoint(machine)}>Add endpoint</button></div>
                {workspace.targets.length > 1 && (
                  <div className="merge-machine-row">
                    <select value={mergeDestinations[machine.id] || ""} onChange={(event) => setMergeDestinations((current) => ({ ...current, [machine.id]: event.target.value }))}>
                      <option value="">Merge this machine into…</option>
                      {workspace.targets.filter((target) => target.id !== machine.id).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                    </select>
                    <button type="button" className="button secondary" disabled={!mergeDestinations[machine.id]} onClick={() => {
                      const destination = workspace.targets.find((target) => target.id === mergeDestinations[machine.id]);
                      if (destination && window.confirm(`Merge ${machine.name} into ${destination.name}? Case data and endpoints will move; ${machine.name} will be removed.`)) actions.mergeTarget(machine.id, destination.id);
                    }}>Merge case data</button>
                  </div>
                )}
                <label className="card-notes"><span>Machine notes</span><textarea rows="3" value={machine.notes} onChange={(event) => actions.updateTarget(machine.id, { notes: event.target.value })} /></label>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

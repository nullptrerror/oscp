import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import ChecklistItem from "../components/ChecklistItem";
import VariablesPanel from "../components/VariablesPanel";
import EvidenceInbox from "../components/EvidenceInbox";
import { CHECKLIST } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { getScopedItemValue } from "../lib/workspace";
import { useLocalRunner } from "../context/LocalRunnerContext";
import { FLAG_PROFILES, flagProfile } from "../lib/flagProfiles";
import PdfMachineImporter from "../components/PdfMachineImporter";
import PracticeBoxSelect from "../components/PracticeBoxSelect";
import { PLATFORM_PHASES, platformLabel } from "../data/practiceBoxes";

function MachineRequired({ workspace, actions }) {
  const [draft, setDraft] = useState({ name: "", host: "", os: "Unknown", labType: "oscp", boxType: "unknown", practiceBoxId: "" });
  const submit = (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.host.trim()) return;
    const profile = flagProfile(draft.labType);
    actions.addTarget({ ...draft, name: draft.name.trim(), host: draft.host.trim(), userFlagName: profile.userFlagName, rootFlagName: profile.rootFlagName, domain: "", notes: "" });
  };
  return (
    <section className="machine-gate" role="dialog" aria-labelledby="machine-gate-title">
      <div><p className="eyebrow">Machine required</p><h2 id="machine-gate-title">Choose where this work belongs.</h2><p>Commands, evidence, credentials, flags, notes, and report text are always stored under one machine.</p></div>
      {workspace.targets.length > 0 && <div className="machine-gate-existing">{workspace.targets.map((target) => <button type="button" className="button secondary" key={target.id} onClick={() => actions.useTarget(target)}>Use {target.name} · {target.host}</button>)}</div>}
      <form onSubmit={submit}>
        <PracticeBoxSelect value={draft.practiceBoxId} onSelect={(box) => {
          if (!box) { setDraft({ ...draft, practiceBoxId: "" }); return; }
          setDraft({ ...draft, practiceBoxId: box.id, name: box.name, os: box.os, boxType: box.platform, labType: box.labType });
        }} />
        <label><span>New box name</span><input type="text" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="web01" required /></label>
        <label><span>IP or host</span><input type="text" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="192.168.45.100" required /></label>
        <label><span>Proof style</span><select value={draft.labType} onChange={(event) => setDraft({ ...draft, labType: event.target.value })}>{Object.entries(FLAG_PROFILES).map(([value, profile]) => <option value={value} key={value}>{profile.label}</option>)}</select></label>
        <button type="submit" className="button" disabled={!draft.name.trim() || !draft.host.trim()}>Create and use box</button>
      </form>
      <PdfMachineImporter compact />
      <Link className="text-button machine-gate-link" to="/targets">Open full machine setup</Link>
    </section>
  );
}

export default function ChecklistPage() {
  const { workspace, actions } = useWorkspace();
  const runner = useLocalRunner();
  const [query, setQuery] = useState("");
  const [hideComplete, setHideComplete] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
  const [expandedResultsKey, setExpandedResultsKey] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const focusSearch = (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  useEffect(() => setExpandedResultsKey(null), [workspace.activeTargetId]);
  const normalizedQuery = query.trim().toLowerCase();
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);
  const platformPhases = PLATFORM_PHASES[activeTarget?.boxType];
  const methodology = focusMode && platformPhases ? CHECKLIST.filter((phase) => platformPhases.has(phase.id)) : CHECKLIST;

  const totalItems = methodology.reduce((total, phase) => total + phase.items.length, 0);
  const completedItems = methodology.reduce(
    (total, phase) => total + phase.items.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length,
    0,
  );
  const percent = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

  const visiblePhases = useMemo(
    () => methodology.map((phase) => ({
      ...phase,
      items: phase.items.filter((item) => {
        if (hideComplete && getScopedItemValue(workspace.completed, workspace, item.id, false)) return false;
        if (!normalizedQuery) return true;
        const haystack = [
          item.title,
          item.detail,
          phase.title,
          ...item.commands.flatMap((command) => [command.label, command.value]),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    })).filter((phase) => phase.items.length > 0),
    [hideComplete, normalizedQuery, workspace.completed, methodology],
  );
  const recommendedItem = methodology.flatMap((phase) => phase.items.map((item) => ({ ...item, phase })))
    .find((item) => !getScopedItemValue(workspace.completed, workspace, item.id, false));

  if (!workspace.activeTargetId) {
    return (
      <main className="page-shell checklist-page">
        <section className="checklist-hero"><div><p className="eyebrow">Operator checklist</p><h1>Methodology, not memory.</h1><p>Select a machine before beginning so nothing is saved into an unassigned workspace.</p></div></section>
        <MachineRequired workspace={workspace} actions={actions} />
      </main>
    );
  }

  return (
    <main className="page-shell checklist-page">
      <section className="checklist-hero">
        <div>
          <p className="eyebrow">Operator checklist</p>
          <h1>Methodology, not memory.</h1>
          <p>Small enough to use under pressure. Detailed enough to keep you moving.</p>
        </div>
        <div className="progress-card" aria-label={`${percent}% complete`}>
          <div className="progress-dial" style={{ "--progress": `${percent * 3.6}deg` }}>
            <strong>{percent}%</strong>
            <span>complete</span>
          </div>
          <p><strong>{completedItems}</strong> of {totalItems} checks</p>
        </div>
      </section>

      <section className={`runner-readiness ${runner.available ? "is-local" : "is-static"}`}>
        <div>
          <p className="eyebrow">Execution mode</p>
          <strong>{runner.available ? "Local Kali runner connected" : "Static documentation mode"}</strong>
          <span>{runner.available ? `Commands run under ${runner.workspaceRoot}. Successful runs save evidence and complete the check.` : "Commands cannot execute from a statically hosted browser. Paste or attach each command's result instead."}</span>
        </div>
        {runner.available && (
          <div className="runner-tool-list" aria-label="Local tool readiness">
            {runner.tools.map((tool) => <span className={tool.ready ? "ready" : "missing"} key={tool.name}>{tool.ready ? "✓" : "×"} {tool.name}</span>)}
          </div>
        )}
      </section>

      <div className="checklist-toolbar">
        <label className="search-field">
          <span className="sr-only">Search checklist</span>
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }}
            placeholder="Search checks, tools, ports, or commands…"
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={hideComplete} onChange={(event) => setHideComplete(event.target.checked)} />
          <span>Hide complete</span>
        </label>
        {platformPhases && <label className="toggle-field"><input type="checkbox" checked={focusMode} onChange={(event) => setFocusMode(event.target.checked)} /><span>{platformLabel(activeTarget.boxType)} focus</span></label>}
      </div>

      {recommendedItem && !normalizedQuery && (
        <a className="next-action-card" href={`#item-${recommendedItem.id}`}>
          <span>Next smallest action</span>
          <strong>{recommendedItem.title}</strong>
          <small>{recommendedItem.phase.title} · finish one result, write one conclusion, then move on.</small>
        </a>
      )}

      <EvidenceInbox />

      <div className="checklist-layout">
        <div className="phases-column">
          {visiblePhases.map((phase) => {
            const phaseDone = phase.items.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length;
            return (
              <section className="phase-card" id={`phase-${phase.id}`} key={phase.id}>
                <div className="phase-heading">
                  <span className="phase-number">{phase.number}</span>
                  <div>
                    <h2>{phase.title}</h2>
                    <p>{phase.summary}</p>
                  </div>
                  <span className="phase-count">{phaseDone}/{phase.items.length}</span>
                </div>
                <div className="phase-items">
                  {phase.items.map((item) => (
                    <ChecklistItem
                      key={item.id}
                      item={item}
                      recommended={recommendedItem?.id === item.id && !normalizedQuery}
                      searchActive={Boolean(normalizedQuery)}
                      expandedResultsKey={expandedResultsKey}
                      onExpandedResultsChange={setExpandedResultsKey}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {visiblePhases.length === 0 && (
            <div className="empty-state">
              <p className="eyebrow">No matches</p>
              <h2>Try a tool, port, or service name.</h2>
              <button type="button" className="button secondary" onClick={() => { setQuery(""); setHideComplete(false); }}>
                Clear filters
              </button>
            </div>
          )}
        </div>
        <VariablesPanel />
      </div>
    </main>
  );
}

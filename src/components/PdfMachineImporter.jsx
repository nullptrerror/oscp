import { useRef, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { FLAG_PROFILES } from "../lib/flagProfiles";

const MAX_PDF_SIZE = 30 * 1024 * 1024;

export default function PdfMachineImporter({ compact = false, onImported }) {
  const { actions } = useWorkspace();
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const choosePdf = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_PDF_SIZE) {
      setMessage({ type: "error", text: "That PDF is larger than 30 MB." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { inspectWorkspacePdf } = await import("../lib/pdfReport");
      const inspected = await inspectWorkspacePdf(await file.arrayBuffer());
      if (!inspected.workspace.targets.length) throw new Error("That PDF workspace does not contain a machine.");
      const selectedTargetId = inspected.workspace.activeTargetId || inspected.workspace.targets[0].id;
      const missing = inspected.missingLabStyleTargetIds.includes(selectedTargetId);
      const selected = inspected.workspace.targets.find((target) => target.id === selectedTargetId);
      setPending({
        ...inspected,
        filename: file.name,
        selectedTargetId,
        labType: missing ? "" : selected?.labType || "",
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not inspect that PDF." });
    } finally {
      setBusy(false);
    }
  };

  const selectTarget = (targetId) => {
    const target = pending.workspace.targets.find((entry) => entry.id === targetId);
    const missing = pending.missingLabStyleTargetIds.includes(targetId);
    setPending({ ...pending, selectedTargetId: targetId, labType: missing ? "" : target?.labType || "" });
  };

  const importSelected = () => {
    const target = pending.workspace.targets.find((entry) => entry.id === pending.selectedTargetId);
    const needsStyle = pending.missingLabStyleTargetIds.includes(pending.selectedTargetId);
    if (!target || (needsStyle && !pending.labType)) return;
    actions.importMachine(pending.workspace, target.id, pending.labType || target.labType);
    setMessage({ type: "success", text: `Imported ${target.name} and its machine-scoped evidence from ${pending.filename}.` });
    setPending(null);
    onImported?.();
  };

  return (
    <div className={`pdf-machine-importer ${compact ? "is-compact" : ""}`}>
      <button type="button" className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "Reading PDF…" : "Load machine from PDF"}
      </button>
      <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={choosePdf} />
      {message && <p className={`import-message ${message.type}`} role="status">{message.text}</p>}
      {pending && (
        <div className="pdf-import-review" role="dialog" aria-label="Review PDF machine import">
          <div>
            <strong>Import from {pending.filename}</strong>
            <span>This adds one machine without replacing the rest of your workspace.</span>
          </div>
          {pending.workspace.targets.length > 1 && (
            <label><span>Machine</span><select value={pending.selectedTargetId} onChange={(event) => selectTarget(event.target.value)}>{pending.workspace.targets.map((target) => <option value={target.id} key={target.id}>{target.name} · {target.host || "no address"}</option>)}</select></label>
          )}
          {pending.missingLabStyleTargetIds.includes(pending.selectedTargetId) && (
            <label className="lab-style-required">
              <span>Which proof style did this machine use? *</span>
              <select value={pending.labType} onChange={(event) => setPending({ ...pending, labType: event.target.value })} required>
                <option value="">Choose before importing…</option>
                {Object.entries(FLAG_PROFILES).map(([value, profile]) => <option value={value} key={value}>{profile.label} · {profile.userFlagName} / {profile.rootFlagName}</option>)}
              </select>
              <small>The older PDF did not record this setting, so Fieldnotes will not guess.</small>
            </label>
          )}
          <div className="pdf-import-actions">
            <button type="button" className="button" onClick={importSelected} disabled={pending.missingLabStyleTargetIds.includes(pending.selectedTargetId) && !pending.labType}>Import machine</button>
            <button type="button" className="text-button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

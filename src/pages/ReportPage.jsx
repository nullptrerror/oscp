import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { fileToEvidence } from "../lib/evidence";
import { getActiveScope, getScopedItemValue } from "../lib/workspace";

const reportError = (error) => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/pdf-lib|failed to fetch dynamically imported module/i.test(message)) {
    return "PDF support is not installed in node_modules. Stop Vite, run npm install (or npm ci), then restart npm run dev.";
  }
  return message || "The PDF operation failed.";
};

export default function ReportPage() {
  const { workspace, actions } = useWorkspace();
  const importRef = useRef(null);
  const userFlagRef = useRef(null);
  const rootFlagRef = useRef(null);
  const profileRef = useRef(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);
  const report = workspace.reports[getActiveScope(workspace)] || {};

  const readiness = useMemo(() => {
    const completed = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length;
    const evidence = ALL_ITEMS.flatMap((item) => getScopedItemValue(workspace.evidence, workspace, item.id, [])).length;
    const proof = getScopedItemValue(workspace.evidence, workspace, "proof-artifacts", []);
    const copiedCommands = (workspace.commandHistory || []).filter((entry) => entry.targetId === workspace.activeTargetId).length;
    return {
      completed,
      evidence,
      copiedCommands,
      userFlag: proof.some((entry) => entry.category === "user-flag"),
      rootFlag: proof.some((entry) => entry.category === "root-flag"),
    };
  }, [workspace]);

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { downloadReportPdf } = await import("../lib/pdfReport");
      await downloadReportPdf(workspace, workspace.activeTargetId);
      setMessage({ type: "success", text: "Report generated. Its attachments include the complete restorable workspace and target evidence." });
    } catch (error) {
      setMessage({ type: "error", text: reportError(error) });
    } finally {
      setBusy(false);
    }
  };

  const importPdf = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      setMessage({ type: "error", text: "That PDF is larger than 30 MB." });
      return;
    }
    setBusy(true);
    try {
      const { extractWorkspaceFromPdf } = await import("../lib/pdfReport");
      const restored = await extractWorkspaceFromPdf(await file.arrayBuffer());
      if (!window.confirm(`Replace this browser's workspace with the data embedded in ${file.name}?`)) return;
      actions.importWorkspace(restored);
      setMessage({ type: "success", text: `Restored ${restored.targets.length} target(s) from ${file.name}.` });
    } catch (error) {
      setMessage({ type: "error", text: reportError(error) });
    } finally {
      setBusy(false);
    }
  };

  const addFlagScreenshot = async (event, category) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const evidence = await fileToEvidence(file);
      if (!evidence.dataUrl) throw new Error("Flag proof must be a PNG or JPEG screenshot.");
      actions.addEvidence("proof-artifacts", { ...evidence, category, label: `${category === "user-flag" ? "User" : "Root / Administrator"} proof — ${file.name}` });
      setMessage({ type: "success", text: `${category === "user-flag" ? "User" : "Root / Administrator"} proof added to this target.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not add that screenshot." });
    }
  };

  const addProfileImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await fileToEvidence(file);
      if (!image.dataUrl) throw new Error("Profile image must be a PNG or JPEG.");
      actions.updateReport({ profileImage: image.dataUrl, profileImageName: file.name });
      setMessage({ type: "success", text: "Profile image added to this target report." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not add that profile image." });
    }
  };

  return (
    <main className="page-shell report-page">
      <section className="section-hero report-hero">
        <div>
          <p className="eyebrow">Machine deliverable</p>
          <h1>Turn the runbook into the report.</h1>
          <p>The PDF includes the narrative, commands, notes, text output, screenshots, and a private embedded workspace that can restore the app later.</p>
        </div>
        <div className="report-target-picker">
          <label htmlFor="report-target">Report machine</label>
          <select id="report-target" value={workspace.activeTargetId || ""} onChange={(event) => {
            const target = workspace.targets.find((entry) => entry.id === event.target.value);
            if (target) actions.useTarget(target);
          }}>
            {workspace.targets.length === 0 && <option value="">Current command context</option>}
            {workspace.targets.map((target) => <option key={target.id} value={target.id}>{target.name} · {(target.endpoints || []).length} endpoint{(target.endpoints || []).length === 1 ? "" : "s"}</option>)}
          </select>
        </div>
      </section>

      {message && <div className={`notice ${message.type}`} role="status">{message.text}</div>}

      <div className="report-layout">
        <section className="report-editor">
          <div className="finding-section-head no-border">
            <div><p className="eyebrow">Narrative</p><h2>{activeTarget?.name || workspace.variables.targetName}</h2></div>
          </div>
          <div className="form-row equal">
            <label><span>Your name</span><input type="text" value={report.operatorName || ""} onChange={(event) => actions.updateReport({ operatorName: event.target.value })} placeholder="Candidate name" /></label>
            <label><span>Candidate / lab ID</span><input type="text" value={report.candidateId || ""} onChange={(event) => actions.updateReport({ candidateId: event.target.value })} placeholder="Optional identifier" /></label>
          </div>
          <div className="profile-image-control">
            {report.profileImage && <img src={report.profileImage} alt="Report profile" />}
            <div>
              <button type="button" className="button secondary" onClick={() => profileRef.current?.click()}>{report.profileImage ? "Replace profile image" : "Add profile image"}</button>
              {report.profileImage && <button type="button" className="text-button danger" onClick={() => actions.updateReport({ profileImage: "", profileImageName: "" })}>Remove</button>}
            </div>
            <input ref={profileRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={addProfileImage} />
          </div>
          <label><span>Report title</span><input type="text" value={report.title || ""} onChange={(event) => actions.updateReport({ title: event.target.value })} placeholder={`${activeTarget?.name || workspace.variables.targetName} Penetration Test Report`} /></label>
          <label><span>Executive summary</span><textarea rows="6" value={report.executiveSummary || ""} onChange={(event) => actions.updateReport({ executiveSummary: event.target.value })} placeholder="Summarize the compromise path, impact, and final access in plain language." /></label>
          <label><span>Scope</span><textarea rows="3" value={report.scope || ""} onChange={(event) => actions.updateReport({ scope: event.target.value })} placeholder="Target IP, hostname, domain, and any scope limitations." /></label>
          <label><span>Recommendations</span><textarea rows="5" value={report.recommendations || ""} onChange={(event) => actions.updateReport({ recommendations: event.target.value })} placeholder="Prioritized fixes for the attack path you demonstrated." /></label>
        </section>

        <aside className="report-readiness">
          <p className="eyebrow">Report readiness</p>
          <dl className="stat-list">
            <div><dt>Completed checks</dt><dd>{readiness.completed} / {ALL_ITEMS.length}</dd></div>
            <div><dt>Evidence items</dt><dd>{readiness.evidence}</dd></div>
            <div><dt>Copied commands</dt><dd>{readiness.copiedCommands}</dd></div>
            <div><dt>User proof</dt><dd>{readiness.userFlag ? "Ready" : "Missing"}</dd></div>
            <div><dt>Root / Admin proof</dt><dd>{readiness.rootFlag ? "Ready" : "Missing"}</dd></div>
          </dl>
          <div className="proof-actions">
            <button type="button" className="button secondary" onClick={() => userFlagRef.current?.click()}>Add user proof image</button>
            <button type="button" className="button secondary" onClick={() => rootFlagRef.current?.click()}>Add root proof image</button>
            <input ref={userFlagRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => addFlagScreenshot(event, "user-flag")} />
            <input ref={rootFlagRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => addFlagScreenshot(event, "root-flag")} />
          </div>
          <button type="button" className="button report-generate" onClick={generate} disabled={busy}>{busy ? "Working…" : "Generate target PDF"}</button>
          <button type="button" className="text-button" onClick={() => importRef.current?.click()} disabled={busy}>Restore workspace from PDF</button>
          <input ref={importRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={importPdf} />
          <p className="report-security-note">The PDF and its embedded JSON contain secrets in plain text. Protect it like exam evidence.</p>
          <Link className="backup-link" to="/backup">JSON backup and reset tools</Link>
        </aside>
      </div>
    </main>
  );
}

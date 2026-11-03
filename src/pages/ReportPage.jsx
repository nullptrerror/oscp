import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { fileToEvidence } from "../lib/evidence";
import { getActiveScope, getScopedItemValue } from "../lib/workspace";
import { getOperatorProfile, githubProfile, initials } from "../lib/profile";

const AVATAR_SIZE = 320;

const reportError = (error) => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/pdf-lib|fontkit|dejavu|failed to fetch dynamically imported module/i.test(message)) {
    return "PDF support is not installed in node_modules. Stop Vite, run npm install (or npm ci), then restart npm run dev.";
  }
  return message || "The PDF operation failed.";
};

// Avatars are cropped to a centred square and downscaled so they stay small in browser storage.
const squareAvatar = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    resolve(canvas.toDataURL("image/png"));
  };
  image.onerror = () => reject(new Error("That image could not be read."));
  image.src = dataUrl;
});

function Avatar({ src, name, className = "" }) {
  return src
    ? <img className={`avatar ${className}`} src={src} alt="" />
    : <span className={`avatar avatar-initials ${className}`} aria-hidden="true">{initials(name)}</span>;
}

export default function ReportPage() {
  const { workspace, actions } = useWorkspace();
  const importRef = useRef(null);
  const userFlagRef = useRef(null);
  const rootFlagRef = useRef(null);
  const profileRef = useRef(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);
  const targetName = activeTarget?.name || workspace.variables.targetName;
  const report = workspace.reports[getActiveScope(workspace)] || {};
  const profile = getOperatorProfile(workspace, report);
  const github = githubProfile(profile.github);
  const reportTitle = report.title || `${targetName} Penetration Test Report`;

  // The first profile edit also moves values from older per-machine reports into the shared profile.
  const updateProfile = (patch) => {
    actions.updateProfile({ ...profile, ...patch });
    if (report.operatorName || report.candidateId || report.profileImage) actions.updateReport({ operatorName: "", candidateId: "", profileImage: "", profileImageName: "" });
  };

  const readiness = useMemo(() => {
    const completed = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length;
    const documented = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.evidence, workspace, item.id, []).length > 0).length;
    const proof = getScopedItemValue(workspace.evidence, workspace, "proof-artifacts", []);
    const copiedCommands = (workspace.commandHistory || []).filter((entry) => entry.targetId === workspace.activeTargetId).length;
    return {
      completed,
      documented,
      copiedCommands,
      userFlag: proof.some((entry) => entry.category === "user-flag"),
      rootFlag: proof.some((entry) => entry.category === "root-flag"),
    };
  }, [workspace]);

  const checks = [
    { label: "Name and OSID", done: Boolean(profile.name && profile.osid), hint: "Fill in the operator profile." },
    { label: "Executive summary", done: Boolean(report.executiveSummary?.trim()), hint: "Two or three sentences on the attack path and impact." },
    { label: "Steps with evidence", done: readiness.documented > 0, detail: `${readiness.documented}`, hint: "Save command output on the checklist." },
    { label: "Commands logged", done: readiness.copiedCommands > 0, detail: `${readiness.copiedCommands}`, hint: "Copy commands from the checklist so they are recorded." },
    { label: "User / local proof", done: readiness.userFlag, hint: "Screenshot with local.txt and the IP address.", action: () => userFlagRef.current?.click(), actionLabel: "Add" },
    { label: "Root / Admin proof", done: readiness.rootFlag, hint: "Screenshot with proof.txt and the IP address.", action: () => rootFlagRef.current?.click(), actionLabel: "Add" },
    { label: "Recommendations", done: Boolean(report.recommendations?.trim()), hint: "One fix per weakness you exploited." },
  ];
  const doneCount = checks.filter((check) => check.done).length;

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { downloadReportPdf } = await import("../lib/pdfReport");
      const { pages } = await downloadReportPdf(workspace, workspace.activeTargetId);
      setMessage({ type: "success", text: `Report generated: ${pages} pages. Its attachments include the complete restorable workspace and every evidence file.` });
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
      updateProfile({ avatar: await squareAvatar(image.dataUrl) });
      setMessage({ type: "success", text: "Profile image saved. It appears as a circle in the header of every report page." });
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
          <p>The PDF includes the narrative, commands, notes, colored terminal output, screenshots, and a private embedded workspace that can restore the app later.</p>
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
        <div className="report-main">
          <section className="report-editor profile-card">
            <div className="finding-section-head no-border">
              <div><p className="eyebrow">Operator profile</p><h2>Shown on every page</h2></div>
              <span className="profile-scope">All machines</span>
            </div>
            <div className="profile-grid">
              <div className="avatar-picker">
                <button type="button" className="avatar-button" onClick={() => profileRef.current?.click()} aria-label={profile.avatar ? "Replace profile image" : "Add profile image"}>
                  <Avatar src={profile.avatar} name={profile.name} className="avatar-large" />
                  <span className="avatar-overlay">{profile.avatar ? "Change" : "Add photo"}</span>
                </button>
                {profile.avatar && <button type="button" className="text-button danger" onClick={() => updateProfile({ avatar: "" })}>Remove</button>}
                <input ref={profileRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={addProfileImage} />
              </div>
              <div className="profile-fields">
                <label><span>Full name</span><input type="text" value={profile.name} onChange={(event) => updateProfile({ name: event.target.value })} placeholder="Name as registered with OffSec" autoComplete="name" /></label>
                <div className="form-row equal">
                  <label><span>OSID</span><input type="text" value={profile.osid} onChange={(event) => updateProfile({ osid: event.target.value })} placeholder="OS-XXXXXXX" spellCheck="false" /></label>
                  <label>
                    <span>GitHub</span>
                    <div className={`prefixed-input ${profile.github && !github ? "invalid" : ""}`}>
                      <em>github.com/</em>
                      <input type="text" value={github?.handle ?? profile.github} onChange={(event) => updateProfile({ github: event.target.value })} placeholder="username" spellCheck="false" />
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="header-preview" aria-label="PDF page header preview">
              <div className="header-preview-left">
                <Avatar src={profile.avatar} name={profile.name} />
                <div>
                  <strong>{profile.name || "Operator"}</strong>
                  <span>
                    {profile.osid && <><b>OSID</b> <code>{profile.osid}</code></>}
                    {profile.osid && github && <i>·</i>}
                    {github && <a href={github.url} target="_blank" rel="noreferrer">{github.display}</a>}
                  </span>
                </div>
              </div>
              <div className="header-preview-right">
                <strong>{reportTitle}</strong>
                <span>OSCP+ Exam Report · {targetName}</span>
              </div>
              <p className="header-preview-caption">PDF header preview</p>
            </div>
          </section>

          <section className="report-editor">
            <div className="finding-section-head no-border">
              <div><p className="eyebrow">Narrative</p><h2>{targetName}</h2></div>
            </div>
            <label><span>Report title</span><input type="text" value={report.title || ""} onChange={(event) => actions.updateReport({ title: event.target.value })} placeholder={`${targetName} Penetration Test Report`} /></label>
            <label>
              <span>Executive summary</span>
              <textarea rows="6" value={report.executiveSummary || ""} onChange={(event) => actions.updateReport({ executiveSummary: event.target.value })} placeholder="Summarize the compromise path, impact, and final access in plain language." />
              <small className="field-hint">Blank lines start new paragraphs. Lines starting with "-" or "1." become lists in the PDF.</small>
            </label>
            <label><span>Scope</span><textarea rows="3" value={report.scope || ""} onChange={(event) => actions.updateReport({ scope: event.target.value })} placeholder="Target IP, hostname, domain, and any scope limitations." /></label>
            <label><span>Recommendations</span><textarea rows="5" value={report.recommendations || ""} onChange={(event) => actions.updateReport({ recommendations: event.target.value })} placeholder={"1. Fix for the initial foothold\n2. Fix for the privilege escalation"} /></label>
          </section>
        </div>

        <aside className="report-readiness">
          <div className="readiness-head">
            <div>
              <p className="eyebrow">Report readiness</p>
              <strong>{doneCount} of {checks.length} ready</strong>
            </div>
            <div className="readiness-meter" style={{ "--progress": `${(doneCount / checks.length) * 100}%` }} aria-hidden="true"><span /></div>
          </div>
          <ul className="readiness-list">
            {checks.map((check) => (
              <li key={check.label} className={check.done ? "is-done" : ""}>
                <span className="readiness-mark" aria-hidden="true">{check.done ? "✓" : ""}</span>
                <div>
                  <strong>{check.label}{check.detail && <em>{check.detail}</em>}</strong>
                  {!check.done && <small>{check.hint}</small>}
                </div>
                {check.action && <button type="button" className="text-button" onClick={check.action}>{check.done ? "Add more" : check.actionLabel}</button>}
                <span className="sr-only">{check.done ? "ready" : "missing"}</span>
              </li>
            ))}
          </ul>
          <input ref={userFlagRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => addFlagScreenshot(event, "user-flag")} />
          <input ref={rootFlagRef} className="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => addFlagScreenshot(event, "root-flag")} />
          <p className="readiness-foot">{readiness.completed} of {ALL_ITEMS.length} checklist items complete for this machine.</p>
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

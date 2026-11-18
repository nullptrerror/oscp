import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ALL_ITEMS } from "../data/checklist";
import { useWorkspace } from "../context/WorkspaceContext";
import { fileToEvidence, visibleDiscoveries } from "../lib/evidence";
import {
  commandResultReference,
  getActiveScope,
  getCommandRunResultStateValue,
  getScopedItemValue,
  latestCommandResultReference,
  RESULT_STATES,
} from "../lib/workspace";
import { getOperatorProfile, githubProfile, initials } from "../lib/profile";
import { buildReportStarters } from "../lib/reportStarters";
import {
  generateReportMarkdown,
  markdownReportFilename,
  REPORT_MARKDOWN_VERSION,
  reportMarkdownFingerprint,
} from "../lib/markdownReport";
import PdfMachineImporter from "../components/PdfMachineImporter";
import { buildTargetNarrativeModel } from "../lib/narrative";

const AVATAR_SIZE = 320;

const downloadText = (value, filename) => {
  const url = URL.createObjectURL(new Blob([value], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

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
  const userFlagRef = useRef(null);
  const rootFlagRef = useRef(null);
  const profileRef = useRef(null);
  const markdownTargetRef = useRef("");
  const [message, setMessage] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [generatedMarkdownSource, setGeneratedMarkdownSource] = useState({ targetKey: "", value: "", error: "" });
  const [markdownGenerating, setMarkdownGenerating] = useState(true);
  const activeTarget = workspace.targets.find((target) => target.id === workspace.activeTargetId);
  const markdownTargetKey = workspace.activeTargetId || "current-command-context";
  markdownTargetRef.current = markdownTargetKey;
  const targetName = activeTarget?.name || workspace.variables.targetName;
  const report = workspace.reports[getActiveScope(workspace)] || {};
  const profile = getOperatorProfile(workspace, report);
  const github = githubProfile(profile.github);
  const reportTitle = report.title || `${targetName} Penetration Test Report`;
  const reportStarters = useMemo(() => buildReportStarters(workspace, workspace.activeTargetId), [workspace]);
  const generatedMarkdown = generatedMarkdownSource.targetKey === markdownTargetKey ? generatedMarkdownSource.value : "";
  const markdownLoading = markdownGenerating || generatedMarkdownSource.targetKey !== markdownTargetKey;
  const markdownGenerationError = generatedMarkdownSource.targetKey === markdownTargetKey ? generatedMarkdownSource.error : "";
  const generatedMarkdownFingerprint = useMemo(
    () => reportMarkdownFingerprint(generatedMarkdown),
    [generatedMarkdown],
  );
  const hasMarkdownDraft = typeof report.markdownDraft === "string";
  const markdown = hasMarkdownDraft ? report.markdownDraft : generatedMarkdown;
  const markdownDirty = hasMarkdownDraft && markdown !== generatedMarkdown;
  const markdownSourceChanged = !markdownLoading && !markdownGenerationError && hasMarkdownDraft
    && Boolean(report.markdownSourceFingerprint)
    && report.markdownSourceFingerprint !== generatedMarkdownFingerprint;
  const markdownStatus = markdownLoading ? "Generating" : markdownGenerationError ? "Generation failed" : markdownSourceChanged ? "Source changed" : markdownDirty ? "Edited" : "Generated";
  const busy = Boolean(busyAction);

  useEffect(() => {
    let cancelled = false;
    const targetKey = markdownTargetKey;
    setMarkdownGenerating(true);
    Promise.resolve(generateReportMarkdown(workspace, workspace.activeTargetId))
      .then((value) => {
        if (!cancelled) setGeneratedMarkdownSource({ targetKey, value, error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          const errorText = reportError(error);
          setGeneratedMarkdownSource((current) => current.targetKey === targetKey
            ? { ...current, error: errorText }
            : { targetKey, value: "", error: errorText });
          setMessage({ type: "error", text: errorText });
        }
      })
      .finally(() => {
        if (!cancelled) setMarkdownGenerating(false);
      });
    return () => { cancelled = true; };
  }, [
    workspace.activeTargetId,
    workspace.targets,
    workspace.variables,
    workspace.profile,
    workspace.accounts,
    workspace.users,
    workspace.loot,
    workspace.completed,
    workspace.resultStates,
    workspace.commandResultStates,
    workspace.notes,
    workspace.nextSteps,
    workspace.narrativeSources,
    workspace.evidence,
    workspace.discoveries,
    workspace.ignoredDiscoveries,
    workspace.commandHistory,
    workspace.parserSettings,
    report.title,
    report.executiveSummary,
    report.scope,
    report.recommendations,
    report.proofVerified,
    report.proofSubmitted,
    report.starterSources,
    markdownTargetKey,
  ]);

  useEffect(() => {
    if (!workspace.activeTargetId) return;
    const previousSources = report.starterSources || {};
    const patch = {};
    const nextSources = { ...previousSources };
    for (const key of ["executiveSummary", "scope", "recommendations"]) {
      const current = report[key] || "";
      if ((!current.trim() || current === previousSources[key]) && current !== reportStarters[key]) {
        patch[key] = reportStarters[key];
        nextSources[key] = reportStarters[key];
      }
    }
    if (Object.keys(patch).length) actions.updateReport({ ...patch, starterSources: nextSources });
  }, [actions, report.executiveSummary, report.recommendations, report.scope, report.starterSources, reportStarters, workspace.activeTargetId]);

  // The first profile edit also moves values from older per-machine reports into the shared profile.
  const updateProfile = (patch) => {
    actions.updateProfile({ ...profile, ...patch });
    if (report.operatorName || report.candidateId || report.profileImage) actions.updateReport({ operatorName: "", candidateId: "", profileImage: "", profileImageName: "" });
  };

  const readiness = useMemo(() => {
    const completed = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.completed, workspace, item.id, false)).length;
    const documented = ALL_ITEMS.filter((item) => getScopedItemValue(workspace.evidence, workspace, item.id, []).length > 0).length;
    const proof = getScopedItemValue(workspace.evidence, workspace, "proof-artifacts", []);
    const targetRuns = (workspace.commandHistory || []).filter((entry) => entry.targetId === workspace.activeTargetId && entry.source === "local runner");
    const narrativeModel = buildTargetNarrativeModel(workspace, ALL_ITEMS, workspace.activeTargetId);
    const activityItems = narrativeModel.activityItemIds.filter((itemId) => {
      const entries = getScopedItemValue(workspace.evidence, workspace, itemId, []);
      return targetRuns.some((entry) => entry.itemId === itemId)
        || entries.some((entry) => !["user-flag", "root-flag"].includes(entry.category));
    });
    const narrated = activityItems.filter((itemId) => narrativeModel.items[itemId]?.ready).length;
    const classified = activityItems.filter((itemId) => {
      const state = narrativeModel.items[itemId]?.resultState;
      return state && state !== RESULT_STATES.REVIEW;
    }).length;
    const commandResults = [...new Set(ALL_ITEMS.flatMap((item) => {
      const entries = getScopedItemValue(workspace.evidence, workspace, item.id, []);
      return entries
        .filter((entry) => entry.commandKey && entry.substantive !== false && commandResultReference(entry))
        .map((entry) => [item.id, entry.commandKey, commandResultReference(entry), latestCommandResultReference(entries, entry.commandKey)]);
    }).map(([itemId, commandKey, reference, latestReference]) => `${itemId}\u0000${commandKey}\u0000${reference}\u0000${latestReference}`))];
    const commandsClassified = commandResults.filter((value) => {
      const [itemId, commandKey, resultReference, latestReference] = value.split("\u0000");
      const state = getCommandRunResultStateValue(
        workspace.commandResultStates,
        workspace,
        itemId,
        commandKey,
        resultReference,
        "",
        { allowLegacy: resultReference === latestReference },
      );
      return state && state !== RESULT_STATES.REVIEW;
    }).length;
    const pendingCandidates = visibleDiscoveries(workspace.discoveries, {
      settings: workspace.parserSettings,
      ignored: workspace.ignoredDiscoveries,
      targetId: workspace.activeTargetId,
    }).filter((entry) => entry.targetId === workspace.activeTargetId && entry.status !== "confirmed").length;
    return {
      completed,
      documented,
      terminalRuns: targetRuns.length,
      narrated,
      narrativeTotal: activityItems.length,
      classified,
      commandsClassified,
      commandTotal: commandResults.length,
      pendingCandidates,
      userFlag: proof.some((entry) => entry.category === "user-flag"),
      rootFlag: proof.some((entry) => entry.category === "root-flag"),
    };
  }, [workspace]);

  const checks = [
    { label: "Name and OSID", done: Boolean(profile.name && profile.osid), hint: "Fill in the operator profile." },
    { label: "Executive summary", done: Boolean(report.executiveSummary?.trim()), hint: "Explain the access and business impact in plain language; omit tools, ports, and command counts." },
    { label: "Steps with evidence", done: readiness.documented > 0, detail: `${readiness.documented}`, hint: "Save command output on the checklist." },
    { label: "Terminal runs", done: readiness.terminalRuns > 0, detail: `${readiness.terminalRuns}`, hint: "Run commands from the checklist so their exact arguments and results are recorded." },
    { label: "Deterministic narrative ready", done: readiness.narrativeTotal > 0 && readiness.narrated === readiness.narrativeTotal, detail: `${readiness.narrated}/${readiness.narrativeTotal}`, hint: "Classify the saved command results. Fieldnotes derives the finding and decision from those reviewed results; add an override only when the deterministic text would be misleading." },
    { label: "Item results classified", done: readiness.narrativeTotal > 0 && readiness.classified === readiness.narrativeTotal, detail: `${readiness.classified}/${readiness.narrativeTotal}`, hint: "Classify each command result. Safe combinations roll up automatically; mixed failure or blocked states require an explicit item result." },
    { label: "Command results classified", done: readiness.commandTotal > 0 && readiness.commandsClassified === readiness.commandTotal, detail: `${readiness.commandsClassified}/${readiness.commandTotal}`, hint: "Classify every command that has saved evidence." },
    { label: "Parser candidates reviewed", done: readiness.pendingCandidates === 0, detail: `${readiness.pendingCandidates}`, hint: "Confirm or ignore every unverified parser candidate before generating the report." },
    { label: "User / local proof", done: readiness.userFlag, hint: "Screenshot with local.txt and the IP address.", action: () => userFlagRef.current?.click(), actionLabel: "Add" },
    { label: "Root / Admin proof", done: readiness.rootFlag, hint: "Screenshot with proof.txt and the IP address.", action: () => rootFlagRef.current?.click(), actionLabel: "Add" },
    { label: "Proof screenshot verified", done: Boolean(report.proofVerified), hint: "Confirm original location, interactive shell, identity, IP, and proof contents are visible." },
    { label: activeTarget?.labType === "oscp" ? "Control-panel proof" : "Control-panel proof (practice N/A)", done: activeTarget?.labType === "oscp" ? Boolean(report.proofSubmitted) : true, hint: activeTarget?.labType === "oscp" ? "Submit each proof value before the exam VPN/control panel closes." : "Practice targets have no OffSec exam control-panel submission." },
    { label: "Recommendations", done: Boolean(report.recommendations?.trim()), hint: "One fix per weakness you exploited." },
  ];
  const doneCount = checks.filter((check) => check.done).length;

  const applyReportStarters = () => {
    const patch = Object.fromEntries(Object.entries(reportStarters).filter(([key]) => !report[key]?.trim()));
    if (Object.keys(patch).length === 0) {
      setMessage({ type: "info", text: "The narrative fields already contain text. Clear a field before generating a replacement starter for it." });
      return;
    }
    actions.updateReport(patch);
    setMessage({ type: "success", text: `Generated ${Object.keys(patch).length} starter section${Object.keys(patch).length === 1 ? "" : "s"} from this target's recorded activity. Review every bracketed placeholder before submission.` });
  };

  const generateDirectPdf = async () => {
    setBusyAction("direct-pdf");
    setMessage(null);
    try {
      const { downloadReportPdf } = await import("../lib/pdfReport");
      const { pages } = await downloadReportPdf(workspace, workspace.activeTargetId);
      setMessage({ type: "success", text: `Direct report generated: ${pages} pages. Its attachments include the complete restorable workspace and every evidence file.` });
    } catch (error) {
      setMessage({ type: "error", text: reportError(error) });
    } finally {
      setBusyAction("");
    }
  };

  const updateMarkdown = (value) => {
    actions.updateReport({
      markdownDraft: value,
      markdownSourceFingerprint: hasMarkdownDraft
        ? report.markdownSourceFingerprint || generatedMarkdownFingerprint
        : generatedMarkdownFingerprint,
      markdownUpdatedAt: new Date().toISOString(),
      markdownVersion: REPORT_MARKDOWN_VERSION,
    });
  };

  const resetMarkdown = async () => {
    if (markdownDirty && !window.confirm("Discard your Markdown edits and restore the latest generated report?")) return;
    const targetId = workspace.activeTargetId;
    const targetKey = markdownTargetKey;
    setBusyAction("reset-markdown");
    setMessage(null);
    try {
      const latest = await generateReportMarkdown(workspace, targetId);
      if (markdownTargetRef.current === targetKey) setGeneratedMarkdownSource({ targetKey, value: latest, error: "" });
      const resetPatch = {
        markdownDraft: null,
        markdownSourceFingerprint: "",
        markdownUpdatedAt: "",
        markdownVersion: REPORT_MARKDOWN_VERSION,
      };
      if (targetId) actions.updateTargetReport(targetId, resetPatch);
      else actions.updateReport(resetPatch);
      setMessage({ type: "success", text: "Markdown reset to the latest deterministic report generated from this target's reviewed activity." });
    } catch (error) {
      const errorText = reportError(error);
      if (markdownTargetRef.current === targetKey) {
        setGeneratedMarkdownSource((current) => current.targetKey === targetKey
          ? { ...current, error: errorText }
          : { targetKey, value: "", error: errorText });
      }
      setMessage({ type: "error", text: errorText });
    } finally {
      setBusyAction("");
    }
  };

  const downloadMarkdown = () => {
    downloadText(markdown, markdownReportFilename(targetName));
    setMessage({ type: "success", text: "Markdown downloaded. It may contain credentials, hashes, proof values, and other private assessment evidence." });
  };

  const generateMarkdownPdf = async () => {
    setBusyAction("markdown-pdf");
    setMessage(null);
    try {
      const { downloadMarkdownReportPdf } = await import("../lib/markdownPdf");
      const { pages, warnings = [] } = await downloadMarkdownReportPdf(workspace, workspace.activeTargetId, markdown);
      const warningText = warnings.length ? ` ${warnings.length} legacy evidence attachment${warnings.length === 1 ? " was" : "s were"} unreadable and skipped; review the saved evidence list.` : "";
      setMessage({ type: warnings.length ? "info" : "success", text: `Styled Markdown report generated: ${pages} pages. Your edited Markdown and the restorable workspace are embedded as attachments.${warningText}` });
    } catch (error) {
      setMessage({ type: "error", text: reportError(error) });
    } finally {
      setBusyAction("");
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
          <p>The PDF includes the narrative, commands, notes, colored terminal output, screenshots, and a private embedded workspace that can reload this machine later.</p>
        </div>
        <div className="report-target-picker">
          <label htmlFor="report-target">Report machine</label>
          <select id="report-target" value={workspace.activeTargetId || ""} disabled={busy || markdownLoading} onChange={(event) => {
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
              <button type="button" className="button secondary report-starter-button" onClick={applyReportStarters}>Fill blanks from activity</button>
            </div>
            <label><span>Report title</span><input type="text" value={report.title || ""} onChange={(event) => actions.updateReport({ title: event.target.value })} placeholder={`${targetName} Penetration Test Report`} /></label>
            <label>
              <span>Executive summary</span>
              <textarea rows="6" value={report.executiveSummary || ""} onChange={(event) => actions.updateReport({ executiveSummary: event.target.value })} placeholder="For a non-technical reader: what access was achieved, why it matters to the organization, and what should be fixed first?" />
              <small className="field-hint">Write for a manager. Avoid commands, tool names, ports, acronyms, and a chronological play-by-play. Blank lines start new paragraphs.</small>
            </label>
            <label><span>Scope</span><textarea rows="3" value={report.scope || ""} onChange={(event) => actions.updateReport({ scope: event.target.value })} placeholder="Target IP, hostname, domain, and any scope limitations." /></label>
            <label><span>Recommendations</span><textarea rows="5" value={report.recommendations || ""} onChange={(event) => actions.updateReport({ recommendations: event.target.value })} placeholder={"1. Fix for the initial foothold\n2. Fix for the privilege escalation"} /></label>
            <div className="exam-proof-confirmations">
              <div><p className="eyebrow">Exam safeguard</p><h3>Proof confirmations</h3></div>
              <label><input type="checkbox" checked={Boolean(report.proofVerified)} onChange={(event) => actions.updateReport({ proofVerified: event.target.checked })} /><span>I verified the screenshot shows an interactive shell reading the proof from its original location, together with the target IP and identity.</span></label>
              <label><input type="checkbox" checked={Boolean(report.proofSubmitted)} onChange={(event) => actions.updateReport({ proofSubmitted: event.target.checked })} /><span>I submitted the proof value in the exam control panel before the exam ended.</span></label>
              <p>This app’s starter text is generated locally with fixed rules. Do not use ChatGPT, Codex, or another AI assistant during the exam or report-writing period. Recheck the current OffSec exam guide before your attempt.</p>
            </div>
          </section>

          <section className="report-editor report-markdown-editor" aria-labelledby="markdown-report-title" aria-busy={markdownLoading || ["reset-markdown", "markdown-pdf"].includes(busyAction)}>
            <div className="markdown-editor-head">
              <div>
                <p className="eyebrow">Editable deliverable</p>
                <h2 id="markdown-report-title">Markdown report</h2>
              </div>
              <span className={`markdown-status ${markdownLoading ? "is-loading" : markdownGenerationError ? "is-error" : markdownSourceChanged ? "is-stale" : markdownDirty ? "is-edited" : "is-generated"}`} role="status" aria-live="polite">{markdownStatus}</span>
            </div>
            <p id="markdown-report-help" className="field-hint">
              This deterministic draft is saved only in this target's local workspace. Edit it directly, download it, or render it with the same private report styling. Evidence changes do not overwrite your edits. Only embedded Fieldnotes evidence references can render images; external URLs and filesystem paths are rejected.
            </p>
            {!markdownLoading && !markdownGenerationError && markdownSourceChanged && <p className="markdown-source-warning" role="status">The target's reviewed activity changed after this draft was created. Reset Markdown to rebuild it, or keep editing this version.</p>}
            <label htmlFor="report-markdown"><span>Editable report Markdown</span></label>
            <textarea
              id="report-markdown"
              className="markdown-report-textarea"
              rows="32"
              value={markdown}
              aria-describedby="markdown-report-help markdown-report-security"
              disabled={markdownLoading}
              spellCheck="false"
              onChange={(event) => updateMarkdown(event.target.value)}
            />
            <div className="markdown-report-actions" role="group" aria-label="Markdown report actions">
              <button type="button" className="button secondary" onClick={downloadMarkdown} disabled={busy || markdownLoading || Boolean(markdownGenerationError) || !markdown.trim()}>Download Markdown</button>
              <button type="button" className="button secondary" onClick={resetMarkdown} disabled={busy || markdownLoading || Boolean(markdownGenerationError) || !hasMarkdownDraft}>{busyAction === "reset-markdown" ? "Resetting…" : "Reset to generated Markdown"}</button>
              <button type="button" className="button" onClick={generateMarkdownPdf} disabled={busy || markdownLoading || Boolean(markdownGenerationError) || !markdown.trim()}>{busyAction === "markdown-pdf" ? "Generating styled PDF…" : "Generate styled PDF from Markdown"}</button>
            </div>
            <p id="markdown-report-security" className="report-security-note markdown-security-note">Markdown and both PDF formats may contain credentials, hashes, proof values, and embedded evidence. Protect every exported copy like exam evidence.</p>
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
          <button type="button" className="button report-generate" onClick={generateDirectPdf} disabled={busy}>{busyAction === "direct-pdf" ? "Generating direct PDF…" : "Generate direct PDF"}</button>
          <p className="report-submission-note">This is a single-target working report, not a complete submission archive. Before submission, assemble every required target into one reviewed PDF and follow the current OffSec filename, 7z, size, and hash-verification requirements.</p>
          <PdfMachineImporter compact />
          <p className="report-security-note">Direct PDF, styled Markdown PDF, Markdown, and embedded JSON can contain secrets in plain text. Protect them like exam evidence.</p>
          <Link className="backup-link" to="/backup">JSON backup and reset tools</Link>
        </aside>
      </div>
    </main>
  );
}

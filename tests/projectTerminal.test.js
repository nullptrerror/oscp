import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readOptional = (file) => fs.existsSync(path.join(root, file)) ? read(file) : "";
const runtimeFiles = ["src", "server"].flatMap((directory) => fs.readdirSync(path.join(root, directory), { recursive: true })
  .filter((entry) => /\.(?:js|jsx|mjs)$/u.test(entry))
  .map((entry) => path.join(root, directory, entry))
  .filter((entry) => fs.statSync(entry).isFile()));
const runtimeSource = runtimeFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

test("the default Vite development command includes the embedded localhost runner", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts.dev, /\bvite\b/u);
  assert.match(pkg.scripts.dev, /--mode\s+runner\b/u, "npm run dev must enable the embedded PTY runner");
  assert.match(pkg.scripts.dev, /--host\s+127\.0\.0\.1\b/u, "the default runner must remain loopback-only");
  assert.match(pkg.scripts["dev:static"] || "", /\bvite\b/u, "review-only static mode must be explicit rather than the default");
});

test("runtime code never launches a desktop terminal or browser popup", () => {
  assert.doesNotMatch(runtimeSource, /\bwindow\.open\s*\(/u);
  assert.doesNotMatch(runtimeSource, /\b(?:x-terminal-emulator|gnome-terminal|xfce4-terminal|mate-terminal|konsole|alacritty|kitty)\b/iu);
  assert.doesNotMatch(runtimeSource, /\b(?:spawn|exec)(?:Sync)?\s*\([^\n]*["'](?:open|xdg-open)["']/iu);
});

test("the UI directs execution into Fieldnotes instead of an external shell", () => {
  const operatorUi = [
    "src/components/CommandBlock.jsx",
    "src/components/CommandResultPanel.jsx",
    "src/pages/ChecklistPage.jsx",
  ].map(read).join("\n");

  assert.doesNotMatch(operatorUi, /\brun (?:the command )?externally\b/iu);
  assert.doesNotMatch(operatorUi, /copy (?:it|this exact step) into (?:the )?(?:correct|confirmed)[^\n]*(?:shell|terminal)/iu);
  assert.doesNotMatch(operatorUi, /Kali PTY will not launch/iu);
});

test("the embedded terminal workspace is mounted above route content", () => {
  const app = read("src/App.jsx");
  const context = readOptional("src/context/TerminalWorkspaceContext.jsx");
  const dock = readOptional("src/components/TerminalDock.jsx");

  assert.match(context, /export function TerminalWorkspaceProvider\b/u);
  assert.match(context, /export function useTerminalWorkspace\b/u);
  assert.match(dock, /(?:export default function|function) TerminalDock\b/u);
  assert.match(app, /<TerminalWorkspaceProvider>[\s\S]*<AppRoutes\s*\/>[\s\S]*<\/TerminalWorkspaceProvider>/u);
  const dockIndex = app.indexOf("<TerminalDock");
  const routesStart = app.indexOf("<Routes>");
  const routesEnd = app.indexOf("</Routes>");
  assert.ok(dockIndex >= 0 && (dockIndex < routesStart || dockIndex > routesEnd), "the dock must sit outside Routes and remain mounted while route content changes");
});

test("non-LHOST commands route through a compatible selected in-app session", () => {
  const block = read("src/components/CommandBlock.jsx");
  const results = read("src/components/CommandResultPanel.jsx");
  const combined = `${block}\n${results}`;

  assert.doesNotMatch(block, /localRunnerAllowed=\{command\.runsOn === ["']lhost["'] && !command\.terminal\}/u);
  assert.match(combined, /useTerminalWorkspace/u);
  assert.match(combined, /(?:ranked|compatible)Sessions/iu);
  assert.match(combined, /stage(?:Command|Step)/u, "target and console commands must be staged for review, not sent automatically");
});

test("terminal execution remains operator initiated and never chains the next command", () => {
  assert.doesNotMatch(runtimeSource, /\b(?:runNext|executeChain|autoRun|autoExecute|autoExploit|submitProof)\b/iu);

  const dock = readOptional("src/components/TerminalDock.jsx");
  assert.match(dock, /(?:pending|staged)[A-Za-z]*(?:Command|Step)|(?:Command|Step)[A-Za-z]*(?:pending|staged)/iu);
  assert.match(dock, /["']Run reviewed command["']/u, "a staged command needs a second explicit operator action");
  assert.match(dock, /Save output snapshot/u);
  assert.match(dock, /(?:Mark visible prompt ready|Save step & reuse visible prompt)/u, "saving evidence must not silently declare a long-running process ready for another command");
});

test("LHOST cards can reuse a uniquely suggested ready tab without automatic execution", () => {
  const results = read("src/components/CommandResultPanel.jsx");
  const dock = read("src/components/TerminalDock.jsx");
  const context = read("src/context/TerminalWorkspaceContext.jsx");
  const routing = read("src/lib/terminalWorkspace.js");
  assert.match(results, /Open new terminal tab/u);
  assert.match(results, /Stage in existing tab/u);
  assert.match(results, /terminalWorkspace\.suggestedSession/u);
  assert.match(results, /staging and execution remain separate operator actions/u);
  assert.match(results, /machine transcript · opened at/u, "machine-scoped routes must not present their launch endpoint as the current scope");
  assert.match(dock, /machine transcript scope · opened at/u);
  assert.match(dock, /Local PTY workspace/u, "the local evidence path must not be presented as an unknown remote shell cwd");
  assert.match(context, /readyAt:\s*new Date\(\)\.toISOString\(\)/u);
  assert.match(routing, /session\.promptReady === true/u);
  assert.doesNotMatch(results, /useEffect\([^)]*stageCommand/isu);
});

test("the transcript shell has one scoped role and cannot double-write its journey log", () => {
  const checklist = read("src/data/checklist.js");
  const runner = read("server/runner.mjs");
  assert.match(checklist, /label:\s*"Start command log"[\s\S]{0,700}sessionRole:\s*"machine-log"[\s\S]{0,500}terminalBehavior:\s*"interactive-shell"/u);
  assert.match(checklist, /label:\s*"Stop terminal log"[\s\S]{0,700}requiresExistingSession:\s*true/u);
  assert.match(runner, /transcriptShellJourneyPath/u);
  assert.match(runner, /journeyLog:\s*null,\s*childOwned:\s*true/u);
});

test("saved runs retain their launch context even if a reusable tab is relabeled later", () => {
  const context = read("src/context/TerminalWorkspaceContext.jsx");
  const results = read("src/components/CommandResultPanel.jsx");
  const report = read("src/lib/pdfReport.js");
  assert.match(context, /runsOn:\s*step\.runsOn/u);
  assert.match(context, /terminalContext:\s*step\.terminalContext\s*\|\|\s*session\.context/u);
  assert.match(context, /terminalRole:\s*step\.sessionRole\s*\|\|\s*session\.sessionRole/u);
  assert.match(context, /terminalCwd:\s*step\.cwd\s*\|\|\s*session\.cwd/u);
  assert.match(results, /<EvidenceList[^>]+resultCategory=\{resultCategory\}/u, "saved-run controls must retain the command's semantic activity label");
  assert.match(report, /formatCommandExecutionContext\(command\)/u);
});

test("result controls classify exact saved runs and new evidence reopens that run for review", () => {
  const checklist = read("src/components/ChecklistItem.jsx");
  const evidence = read("src/components/EvidenceList.jsx");
  const context = read("src/context/WorkspaceContext.jsx");
  assert.match(checklist, /getCommandRunResultStateValue/u);
  assert.match(checklist, /resultReference=\{resultReference\}/u);
  assert.match(evidence, /setCommandResultState\(itemId, entry\.commandKey, event\.target\.value, resultReference\)/u);
  assert.match(context, /commandResultStatesAfterEvidence/u);
});

test("ambiguous and interrupt routes require an explicit terminal choice", () => {
  const results = read("src/components/CommandResultPanel.jsx");
  assert.match(results, /requiresExplicitSession/u);
  assert.match(results, /compatible\.length\s*>\s*1/u);
  assert.match(results, /isInterruptInstruction\(commandText\)/u);
  assert.match(results, /Choose the exact session/u);
});

test("terminal routing and destructive endpoint actions preserve endpoint ownership", () => {
  const context = read("src/context/TerminalWorkspaceContext.jsx");
  const routing = read("src/lib/terminalWorkspace.js");
  const results = read("src/components/CommandResultPanel.jsx");
  const targets = read("src/pages/TargetsPage.jsx");
  assert.match(context, /endpointId:\s*request\.endpointId/u);
  assert.match(context, /hasSessionsForEndpoint/u);
  assert.match(routing, /session\.endpointId\s*!==\s*request\.endpointId/u);
  assert.match(routing, /session\.address\s*!==\s*request\.address/u);
  assert.match(results, /session\.address/u);
  assert.match(targets, /hasEndpointSessions/u);
});

test("workspace replacement and machine removal are blocked while terminal tabs exist", () => {
  const targets = read("src/pages/TargetsPage.jsx");
  const backup = read("src/pages/BackupPage.jsx");
  assert.match(targets, /hasSessionsForTarget/u);
  assert.match(targets, /Stop and close every embedded terminal tab/u);
  assert.match(backup, /terminalWorkspace\.sessions\.length\s*>\s*0/u);
  assert.match(backup, /Stop and close every embedded terminal tab/u);
});

test("machine creation and editing expose one safe optional folder slug", () => {
  const targets = read("src/pages/TargetsPage.jsx");
  const context = read("src/context/WorkspaceContext.jsx");
  assert.match(targets, /Folder slug \(optional\)/u);
  assert.match(targets, /pattern=\{FOLDER_SLUG_PATTERN_SOURCE\}/u);
  assert.match(targets, /actions\.addTarget\(\{[^\n]+slug:\s*requestedSlug\s*\|\|\s*undefined/u);
  assert.match(targets, /actions\.updateTarget\(machine\.id,\s*\{\s*slug:\s*requestedSlug\s*\}\)/u);
  assert.match(context, /targetSlug:\s*safePatch\.slug/u);
});

test("direct and editable Markdown reports remain target-scoped Vite actions", () => {
  const reportPage = read("src/pages/ReportPage.jsx");
  const styles = read("src/styles.css");

  assert.match(reportPage, /workspace\.reports\[getActiveScope\(workspace\)\]/u, "Markdown drafts must remain scoped to the selected target report");
  assert.match(reportPage, /import\(["']\.\.\/lib\/pdfReport["']\)/u);
  assert.match(reportPage, /downloadReportPdf\(workspace, workspace\.activeTargetId\)/u);
  assert.match(reportPage, /onClick=\{generateDirectPdf\}/u);
  assert.match(reportPage, /["']Generate direct PDF["']/u);

  for (const reportApi of ["generateReportMarkdown", "reportMarkdownFingerprint", "markdownReportFilename", "REPORT_MARKDOWN_VERSION"]) {
    assert.match(reportPage, new RegExp(`\\b${reportApi}\\b`, "u"));
  }
  assert.match(reportPage, /typeof report\.markdownDraft === ["']string["']/u, "null or absent drafts must resolve to fresh generated Markdown");
  assert.match(reportPage, /hasMarkdownDraft \? report\.markdownDraft : generatedMarkdown/u);
  assert.match(reportPage, /markdownDraft:\s*value[\s\S]{0,260}markdownSourceFingerprint:[\s\S]{0,260}markdownUpdatedAt:\s*new Date\(\)\.toISOString\(\)[\s\S]{0,160}markdownVersion:\s*REPORT_MARKDOWN_VERSION/u);
  assert.match(reportPage, /markdownDirty && !window\.confirm/u, "reset should confirm only when generated text would replace edits");
  assert.match(reportPage, /generatedMarkdownSource\.targetKey === markdownTargetKey/u, "generated source from the previous target must never become the active export");
  assert.match(reportPage, /await generateReportMarkdown\(workspace, targetId\)/u);
  assert.match(reportPage, /actions\.updateTargetReport\(targetId, resetPatch\)/u, "an in-flight reset must clear only the target that initiated it");
  assert.match(reportPage, /id="report-target"[^>]+disabled=\{busy \|\| markdownLoading\}/u);
  assert.match(reportPage, /markdownDraft:\s*null[\s\S]{0,160}markdownSourceFingerprint:\s*["']["'][\s\S]{0,160}markdownUpdatedAt:\s*["']["']/u);
  assert.match(reportPage, /downloadText\(markdown, markdownReportFilename\(targetName\)\)/u, "the download must use the effective edited-or-generated text");

  assert.match(reportPage, /import\(["']\.\.\/lib\/markdownPdf["']\)/u, "edited Markdown rendering must stay in its dedicated lazy-loaded PDF module");
  assert.match(reportPage, /downloadMarkdownReportPdf\(workspace, workspace\.activeTargetId, markdown\)/u);
  for (const label of ["Download Markdown", "Reset to generated Markdown", "Generate styled PDF from Markdown"]) {
    assert.match(reportPage, new RegExp(label, "u"));
  }
  for (const status of ["Generated", "Edited", "Source changed"]) assert.match(reportPage, new RegExp(status, "u"));
  assert.match(reportPage, /rows=["']32["']/u);
  assert.match(reportPage, /aria-describedby=["']markdown-report-help markdown-report-security["']/u);
  assert.match(reportPage, /external URLs and filesystem paths are rejected/u);
  assert.match(reportPage, /may contain credentials, hashes, proof values/u);
  assert.match(styles, /\.markdown-report-textarea\s*\{[^}]*resize:\s*vertical[^}]*white-space:\s*pre/isu);
  assert.match(styles, /\.markdown-report-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/isu);
  assert.match(styles, /\.markdown-report-actions\s*\{\s*grid-template-columns:\s*1fr/isu, "Markdown actions must stack on the existing responsive breakpoint");
});

test("the terminal dock remains contained on short and narrow viewports", () => {
  const styles = read("src/styles.css");
  assert.match(styles, /\.terminal-workspace\s*\{[^}]*100dvh[^}]*display:\s*flex[^}]*overflow:\s*hidden/isu);
  assert.match(styles, /\.terminal-workspace-body\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden auto/isu);
  assert.match(styles, /\.terminal-screens\s*\{[^}]*min-height:[^}]*flex:\s*1 1[^}]*overflow:\s*hidden/isu);
  assert.match(styles, /\.terminal-workspace-screen \.xterm-host\s*\{[^}]*height:\s*100%/isu);
  assert.match(styles, /\.terminal-proof-alert code\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/isu);
  assert.match(styles, /@media \(max-height:\s*520px\)/u);
});

test("terminal-only screenshots are explicit, active-session scoped, and stay local", () => {
  const dock = read("src/components/TerminalDock.jsx");
  const dialog = read("src/components/TerminalCaptureDialog.jsx");
  const terminal = read("src/components/CommandTerminal.jsx");
  assert.match(dock, /onClick=\{openCapture\}>Capture terminal</u);
  assert.match(dock, /terminalRefs\.current\.get\(active\.id\)/u);
  assert.match(terminal, /terminal\.buffer\.active/u);
  assert.match(terminal, /lines\.push\(terminalStyledRow\(terminal, buffer, index\)\)/u);
  assert.doesNotMatch(dialog, /terminalHandle|styledRows/u, "rendering must use the same frozen rows that were previewed and checked");
  for (const label of ["Automatic proof context", "Current visible terminal", "Last N terminal rows", "Entire terminal scrollback"]) {
    assert.match(dialog, new RegExp(label, "u"));
  }
  assert.match(dialog, /Download \$\{plan\.pages\?\.length/u);
  assert.match(dialog, /Add as .* report proof/u);
  assert.doesNotMatch(`${dock}\n${dialog}\n${terminal}`, /getDisplayMedia|window\.open|https?:\/\//u);
  assert.doesNotMatch(dock, /terminalProof[\s\S]{0,300}openCapture/u);
});

test("the terminal capture dialog contains keyboard focus and restores it on close", () => {
  const dialog = read("src/components/TerminalCaptureDialog.jsx");
  assert.match(dialog, /aria-modal="true"/u);
  assert.match(dialog, /event\.key === "Escape"/u);
  assert.match(dialog, /event\.key !== "Tab"/u);
  assert.match(dialog, /document\.addEventListener\("keydown", handleKeyDown\)/u);
  assert.match(dialog, /previousFocus instanceof HTMLElement[^\n]+previousFocus\.focus\(\)/u);
});

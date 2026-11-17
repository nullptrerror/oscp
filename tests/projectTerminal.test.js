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
  assert.match(combined, /compatibleSession/iu);
  assert.match(combined, /stage(?:Command|Step)/u, "target and console commands must be staged for review, not sent automatically");
});

test("terminal execution remains operator initiated and never chains the next command", () => {
  assert.doesNotMatch(runtimeSource, /\b(?:runNext|executeChain|autoRun|autoExecute|autoExploit|submitProof)\b/iu);

  const dock = readOptional("src/components/TerminalDock.jsx");
  assert.match(dock, /(?:pending|staged)[A-Za-z]*(?:Command|Step)|(?:Command|Step)[A-Za-z]*(?:pending|staged)/iu);
  assert.match(dock, /["']Run reviewed command["']/u, "a staged command needs a second explicit operator action");
  assert.match(dock, /Save output snapshot/u);
  assert.match(dock, /Mark prompt ready/u, "saving evidence must not silently declare a long-running process ready for another command");
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

test("reports are still generated and downloaded by the Vite application", () => {
  const reportPage = read("src/pages/ReportPage.jsx");
  assert.match(reportPage, /import\(["']\.\.\/lib\/pdfReport["']\)/u);
  assert.match(reportPage, /downloadReportPdf\(workspace, workspace\.activeTargetId\)/u);
  assert.match(reportPage, /onClick=\{generate\}/u);
  assert.match(reportPage, /["']Generate target PDF["']/u);
});

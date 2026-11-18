import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  buildTargetReportData,
  extractWorkspaceFromPdf,
  deriveReportAccountStatuses,
  formatCommandPromptLines,
  formatCommandExecutionContext,
  formatKaliPromptLines,
  generateReportPdf,
  inspectWorkspacePdf,
  normalizeTerminalDisplayLines,
  orderAttackPathEvents,
  orderCommandRuns,
  resultBackedCommandRuns,
  selectOutputExcerpt,
  terminalFontSize,
} from "../src/lib/pdfReport.js";
import { createDefaultWorkspace, normalizeWorkspace, RESULT_STATES, WORKSPACE_VERSION } from "../src/lib/workspace.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const fontFile = (name) => readFile(new URL(`../node_modules/dejavu-fonts-ttf/ttf/${name}.ttf`, import.meta.url));
const loadFonts = async () => ({
  sans: await fontFile("DejaVuSans"),
  sansBold: await fontFile("DejaVuSans-Bold"),
  mono: await fontFile("DejaVuSansMono"),
  monoBold: await fontFile("DejaVuSansMono-Bold"),
});

const embeddedFontNames = (pdf) => {
  const names = new Set();
  for (const page of pdf.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) continue;
    for (const key of fonts.keys()) {
      const font = fonts.lookup(key, PDFDict);
      const baseFont = font.lookupMaybe(PDFName.of("BaseFont"), PDFName);
      if (baseFont) names.add(baseFont.toString());
    }
  }
  return [...names];
};

const sampleWorkspace = () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-active";
  workspace.targets.push({ id: "target-active", name: "active", host: "10.129.80.195", domain: "active.htb" });
  workspace.completed["target-active::recon-tcp-detail"] = true;
  workspace.notes["target-active::recon-tcp-detail"] = "Found SMB and WinRM.";
  workspace.evidence["target-active::recon-tcp-detail"] = [{ id: "ev-1", label: "nmap.txt", content: "445/tcp open microsoft-ds", createdAt: new Date().toISOString() }];
  workspace.commandHistory.push({ id: "command-1", targetId: "target-active", itemId: "recon-tcp-detail", label: "Focused scan", command: "nmap -sCV 10.129.80.195", address: "10.129.80.195", copiedAt: new Date().toISOString() });
  return workspace;
};

test("generated target PDF contains pages and restores the embedded workspace", async () => {
  const workspace = sampleWorkspace();
  workspace.reports["target-active"] = { operatorName: "Kali Operator", candidateId: "LAB-001", profileImage: PIXEL };

  const bytes = await generateReportPdf(workspace, "target-active");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 4);
  assert.equal(pdf.getAuthor(), "Kali Operator");

  const restored = await extractWorkspaceFromPdf(bytes);
  assert.equal(restored.targets[0].name, "active");
  assert.equal(restored.notes["target-active::recon-tcp-detail"], "Found SMB and WinRM.");
  assert.equal(restored.commandHistory[0].command, "nmap -sCV 10.129.80.195");
});

test("direct Node generation embeds the bundled Unicode font for Kali prompt glyphs", async () => {
  const pdf = await PDFDocument.load(await generateReportPdf(sampleWorkspace(), "target-active"));
  assert.ok(
    embeddedFontNames(pdf).some((name) => name.startsWith("/DejaVuSansMono")),
    "direct generation should not replace Kali box-drawing glyphs with question marks",
  );
  const prompt = formatKaliPromptLines("nmap 10.129.80.195", "~/oscp/active", true)
    .map((line) => line.map((segment) => segment.text).join(""))
    .join("\n");
  assert.match(prompt, /^┌──\(kali㉿kali\)-\[~\/oscp\/active\]\n└─\$ nmap/u);
  assert.doesNotMatch(prompt, /\?{2,}/u);
});

test("remote commands render an honest compact context prompt instead of a synthetic Kali prompt", () => {
  const lines = formatCommandPromptLines({
    command: "cmd.exe /d /c whoami",
    runsOn: "foothold-windows",
    terminalContext: "foothold-windows",
  }, "~/oscp/forest", true).map((line) => line.map((segment) => segment.text).join(""));

  assert.deepEqual(lines, ["[foothold-windows]", "PS> cmd.exe /d /c whoami"]);
  assert.doesNotMatch(lines.join("\n"), /kali/u);
});

test("a twelve-command machine report remains concise without dropping full evidence attachments", async () => {
  const workspace = sampleWorkspace();
  const scope = "target-active::recon-tcp-detail";
  workspace.notes[scope] = "Enumeration established the target's exposed service path.";
  workspace.nextSteps[scope] = "The confirmed result justified the next bounded validation.";
  workspace.evidence[scope] = [];
  workspace.commandHistory = [];
  for (let index = 0; index < 12; index += 1) {
    const id = `command-${index + 1}`;
    workspace.commandHistory.push({
      id,
      targetId: "target-active",
      itemId: "recon-tcp-detail",
      label: `Validation step ${index + 1}`,
      command: `tool --step ${index + 1} 10.129.80.195`,
      address: "10.129.80.195",
      source: "local runner",
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      established: `Step ${index + 1} established one bounded fact.`,
      nextAction: `Continue to validation step ${index + 2}.`,
    });
    workspace.evidence[scope].push({
      id: `evidence-${index + 1}`,
      commandRunId: id,
      label: `step-${index + 1}.txt`,
      content: Array.from({ length: 20 }, (_, line) => `line ${line + 1} result`).join("\n"),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    });
  }

  const bytes = await generateReportPdf(workspace, "target-active");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() <= 15, `expected at most 15 pages, received ${pdf.getPageCount()}`);
  const restored = await extractWorkspaceFromPdf(bytes);
  assert.equal(restored.commandHistory.length, 12);
  assert.equal(restored.evidence[scope].length, 12);
});

test("PDF command runs retain chronological order when an earlier command is run again", () => {
  const commands = [
    { id: "first-run", command: "nmap", startedAt: "2026-01-01T10:00:00.000Z" },
    { id: "second-run", command: "nxc", startedAt: "2026-01-01T10:01:00.000Z" },
    { id: "rerun-first", command: "nmap", startedAt: "2026-01-01T10:02:00.000Z" },
  ];

  assert.deepEqual(orderCommandRuns(commands).map((command) => command.id), ["first-run", "second-run", "rerun-first"]);
});

test("PDF report data preserves per-run outcomes and visible execution context across reruns", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "forest";
  workspace.targets = [{ id: "forest", name: "Forest", host: "10.0.0.1", endpoints: [{ id: "ep", address: "10.0.0.1" }] }];
  workspace.commandHistory = [
    {
      id: "failed-run",
      targetId: "forest",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
      runsOn: "lhost",
      terminalContext: "lhost",
      terminalRole: "machine-log",
      cwd: "/home/kali/oscp/forest",
    },
    {
      id: "confirmed-rerun",
      targetId: "forest",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
      runsOn: "lhost",
      terminalContext: "lhost",
      terminalRole: "machine-log",
      cwd: "/home/kali/oscp/forest",
    },
  ];
  workspace.evidence["forest::svc-smb"] = [
    { id: "failed-evidence", targetId: "forest", commandRunId: "failed-run", commandKey: "list-shares", content: "Connection refused" },
    { id: "confirmed-evidence", targetId: "forest", commandRunId: "confirmed-rerun", commandKey: "list-shares", content: "Sharename Public" },
  ];
  workspace.commandResultStates["forest::svc-smb::list-shares::run:failed-run"] = RESULT_STATES.FAILED;
  workspace.commandResultStates["forest::svc-smb::list-shares::run:confirmed-rerun"] = RESULT_STATES.CONFIRMED;

  const data = buildTargetReportData(workspace, "forest");

  assert.deepEqual(data.commandHistory.map((entry) => entry.commandResultState), [RESULT_STATES.FAILED, RESULT_STATES.CONFIRMED]);
  assert.equal(
    formatCommandExecutionContext(data.commandHistory[0]),
    "run on lhost · terminal lhost · role machine-log · PTY workspace ~/oscp/forest",
  );
  assert.equal(
    formatCommandExecutionContext({
      runsOn: "foothold-linux",
      terminalContext: "foothold-linux",
      terminalRole: "general",
      cwd: "/home/kali/oscp/forest",
    }),
    "run on foothold-linux · terminal foothold-linux · role general · PTY workspace ~/oscp/forest",
  );
});

test("PDF report data keeps a migrated legacy outcome on the pre-rerun command", () => {
  const workspace = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    activeTargetId: "forest",
    targets: [{ id: "forest", name: "Forest", host: "10.0.0.1", endpoints: [{ id: "ep", address: "10.0.0.1" }] }],
    commandHistory: [{
      id: "legacy-run",
      targetId: "forest",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
    }],
    evidence: {
      "forest::svc-smb": [{ id: "legacy-evidence", targetId: "forest", commandRunId: "legacy-run", commandKey: "list-shares", content: "Sharename Public" }],
    },
    commandResultStates: {
      "forest::svc-smb::list-shares": RESULT_STATES.CONFIRMED,
    },
  });
  workspace.commandHistory.push({
    id: "new-rerun",
    targetId: "forest",
    source: "local runner",
    itemId: "svc-smb",
    commandKey: "list-shares",
    label: "List shares",
    command: "smbclient -L //10.0.0.1 -N",
  });
  workspace.evidence["forest::svc-smb"].push({ id: "new-evidence", targetId: "forest", commandRunId: "new-rerun", commandKey: "list-shares", content: "Connection refused" });
  workspace.commandResultStates["forest::svc-smb::list-shares::run:new-rerun"] = RESULT_STATES.REVIEW;

  const data = buildTargetReportData(workspace, "forest");

  assert.deepEqual(data.commandHistory.map((entry) => entry.commandResultState), [RESULT_STATES.CONFIRMED, RESULT_STATES.REVIEW]);
});

test("report command runs exclude orphaned history after its saved result is removed", () => {
  const commands = [
    { id: "canonical", targetId: "forest", source: "local runner" },
    { id: "orphan", targetId: "forest", source: "local runner" },
  ];
  const items = [{
    id: "recon-tcp-all",
    evidence: [{ commandRunId: "canonical", targetId: "forest", content: "53/tcp open domain" }],
  }];

  assert.deepEqual(resultBackedCommandRuns(commands, items, "forest").map((command) => command.id), ["canonical"]);
});

test("report command runs remain linked while any substantive snapshot is retained", () => {
  const commands = [{ id: "scan", targetId: "forest", source: "local runner" }];
  const items = [{
    id: "recon-tcp-all",
    evidence: [
      { commandRunId: "scan", targetId: "forest", content: "[Fieldnotes] Process ended with exit code 0.", substantive: false },
      { commandRunId: "scan", targetId: "forest", content: "Nmap scan report for 10.129.95.210", substantive: true },
    ],
  }];

  assert.deepEqual(resultBackedCommandRuns(commands, items, "forest").map((command) => command.id), ["scan"]);
  assert.deepEqual(resultBackedCommandRuns(commands, [{ ...items[0], evidence: [items[0].evidence[0]] }], "forest"), []);
});

test("report command runs cannot be backed by evidence from another target", () => {
  const commands = [
    { id: "shared-id", targetId: "forest", source: "local runner" },
    { id: "other-run", targetId: "active", source: "local runner" },
  ];
  const items = [{
    id: "recon-tcp-all",
    evidence: [
      { commandRunId: "shared-id", targetId: "active", content: "foreign result" },
      { commandRunId: "other-run", targetId: "active", content: "active result" },
    ],
  }];

  assert.deepEqual(resultBackedCommandRuns(commands, items, "forest"), []);
  assert.deepEqual(resultBackedCommandRuns(commands, items, "active").map((command) => command.id), ["other-run"]);
});

test("report accounts become valid only from confirmed successful authentication evidence", () => {
  const accounts = [
    { id: "svc", domain: "htb.local", username: "svc-alfresco", status: "untested" },
    { id: "admin", domain: "htb.local", username: "Administrator", status: "untested" },
    { id: "locked", domain: "htb.local", username: "locked-user", status: "locked" },
  ];
  const commands = [
    { id: "svc-auth", label: "Validate WinRM authentication — htb.local\\svc-alfresco", commandResultState: "finding-confirmed" },
    { id: "admin-exit", label: "Validate SMB authentication — htb.local\\Administrator", commandResultState: "finding-confirmed" },
    { id: "locked-auth", label: "Validate SSH authentication — htb.local\\locked-user", commandResultState: "finding-confirmed" },
  ];
  const items = [{
    evidence: [
      { commandRunId: "svc-auth", content: "WINRM host [+] htb.local\\svc-alfresco:secret (Pwn3d!)" },
      { commandRunId: "admin-exit", content: "[Fieldnotes] Process ended with exit code 0.", substantive: false },
      { commandRunId: "locked-auth", content: "SSH host [+] htb.local\\locked-user:secret" },
    ],
  }];

  const derived = deriveReportAccountStatuses(accounts, commands, items);
  assert.equal(derived[0].status, "valid");
  assert.equal(derived[1].status, "untested", "exit zero is not authentication evidence");
  assert.equal(derived[2].status, "locked", "explicit operator status is preserved");
  assert.equal(accounts[0].status, "untested", "report derivation does not mutate the workspace");
});

test("authentication evidence cannot validate a different account or an unconfirmed run", () => {
  const accounts = [{ domain: "htb.local", username: "Administrator", status: "untested" }];
  const items = [{ evidence: [
    { commandRunId: "other", content: "SMB host [+] htb.local\\Administrator:hash (Pwn3d!)" },
    { commandRunId: "review", content: "SMB host [+] htb.local\\Administrator:hash (Pwn3d!)" },
  ] }];
  const commands = [
    { id: "other", label: "Validate SMB authentication — htb.local\\other-user", commandResultState: "finding-confirmed" },
    { id: "review", label: "Validate SMB authentication — htb.local\\Administrator", commandResultState: "needs-review" },
  ];

  assert.equal(deriveReportAccountStatuses(accounts, commands, items)[0].status, "untested");
});

test("explicit command sequence overrides artifact timestamps with stable fallback ordering", () => {
  const commands = [
    { id: "unsequenced-late", startedAt: "2026-01-01T10:05:00.000Z" },
    { id: "manifest-second", sequence: 2, recordedAt: "2026-01-01T10:00:00.000Z" },
    { id: "manifest-first", sequence: 1, recordedAt: "2026-01-01T10:04:00.000Z" },
    { id: "unsequenced-early", copiedAt: "2026-01-01T10:01:00.000Z" },
    { id: "invalid-sequence", sequence: Number.NaN, startedAt: "2026-01-01T10:03:00.000Z" },
  ];

  assert.deepEqual(orderCommandRuns(commands).map((command) => command.id), [
    "manifest-first",
    "manifest-second",
    "unsequenced-early",
    "invalid-sequence",
    "unsequenced-late",
  ]);
});

test("attack-path events keep commands contiguous and append evidence-only narratives", () => {
  const items = [
    { id: "recon", note: "Recon narrative", evidence: [] },
    { id: "smb", note: "SMB narrative", evidence: [] },
    { id: "manual", note: "Evidence-only narrative", evidence: [{ createdAt: "2026-01-01T10:00:30.000Z" }] },
    { id: "undated", note: "Undated narrative", evidence: [] },
  ];
  const commands = [
    { id: "recon-first", itemId: "recon", startedAt: "2026-01-01T10:00:00.000Z" },
    { id: "smb-middle", itemId: "smb", startedAt: "2026-01-01T10:01:00.000Z" },
    { id: "recon-rerun", itemId: "recon", startedAt: "2026-01-01T10:02:00.000Z" },
  ];

  const events = orderAttackPathEvents(items, commands);
  assert.deepEqual(events.map((event) => event.command?.id || event.item.id), [
    "recon-first",
    "smb-middle",
    "recon-rerun",
    "manual",
    "undated",
  ]);
  assert.deepEqual(events.map((event) => event.showItemContext), [true, true, false, true, true]);
});

test("console excerpts trim blanks and preserve a bounded head/tail balance", () => {
  const excerpt = selectOutputExcerpt([
    "",
    "banner",
    "command context",
    "early result",
    "middle one",
    "middle two",
    "final result",
    "completion signal",
    "   ",
  ], 6);

  assert.deepEqual(excerpt.lines, ["banner", "command context", "early result", "final result", "completion signal"]);
  assert.equal(excerpt.omitted, 2);
  assert.equal(excerpt.splitAt, 3);
});

test("terminal display cleanup removes echoed input and duplicate prompts while preserving proof context", () => {
  const command = "cmd.exe /d /c \"hostname & whoami & ipconfig\"";
  const prompt = "*Evil-WinRM* PS C:\\Users\\student\\Documents>";
  const lines = normalizeTerminalDisplayLines([
    [{ text: "┌──(kali㉿kali)-[~/oscp/forest]", style: {} }],
    [{ text: `${prompt} ${command}`, style: { fg: "#ff5f5f" } }],
    [],
    [{ text: "IPv4 Address. . . . . . . . . . . : 10.0.0.10", style: {} }],
    [{ text: "Proof path: C:\\Users\\student\\Desktop\\user.txt", style: {} }],
    [{ text: `${prompt} ${prompt}`, style: { fg: "#ff5f5f" } }],
  ], command);
  const text = lines.map((line) => line.map((segment) => segment.text).join(""));

  assert.deepEqual(text, [
    "IPv4 Address. . . . . . . . . . . : 10.0.0.10",
    "Proof path: C:\\Users\\student\\Desktop\\user.txt",
    prompt,
  ]);
});

test("terminal display cleanup drops a carriage-repaint command tail without hiding the result", () => {
  const command = "test 'creator' = 'creator' || { exit 1; }; net rpc user info 'temp-user' -S '10.0.0.10' -U 'LAB/operator%secret'";
  const lines = normalizeTerminalDisplayLines([
    [{ text: "1; }; net 'temp-user' -S '10.0.0.10' -U 'LAB/operator%secret'>", style: {} }],
    [{ text: "Failed to get groups for 'temp-user': no mapping", style: {} }],
  ], command).map((line) => line.map((segment) => segment.text).join(""));

  assert.deepEqual(lines, ["Failed to get groups for 'temp-user': no mapping"]);
});

test("terminal font sizing stays readable while fitting unusually long reviewed commands", () => {
  assert.equal(terminalFontSize([[{ text: "short result", style: {} }]]), 7.3);
  assert.equal(terminalFontSize([[{ text: "x".repeat(100), style: {} }]]), 6.9);
  assert.equal(terminalFontSize([[{ text: "x".repeat(150), style: {} }]]), 6.2);
});

test("PDF inspection reports older machines that did not store a lab style", async () => {
  const workspace = sampleWorkspace();
  delete workspace.targets[0].labType;
  const inspected = await inspectWorkspacePdf(await generateReportPdf(workspace, "target-active"));
  assert.deepEqual(inspected.missingLabStyleTargetIds, ["target-active"]);
  assert.equal(inspected.workspace.targets[0].labType, "oscp");
});

test("Unicode fonts render ANSI-colored output, emoji, and the workspace profile on every page", async () => {
  const workspace = sampleWorkspace();
  workspace.profile = { name: "Zoë Operator", osid: "OS-424242", github: "nullptrerror", avatar: PIXEL };
  workspace.evidence["target-active::svc-smb"] = [{
    id: "ev-2",
    label: "nxc.log",
    content: `\x1b[1;32m[+]\x1b[0m corp\\svc:Summer2026! \x1b[1;33m(Pwn3d!)\x1b[0m 🔥 ✓ ╔══╣ 中\n${"line\n".repeat(400)}`,
    createdAt: new Date().toISOString(),
  }];
  const rasterized = [];
  const rasterizeEmoji = async (emoji) => {
    rasterized.push(emoji);
    return Uint8Array.from(atob(PIXEL.split(",")[1]), (character) => character.charCodeAt(0));
  };

  const bytes = await generateReportPdf(workspace, "target-active", { fonts: await loadFonts(), rasterizeEmoji });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getAuthor(), "Zoë Operator");
  assert.ok(pdf.getPageCount() < 15, "long console output is excerpted instead of expanding the report indefinitely");
  assert.deepEqual(rasterized, ["🔥"]);
  assert.ok(pdf.catalog.get(PDFName.of("Outlines")), "PDF has bookmarks");
  const linkCount = pdf.getPages().reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);
  assert.ok(linkCount >= pdf.getPageCount(), "every header links the GitHub profile");

  const restored = await extractWorkspaceFromPdf(bytes);
  assert.equal(restored.profile.osid, "OS-424242");
});

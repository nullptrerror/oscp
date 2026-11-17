import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  extractWorkspaceFromPdf,
  formatKaliPromptLines,
  generateReportPdf,
  inspectWorkspacePdf,
  orderAttackPathEvents,
  orderCommandRuns,
  selectOutputExcerpt,
} from "../src/lib/pdfReport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

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

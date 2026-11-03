import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName } from "pdf-lib";
import { generateReportPdf, extractWorkspaceFromPdf, orderCommandRuns } from "../src/lib/pdfReport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const fontFile = (name) => readFile(new URL(`../node_modules/dejavu-fonts-ttf/ttf/${name}.ttf`, import.meta.url));
const loadFonts = async () => ({
  sans: await fontFile("DejaVuSans"),
  sansBold: await fontFile("DejaVuSans-Bold"),
  mono: await fontFile("DejaVuSansMono"),
  monoBold: await fontFile("DejaVuSansMono-Bold"),
});

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

test("PDF command runs retain chronological order when an earlier command is run again", () => {
  const commands = [
    { id: "first-run", command: "nmap", startedAt: "2026-01-01T10:00:00.000Z" },
    { id: "second-run", command: "nxc", startedAt: "2026-01-01T10:01:00.000Z" },
    { id: "rerun-first", command: "nmap", startedAt: "2026-01-01T10:02:00.000Z" },
  ];

  assert.deepEqual(orderCommandRuns(commands).map((command) => command.id), ["first-run", "second-run", "rerun-first"]);
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
  assert.deepEqual(rasterized, ["🔥"]);
  assert.ok(pdf.catalog.get(PDFName.of("Outlines")), "PDF has bookmarks");
  const linkCount = pdf.getPages().reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);
  assert.ok(linkCount >= pdf.getPageCount(), "every header links the GitHub profile");

  const restored = await extractWorkspaceFromPdf(bytes);
  assert.equal(restored.profile.osid, "OS-424242");
});

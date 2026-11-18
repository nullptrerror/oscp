import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
} from "pdf-lib";
import {
  generateMarkdownReportPdf,
  markdownPdfFilename,
} from "../src/lib/markdownPdf.js";
import { generateReportMarkdown } from "../src/lib/markdownReport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const sampleWorkspace = () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "forest";
  workspace.targets = [{
    id: "forest",
    name: "Forest",
    host: "10.129.95.210",
    domain: "htb.local",
    endpoints: [{ id: "forest-primary", address: "10.129.95.210", hostnames: ["forest.htb.local"] }],
  }];
  workspace.profile = { ...workspace.profile, name: "NullPtrError", osid: "OS-000000" };
  workspace.reports.forest = {
    title: "Forest Penetration Test Report",
    executiveSummary: "Administrative access was confirmed and documented.",
    scope: "- Target: Forest\n- Address: 10.129.95.210",
    recommendations: "1. Restrict delegated directory rights.\n2. Rotate affected credentials.",
  };
  workspace.completed["forest::recon-tcp-detail"] = true;
  workspace.notes["forest::recon-tcp-detail"] = "The directory service was reachable.";
  workspace.nextSteps["forest::recon-tcp-detail"] = "Continue with bounded service validation.";
  workspace.evidence["forest::recon-tcp-detail"] = [{
    id: "scan-output",
    targetId: "forest",
    commandRunId: "scan-command",
    label: "focused-scan.txt",
    filename: "focused-scan.txt",
    mimeType: "text/plain",
    content: "Nmap scan report for 10.129.95.210\n445/tcp open microsoft-ds",
    createdAt: "2026-11-17T22:00:00.000Z",
  }];
  workspace.commandHistory = [{
    id: "scan-command",
    targetId: "forest",
    itemId: "recon-tcp-detail",
    source: "local runner",
    label: "Focused TCP scan",
    command: "nmap -sCV 10.129.95.210",
    address: "10.129.95.210",
    runsOn: "lhost",
    terminalContext: "lhost",
    startedAt: "2026-11-17T21:59:00.000Z",
  }];
  workspace.completed["forest::proof-artifacts"] = true;
  workspace.evidence["forest::proof-artifacts"] = [{
    id: "user-proof",
    targetId: "forest",
    label: "User proof",
    filename: "user-proof.png",
    mimeType: "image/png",
    category: "user-flag",
    dataUrl: PIXEL,
    createdAt: "2026-11-17T23:00:00.000Z",
  }];
  return workspace;
};

const embeddedFiles = (pdf) => {
  const files = new Map();
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const entries = embedded?.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!entries) return files;
  for (let index = 0; index < entries.size(); index += 2) {
    const name = entries.lookup(index, PDFString, PDFHexString).decodeText();
    const specification = entries.lookup(index + 1, PDFDict);
    const streams = specification.lookup(PDFName.of("EF"), PDFDict);
    const stream = streams.lookup(PDFName.of("F"), PDFStream);
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
    files.set(name, bytes);
  }
  return files;
};

test("styled Markdown PDF renders edited source and embeds its private restore material", async () => {
  const workspace = sampleWorkspace();
  const generated = await generateReportMarkdown(workspace, "forest");
  const edited = generated.replace("## Executive Summary", "## Executive Summary\n\nReviewer-approved wording.");
  const result = await generateMarkdownReportPdf(workspace, "forest", edited, {
    generatedAt: new Date("2026-11-17T23:30:00.000Z"),
  });

  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getPageCount(), result.pages);
  assert.equal(pdf.getTitle(), "Forest Penetration Test Report");
  assert.equal(pdf.getAuthor(), "NullPtrError");
  assert.deepEqual(result.warnings, []);

  const files = embeddedFiles(pdf);
  assert.ok(files.has("fieldnotes-workspace.json"));
  assert.ok(files.has("Forest-report.md"));
  assert.ok([...files.keys()].some((name) => name.endsWith("focused-scan.txt")));
  assert.ok([...files.keys()].some((name) => name.endsWith("user-proof.png")));
  assert.equal(new TextDecoder().decode(files.get("Forest-report.md")), edited);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get("fieldnotes-workspace.json"))).activeTargetId, "forest");
});

test("styled Markdown PDF rejects external image references before rendering", async () => {
  const workspace = sampleWorkspace();
  const source = "<!-- fieldnotes:report:v1 -->\n# Report\n\n![remote](https://example.test/proof.png)\n";
  await assert.rejects(
    generateMarkdownReportPdf(workspace, "forest", source),
    /Remote or filesystem image references are not allowed/iu,
  );
});

test("styled Markdown PDF wraps very long code without clipping or failing", async () => {
  const workspace = sampleWorkspace();
  const longCommand = `cmd.exe /d /c \"${"hostname & whoami & ipconfig ".repeat(30)}\"`;
  const source = `<!-- fieldnotes:report:v1 -->\n# Long command report\n\n\`\`\`text\n${longCommand}\n\`\`\`\n`;
  const result = await generateMarkdownReportPdf(workspace, "forest", source);
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.ok(result.bytes.length > 1_000);
});

test("multi-page code blocks use the available page height without blank overflow pages", async () => {
  const workspace = sampleWorkspace();
  const rows = Array.from({ length: 110 }, (_, index) => `row ${String(index + 1).padStart(3, "0")} ${"bounded terminal evidence ".repeat(3)}`).join("\n");
  const source = `<!-- fieldnotes:report:v1 -->\n# Long evidence report\n\n\`\`\`text\n${rows}\n\`\`\`\n`;
  const result = await generateMarkdownReportPdf(workspace, "forest", source);
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() <= 3, `expected no more than three occupied pages, received ${pdf.getPageCount()}`);
});

test("standard-font fallback sanitizes tabs and control characters", async () => {
  const workspace = sampleWorkspace();
  workspace.profile.name = "Null\tPtr\u0007Error";
  workspace.profile.osid = "OS-000\t000";
  workspace.targets[0].name = "For\test";
  const source = "<!-- fieldnotes:report:v1 -->\n# Fallback\treport\n\nOne\ttab and one\u0007control byte.\n";
  const result = await generateMarkdownReportPdf(workspace, "forest", source, { fonts: {} });
  const pdf = await PDFDocument.load(result.bytes);
  assert.equal(pdf.getPageCount(), 1);
});

test("one malformed legacy evidence attachment does not discard the report", async () => {
  const workspace = sampleWorkspace();
  workspace.evidence["forest::recon-tcp-detail"].push({
    id: "legacy-broken-image",
    targetId: "forest",
    label: "legacy-broken-image.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,%%%",
  });
  const source = await generateReportMarkdown(workspace, "forest");
  const result = await generateMarkdownReportPdf(workspace, "forest", source);
  assert.match(result.warnings.join("\n"), /could not be decoded/iu);
  assert.ok((await PDFDocument.load(result.bytes)).getPageCount() >= 1);
});

test("styled Markdown PDF filenames are filesystem-safe", () => {
  assert.equal(markdownPdfFilename("Forest (DC) / résumé"), "Forest-DC-resume-markdown-report.pdf");
  assert.equal(markdownPdfFilename(""), "target-markdown-report.pdf");
});

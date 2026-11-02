import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateReportPdf, extractWorkspaceFromPdf } from "../src/lib/pdfReport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

test("generated target PDF contains pages and restores the embedded workspace", async () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-active";
  workspace.targets.push({ id: "target-active", name: "active", host: "10.129.80.195", domain: "active.htb" });
  workspace.completed["target-active::recon-tcp-detail"] = true;
  workspace.notes["target-active::recon-tcp-detail"] = "Found SMB and WinRM.";
  workspace.evidence["target-active::recon-tcp-detail"] = [{ id: "ev-1", label: "nmap.txt", content: "445/tcp open microsoft-ds", createdAt: new Date().toISOString() }];
  workspace.reports["target-active"] = {
    operatorName: "Kali Operator",
    candidateId: "LAB-001",
    profileImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  };

  const bytes = await generateReportPdf(workspace, "target-active");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 4);
  assert.equal(pdf.getAuthor(), "Kali Operator");

  const restored = await extractWorkspaceFromPdf(bytes);
  assert.equal(restored.targets[0].name, "active");
  assert.equal(restored.notes["target-active::recon-tcp-detail"], "Found SMB and WinRM.");
});

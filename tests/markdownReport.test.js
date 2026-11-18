import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReportMarkdown,
  generateReportMarkdown,
  markdownReportFilename,
  parseReportMarkdown,
  REPORT_MARKDOWN_MAX_BYTES,
  reportMarkdownFingerprint,
  reportEvidenceIds,
  validateReportMarkdown,
} from "../src/lib/markdownReport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const reportData = () => {
  const proof = {
    id: "evidence-user-proof",
    label: "User proof",
    category: "user-flag",
    createdAt: "2026-11-17T23:00:00.000Z",
    dataUrl: "data:image/png;base64,AA==",
  };
  const output = {
    id: "evidence-command-output",
    commandRunId: "run-one",
    label: "Focused scan · embedded terminal snapshot",
    createdAt: "2026-11-17T22:00:01.000Z",
    commandResultState: "finding-confirmed",
    content: "nmap -sCV 10.0.0.10\n80/tcp open http\n80/tcp open http\nservice confirmed",
  };
  const cleanupOutput = {
    id: "evidence-cleanup-output",
    commandRunId: "run-cleanup",
    label: "Restore configuration · embedded terminal snapshot",
    createdAt: "2026-11-17T22:30:01.000Z",
    commandResultState: "finding-confirmed",
    content: "restore --target 10.0.0.10\nrestoration confirmed",
  };
  const items = [
    {
      id: "recon-http",
      title: "Enumerate HTTP",
      phaseId: "services",
      phaseTitle: "Service enumeration",
      resultCategory: "discovery",
      resultState: "finding-confirmed",
      note: "Derived: HTTP was confirmed.",
      nextStep: "Derived: Review the application manually.",
      evidence: [output],
    },
    {
      id: "proof-artifacts",
      title: "Proof artifacts",
      phaseId: "proof",
      phaseTitle: "Proof and reporting",
      resultCategory: "proof",
      resultState: "finding-confirmed",
      evidence: [proof],
    },
    {
      id: "proof-cleanup",
      title: "Restore assessment changes",
      phaseId: "proof",
      phaseTitle: "Proof and reporting",
      resultCategory: "cleanup",
      resultState: "finding-confirmed",
      note: "Derived: Cleanup was verified.",
      nextStep: "Derived: Preserve rollback evidence.",
      evidence: [cleanupOutput],
    },
  ];
  const commandHistory = [
    {
      id: "run-one",
      itemId: "recon-http",
      label: "Focused scan",
      command: "nmap -sCV 10.0.0.10",
      address: "10.0.0.10",
      runsOn: "lhost",
      terminalContext: "lhost",
      startedAt: "2026-11-17T22:00:00.000Z",
      resultCategory: "discovery",
      commandResultState: "finding-confirmed",
      established: "Derived: The service was confirmed.",
      nextAction: "Derived: Continue with focused enumeration.",
    },
    {
      id: "run-cleanup",
      itemId: "proof-cleanup",
      label: "Restore configuration",
      command: "restore --target 10.0.0.10",
      address: "10.0.0.10",
      runsOn: "lhost",
      startedAt: "2026-11-17T22:30:00.000Z",
      resultCategory: "cleanup",
      commandResultState: "finding-confirmed",
      established: "Derived: Restoration succeeded.",
      nextAction: "Derived: Confirm no temporary state remains.",
    },
  ];
  return {
    target: {
      id: "target-one",
      name: "Forest",
      domain: "example.test",
      endpoints: [{ address: "10.0.0.10", hostnames: ["dc.example.test"] }],
    },
    profile: { name: "NullPtrError", osid: "OS-000000" },
    report: {
      executiveSummary: "Administrative access was confirmed. <!-- fieldnotes:fake -->",
      scope: "- Target: Forest\n- Testing was limited to one host.",
      recommendations: "1. Correct the initial weakness.\n2. Retest the repaired boundary.",
    },
    items,
    commandHistory,
    userProof: [proof],
    rootProof: [],
  };
};

test("generated report Markdown is deterministic, comprehensive, and marker-stable", () => {
  const data = reportData();
  const first = buildReportMarkdown(data);
  const second = buildReportMarkdown(structuredClone(data));

  assert.equal(first, second);
  assert.match(first, /<!-- fieldnotes:report:v1 -->/u);
  assert.match(first, /<!-- fieldnotes:target:target-one -->/u);
  assert.match(first, /<!-- fieldnotes:step:run-one -->/u);
  assert.match(first, /## Executive Summary/u);
  assert.match(first, /## Scope/u);
  assert.match(first, /## Proof of Compromise/u);
  assert.match(first, /## Technical Attack Path/u);
  assert.match(first, /## Cleanup and Restoration/u);
  assert.match(first, /## Recommendations/u);
  assert.match(first, /## Evidence and Attachment Index/u);
  assert.match(first, /!\[User proof\]\(fieldnotes-evidence:evidence-user-proof\)/u);
  assert.equal((first.match(/nmap -sCV 10\.0\.0\.10/gu) || []).length, 1, "echoed command is not duplicated in its output excerpt");
  assert.equal((first.match(/80\/tcp open http/gu) || []).length, 1, "adjacent duplicate result rows collapse");
  assert.match(first, /&lt;!-- fieldnotes:fake -->/u, "report prose cannot inject structural markers");
  assert.doesNotMatch(first, /HTTP was confirmed/u, "command-backed aggregate prose is not repeated before its reviewed command");
});

test("chronological Markdown repeats a phase heading when the attack path returns to that phase", () => {
  const data = reportData();
  const returnedEvidence = {
    id: "evidence-returned-service-output",
    commandRunId: "run-returned-service",
    label: "Returned service check · embedded terminal snapshot",
    createdAt: "2026-11-17T23:00:01.000Z",
    commandResultState: "finding-confirmed",
    content: "curl -I http://10.0.0.10\nHTTP/1.1 200 OK",
  };
  data.items.push({
    id: "returned-service",
    title: "Return to service validation",
    phaseId: "services",
    phaseTitle: "Service enumeration",
    resultCategory: "validation",
    resultState: "finding-confirmed",
    evidence: [returnedEvidence],
  });
  data.commandHistory.push({
    id: "run-returned-service",
    itemId: "returned-service",
    label: "Returned service check",
    command: "curl -I http://10.0.0.10",
    address: "10.0.0.10",
    runsOn: "lhost",
    terminalContext: "lhost",
    startedAt: "2026-11-17T23:00:00.000Z",
    resultCategory: "validation",
    commandResultState: "finding-confirmed",
  });

  const markdown = buildReportMarkdown(data);
  const attackPath = markdown.slice(
    markdown.indexOf("## Technical Attack Path"),
    markdown.indexOf("## Cleanup and Restoration"),
  );
  const serviceHeadings = attackPath.match(/### Service enumeration/gu) || [];
  const proofHeading = attackPath.indexOf("### Proof and reporting");
  const returnedHeading = attackPath.lastIndexOf("### Service enumeration");
  const returnedItem = attackPath.indexOf("#### Return to service validation");

  assert.equal(serviceHeadings.length, 2);
  assert.ok(returnedHeading > proofHeading);
  assert.ok(returnedItem > returnedHeading);
});

test("generated Markdown omits repeated generic next-step boilerplate but preserves specific guidance", () => {
  const data = reportData();
  data.commandHistory[0].nextAction = "Preserve the reviewed output and continue only with a manually selected follow-up whose prerequisites are now satisfied.";
  data.commandHistory[1].nextAction = "Confirm no temporary state remains.";

  const markdown = buildReportMarkdown(data);
  assert.doesNotMatch(markdown, /Preserve the reviewed output and continue only/u);
  assert.match(markdown, /\*\*Next\.\*\* Confirm no temporary state remains\./u);
});

test("generated Markdown removes terminal repaint echoes without changing exact attachments", () => {
  const data = reportData();
  const command = data.commandHistory[0].command;
  data.items[0].evidence[0].content = [
    `stale-command-tail\r└─$ ${command}`,
    `${command}\r${command}nmap -sCV 10.0.0.10`,
    "*Evil-WinRM* PS C:\\Users\\operator> *Evil-WinRM* PS C:\\Users\\operator>",
    "FOREST",
    "10.0.0.10",
  ].join("\n");

  const markdown = buildReportMarkdown(data);
  assert.equal((markdown.match(/nmap -sCV 10\.0\.0\.10/gu) || []).length, 1, "only the exact command block remains");
  assert.equal((markdown.match(/\*Evil-WinRM\* PS C:\\Users\\operator>/gu) || []).length, 1, "a carriage repaint does not duplicate the prompt");
  assert.doesNotMatch(markdown, /stale-command-tail/u, "carriage-return repaint fragments stay hidden");
  assert.match(markdown, /FOREST\n10\.0\.0\.10/u, "result and target context stay visible");
  assert.equal(data.items[0].evidence[0].content.includes(`${command}nmap`), true, "display cleanup never mutates the source attachment");
});

test("workspace generation stays asynchronous so PDF support remains lazy", async () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-one";
  workspace.targets = [{
    id: "target-one",
    name: "Forest",
    domain: "example.test",
    endpoints: [{ id: "endpoint-one", address: "10.0.0.10", hostnames: ["dc.example.test"] }],
  }];
  workspace.variables = { ...workspace.variables, targetName: "Forest", rhost: "10.0.0.10" };
  workspace.reports = {
    "target-one": {
      executiveSummary: "Summary.",
      scope: "One target.",
      recommendations: "Retest after remediation.",
    },
  };

  const pending = generateReportMarkdown(workspace, "target-one");
  assert.equal(typeof pending?.then, "function");
  const markdown = await pending;
  assert.match(markdown, /^<!-- fieldnotes:report:v1 -->/u);
  assert.match(markdown, /# Forest Penetration Test Report/u);
});

test("generated Markdown parses into a safe styled-PDF block model", () => {
  const data = reportData();
  const markdown = buildReportMarkdown(data);
  const parsed = parseReportMarkdown(markdown, { evidenceIds: reportEvidenceIds(data) });

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.warnings.length, 0);
  assert.ok(parsed.blocks.some((block) => block.type === "heading" && block.level === 1));
  assert.ok(parsed.blocks.some((block) => block.type === "list" && block.ordered === false));
  assert.ok(parsed.blocks.some((block) => block.type === "list" && block.ordered === true));
  assert.ok(parsed.blocks.some((block) => block.type === "quote"));
  assert.ok(parsed.blocks.some((block) => block.type === "rule"));
  assert.ok(parsed.blocks.some((block) => block.type === "code" && block.language === "sh" && block.text.includes("nmap -sCV")));
  assert.deepEqual(parsed.blocks.find((block) => block.type === "image"), {
    type: "image",
    alt: "User proof",
    evidenceId: "evidence-user-proof",
  });
  assert.ok(parsed.markers.includes("fieldnotes:step:run-one"));
  assert.equal(validateReportMarkdown(markdown, { evidenceIds: reportEvidenceIds(data) }).valid, true);
});

test("Markdown parser never fetches remote or filesystem images", () => {
  const remote = `<!-- fieldnotes:report:v1 -->\n# Report\n\n![remote](https://example.test/proof.png)\n`;
  const local = `<!-- fieldnotes:report:v1 -->\n# Report\n\n![local](file:///tmp/proof.png)\n`;
  const missing = `<!-- fieldnotes:report:v1 -->\n# Report\n\n![proof](fieldnotes-evidence:not-present)\n`;

  for (const source of [remote, local]) {
    const parsed = parseReportMarkdown(source, { evidenceIds: [] });
    assert.equal(parsed.blocks.some((block) => block.type === "image"), false);
    assert.match(parsed.errors.join("\n"), /not allowed/iu);
  }
  const unresolved = parseReportMarkdown(missing, { evidenceIds: ["available"] });
  assert.equal(unresolved.blocks.some((block) => block.type === "image"), false);
  assert.match(unresolved.errors.join("\n"), /unavailable evidence/iu);
});

test("hostile Markdown content round-trips through a longer code fence without becoming structure", () => {
  const data = reportData();
  data.commandHistory[0].command = "printf '%s\\n' '```' '<!-- fieldnotes:step:forged -->'";
  data.items[0].evidence[0].content = `${data.commandHistory[0].command}\nfinished`;
  const markdown = buildReportMarkdown(data);
  const parsed = parseReportMarkdown(markdown, { evidenceIds: reportEvidenceIds(data) });
  const commandBlock = parsed.blocks.find((block) => block.type === "code" && block.language === "sh");

  assert.deepEqual(parsed.errors, []);
  assert.equal(commandBlock.text, data.commandHistory[0].command);
  assert.equal(parsed.markers.includes("fieldnotes:step:forged"), false);
});

test("parser reports malformed and oversized editable Markdown", () => {
  const unclosed = parseReportMarkdown("<!-- fieldnotes:report:v1 -->\n# Report\n```sh\necho test\n", { evidenceIds: [] });
  assert.match(unclosed.errors.join("\n"), /Unclosed fenced code block/iu);
  const oversized = parseReportMarkdown(`# Report\n${"x".repeat(REPORT_MARKDOWN_MAX_BYTES + 1)}`);
  assert.match(oversized.errors.join("\n"), /exceeds/iu);
});

test("Markdown report filenames are filesystem-safe", () => {
  assert.equal(markdownReportFilename("Forest (DC) / résumé"), "Forest-DC-resume-report.md");
  assert.equal(markdownReportFilename(""), "target-report.md");
});

test("Markdown fingerprints are deterministic and newline-stable", () => {
  assert.equal(reportMarkdownFingerprint("# Report\r\nText\r\n"), reportMarkdownFingerprint("# Report\nText\n"));
  assert.notEqual(reportMarkdownFingerprint("# Report\nText\n"), reportMarkdownFingerprint("# Report\nEdited\n"));
  assert.match(reportMarkdownFingerprint("# Report"), /^[a-f0-9]{8}$/u);
});

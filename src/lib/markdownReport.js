import { resultCategoryLabel, resultStateLabel } from "./resultClassification.js";
import { stripAnsi, terminalLines } from "./terminalText.js";
import { normalizeTerminalDisplayLines } from "./reportTerminal.js";

export const REPORT_MARKDOWN_VERSION = 1;
export const REPORT_MARKDOWN_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_EVIDENCE_SCHEME = "fieldnotes-evidence:";

const MARKER_PREFIX = "fieldnotes:";
const GENERIC_NEXT_ACTION = "Preserve the reviewed output and continue only with a manually selected follow-up whose prerequisites are now satisfied.";
const MARKER = /^<!--\s*(fieldnotes:[a-z0-9._:/%-]+)\s*-->$/iu;
const EVIDENCE_IMAGE = /^!\[([^\]]*)\]\(fieldnotes-evidence:([a-z0-9._:-]+)\)$/iu;
const ANY_IMAGE = /!\[[^\]]*\]\(([^)]+)\)/u;

const normalizeNewlines = (value = "") => String(value ?? "").replace(/\r\n?/gu, "\n");
const plainText = (value = "") => normalizeNewlines(value).replace(/<!--\s*fieldnotes:/giu, "&lt;!-- fieldnotes:").trim();
const cleanAutomaticPrefix = (value = "") => plainText(value).replace(/^(?:Draft|Attempt|Result|Derived):\s*/iu, "");
const inline = (value = "") => plainText(value)
  .replace(/\\/gu, "\\\\")
  .replace(/([*_[\]`])/gu, "\\$1")
  .replace(/\n+/gu, " ");
const imageAlt = (value = "Evidence image") => plainText(value).replace(/[\\\[\]\r\n]+/gu, " ").trim() || "Evidence image";

const markerValue = (value = "entry") => encodeURIComponent(String(value || "entry").trim()).toLowerCase();

const marker = (kind, id = "") => `<!-- ${MARKER_PREFIX}${kind}${id ? `:${markerValue(id)}` : ""} -->`;

const longestFenceRun = (value, character) => Math.max(0, ...[...String(value).matchAll(new RegExp(`${character}+`, "gu"))].map((match) => match[0].length));
const fenced = (value = "", language = "text") => {
  const text = normalizeNewlines(value).replace(/\n+$/u, "");
  const length = Math.max(3, longestFenceRun(text, "`") + 1);
  const fence = "`".repeat(length);
  return `${fence}${language}\n${text}\n${fence}`;
};

const timestamp = (value) => {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const homeRelative = (path) => String(path || "").replace(/^\/home\/kali(?=\/|$)/u, "~").replace(/^\/root(?=\/|$)/u, "~");

const formatCommandExecutionContext = (command = {}) => [
  command.runsOn ? `run on ${command.runsOn}` : "",
  command.terminalContext ? `terminal ${command.terminalContext}` : "",
  command.terminalRole ? `role ${command.terminalRole}` : "",
  command.cwd ? `PTY workspace ${homeRelative(command.cwd)}` : "",
].filter(Boolean).join(" · ");

const orderCommandRuns = (commands = []) => commands
  .map((command, index) => {
    const time = Date.parse(command.startedAt || command.copiedAt || command.recordedAt || "");
    return {
      command,
      index,
      sequence: Number.isFinite(command.sequence) ? command.sequence : Number.POSITIVE_INFINITY,
      time: Number.isNaN(time) ? Number.POSITIVE_INFINITY : time,
    };
  })
  .sort((left, right) => left.sequence - right.sequence || left.time - right.time || left.index - right.index)
  .map(({ command }) => command);

const eventTimestamp = (value) => {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? null : time;
};

const orderAttackPathEvents = (items = [], commands = []) => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const orderedCommands = orderCommandRuns(commands);
  const commandItemIds = new Set(orderedCommands.map((command) => command.itemId));
  const events = orderedCommands.map((command) => ({ kind: "command", command, item: itemById.get(command.itemId) || null }));
  const itemOnly = items
    .filter((item) => !commandItemIds.has(item.id) && (item.note || item.nextStep || item.evidence?.length))
    .map((item, index) => ({
      kind: "item",
      item,
      index,
      time: Math.min(...(item.evidence || []).map((entry) => eventTimestamp(entry.createdAt)).filter((value) => value !== null)),
    }))
    .map((event) => ({ ...event, time: Number.isFinite(event.time) ? event.time : null }))
    .sort((left, right) => {
      if (left.time === null || right.time === null) return left.time === right.time ? left.index - right.index : left.time === null ? 1 : -1;
      return left.time - right.time || left.index - right.index;
    });
  events.push(...itemOnly);
  const seenItems = new Set();
  return events.map((event) => {
    const id = event.item?.id;
    const showItemContext = Boolean(id && !seenItems.has(id));
    if (showItemContext) seenItems.add(id);
    return { ...event, showItemContext };
  });
};

const outputLineText = (line) => (typeof line === "string" ? line : (line || []).map((segment) => segment.text || "").join(""));
const selectOutputExcerpt = (sourceLines = [], limit = 14) => {
  const lines = [...sourceLines];
  while (lines.length && !outputLineText(lines[0]).trim()) lines.shift();
  while (lines.length && !outputLineText(lines.at(-1)).trim()) lines.pop();
  if (lines.length <= limit) return { lines, omitted: 0, splitAt: lines.length };
  const contentLimit = Math.max(2, limit - 1);
  const head = Math.ceil(contentLimit / 2);
  const tail = contentLimit - head;
  return { lines: [...lines.slice(0, head), ...lines.slice(-tail)], omitted: lines.length - contentLimit, splitAt: head };
};

const targetAddresses = (target = {}) => [...new Set([
  target.host,
  ...(target.endpoints || []).map((entry) => entry.address),
].filter(Boolean))];

const targetHostnames = (target = {}) => [...new Set((target.endpoints || [])
  .flatMap((entry) => entry.hostnames || [])
  .filter(Boolean))];

const evidenceRecords = (data = {}) => (data.items || []).flatMap((item) => (item.evidence || []).map((entry) => ({
  ...entry,
  itemId: item.id,
  itemTitle: item.title,
})));

export const reportEvidenceIds = (data = {}) => new Set(evidenceRecords(data).map((entry) => String(entry.id || "")).filter(Boolean));

const evidenceReference = (entry = {}) => entry.id ? `${REPORT_EVIDENCE_SCHEME}${entry.id}` : "";

const outputExcerpt = (content = "", command = "", limit = 14) => {
  // Keep raw carriage returns intact until the terminal parser applies cursor
  // repaint semantics. Converting them to newlines first exposes stale command
  // fragments that were never simultaneously visible in the terminal.
  const styled = terminalLines(String(content ?? ""));
  const display = normalizeTerminalDisplayLines(styled, normalizeNewlines(stripAnsi(command)).trim());
  const excerpt = selectOutputExcerpt(display, limit);
  const rendered = excerpt.lines.map((line, index) => {
    const text = (line || []).map((segment) => segment.text || "").join("");
    if (excerpt.omitted && index === excerpt.splitAt) return `... ${excerpt.omitted} middle lines omitted ...\n${text}`;
    return text;
  });
  return rendered.join("\n").trim();
};

const commandResultSummary = (command = {}) => [
  command.resultCategory ? resultCategoryLabel(command.resultCategory) : "",
  command.commandResultState ? resultStateLabel(command.commandResultState, command.resultCategory) : "",
].filter(Boolean).join(" — ");

const writeNarrative = (parts, label, value) => {
  const text = cleanAutomaticPrefix(value);
  if (text) parts.push(`**${label}.** ${text}`);
};

const reportTitle = (data = {}) => data.report?.title?.trim() || `${data.target?.name || "Target"} Penetration Test Report`;

export function buildReportMarkdown(data = {}, { evidenceLineLimit = 14 } = {}) {
  const target = data.target || {};
  const report = data.report || {};
  const profile = data.profile || {};
  const title = reportTitle(data);
  const addresses = targetAddresses(target);
  const hostnames = targetHostnames(target);
  const parts = [
    marker("report", `v${REPORT_MARKDOWN_VERSION}`),
    marker("target", target.id || target.name || "target"),
    `# ${inline(title)}`,
    "",
    `- **Operator:** ${inline(profile.name || "Operator")}`,
    `- **OSID:** ${inline(profile.osid || "Not set")}`,
    `- **Target:** ${inline(target.name || "Target")}`,
    `- **Address:** ${inline(addresses.join(", ") || "Not recorded")}`,
    `- **Hostname:** ${inline(hostnames.join(", ") || "Not recorded")}`,
    `- **Domain:** ${inline(target.domain || "Not recorded")}`,
    "",
    "> Confidential assessment material. Review and protect exported copies.",
    "",
    "---",
    "",
    marker("section", "executive-summary"),
    "## Executive Summary",
    "",
    plainText(report.executiveSummary || "No executive summary has been recorded."),
    "",
    marker("section", "scope"),
    "## Scope",
    "",
    plainText(report.scope || `- Target: ${target.name || "Target"}\n- Address: ${addresses.join(", ") || "Not recorded"}`),
    "",
    marker("section", "proof"),
    "## Proof of Compromise",
    "",
  ];

  const proofEntries = [
    ...(data.userProof || []).map((entry) => ({ ...entry, proofLabel: "User / local proof" })),
    ...(data.rootProof || []).map((entry) => ({ ...entry, proofLabel: "Root / Administrator proof" })),
  ];
  if (!proofEntries.length) parts.push("No proof screenshot is attached.", "");
  for (const entry of proofEntries) {
    parts.push(marker("evidence", entry.id || entry.proofLabel), `### ${inline(entry.proofLabel)}`, "");
    const reference = evidenceReference(entry);
    if (reference) parts.push(`![${imageAlt(entry.label || entry.proofLabel)}](${reference})`, "");
    if (entry.capture?.capturedAt || entry.createdAt) parts.push(`Captured: ${timestamp(entry.capture?.capturedAt || entry.createdAt)}`, "");
  }

  parts.push(marker("section", "attack-path"), "## Technical Attack Path", "");
  const events = orderAttackPathEvents(data.items || [], data.commandHistory || []);
  let currentPhase = null;
  let step = 0;
  for (const event of events) {
    const item = event.item;
    if (event.showItemContext && item) {
      // The attack path is chronological, so a later command can legitimately
      // return to a phase that appeared earlier. Repeat that phase heading when
      // the stream changes phase; otherwise the returned item is visually
      // nested beneath the wrong phase in Markdown and the styled PDF.
      if (item.phaseId && item.phaseId !== currentPhase) {
        currentPhase = item.phaseId;
        parts.push(marker("phase", item.phaseId), `### ${inline(item.phaseTitle || item.phaseId)}`, "");
      }
      parts.push(marker("item", item.id || item.title), `#### ${inline(item.title || "Checklist item")}`, "");
      const result = [
        item.resultCategory ? resultCategoryLabel(item.resultCategory) : "",
        item.resultState ? resultStateLabel(item.resultState, item.resultCategory) : "",
      ].filter(Boolean).join(" — ");
      if (result) parts.push(`> Operator result: ${result}`, "");
      if (event.kind !== "command") {
        writeNarrative(parts, "Result", item.note);
        writeNarrative(parts, "Decision", item.nextStep);
        if (item.note || item.nextStep) parts.push("");
      }
    }

    if (event.kind !== "command") continue;
    const command = event.command || {};
    step += 1;
    parts.push(
      marker("step", command.id || `${command.itemId || "command"}-${step}`),
      `##### Step ${String(step).padStart(2, "0")} — ${inline(command.label || "Command")}`,
      "",
    );
    const context = [command.address, formatCommandExecutionContext(command), timestamp(command.startedAt || command.copiedAt || command.recordedAt)].filter(Boolean).join(" · ");
    if (context) parts.push(`- **Context:** ${inline(context)}`);
    const result = commandResultSummary(command);
    if (result) parts.push(`- **Command result:** ${inline(result)}`);
    if (context || result) parts.push("");
    const itemFinding = cleanAutomaticPrefix(item?.note);
    const itemDecision = cleanAutomaticPrefix(item?.nextStep);
    const commandFinding = cleanAutomaticPrefix(command.established);
    const commandDecision = cleanAutomaticPrefix(command.nextAction);
    const showCommandDecision = commandDecision
      && commandDecision !== itemDecision
      && commandDecision !== GENERIC_NEXT_ACTION;
    if (commandFinding && commandFinding !== itemFinding) writeNarrative(parts, "Finding", commandFinding);
    if (showCommandDecision) writeNarrative(parts, "Next", commandDecision);
    if ((commandFinding && commandFinding !== itemFinding) || showCommandDecision) parts.push("");
    parts.push(fenced(command.command || "", "sh"), "");

    const linked = (item?.evidence || []).filter((entry) => entry.commandRunId === command.id);
    for (const entry of linked) {
      parts.push(marker("evidence", entry.id || entry.label || "result"), `> Saved evidence: ${inline(entry.label || "Command output")}${entry.createdAt ? ` · ${timestamp(entry.createdAt)}` : ""}`, "");
      if (entry.content) {
        const excerpt = outputExcerpt(entry.content, command.command, evidenceLineLimit);
        if (excerpt) parts.push(fenced(excerpt, "text"), "");
      }
    }
  }

  const cleanupCommands = (data.commandHistory || []).filter((entry) => entry.resultCategory === "cleanup");
  parts.push(marker("section", "cleanup"), "## Cleanup and Restoration", "");
  if (!cleanupCommands.length) parts.push("No cleanup command was recorded.", "");
  else for (const command of cleanupCommands) {
    parts.push(`- **${inline(command.label || "Cleanup step")}** — ${inline(resultStateLabel(command.commandResultState, command.resultCategory) || "recorded")}`);
  }
  if (cleanupCommands.length) parts.push("");

  parts.push(
    marker("section", "recommendations"),
    "## Recommendations",
    "",
    plainText(report.recommendations || "No recommendations have been recorded."),
    "",
    marker("section", "attachments"),
    "## Evidence and Attachment Index",
    "",
  );
  const attachments = evidenceRecords(data);
  if (!attachments.length) parts.push("No evidence attachment is recorded.", "");
  else for (const entry of attachments) {
    const name = entry.filename || entry.name || entry.label || entry.id || "Evidence";
    const category = entry.category || entry.commandResultState || "evidence";
    parts.push(`- ${inline(name)} — ${inline(category)}${entry.id ? ` — \`${inline(entry.id)}\`` : ""}`);
  }

  return `${parts.join("\n").trim()}\n`;
}

export async function generateReportMarkdown(workspace, targetId = workspace?.activeTargetId, options = {}) {
  const { buildTargetReportData } = await import("./pdfReport.js");
  return buildReportMarkdown(buildTargetReportData(workspace, targetId), options);
}

export const resetReportMarkdown = generateReportMarkdown;

export function markdownReportFilename(targetName = "target") {
  const safe = String(targetName || "target")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "target";
  return `${safe}-report.md`;
}

// A small deterministic source fingerprint for UI stale/reset notices. This is
// intentionally not a security digest; exported evidence keeps its SHA-256
// metadata separately.
export function reportMarkdownFingerprint(markdown = "") {
  const bytes = new TextEncoder().encode(normalizeNewlines(markdown));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const isBlockStart = (line) => (
  MARKER.test(line)
  || /^#{1,6}\s+/u.test(line)
  || /^(`{3,}|~{3,})/u.test(line)
  || /^\s*(?:[-+*]|\d+[.)])\s+/u.test(line)
  || /^>\s?/u.test(line)
  || /^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)
  || EVIDENCE_IMAGE.test(line)
  || ANY_IMAGE.test(line)
);

const normalizeEvidenceIds = (values = []) => new Set([...values].map((value) => String(value?.id || value || "")).filter(Boolean));

export function parseReportMarkdown(markdown = "", { evidenceIds = [] } = {}) {
  const source = normalizeNewlines(markdown);
  const size = new TextEncoder().encode(source).length;
  const blocks = [];
  const errors = [];
  const warnings = [];
  const markers = [];
  const seenMarkers = new Set();
  const allowedEvidence = normalizeEvidenceIds(evidenceIds);
  if (size > REPORT_MARKDOWN_MAX_BYTES) {
    return { version: REPORT_MARKDOWN_VERSION, blocks, markers, errors: [`Markdown exceeds the ${REPORT_MARKDOWN_MAX_BYTES}-byte offline report limit.`], warnings };
  }

  const lines = source.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const markerMatch = line.trim().match(MARKER);
    if (markerMatch) {
      const id = markerMatch[1];
      if (seenMarkers.has(id)) warnings.push(`Duplicate report marker: ${id}`);
      seenMarkers.add(id);
      markers.push(id);
      blocks.push({ type: "marker", id });
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/u);
    if (fenceMatch) {
      const opening = fenceMatch[1];
      const character = opening[0];
      const language = fenceMatch[2].trim().split(/\s+/u)[0] || "text";
      const content = [];
      index += 1;
      let closed = false;
      while (index < lines.length) {
        if (new RegExp(`^\\s*${character}{${opening.length},}\\s*$`, "u").test(lines[index])) {
          closed = true;
          index += 1;
          break;
        }
        content.push(lines[index]);
        index += 1;
      }
      if (!closed) errors.push(`Unclosed fenced code block beginning near line ${index - content.length}.`);
      blocks.push({ type: "code", language, text: content.join("\n") });
      continue;
    }

    const imageMatch = line.trim().match(EVIDENCE_IMAGE);
    if (imageMatch) {
      const evidenceId = imageMatch[2];
      if (!allowedEvidence.has(evidenceId)) errors.push(`Image references unavailable evidence: ${evidenceId}`);
      else blocks.push({ type: "image", alt: imageMatch[1], evidenceId });
      index += 1;
      continue;
    }
    const unsafeImage = line.match(ANY_IMAGE);
    if (unsafeImage) {
      errors.push(`Remote or filesystem image references are not allowed: ${unsafeImage[1]}`);
      blocks.push({ type: "paragraph", text: line.trim() });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quoted = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoted.join("\n").trim() });
      continue;
    }
    const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/u);
    if (listMatch) {
      const ordered = /^\d/u.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/u);
        if (!next || /^\d/u.test(next[1]) !== ordered) break;
        items.push(next[2].trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  if (!markers.includes(`${MARKER_PREFIX}report:v${REPORT_MARKDOWN_VERSION}`)) {
    warnings.push(`The Fieldnotes report marker for Markdown version ${REPORT_MARKDOWN_VERSION} is missing.`);
  }
  if (!blocks.some((block) => block.type === "heading" && block.level === 1)) errors.push("The Markdown report needs one level-one title.");
  return { version: REPORT_MARKDOWN_VERSION, blocks, markers, errors, warnings };
}

export function validateReportMarkdown(markdown, options = {}) {
  const parsed = parseReportMarkdown(markdown, options);
  return { valid: parsed.errors.length === 0, errors: parsed.errors, warnings: parsed.warnings };
}

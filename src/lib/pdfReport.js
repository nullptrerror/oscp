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
  StandardFonts,
  rgb,
} from "pdf-lib";
import { ALL_ITEMS } from "../data/checklist.js";
import { getActiveScope, getTargetItemValue, normalizeWorkspace } from "./workspace.js";
import { formatDiscovery } from "./evidence.js";

export const WORKSPACE_ATTACHMENT = "fieldnotes-workspace.json";
const PAGE_SIZE = [595.28, 841.89];
const MARGIN = 48;

const ascii = (value) => String(value ?? "")
  .replace(/[–—]/g, "-")
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");

const safeFilename = (value) => ascii(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "target";

const dataUrlBytes = (dataUrl) => {
  const encoded = String(dataUrl).split(",")[1] || "";
  const binary = globalThis.atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

function wrapText(text, font, size, width) {
  const output = [];
  for (const paragraph of ascii(text).split(/\r?\n/)) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) output.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(`${chunk}${character}`, size) > width && chunk) {
          output.push(chunk);
          chunk = character;
        } else chunk += character;
      }
      line = chunk;
    }
    if (line) output.push(line);
  }
  return output;
}

function targetData(workspace, targetId) {
  const target = workspace.targets.find((entry) => entry.id === targetId)
    || workspace.targets.find((entry) => entry.id === workspace.activeTargetId)
    || { id: null, name: workspace.variables.targetName, host: workspace.variables.rhost, domain: workspace.variables.domain };
  const scope = target?.id || getActiveScope(workspace);
  const report = workspace.reports[scope] || {};
  const belongs = (entry) => entry.targetId ? entry.targetId === target?.id : entry.target === target?.name;
  const commandHistory = (workspace.commandHistory || []).filter(belongs);
  const items = ALL_ITEMS.map((item) => ({
    ...item,
    completed: Boolean(getTargetItemValue(workspace.completed, scope, item.id, false)),
    note: getTargetItemValue(workspace.notes, scope, item.id, ""),
    evidence: getTargetItemValue(workspace.evidence, scope, item.id, []),
  })).filter((item) => item.completed || item.note || item.evidence.length > 0 || commandHistory.some((command) => command.itemId === item.id));
  return {
    target,
    scope,
    report,
    items,
    accounts: workspace.accounts.filter(belongs),
    users: (workspace.users || []).filter(belongs),
    loot: workspace.loot.filter(belongs),
    discoveries: workspace.discoveries.filter(belongs),
    commandHistory,
  };
}

export async function generateReportPdf(workspace, targetId) {
  const data = targetData(workspace, targetId);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const monoBold = await pdf.embedFont(StandardFonts.CourierBold);
  const generatedAt = new Date();
  let profileImage = null;
  if (data.report.profileImage) {
    try {
      const profileBytes = dataUrlBytes(data.report.profileImage);
      profileImage = /png/i.test(data.report.profileImage.slice(0, 30)) ? await pdf.embedPng(profileBytes) : await pdf.embedJpg(profileBytes);
    } catch {
      profileImage = null;
    }
  }
  const colors = {
    ink: rgb(0.10, 0.13, 0.11),
    muted: rgb(0.35, 0.41, 0.37),
    green: rgb(0.25, 0.43, 0.17),
    pale: rgb(0.94, 0.97, 0.93),
    line: rgb(0.80, 0.84, 0.81),
  };
  let page;
  let y;

  const newPage = () => {
    page = pdf.addPage(PAGE_SIZE);
    y = PAGE_SIZE[1] - MARGIN;
    const footer = `${data.report.operatorName || "FIELDNOTES"} / ${generatedAt.toISOString()}`;
    page.drawText(ascii(footer), { x: MARGIN, y: 24, size: 7, font: monoBold, color: colors.muted });
  };
  const ensure = (height) => { if (!page || y - height < MARGIN) newPage(); };
  const lines = (text, { font = regular, size = 10, color = colors.ink, indent = 0, gap = 3 } = {}) => {
    const wrapped = wrapText(text, font, size, PAGE_SIZE[0] - (MARGIN * 2) - indent);
    const lineHeight = size + gap;
    ensure(Math.max(lineHeight, wrapped.length * lineHeight));
    for (const line of wrapped) {
      if (y - lineHeight < MARGIN) newPage();
      if (line) page.drawText(line, { x: MARGIN + indent, y, size, font, color });
      y -= lineHeight;
    }
    return wrapped.length;
  };
  const heading = (text, level = 1) => {
    const size = level === 1 ? 18 : 12;
    ensure(size + 22);
    y -= level === 1 ? 12 : 7;
    lines(text.toUpperCase(), { font: bold, size, color: level === 1 ? colors.green : colors.ink, gap: 4 });
    y -= 4;
  };
  const labelValue = (label, value) => {
    if (!value) return;
    lines(`${label}: ${value}`, { font: mono, size: 8.5, color: colors.muted, gap: 3 });
  };
  const code = (text) => {
    const clipped = ascii(text).slice(0, 5000);
    const wrapped = wrapText(clipped, mono, 7.2, PAGE_SIZE[0] - (MARGIN * 2) - 16);
    const height = Math.max(24, wrapped.length * 9 + 12);
    ensure(Math.min(height, PAGE_SIZE[1] - (MARGIN * 2)));
    const startY = y;
    page.drawRectangle({ x: MARGIN, y: Math.max(MARGIN, y - height + 3), width: PAGE_SIZE[0] - MARGIN * 2, height: Math.min(height, y - MARGIN + 3), color: colors.pale });
    y -= 7;
    for (const line of wrapped) {
      if (y < MARGIN + 10) newPage();
      page.drawText(line || " ", { x: MARGIN + 8, y, size: 7.2, font: mono, color: colors.ink });
      y -= 9;
    }
    if (startY === y) y -= 12;
    y -= 6;
  };

  newPage();
  if (profileImage) {
    const profileScale = Math.min(72 / profileImage.width, 72 / profileImage.height);
    page.drawImage(profileImage, { x: MARGIN, y: y - (profileImage.height * profileScale), width: profileImage.width * profileScale, height: profileImage.height * profileScale });
  }
  y -= 90;
  lines(data.report.title || `${data.target?.name || workspace.variables.targetName} Penetration Test Report`, { font: bold, size: 28, color: colors.ink, gap: 6 });
  y -= 14;
  lines("OSCP+ STYLE LAB REPORT", { font: monoBold, size: 11, color: colors.green, gap: 4 });
  y -= 28;
  labelValue("Target", data.target?.name || workspace.variables.targetName);
  labelValue("Prepared by", data.report.operatorName);
  labelValue("Candidate / lab ID", data.report.candidateId);
  labelValue("IP address", data.target?.host || workspace.variables.rhost);
  labelValue("TCP ports", data.target?.port || workspace.variables.rport);
  labelValue("UDP ports", data.target?.udpPorts || workspace.variables.uport);
  labelValue("Domain", data.target?.domain || workspace.variables.domain);
  labelValue("Workspace", `${workspace.variables.workspaceRoot}/${data.target?.name || workspace.variables.targetName}`);
  labelValue("Generated", generatedAt.toISOString());
  y -= 30;
  lines("This report was generated from target-scoped checklist notes and attached evidence. The original Fieldnotes workspace is embedded in this PDF for restoration.", { size: 10.5, color: colors.muted, gap: 5 });

  newPage();
  heading("Executive summary");
  lines(data.report.executiveSummary || "Document the compromise path, business impact, and final level of access here before submission.", { size: 10.5, gap: 5 });
  heading("Scope", 2);
  lines(data.report.scope || `${data.target?.host || workspace.variables.rhost} (${data.target?.name || workspace.variables.targetName})`, { size: 10, gap: 4 });
  heading("Attack surface", 2);
  for (const endpoint of (data.target?.endpoints || [])) {
    lines(`${endpoint.address}${endpoint.hostnames?.length ? ` (${endpoint.hostnames.join(", ")})` : ""} | TCP: ${endpoint.tcpPorts || "none"} | UDP: ${endpoint.udpPorts || "none"}`, { font: mono, size: 8.5, color: colors.muted });
  }
  if (data.discoveries.length === 0) lines("No parsed discoveries were saved.", { color: colors.muted });
  for (const discovery of data.discoveries) lines(formatDiscovery(discovery), { font: mono, size: 8.5, color: colors.muted });
  heading("Tracked users", 2);
  if (data.users.length === 0) lines("No standalone usernames were saved.", { color: colors.muted });
  for (const user of data.users) labelValue(user.source || "user", `${user.domain ? `${user.domain}\\` : ""}${user.username}`);
  heading("Credentials obtained", 2);
  if (data.accounts.length === 0) lines("No credentials were saved.", { color: colors.muted });
  for (const account of data.accounts) labelValue(account.status || "credential", `${account.domain ? `${account.domain}\\` : ""}${account.username}${account.secret ? ` : ${account.secret}` : ""}`);

  newPage();
  heading("Technical narrative");
  if (data.items.length === 0) lines("No checklist results have been saved for this target.", { color: colors.muted });
  for (const item of data.items) {
    heading(`${item.phaseTitle} / ${item.title}`, 2);
    labelValue("Status", item.completed ? "Complete" : "Evidence captured");
    if (item.detail) lines(item.detail, { color: colors.muted, size: 9 });
    if (item.note) {
      lines("Operator note", { font: bold, size: 9 });
      lines(item.note, { size: 9.5, gap: 4 });
    }
    const copiedCommands = data.commandHistory.filter((command) => command.itemId === item.id);
    for (const command of copiedCommands) {
      lines(`${command.label} / ${command.address || "target"} / ${command.copiedAt}`, { font: bold, size: 8.5, color: colors.green });
      code(command.command);
    }
    for (const evidence of item.evidence) {
      lines(`Evidence: ${evidence.label}`, { font: bold, size: 9 });
      if (evidence.content) code(evidence.content.slice(0, 3500));
      if (evidence.discoveries?.length) lines(evidence.discoveries.map(formatDiscovery).join(" | "), { font: mono, size: 7.5, color: colors.muted });
    }
  }

  const images = data.items.flatMap((item) => item.evidence.map((evidence) => ({ ...evidence, itemTitle: item.title }))).filter((evidence) => evidence.dataUrl);
  if (images.length) {
    newPage();
    heading("Evidence screenshots");
    for (const evidence of images) {
      ensure(180);
      lines(`${evidence.itemTitle}: ${evidence.label}`, { font: bold, size: 9 });
      try {
        const bytes = dataUrlBytes(evidence.dataUrl);
        const image = /png/i.test(evidence.mimeType || evidence.dataUrl.slice(0, 30)) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const scale = Math.min((PAGE_SIZE[0] - MARGIN * 2) / image.width, 430 / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        ensure(height + 18);
        page.drawImage(image, { x: MARGIN, y: y - height, width, height });
        y -= height + 18;
      } catch {
        lines("The screenshot could not be rendered, but remains embedded in the workspace attachment.", { color: colors.muted, size: 8 });
      }
    }
  }

  newPage();
  heading("Conclusion and recommendations");
  lines(data.report.recommendations || "Record the remediation actions that would prevent the attack path and reduce the impact of credential reuse or excessive privilege.", { size: 10.5, gap: 5 });
  heading("Loot and proof inventory", 2);
  if (data.loot.length === 0) lines("No loot records were saved.", { color: colors.muted });
  for (const entry of data.loot) labelValue(entry.label, [entry.location, entry.value].filter(Boolean).join(" - "));

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`${index + 1} / ${pages.length}`, { x: PAGE_SIZE[0] - MARGIN - 34, y: 24, size: 7, font: mono, color: colors.muted });
  });
  pdf.setTitle(data.report.title || `${data.target?.name || "Target"} Penetration Test Report`);
  pdf.setAuthor(data.report.operatorName || "Fieldnotes OSCP+");
  pdf.setSubject("Target report with embedded Fieldnotes workspace");
  await pdf.attach(new TextEncoder().encode(JSON.stringify(workspace)), WORKSPACE_ATTACHMENT, {
    mimeType: "application/json",
    description: "Complete Fieldnotes workspace for import",
    creationDate: generatedAt,
  });
  let attachmentIndex = 0;
  for (const evidence of data.items.flatMap((item) => item.evidence)) {
    const encodedFile = evidence.dataUrl || evidence.fileDataUrl;
    const bytes = encodedFile ? dataUrlBytes(encodedFile) : evidence.content ? new TextEncoder().encode(evidence.content) : null;
    if (!bytes) continue;
    attachmentIndex += 1;
    await pdf.attach(bytes, `${String(attachmentIndex).padStart(3, "0")}-${safeFilename(evidence.filename || evidence.label)}`, {
      mimeType: evidence.mimeType || "text/plain",
      description: `Evidence for ${data.target?.name || workspace.variables.targetName}`,
    });
  }
  return pdf.save();
}

function embeddedFileBytes(pdf, wantedName) {
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const entries = embedded?.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!entries) return null;
  for (let index = 0; index < entries.size(); index += 2) {
    const nameObject = entries.lookup(index, PDFString, PDFHexString);
    if (nameObject.decodeText() !== wantedName) continue;
    const fileSpec = entries.lookup(index + 1, PDFDict);
    const ef = fileSpec.lookup(PDFName.of("EF"), PDFDict);
    const stream = ef.lookup(PDFName.of("F"), PDFStream);
    return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  }
  return null;
}

export async function extractWorkspaceFromPdf(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const attachment = embeddedFileBytes(pdf, WORKSPACE_ATTACHMENT);
  if (!attachment) throw new Error("This PDF does not contain a Fieldnotes workspace attachment.");
  try {
    return normalizeWorkspace(JSON.parse(new TextDecoder().decode(attachment)));
  } catch (error) {
    if (error instanceof Error && /Unsupported backup version/.test(error.message)) throw error;
    throw new Error("The embedded Fieldnotes workspace could not be read.");
  }
}

export async function downloadReportPdf(workspace, targetId) {
  const bytes = await generateReportPdf(workspace, targetId);
  const target = workspace.targets.find((entry) => entry.id === targetId) || workspace.targets.find((entry) => entry.id === workspace.activeTargetId);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(target?.name || workspace.variables.targetName)}-report.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

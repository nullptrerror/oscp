import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  buildTargetReportData,
  loadBundledNodePdfFonts,
  WORKSPACE_ATTACHMENT,
} from "./pdfReport.js";
import {
  markdownReportFilename,
  parseReportMarkdown,
  reportEvidenceIds,
} from "./markdownReport.js";

const PAGE_SIZE = [595.28, 841.89];
const [PAGE_W, PAGE_H] = PAGE_SIZE;
const LEFT = 56;
const RIGHT = PAGE_W - 56;
const CONTENT_W = RIGHT - LEFT;
const CONTENT_TOP = PAGE_H - 104;
const CONTENT_BOTTOM = 76;

const PALETTE = {
  ink: "#17201a",
  body: "#2c3630",
  muted: "#66756b",
  line: "#dbe2dd",
  accent: "#3d6b21",
  warn: "#8a5d00",
  warnSoft: "#fdf3d8",
  white: "#ffffff",
  terminal: "#08100b",
  terminalTop: "#111d15",
  terminalText: "#dcead8",
  terminalMuted: "#7e9284",
};

const colorCache = new Map();
const color = (value) => {
  if (!colorCache.has(value)) {
    const number = Number.parseInt(value.slice(1), 16);
    colorCache.set(value, rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255));
  }
  return colorCache.get(value);
};

const safeFilename = (value = "target") => String(value || "target")
  .normalize("NFKD")
  .replace(/\p{M}+/gu, "")
  .replace(/[^a-zA-Z0-9._-]+/gu, "-")
  .replace(/^-+|-+$/gu, "") || "target";

const formatTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const asciiFallback = (value = "") => String(value)
  .replace(/[–—]/gu, "-")
  .replace(/[‘’]/gu, "'")
  .replace(/[“”]/gu, "\"")
  .replace(/…/gu, "...")
  .replace(/→/gu, "->")
  .replace(/←/gu, "<-")
  .replace(/[^\x09\x0A\x0D\x20-\x7E]/gu, "?");

const printableText = (value = "", unicode = true) => {
  const text = String(value).replace(/\t/gu, "    ").replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "");
  return unicode ? text : asciiFallback(text);
};

const decodeInlineEntities = (value = "") => String(value)
  .replace(/&lt;/gu, "<")
  .replace(/&gt;/gu, ">")
  .replace(/&amp;/gu, "&")
  .replace(/&quot;/gu, "\"")
  .replace(/&#39;/gu, "'");

const unescapeMarkdown = (value = "") => decodeInlineEntities(value).replace(/\\([\\`*_[\]{}()#+.!-])/gu, "$1");

// The editable format deliberately supports a small, auditable Markdown
// subset. This parser mirrors that subset and never evaluates HTML.
function inlineSegments(value = "") {
  const source = String(value).replace(/\n+/gu, " ");
  const segments = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/gu;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) segments.push({ text: unescapeMarkdown(source.slice(cursor, match.index)) });
    const token = match[0];
    if (token.startsWith("**")) segments.push({ text: unescapeMarkdown(token.slice(2, -2)), bold: true });
    else if (token.startsWith("`")) segments.push({ text: unescapeMarkdown(token.slice(1, -1)), mono: true });
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      segments.push({ text: unescapeMarkdown(link?.[1] || token), link: link?.[2] || "" });
      if (link?.[2]) segments.push({ text: ` (${link[2]})`, link: link[2] });
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) segments.push({ text: unescapeMarkdown(source.slice(cursor)) });
  return segments.length ? segments : [{ text: "" }];
}

const dataUrlBytes = (dataUrl = "") => {
  const comma = String(dataUrl).indexOf(",");
  if (comma < 0) throw new Error("Evidence data is not a valid data URL.");
  const metadata = String(dataUrl).slice(0, comma);
  const encoded = String(dataUrl).slice(comma + 1);
  if (!/;base64$/iu.test(metadata)) return new TextEncoder().encode(decodeURIComponent(encoded));
  const binary = globalThis.atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const evidenceRecords = (data = {}) => {
  const seen = new Set();
  return (data.items || []).flatMap((item) => item.evidence || []).filter((entry) => {
    const key = String(entry.id || `${entry.label || "evidence"}:${entry.createdAt || ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

async function resolveFontBytes(options = {}) {
  if (options.fonts) return options.fonts;
  if (typeof document !== "undefined") {
    const { loadPdfFonts } = await import("./pdfAssets.js");
    return loadPdfFonts();
  }
  try {
    return await loadBundledNodePdfFonts();
  } catch {
    return null;
  }
}

async function embedFonts(pdf, fontBytes) {
  if (fontBytes?.sans && fontBytes?.sansBold && fontBytes?.mono && fontBytes?.monoBold) {
    pdf.registerFontkit(fontkit);
    return {
      sans: await pdf.embedFont(fontBytes.sans, { subset: true }),
      sansBold: await pdf.embedFont(fontBytes.sansBold, { subset: true }),
      mono: await pdf.embedFont(fontBytes.mono, { subset: true }),
      monoBold: await pdf.embedFont(fontBytes.monoBold, { subset: true }),
      unicode: true,
    };
  }
  return {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    sansBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    monoBold: await pdf.embedFont(StandardFonts.CourierBold),
    unicode: false,
  };
}

const fontFor = (fonts, style = {}) => fonts[`${style.mono ? "mono" : "sans"}${style.bold ? "Bold" : ""}`];

function normalizedSegments(segments, fonts) {
  return segments
    .map((segment) => ({ ...segment, text: printableText(segment.text || "", fonts.unicode) }))
    .filter((segment) => segment.text.length > 0);
}

function splitSegmentWords(segment) {
  return String(segment.text).split(/(\s+)/u).filter(Boolean)
    .map((text) => ({ ...segment, text, whitespace: /^\s+$/u.test(text) }));
}

function tokenWidth(token, fonts, size) {
  return fontFor(fonts, token).widthOfTextAtSize(token.text, size);
}

function breakToken(token, fonts, size, width) {
  const parts = [];
  let text = "";
  let used = 0;
  const font = fontFor(fonts, token);
  for (const character of Array.from(token.text)) {
    const characterWidth = font.widthOfTextAtSize(character, size);
    if (text && used + characterWidth > width) {
      parts.push({ ...token, text });
      text = character;
      used = characterWidth;
    } else {
      text += character;
      used += characterWidth;
    }
  }
  if (text) parts.push({ ...token, text });
  return parts;
}

function wrapSegments(sourceSegments, fonts, size, width) {
  const tokens = normalizedSegments(sourceSegments, fonts).flatMap(splitSegmentWords);
  const lines = [];
  let line = [];
  let used = 0;
  const commit = () => {
    while (line.at(-1)?.whitespace) line.pop();
    lines.push(line);
    line = [];
    used = 0;
  };
  for (const sourceToken of tokens) {
    if (sourceToken.whitespace && !line.length) continue;
    const pieces = tokenWidth(sourceToken, fonts, size) <= width
      ? [sourceToken]
      : breakToken(sourceToken, fonts, size, width);
    for (const token of pieces) {
      const measured = tokenWidth(token, fonts, size);
      if (line.length && used + measured > width) commit();
      if (token.whitespace && !line.length) continue;
      line.push(token);
      used += measured;
    }
  }
  if (line.length || !lines.length) commit();
  return lines;
}

function drawInlineLine(page, line, fonts, x, y, size, defaultColor) {
  let cursor = x;
  for (const token of line) {
    const font = fontFor(fonts, token);
    const textColor = token.link ? color(PALETTE.accent) : color(defaultColor);
    page.drawText(token.text, { x: cursor, y, size, font, color: textColor });
    const width = font.widthOfTextAtSize(token.text, size);
    if (token.link) page.drawLine({ start: { x: cursor, y: y - 1 }, end: { x: cursor + width, y: y - 1 }, thickness: 0.4, color: textColor });
    cursor += width;
  }
  return cursor;
}

function truncateText(text, font, size, width) {
  const source = String(text || "");
  if (font.widthOfTextAtSize(source, size) <= width) return source;
  let kept = "";
  for (const character of Array.from(source)) {
    if (font.widthOfTextAtSize(`${kept}${character}...`, size) > width) break;
    kept += character;
  }
  return `${kept}...`;
}

export function markdownPdfFilename(targetName = "target") {
  return `${safeFilename(targetName)}-markdown-report.pdf`;
}

async function buildMarkdownPdf(workspace, targetId, markdown, options = {}) {
  const data = buildTargetReportData(workspace, targetId);
  const parsed = parseReportMarkdown(markdown, { evidenceIds: reportEvidenceIds(data) });
  if (parsed.errors.length) {
    throw new Error(`The Markdown report cannot be rendered:\n- ${parsed.errors.join("\n- ")}`);
  }

  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf, await resolveFontBytes(options));
  const evidence = evidenceRecords(data);
  const evidenceById = new Map(evidence.map((entry) => [String(entry.id || ""), entry]));
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date();
  const targetName = data.target?.name || workspace.variables?.targetName || "Target";
  const sourceTitle = parsed.blocks.find((block) => block.type === "heading" && block.level === 1)?.text;
  const reportTitle = printableText(unescapeMarkdown(sourceTitle || data.report?.title || `${targetName} Penetration Test Report`).replace(/[*_`]/gu, ""), true);

  let page;
  let y;
  const pages = [];
  const newPage = () => {
    page = pdf.addPage(PAGE_SIZE);
    pages.push(page);
    y = CONTENT_TOP;
  };
  const ensure = (height) => {
    if (!page || y - height < CONTENT_BOTTOM) newPage();
  };

  const drawParagraph = (text, {
    size = 9.5,
    bold = false,
    mono = false,
    textColor = PALETTE.body,
    indent = 0,
    after = 6,
    lineHeight = size * 1.48,
    width = CONTENT_W - indent,
  } = {}) => {
    const paragraphs = String(text || "").split(/\n+/u);
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const segments = inlineSegments(paragraphs[paragraphIndex]).map((segment) => ({ ...segment, bold: bold || segment.bold, mono: mono || segment.mono }));
      const lines = wrapSegments(segments, fonts, size, width);
      for (const line of lines) {
        ensure(lineHeight);
        drawInlineLine(page, line, fonts, LEFT + indent, y - size, size, textColor);
        y -= lineHeight;
      }
      if (paragraphIndex < paragraphs.length - 1) y -= 3;
    }
    y -= after;
  };

  const drawHeading = (block, keepWithNext = 0) => {
    const level = Math.min(6, Math.max(1, block.level || 2));
    const style = level === 1
      ? { size: 22, before: 3, after: 16, textColor: PALETTE.ink }
      : level === 2
        ? { size: 15, before: 15, after: 8, textColor: PALETTE.ink }
        : level === 3
          ? { size: 11.5, before: 11, after: 6, textColor: PALETTE.ink }
          : { size: 9.8, before: 8, after: 4, textColor: PALETTE.accent };
    const lines = wrapSegments([{ text: unescapeMarkdown(block.text), bold: true }], fonts, style.size, CONTENT_W - (level === 1 ? 8 : 0));
    const height = style.before + (lines.length * style.size * 1.25) + style.after + (level === 2 ? 5 : 0);
    ensure(height + keepWithNext);
    y -= style.before;
    if (level === 1) page.drawRectangle({ x: LEFT, y: y + 5 - (lines.length * style.size * 1.25), width: 4, height: lines.length * style.size * 1.25, color: color(PALETTE.accent) });
    for (const line of lines) {
      drawInlineLine(page, line, fonts, LEFT + (level === 1 ? 12 : 0), y - style.size, style.size, style.textColor);
      y -= style.size * 1.25;
    }
    if (level === 2) {
      page.drawLine({ start: { x: LEFT, y: y - 1 }, end: { x: RIGHT, y: y - 1 }, thickness: 0.7, color: color(PALETTE.line) });
      y -= 5;
    }
    y -= style.after;
  };

  const drawList = (block) => {
    block.items.forEach((item, index) => {
      const label = block.ordered ? `${index + 1}.` : (fonts.unicode ? "•" : "-");
      const size = 9.3;
      const lines = wrapSegments(inlineSegments(item), fonts, size, CONTENT_W - 22);
      lines.forEach((line, lineIndex) => {
        ensure(size * 1.5);
        if (lineIndex === 0) page.drawText(label, { x: LEFT + 1, y: y - size, size, font: fonts.sansBold, color: color(PALETTE.accent) });
        drawInlineLine(page, line, fonts, LEFT + 22, y - size, size, PALETTE.body);
        y -= size * 1.5;
      });
      y -= 1;
    });
    y -= 5;
  };

  const drawQuote = (block) => {
    const size = 9;
    const lines = wrapSegments(inlineSegments(block.text), fonts, size, CONTENT_W - 30);
    for (const line of lines) {
      ensure(size * 1.55 + 2);
      page.drawRectangle({ x: LEFT, y: y - size * 1.45, width: 3, height: size * 1.55, color: color(PALETTE.accent) });
      drawInlineLine(page, line, fonts, LEFT + 14, y - size, size, PALETTE.muted);
      y -= size * 1.55;
    }
    y -= 8;
  };

  const codeFontSize = (lines) => {
    const longest = lines.reduce((max, line) => Math.max(max, fonts.mono.widthOfTextAtSize(printableText(line, fonts.unicode), 7.35)), 0);
    if (!longest || longest <= CONTENT_W - 28) return 7.35;
    return Math.max(5.45, 7.35 * ((CONTENT_W - 28) / longest));
  };

  const wrapCodeLine = (line, size) => {
    const text = printableText(line, fonts.unicode);
    const width = CONTENT_W - 28;
    if (!text) return [""];
    const rows = [];
    let row = "";
    let used = 0;
    for (const character of Array.from(text)) {
      const characterWidth = fonts.mono.widthOfTextAtSize(character, size);
      if (row && used + characterWidth > width) {
        rows.push(row);
        row = character;
        used = characterWidth;
      } else {
        row += character;
        used += characterWidth;
      }
    }
    if (row || !rows.length) rows.push(row);
    return rows;
  };

  const drawCode = (block) => {
    const sourceLines = String(block.text || "").replace(/\r\n?/gu, "\n").split("\n");
    const size = codeFontSize(sourceLines);
    const lineHeight = size * 1.55;
    const rows = sourceLines.flatMap((line) => wrapCodeLine(line, size));
    let offset = 0;
    let continuation = false;
    while (offset < rows.length || (!rows.length && offset === 0)) {
      const available = y - CONTENT_BOTTOM;
      const fixedHeight = 38;
      const maximumRows = Math.floor((available - fixedHeight) / lineHeight);
      if (maximumRows < 1 || (maximumRows < 2 && y < CONTENT_TOP)) {
        newPage();
        continue;
      }
      const chunk = rows.slice(offset, offset + maximumRows);
      const height = 25 + Math.max(1, chunk.length) * lineHeight + 13;
      ensure(height);
      page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_W, height, color: color(PALETTE.terminal), borderColor: color("#243028"), borderWidth: 0.7 });
      page.drawRectangle({ x: LEFT, y: y - 24, width: CONTENT_W, height: 24, color: color(PALETTE.terminalTop) });
      page.drawCircle({ x: LEFT + 14, y: y - 12, size: 3, color: color("#ff5f57") });
      page.drawCircle({ x: LEFT + 25, y: y - 12, size: 3, color: color("#febc2e") });
      page.drawCircle({ x: LEFT + 36, y: y - 12, size: 3, color: color("#28c840") });
      const language = `${block.language || "text"}${continuation ? " · continued" : ""}`;
      const languageText = fonts.unicode ? language : asciiFallback(language);
      page.drawText(truncateText(languageText, fonts.monoBold, 6.8, CONTENT_W - 70), { x: LEFT + 50, y: y - 15, size: 6.8, font: fonts.monoBold, color: color(PALETTE.terminalMuted) });
      let codeY = y - 34;
      for (const row of chunk.length ? chunk : [""]) {
        page.drawText(row || " ", { x: LEFT + 14, y: codeY, size, font: fonts.mono, color: color(PALETTE.terminalText) });
        codeY -= lineHeight;
      }
      y -= height + 10;
      offset += Math.max(1, chunk.length);
      continuation = true;
    }
  };

  const drawMissingImage = (label) => {
    const height = 52;
    ensure(height + 8);
    page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_W, height, color: color(PALETTE.warnSoft), borderColor: color("#e5cc8d"), borderWidth: 0.7 });
    page.drawText("Evidence image unavailable", { x: LEFT + 12, y: y - 19, size: 8.8, font: fonts.sansBold, color: color(PALETTE.warn) });
    const safeLabel = fonts.unicode ? label : asciiFallback(label);
    page.drawText(truncateText(safeLabel, fonts.sans, 8, CONTENT_W - 24), { x: LEFT + 12, y: y - 36, size: 8, font: fonts.sans, color: color(PALETTE.body) });
    y -= height + 10;
  };

  const drawImage = async (block) => {
    const entry = evidenceById.get(block.evidenceId);
    const encoded = entry?.dataUrl || entry?.fileDataUrl;
    if (!encoded) {
      drawMissingImage(block.alt || entry?.label || block.evidenceId);
      return;
    }
    try {
      const bytes = dataUrlBytes(encoded);
      const mime = entry?.mimeType || String(encoded).slice(5, String(encoded).indexOf(";"));
      const image = /png/iu.test(mime) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const maxHeight = 430;
      const scale = Math.min(CONTENT_W / image.width, maxHeight / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      ensure(height + 40);
      const x = LEFT + ((CONTENT_W - width) / 2);
      page.drawRectangle({ x: x - 3, y: y - height - 3, width: width + 6, height: height + 6, color: color(PALETTE.white), borderColor: color(PALETTE.line), borderWidth: 0.7 });
      page.drawImage(image, { x, y: y - height, width, height });
      y -= height + 12;
      drawParagraph(block.alt || entry?.label || "Evidence image", { size: 7.8, textColor: PALETTE.muted, after: 10 });
    } catch {
      drawMissingImage(block.alt || entry?.label || block.evidenceId);
    }
  };

  newPage();
  for (const block of parsed.blocks) {
    if (block.type === "marker") continue;
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.level || 2));
      // Reserve enough room for the first meaningful block beneath a heading.
      // Step headings in particular should not become the final line on a page
      // while their context and command card begin on the following page.
      const keepWithNext = level >= 4 ? 140 : level === 3 ? 90 : level === 2 ? 80 : 60;
      drawHeading(block, keepWithNext);
    }
    else if (block.type === "paragraph") drawParagraph(block.text);
    else if (block.type === "list") drawList(block);
    else if (block.type === "quote") drawQuote(block);
    else if (block.type === "code") drawCode(block);
    else if (block.type === "image") await drawImage(block);
    else if (block.type === "rule") {
      ensure(18);
      page.drawLine({ start: { x: LEFT, y: y - 5 }, end: { x: RIGHT, y: y - 5 }, thickness: 0.7, color: color(PALETTE.line) });
      y -= 18;
    }
  }

  pages.forEach((pdfPage, index) => {
    const operator = printableText(data.profile?.name || "Operator", fonts.unicode);
    const headerLeft = truncateText(operator, fonts.sansBold, 8.5, CONTENT_W * 0.42);
    pdfPage.drawText(headerLeft, { x: LEFT, y: PAGE_H - 51, size: 8.5, font: fonts.sansBold, color: color(PALETTE.ink) });
    const sourceOsid = data.profile?.osid ? `OSID ${data.profile.osid}` : "OSID not set";
    const osid = printableText(sourceOsid, fonts.unicode);
    const safeOsid = truncateText(osid, fonts.sans, 6.8, CONTENT_W * 0.42);
    pdfPage.drawText(safeOsid, { x: LEFT, y: PAGE_H - 64, size: 6.8, font: fonts.sans, color: color(PALETTE.muted) });
    const safeTitle = printableText(reportTitle, fonts.unicode);
    const headerTitle = truncateText(safeTitle, fonts.sansBold, 8.1, CONTENT_W * 0.52);
    pdfPage.drawText(headerTitle, { x: RIGHT - fonts.sansBold.widthOfTextAtSize(headerTitle, 8.1), y: PAGE_H - 51, size: 8.1, font: fonts.sansBold, color: color(PALETTE.ink) });
    const sourceTargetLine = `OSCP+ Exam Report · ${targetName}`;
    const safeTargetLine = printableText(sourceTargetLine, fonts.unicode);
    const targetLine = truncateText(safeTargetLine, fonts.sans, 6.8, CONTENT_W * 0.52);
    pdfPage.drawText(targetLine, { x: RIGHT - fonts.sans.widthOfTextAtSize(targetLine, 6.8), y: PAGE_H - 64, size: 6.8, font: fonts.sans, color: color(PALETTE.muted) });
    pdfPage.drawLine({ start: { x: LEFT, y: PAGE_H - 77 }, end: { x: RIGHT, y: PAGE_H - 77 }, thickness: 0.6, color: color(PALETTE.line) });
    pdfPage.drawRectangle({ x: LEFT, y: PAGE_H - 77.9, width: 44, height: 1.8, color: color(PALETTE.accent) });

    pdfPage.drawLine({ start: { x: LEFT, y: 54 }, end: { x: RIGHT, y: 54 }, thickness: 0.6, color: color(PALETTE.line) });
    const footerSource = `CONFIDENTIAL  ·  ${targetName}  ·  Generated ${formatTimestamp(generatedAt)}`;
    const footer = printableText(footerSource, fonts.unicode);
    pdfPage.drawText(truncateText(footer, fonts.sans, 6.7, CONTENT_W - 80), { x: LEFT, y: 43, size: 6.7, font: fonts.sans, color: color(PALETTE.muted) });
    const pageNumber = `Page ${index + 1} of ${pages.length}`;
    pdfPage.drawText(pageNumber, { x: RIGHT - fonts.sans.widthOfTextAtSize(pageNumber, 7), y: 43, size: 7, font: fonts.sans, color: color(PALETTE.muted) });
  });

  pdf.setTitle(reportTitle, { showInWindowTitleBar: true });
  pdf.setAuthor(data.profile?.name || "Fieldnotes OSCP+");
  pdf.setSubject(`Styled Markdown OSCP+ penetration test report for ${targetName}`);
  pdf.setKeywords(["OSCP+", "penetration test", "Markdown", targetName, data.profile?.osid].filter(Boolean));
  pdf.setCreator("Fieldnotes OSCP+");
  pdf.setProducer("Fieldnotes OSCP+ (pdf-lib)");
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  const markdownName = markdownReportFilename(targetName);
  await pdf.attach(new TextEncoder().encode(JSON.stringify(workspace)), WORKSPACE_ATTACHMENT, {
    mimeType: "application/json",
    description: "Complete Fieldnotes workspace for import",
    creationDate: generatedAt,
  });
  await pdf.attach(new TextEncoder().encode(String(markdown)), markdownName, {
    mimeType: "text/markdown; charset=utf-8",
    description: `Editable report source for ${targetName}`,
    creationDate: generatedAt,
  });
  const warnings = [...parsed.warnings];
  let attachmentIndex = 0;
  for (const entry of evidence) {
    const encoded = entry.dataUrl || entry.fileDataUrl;
    if (!encoded && !String(entry.content || "").trim()) continue;
    attachmentIndex += 1;
    const name = `${String(attachmentIndex).padStart(3, "0")}-${safeFilename(entry.filename || entry.label || entry.id || "evidence")}`;
    let bytes;
    try {
      bytes = encoded ? dataUrlBytes(encoded) : new TextEncoder().encode(String(entry.content));
    } catch {
      warnings.push(`Evidence attachment could not be decoded: ${entry.label || entry.id || name}`);
      continue;
    }
    await pdf.attach(bytes, name, {
      mimeType: entry.mimeType || (encoded ? "application/octet-stream" : "text/plain; charset=utf-8"),
      description: `Evidence for ${targetName}: ${entry.label || name}`,
      creationDate: entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)) ? new Date(entry.createdAt) : generatedAt,
    });
  }

  return {
    bytes: await pdf.save(),
    pages: pages.length,
    warnings,
    markdownFilename: markdownName,
  };
}

export async function generateMarkdownReportPdf(workspace, targetId, markdown, options = {}) {
  return buildMarkdownPdf(workspace, targetId, markdown, options);
}

export async function downloadMarkdownReportPdf(workspace, targetId, markdown) {
  const result = await buildMarkdownPdf(workspace, targetId, markdown);
  const target = workspace.targets?.find((entry) => entry.id === targetId)
    || workspace.targets?.find((entry) => entry.id === workspace.activeTargetId);
  const blob = new Blob([result.bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = markdownPdfFilename(target?.name || workspace.variables?.targetName);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { pages: result.pages, warnings: result.warnings };
}

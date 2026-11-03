import fontkit from "@pdf-lib/fontkit";
import {
  appendBezierCurve,
  clip,
  closePath,
  decodePDFRawStream,
  endPath,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
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
import { ALL_ITEMS, CHECKLIST } from "../data/checklist.js";
import { getActiveScope, getTargetItemValue, normalizeWorkspace } from "./workspace.js";
import { discoveryContext, discoveryKey, formatDiscovery, PARSER_TAGS, visibleDiscoveries } from "./evidence.js";
import { describeCommand } from "./commandInsights.js";
import { getOperatorProfile, githubProfile, initials } from "./profile.js";
import { TERMINAL_THEME, terminalLines } from "./terminalText.js";

export const WORKSPACE_ATTACHMENT = "fieldnotes-workspace.json";
const DISCOVERY_LABELS = Object.fromEntries(PARSER_TAGS.map((entry) => [entry.type, entry.label]));

const PAGE_SIZE = [595.28, 841.89];
const [PAGE_W, PAGE_H] = PAGE_SIZE;
const LEFT = 56;
const RIGHT = PAGE_W - 56;
const CONTENT_W = RIGHT - LEFT;
const CONTENT_TOP = PAGE_H - 104;
const CONTENT_BOTTOM = 76;
const TERMINAL_LINE_LIMIT = 18;
const TOC_ENTRIES_PER_PAGE = 34;

const PALETTE = {
  ink: "#17201a",
  body: "#2c3630",
  muted: "#66756b",
  faint: "#9aa69e",
  line: "#dbe2dd",
  accent: "#3d6b21",
  accentSoft: "#eef5e6",
  tint: "#f5f7f4",
  warn: "#8a5d00",
  warnSoft: "#fdf3d8",
  white: "#ffffff",
  terminalBorder: "#243028",
  kaliBlue: "#5fa8ff",
};

const PROOF_CATEGORIES = new Set(["user-flag", "root-flag"]);

const colorCache = new Map();
const color = (value) => {
  if (!colorCache.has(value)) {
    const number = Number.parseInt(value.slice(1), 16);
    colorCache.set(value, rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255));
  }
  return colorCache.get(value);
};

const mix = (foreground, background, amount) => {
  const parse = (value) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const [a, b] = [parse(foreground), parse(background)];
  return `#${a.map((channel, index) => Math.round(channel * amount + b[index] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
};

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

const embedDataUrlImage = async (pdf, dataUrl, mimeType = "") => {
  const bytes = dataUrlBytes(dataUrl);
  return /png/i.test(mimeType || String(dataUrl).slice(0, 30)) ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
};

const formatTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// ---------------------------------------------------------------------------
// Typesetting: per-grapheme font fallback, emoji images, and line wrapping.

const SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (text) => {
  if (/^[\x20-\x7e]*$/.test(text)) return text.split("");
  return SEGMENTER ? Array.from(SEGMENTER.segment(text), (part) => part.segment) : Array.from(text);
};
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|️|\p{Regional_Indicator}|‍/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_CLUSTER = /\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?)*/gu;
const INVISIBLE = /[︎️‍​]/gu;
const SUBSTITUTES = { "㉿": "@", " ": " ", " ": " ", " ": " " };

function createTypesetter(families, emojiImages) {
  const widthCache = new Map();
  const measure = (entry, text) => {
    const key = `${entry.id}\u0000${text}`;
    if (!widthCache.has(key)) widthCache.set(key, entry.font.widthOfTextAtSize(text, 1));
    return widthCache.get(key);
  };

  const resolve = (grapheme, chain) => {
    if (emojiImages.has(grapheme) && EMOJI_PRESENTATION.test(grapheme)) return { image: emojiImages.get(grapheme) };
    const text = grapheme.replace(INVISIBLE, "") || " ";
    const codePoints = Array.from(text, (character) => character.codePointAt(0));
    for (const entry of chain) {
      if (codePoints.every((codePoint) => entry.charset.has(codePoint))) return { entry, text };
    }
    if (emojiImages.has(grapheme) && PICTOGRAPHIC.test(grapheme)) return { image: emojiImages.get(grapheme) };
    if (SUBSTITUTES[text]) return resolve(SUBSTITUTES[text], chain);
    return { entry: chain[0], text: "?" };
  };

  const shape = (spans) => {
    const units = [];
    for (const span of spans) {
      const chain = families[`${span.family || "sans"}${span.bold ? "Bold" : ""}`];
      const text = String(span.text ?? "").replace(/\t/g, "    ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
      for (const grapheme of graphemes(text)) {
        const resolved = resolve(grapheme, chain);
        const width = resolved.image ? span.size * 1.2 : measure(resolved.entry, resolved.text) * span.size;
        units.push({ ...resolved, width, span, space: grapheme === " " });
      }
    }
    return units;
  };

  const lineWidth = (units) => units.reduce((total, unit) => total + unit.width, 0);

  // Word-wrapping for prose; words that are too long are broken by grapheme.
  const wrapProse = (units, maxWidth) => {
    const words = [];
    for (const unit of units) {
      const last = words[words.length - 1];
      if (last && last.space === unit.space) last.units.push(unit);
      else words.push({ space: unit.space, units: [unit] });
    }
    const lines = [];
    let line = [];
    let width = 0;
    let pendingSpace = null;
    const commit = () => { lines.push(line); line = []; width = 0; pendingSpace = null; };
    for (const word of words) {
      const wordWidth = lineWidth(word.units);
      if (word.space) {
        if (line.length) pendingSpace = { units: word.units, width: wordWidth };
        continue;
      }
      const spaceWidth = pendingSpace?.width || 0;
      if (width + spaceWidth + wordWidth <= maxWidth) {
        if (pendingSpace) line.push(...pendingSpace.units);
        line.push(...word.units);
        width += spaceWidth + wordWidth;
        pendingSpace = null;
        continue;
      }
      if (line.length) commit();
      if (wordWidth <= maxWidth) {
        line.push(...word.units);
        width = wordWidth;
        continue;
      }
      for (const unit of word.units) {
        if (width + unit.width > maxWidth && line.length) commit();
        line.push(unit);
        width += unit.width;
      }
    }
    if (line.length || lines.length === 0) lines.push(line);
    return lines;
  };

  // Hard wrapping for terminal output: spacing is preserved exactly.
  const wrapHard = (units, maxWidth) => {
    const lines = [];
    let line = [];
    let width = 0;
    for (const unit of units) {
      if (width + unit.width > maxWidth && line.length) {
        lines.push(line);
        line = [];
        width = 0;
      }
      line.push(unit);
      width += unit.width;
    }
    lines.push(line);
    return lines;
  };

  // `top` is the top of the line box; text is vertically centred inside `lineHeight`.
  const draw = (page, units, x, top, lineHeight) => {
    let cursor = x;
    for (const unit of units) {
      if (unit.span.bg) page.drawRectangle({ x: cursor, y: top - lineHeight, width: unit.width + 0.15, height: lineHeight, color: color(unit.span.bg) });
      cursor += unit.width;
    }
    cursor = x;
    let index = 0;
    while (index < units.length) {
      const unit = units[index];
      const { span } = unit;
      const baseline = top - lineHeight / 2 - span.size * 0.35;
      if (unit.image) {
        const size = span.size * 1.08;
        page.drawImage(unit.image, { x: cursor + (unit.width - size) / 2, y: baseline - span.size * 0.2, width: size, height: size });
        cursor += unit.width;
        index += 1;
        continue;
      }
      let text = unit.text;
      let width = unit.width;
      let next = index + 1;
      while (next < units.length && !units[next].image && units[next].entry === unit.entry && units[next].span === span) {
        text += units[next].text;
        width += units[next].width;
        next += 1;
      }
      if (text.trim()) page.drawText(text, { x: cursor, y: baseline, size: span.size, font: unit.entry.font, color: color(span.color) });
      if (span.underline) page.drawLine({ start: { x: cursor, y: baseline - span.size * 0.14 }, end: { x: cursor + width, y: baseline - span.size * 0.14 }, thickness: Math.max(0.4, span.size * 0.06), color: color(span.color) });
      cursor += width;
      index = next;
    }
    return cursor - x;
  };

  const truncate = (units, maxWidth) => {
    if (lineWidth(units) <= maxWidth) return units;
    const ellipsis = shape([{ ...units[0].span, text: "…" }]);
    const out = [];
    let width = lineWidth(ellipsis);
    for (const unit of units) {
      if (width + unit.width > maxWidth) break;
      out.push(unit);
      width += unit.width;
    }
    return [...out, ...ellipsis];
  };

  return { shape, wrapProse, wrapHard, draw, lineWidth, truncate };
}

async function loadFamilies(pdf, fontBytes) {
  let id = 0;
  const wrap = (font) => ({ id: (id += 1), font, charset: new Set(font.getCharacterSet()) });
  const standard = async (name) => wrap(await pdf.embedFont(name));
  const helvetica = await standard(StandardFonts.Helvetica);
  const helveticaBold = await standard(StandardFonts.HelveticaBold);
  const courier = await standard(StandardFonts.Courier);
  const courierBold = await standard(StandardFonts.CourierBold);
  if (!fontBytes?.sans || !fontBytes?.mono) {
    return { sans: [helvetica], sansBold: [helveticaBold], mono: [courier], monoBold: [courierBold], unicode: false };
  }
  pdf.registerFontkit(fontkit);
  const custom = async (bytes) => wrap(await pdf.embedFont(bytes, { subset: true }));
  const sans = await custom(fontBytes.sans);
  const sansBold = fontBytes.sansBold ? await custom(fontBytes.sansBold) : sans;
  const mono = await custom(fontBytes.mono);
  const monoBold = fontBytes.monoBold ? await custom(fontBytes.monoBold) : mono;
  return {
    sans: [helvetica, sans, mono],
    sansBold: [helveticaBold, sansBold, sans],
    mono: [mono, sans, courier],
    monoBold: [monoBold, sansBold, mono],
    unicode: true,
  };
}

async function embedEmoji(pdf, corpus, rasterize) {
  const images = new Map();
  if (!rasterize) return images;
  const clusters = new Set(corpus.match(EMOJI_CLUSTER) || []);
  for (const cluster of [...clusters].slice(0, 300)) {
    if (!EMOJI_PRESENTATION.test(cluster) && !PICTOGRAPHIC.test(cluster)) continue;
    try {
      const png = await rasterize(cluster);
      if (png) images.set(cluster, await pdf.embedPng(png));
    } catch {
      // A missing emoji falls back to a font glyph or "?".
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// Report data

function targetData(workspace, targetId) {
  const target = workspace.targets.find((entry) => entry.id === targetId)
    || workspace.targets.find((entry) => entry.id === workspace.activeTargetId)
    || { id: null, name: workspace.variables.targetName, host: workspace.variables.rhost, domain: workspace.variables.domain };
  const scope = target?.id || getActiveScope(workspace);
  const report = workspace.reports[scope] || {};
  const belongs = (entry) => entry.targetId ? entry.targetId === target?.id : entry.target === target?.name;
  const discoveryOptions = {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId: target?.id,
  };
  const commandHistory = (workspace.commandHistory || []).filter(belongs);
  const items = ALL_ITEMS.map((item) => ({
    ...item,
    completed: Boolean(getTargetItemValue(workspace.completed, scope, item.id, false)),
    note: getTargetItemValue(workspace.notes, scope, item.id, ""),
    nextStep: getTargetItemValue(workspace.nextSteps, scope, item.id, ""),
    evidence: getTargetItemValue(workspace.evidence, scope, item.id, []).map((entry) => ({
      ...entry,
      discoveries: visibleDiscoveries(entry.discoveries, discoveryOptions),
    })),
  })).filter((item) => item.completed || item.note || item.nextStep || item.evidence.length > 0 || commandHistory.some((command) => command.itemId === item.id));
  const evidence = items.flatMap((item) => item.evidence);
  return {
    target,
    scope,
    report,
    profile: getOperatorProfile(workspace, report),
    items,
    accounts: workspace.accounts.filter(belongs),
    users: (workspace.users || []).filter(belongs),
    loot: workspace.loot.filter(belongs),
    discoveries: visibleDiscoveries(workspace.discoveries, discoveryOptions).filter(belongs),
    commandHistory,
    userProof: evidence.filter((entry) => entry.category === "user-flag"),
    rootProof: evidence.filter((entry) => entry.category === "root-flag"),
  };
}

const textCorpus = (data) => JSON.stringify(data, (key, value) => (
  ["dataUrl", "fileDataUrl", "profileImage", "avatar"].includes(key) ? undefined : value
));

// Spaces after commas give long port lists natural wrap points.
const portList = (...values) => [...new Set(values.flatMap((value) => String(value || "").split(",")).map((port) => port.trim()).filter(Boolean))].join(", ");

const homeRelative = (path) => String(path || "").replace(/^\/home\/kali(?=\/|$)/, "~").replace(/^\/root(?=\/|$)/, "~");

export const orderCommandRuns = (commands = []) => commands
  .map((command, index) => ({ command, index }))
  .sort((left, right) => {
    const leftTime = Date.parse(left.command.startedAt || left.command.copiedAt || "");
    const rightTime = Date.parse(right.command.startedAt || right.command.copiedAt || "");
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) return left.index - right.index;
    return leftTime - rightTime;
  })
  .map(({ command }) => command);

// ---------------------------------------------------------------------------
// PDF annotations and navigation

const destination = (page, top) => [page.ref, "XYZ", null, top, null];

function addLink(pdf, page, [x1, y1, x2, y2], target) {
  const annotation = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0],
    ...(target.uri
      ? { A: pdf.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(target.uri) }) }
      : { Dest: destination(target.page, target.top) }),
  });
  page.node.addAnnot(pdf.context.register(annotation));
}

function addOutline(pdf, entries) {
  if (entries.length === 0) return;
  const outlineRef = pdf.context.nextRef();
  const refs = entries.map(() => pdf.context.nextRef());
  entries.forEach((entry, index) => {
    pdf.context.assign(refs[index], pdf.context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlineRef,
      Dest: destination(entry.page, entry.top),
      ...(index > 0 ? { Prev: refs[index - 1] } : {}),
      ...(index < entries.length - 1 ? { Next: refs[index + 1] } : {}),
    }));
  });
  pdf.context.assign(outlineRef, pdf.context.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: entries.length }));
  pdf.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

const CIRCLE_K = 0.5522847498;
function drawAvatar(page, { image, name, fonts }, cx, cy, radius) {
  if (image) {
    const offset = radius * CIRCLE_K;
    page.pushOperators(
      pushGraphicsState(),
      moveTo(cx + radius, cy),
      appendBezierCurve(cx + radius, cy + offset, cx + offset, cy + radius, cx, cy + radius),
      appendBezierCurve(cx - offset, cy + radius, cx - radius, cy + offset, cx - radius, cy),
      appendBezierCurve(cx - radius, cy - offset, cx - offset, cy - radius, cx, cy - radius),
      appendBezierCurve(cx + offset, cy - radius, cx + radius, cy - offset, cx + radius, cy),
      closePath(),
      clip(),
      endPath(),
    );
    const scale = Math.max((radius * 2) / image.width, (radius * 2) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: cx - width / 2, y: cy - height / 2, width, height });
    page.pushOperators(popGraphicsState());
  } else {
    page.drawCircle({ x: cx, y: cy, size: radius, color: color(PALETTE.accent) });
    const letters = initials(name);
    const size = radius * 0.78;
    const width = fonts.bold.widthOfTextAtSize(letters, size);
    page.drawText(letters, { x: cx - width / 2, y: cy - size * 0.36, size, font: fonts.bold, color: color(PALETTE.white) });
  }
  page.drawCircle({ x: cx, y: cy, size: radius, borderColor: color(PALETTE.accent), borderWidth: Math.max(1, radius * 0.07) });
}

function roundedRect(page, x, y, width, height, radius, options) {
  const r = Math.min(radius, width / 2, height / 2);
  const path = `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${width - r} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(path, { x, y: y + height, ...options });
}

// ---------------------------------------------------------------------------

export async function generateReportPdf(workspace, targetId, options) {
  return (await buildReportPdf(workspace, targetId, options)).bytes;
}

async function buildReportPdf(workspace, targetId, { fonts: fontBytes, rasterizeEmoji } = {}) {
  const data = targetData(workspace, targetId);
  const pdf = await PDFDocument.create();
  const families = await loadFamilies(pdf, fontBytes);
  const emojiImages = families.unicode ? await embedEmoji(pdf, textCorpus(data), rasterizeEmoji) : new Map();
  const ts = createTypesetter(families, emojiImages);
  const generatedAt = new Date();
  const targetName = data.target?.name || workspace.variables.targetName;
  const reportTitle = data.report.title || `${targetName} Penetration Test Report`;
  const github = githubProfile(data.profile.github);

  let avatarImage = null;
  if (data.profile.avatar) {
    try {
      avatarImage = await embedDataUrlImage(pdf, data.profile.avatar);
    } catch {
      avatarImage = null;
    }
  }

  const span = (text, style = {}) => ({ text, family: "sans", size: 10, color: PALETTE.body, ...style });
  const mono = (text, style = {}) => span(text, { family: "mono", size: 8.6, ...style });

  let page;
  let y;
  const outline = [];
  const toc = [];
  let figureNumber = 0;

  const newPage = () => {
    page = pdf.addPage(PAGE_SIZE);
    y = CONTENT_TOP;
  };
  const ensure = (height) => {
    if (!page || y - height < CONTENT_BOTTOM) newPage();
  };
  const space = (amount) => {
    y -= amount;
  };

  const paragraph = (spans, { indent = 0, lineHeight, after = 6, width = CONTENT_W - indent } = {}) => {
    const list = Array.isArray(spans) ? spans : [spans];
    const size = list[0]?.size || 10;
    const height = lineHeight || size * 1.48;
    for (const line of ts.wrapProse(ts.shape(list), width)) {
      ensure(height);
      ts.draw(page, line, LEFT + indent, y, height);
      y -= height;
    }
    y -= after;
  };

  // Free text typed by the operator: blank lines separate paragraphs; "-", "*", "•", and "1." start list items.
  const prose = (text, style = {}) => {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let gapPending = false;
    for (const raw of lines) {
      if (!raw.trim()) {
        gapPending = true;
        continue;
      }
      if (gapPending) space(5);
      gapPending = false;
      const bullet = raw.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        const lineHeight = (style.size || 10) * 1.48;
        ensure(lineHeight);
        const top = y;
        const bulletPage = page;
        paragraph(span(bullet[2], style), { indent: 16, after: 2 });
        if (/\d/.test(bullet[1])) ts.draw(bulletPage, ts.shape([span(bullet[1], { ...style, color: PALETTE.accent, bold: true })]), LEFT + 1, top, lineHeight);
        else bulletPage.drawCircle({ x: LEFT + 5, y: top - lineHeight / 2, size: 1.9, color: color(PALETTE.accent) });
      } else {
        paragraph(span(raw, style), { after: 3 });
      }
    }
    space(4);
  };

  let sectionNumber = 0;
  let subsectionNumber = 0;
  const section = (title, { startPage = true } = {}) => {
    if (startPage || !page) newPage();
    else ensure(90);
    sectionNumber += 1;
    subsectionNumber = 0;
    const number = String(sectionNumber).padStart(2, "0");
    const top = y;
    ts.draw(page, ts.shape([mono(`SECTION ${number}`, { size: 7.5, bold: true, color: PALETTE.accent })]), LEFT, y, 11);
    y -= 13;
    paragraph(span(title, { size: 20, bold: true, color: PALETTE.ink }), { lineHeight: 25, after: 4 });
    page.drawRectangle({ x: LEFT, y: y - 1, width: 34, height: 2.4, color: color(PALETTE.accent) });
    y -= 18;
    outline.push({ title: `${sectionNumber}. ${title}`, page, top: top + 10 });
    toc.push({ level: 1, number: `${sectionNumber}`, title, page, top: top + 10 });
  };

  // `keep` is the height of what follows, so a heading never sits alone at the bottom of a page.
  const subheading = (title, { tocEntry = true, keep = 110 } = {}) => {
    ensure(24 + Math.min(keep, CONTENT_TOP - CONTENT_BOTTOM - 24));
    subsectionNumber += 1;
    const number = `${sectionNumber}.${subsectionNumber}`;
    const top = y;
    paragraph([span(`${number}  `, { size: 12.5, bold: true, color: PALETTE.accent }), span(title, { size: 12.5, bold: true, color: PALETTE.ink })], { lineHeight: 17, after: 5 });
    if (tocEntry) toc.push({ level: 2, number, title, page, top: top + 6 });
  };

  const eyebrow = (text, { keep = 60 } = {}) => {
    ensure(24 + keep);
    ts.draw(page, ts.shape([mono(text.toUpperCase(), { size: 7.4, bold: true, color: PALETTE.muted })]), LEFT, y, 11);
    page.drawLine({ start: { x: LEFT, y: y - 14 }, end: { x: RIGHT, y: y - 14 }, thickness: 0.5, color: color(PALETTE.line) });
    y -= 24;
  };

  const chip = (text, { fg, bg }, x, top) => {
    const units = ts.shape([span(text.toUpperCase(), { size: 6.8, bold: true, color: fg })]);
    const width = ts.lineWidth(units) + 12;
    roundedRect(page, x, top - 13, width, 13, 6.5, { color: color(bg) });
    ts.draw(page, units, x + 6, top, 13);
    return width;
  };

  const callout = (label, text, { fg = PALETTE.accent, bg = PALETTE.accentSoft } = {}) => {
    const size = 9.4;
    const lineHeight = size * 1.5;
    const labelUnits = ts.shape([span(label.toUpperCase(), { size: 6.8, bold: true, color: fg })]);
    const lines = String(text || "").split(/\r?\n/).flatMap((line) => ts.wrapProse(ts.shape([span(line, { size, color: PALETTE.body })]), CONTENT_W - 26));
    let index = 0;
    let first = true;
    while (index < lines.length) {
      const headerHeight = first ? 15 : 0;
      ensure(headerHeight + lineHeight + 16);
      const available = Math.floor((y - CONTENT_BOTTOM - headerHeight - 16) / lineHeight);
      const chunk = lines.slice(index, index + Math.max(1, available));
      const height = headerHeight + chunk.length * lineHeight + 16;
      page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_W, height, color: color(bg) });
      page.drawRectangle({ x: LEFT, y: y - height, width: 2.6, height, color: color(fg) });
      let top = y - 8;
      if (first) {
        ts.draw(page, labelUnits, LEFT + 14, top, 11);
        top -= headerHeight;
      }
      for (const line of chunk) {
        ts.draw(page, line, LEFT + 14, top, lineHeight);
        top -= lineHeight;
      }
      y -= height;
      index += chunk.length;
      first = false;
      if (index < lines.length) newPage();
    }
    y -= 10;
  };

  const keyValues = (rows, { labelWidth = 128 } = {}) => {
    const visible = rows.filter(([, value]) => value);
    visible.forEach(([label, value, style = {}], index) => {
      const valueSpans = Array.isArray(value) ? value : [style.mono ? mono(String(value), { size: 8.8, color: PALETTE.ink, ...style }) : span(String(value), { size: 9.6, color: PALETTE.ink, ...style })];
      const lines = ts.wrapProse(ts.shape(valueSpans), CONTENT_W - labelWidth - 20);
      const lineHeight = 13.5;
      const height = lines.length * lineHeight + 11;
      ensure(height);
      if (index % 2 === 0) page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_W, height, color: color(PALETTE.tint) });
      ts.draw(page, ts.shape([span(label.toUpperCase(), { size: 7, bold: true, color: PALETTE.muted })]), LEFT + 10, y - 5.5, lineHeight);
      let top = y - 5.5;
      for (const line of lines) {
        ts.draw(page, line, LEFT + labelWidth, top, lineHeight);
        top -= lineHeight;
      }
      y -= height;
    });
    if (visible.length) y -= 14;
  };

  const table = (columns, rows, { empty } = {}) => {
    if (rows.length === 0) {
      if (empty) paragraph(span(empty, { size: 9.4, color: PALETTE.muted }), { after: 10 });
      return;
    }
    const widths = columns.map((column) => column.width * CONTENT_W);
    const padX = 8;
    const lineHeight = 12.4;
    const header = () => {
      ensure(22 + lineHeight + 10);
      page.drawRectangle({ x: LEFT, y: y - 20, width: CONTENT_W, height: 20, color: color(PALETTE.ink) });
      let x = LEFT;
      columns.forEach((column, index) => {
        ts.draw(page, ts.truncate(ts.shape([span(column.label.toUpperCase(), { size: 6.9, bold: true, color: PALETTE.white })]), widths[index] - padX * 2), x + padX, y, 20);
        x += widths[index];
      });
      y -= 20;
    };
    header();
    rows.forEach((row, rowIndex) => {
      const cells = row.map((value, index) => {
        const column = columns[index];
        const text = String(value ?? "").slice(0, 600) || "—";
        const style = { size: column.mono ? 8.2 : 8.8, color: value ? (column.color || PALETTE.ink) : PALETTE.faint, bold: column.bold };
        return ts.wrapProse(ts.shape([column.mono ? mono(text, style) : span(text, style)]), widths[index] - padX * 2);
      });
      const height = Math.max(...cells.map((lines) => lines.length)) * lineHeight + 10;
      if (y - height < CONTENT_BOTTOM) {
        newPage();
        header();
      }
      if (rowIndex % 2 === 1) page.drawRectangle({ x: LEFT, y: y - height, width: CONTENT_W, height, color: color(PALETTE.tint) });
      page.drawLine({ start: { x: LEFT, y: y - height }, end: { x: RIGHT, y: y - height }, thickness: 0.5, color: color(PALETTE.line) });
      let x = LEFT;
      cells.forEach((lines, index) => {
        let top = y - 5;
        for (const line of lines) {
          ts.draw(page, line, x + padX, top, lineHeight);
          top -= lineHeight;
        }
        x += widths[index];
      });
      y -= height;
    });
    y -= 16;
  };

  // A dark terminal window that keeps ANSI colors and splits cleanly across pages.
  const terminal = ({ title, meta, lines: sourceLines, omitted = 0, omittedNote }) => {
    const size = 7.5;
    const lineHeight = 10.6;
    const padX = 11;
    const padY = 8;
    const barHeight = 18;
    const style = (segmentStyle = {}) => {
      let fg = segmentStyle.fg || TERMINAL_THEME.foreground;
      let bg = segmentStyle.bg;
      if (segmentStyle.inverse) [fg, bg] = [bg || TERMINAL_THEME.background, fg];
      if (segmentStyle.dim) fg = mix(fg, TERMINAL_THEME.background, 0.6);
      return { family: "mono", size, color: fg, bg, bold: Boolean(segmentStyle.bold), underline: Boolean(segmentStyle.underline) };
    };
    const visual = [];
    for (const segments of sourceLines) {
      const units = ts.shape(segments.map((segment) => ({ text: segment.text, ...style(segment.style) })));
      visual.push(...ts.wrapHard(units, CONTENT_W - padX * 2));
    }
    if (omitted > 0) {
      visual.push([]);
      visual.push(...ts.wrapHard(ts.shape([{ text: omittedNote || `… ${omitted} more line${omitted === 1 ? "" : "s"} omitted`, ...style({ fg: TERMINAL_THEME.muted }) }]), CONTENT_W - padX * 2));
    }
    while (visual.length > 1 && visual[visual.length - 1].length === 0) visual.pop();

    const titleUnits = ts.truncate(ts.shape([{ text: title, family: "mono", size: 7, bold: true, color: "#c7d4ca" }]), CONTENT_W * 0.58);
    const metaUnits = meta ? ts.truncate(ts.shape([{ text: meta, family: "mono", size: 6.6, color: TERMINAL_THEME.muted }]), CONTENT_W * 0.36) : [];
    let index = 0;
    let first = true;
    while (index < visual.length) {
      ensure(barHeight + padY * 2 + lineHeight * Math.min(3, visual.length - index));
      const capacity = Math.max(1, Math.floor((y - CONTENT_BOTTOM - barHeight - padY * 2) / lineHeight));
      const chunk = visual.slice(index, index + capacity);
      const height = barHeight + padY * 2 + chunk.length * lineHeight;
      const bottom = y - height;
      roundedRect(page, LEFT, bottom, CONTENT_W, height, 5, { color: color(TERMINAL_THEME.chrome), borderColor: color(PALETTE.terminalBorder), borderWidth: 0.6 });
      roundedRect(page, LEFT + 0.3, bottom + 0.3, CONTENT_W - 0.6, height - barHeight - 0.3, 4.7, { color: color(TERMINAL_THEME.background) });
      page.drawRectangle({ x: LEFT + 0.3, y: y - barHeight - 6, width: CONTENT_W - 0.6, height: 6, color: color(TERMINAL_THEME.background) });
      ["#ff5f56", "#ffbd2e", "#27c93f"].forEach((dot, dotIndex) => page.drawCircle({ x: LEFT + 12 + dotIndex * 9, y: y - barHeight / 2, size: 2.6, color: color(dot) }));
      const label = first ? titleUnits : ts.truncate(ts.shape([{ text: `${title} (continued)`, family: "mono", size: 7, bold: true, color: "#c7d4ca" }]), CONTENT_W * 0.58);
      ts.draw(page, label, LEFT + 44, y, barHeight);
      if (metaUnits.length) ts.draw(page, metaUnits, RIGHT - 10 - ts.lineWidth(metaUnits), y, barHeight);
      let top = y - barHeight - padY;
      for (const line of chunk) {
        ts.draw(page, line, LEFT + padX, top, lineHeight);
        top -= lineHeight;
      }
      y = bottom;
      index += chunk.length;
      first = false;
      if (index < visual.length) newPage();
    }
    y -= 12;
  };

  const kaliPrompt = (command) => {
    const blue = PALETTE.kaliBlue;
    const path = homeRelative(`${workspace.variables.workspaceRoot}/${targetName}`);
    const commandLines = String(command || "").replace(/\r\n/g, "\n").split("\n");
    return [
      [{ text: "┌──(", style: { fg: blue } }, { text: "kali㉿kali", style: { fg: blue, bold: true } }, { text: ")-[", style: { fg: blue } }, { text: path, style: { fg: "#ffffff", bold: true } }, { text: "]", style: { fg: blue } }],
      [{ text: "└─", style: { fg: blue } }, { text: "$ ", style: { fg: blue, bold: true } }, { text: commandLines[0], style: {} }],
      ...commandLines.slice(1).map((line) => [{ text: line, style: {} }]),
    ];
  };

  const outputBlock = (evidence, attachmentName) => {
    const lines = terminalLines(evidence.content);
    while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
    const omitted = Math.max(0, lines.length - TERMINAL_LINE_LIMIT);
    terminal({
      title: evidence.label || evidence.filename || "Command output",
      meta: [formatBytes(evidence.size), formatTimestamp(evidence.createdAt)].filter(Boolean).join(" · "),
      lines: lines.slice(0, TERMINAL_LINE_LIMIT),
      omitted,
      omittedNote: omitted ? `… ${omitted} more line${omitted === 1 ? "" : "s"} omitted. Full output is attached to this PDF${attachmentName ? ` as ${attachmentName}` : ""}.` : "",
    });
  };

  const parsedFindingsBlock = (discoveries = []) => {
    if (discoveries.length === 0) return;
    eyebrow(`Parsed findings · ${discoveries.length}`);
    table(
      [{ label: "Type", width: 0.2, bold: true }, { label: "Finding", width: 0.5, mono: true }, { label: "Context", width: 0.3 }],
      discoveries.map((entry) => [DISCOVERY_LABELS[entry.type] || entry.type.replace(/-/g, " "), entry.value, discoveryContext(entry)]),
    );
  };

  const loadFigure = async (dataUrl, mimeType) => {
    try {
      const image = await embedDataUrlImage(pdf, dataUrl, mimeType);
      const scale = Math.min(CONTENT_W / image.width, 360 / image.height, 1);
      return { image, width: image.width * scale, height: image.height * scale };
    } catch {
      return null;
    }
  };

  const figure = (loaded, caption) => {
    if (!loaded) {
      callout("Screenshot unavailable", `${caption} could not be rendered. The original file remains embedded as a PDF attachment.`, { fg: PALETTE.warn, bg: PALETTE.warnSoft });
      return;
    }
    figureNumber += 1;
    const { image, width, height } = loaded;
    ensure(height + 34);
    const x = LEFT + (CONTENT_W - width) / 2;
    page.drawRectangle({ x: x - 3, y: y - height - 3, width: width + 6, height: height + 6, color: color(PALETTE.white), borderColor: color(PALETTE.line), borderWidth: 0.8 });
    page.drawImage(image, { x, y: y - height, width, height });
    y -= height + 9;
    const captionUnits = ts.shape([span(`Figure ${figureNumber}. `, { size: 8.4, bold: true, color: PALETTE.ink }), span(caption, { size: 8.4, color: PALETTE.muted })]);
    for (const line of ts.wrapProse(captionUnits, CONTENT_W)) {
      ensure(12);
      ts.draw(page, line, LEFT + (CONTENT_W - ts.lineWidth(line)) / 2, y, 12);
      y -= 12;
    }
    y -= 14;
    return figureNumber;
  };

  // Attachment names are assigned up front so truncated output blocks can point at them.
  const attachmentNames = new Map();
  let attachmentIndex = 0;
  for (const evidence of data.items.flatMap((item) => item.evidence)) {
    if (!(evidence.dataUrl || evidence.fileDataUrl || evidence.content)) continue;
    attachmentIndex += 1;
    attachmentNames.set(evidence, `${String(attachmentIndex).padStart(3, "0")}-${safeFilename(evidence.filename || evidence.label)}`);
  }

  // ---- Cover -------------------------------------------------------------
  newPage();
  const coverPage = page;
  y = PAGE_H - 150;
  ts.draw(page, ts.shape([mono("OSCP+ PENETRATION TEST REPORT", { size: 8.5, bold: true, color: PALETTE.accent })]), LEFT, y, 12);
  y -= 22;
  paragraph(span(reportTitle, { size: 30, bold: true, color: PALETTE.ink }), { lineHeight: 35, after: 4 });
  paragraph(span(`${targetName}${data.target?.host ? `  ·  ${data.target.host}` : ""}${data.target?.domain ? `  ·  ${data.target.domain}` : ""}`, { size: 12.5, color: PALETTE.muted }), { after: 14 });
  page.drawRectangle({ x: LEFT, y, width: 48, height: 3, color: color(PALETTE.accent) });
  y -= 30;

  const cardHeight = 92;
  roundedRect(page, LEFT, y - cardHeight, CONTENT_W, cardHeight, 8, { color: color(PALETTE.tint), borderColor: color(PALETTE.line), borderWidth: 0.7 });
  drawAvatar(page, { image: avatarImage, name: data.profile.name, fonts: { bold: families.sansBold[0].font } }, LEFT + 50, y - cardHeight / 2, 30);
  let cardTop = y - 16;
  ts.draw(page, ts.shape([mono("PREPARED BY", { size: 6.8, bold: true, color: PALETTE.muted })]), LEFT + 96, cardTop, 10);
  cardTop -= 12;
  ts.draw(page, ts.truncate(ts.shape([span(data.profile.name || "Operator name not set", { size: 15, bold: true, color: data.profile.name ? PALETTE.ink : PALETTE.faint })]), CONTENT_W - 120), LEFT + 96, cardTop, 20);
  cardTop -= 21;
  if (data.profile.osid) {
    ts.draw(page, ts.shape([span("OSID  ", { size: 8.6, bold: true, color: PALETTE.muted }), mono(data.profile.osid, { size: 9, color: PALETTE.ink })]), LEFT + 96, cardTop, 13);
    cardTop -= 13;
  }
  if (github) {
    const units = ts.shape([span("GitHub  ", { size: 8.6, bold: true, color: PALETTE.muted }), span(github.display, { size: 9, color: PALETTE.accent, underline: true })]);
    const width = ts.draw(page, units, LEFT + 96, cardTop, 13);
    addLink(pdf, page, [LEFT + 96, cardTop - 13, LEFT + 96 + width, cardTop], { uri: github.url });
  }
  y -= cardHeight + 26;

  const endpoints = data.target?.endpoints || [];
  keyValues([
    ["Target", targetName],
    ["IP address", data.target?.host || workspace.variables.rhost, { mono: true }],
    ["Hostnames", [...new Set(endpoints.flatMap((endpoint) => endpoint.hostnames || []))].join(", "), { mono: true }],
    ["Domain", data.target?.domain || workspace.variables.domain, { mono: true }],
    ["TCP ports", portList(...(endpoints.length ? endpoints.map((endpoint) => endpoint.tcpPorts) : [data.target?.port || workspace.variables.rport])), { mono: true }],
    ["UDP ports", portList(...(endpoints.length ? endpoints.map((endpoint) => endpoint.udpPorts) : [data.target?.udpPorts || workspace.variables.uport])), { mono: true }],
    ["Workspace", `${workspace.variables.workspaceRoot}/${targetName}`, { mono: true }],
    ["Generated", formatTimestamp(generatedAt)],
  ]);

  const stats = [
    ["Checks completed", data.items.filter((item) => item.completed).length],
    ["Evidence items", data.items.reduce((total, item) => total + item.evidence.length, 0)],
    ["Commands logged", data.commandHistory.length],
    ["Credentials", data.accounts.length],
  ];
  const statWidth = (CONTENT_W - 30) / stats.length;
  ensure(64);
  stats.forEach(([label, value], index) => {
    const x = LEFT + index * (statWidth + 10);
    roundedRect(page, x, y - 56, statWidth, 56, 6, { borderColor: color(PALETTE.line), borderWidth: 0.8, color: color(PALETTE.white) });
    ts.draw(page, ts.shape([span(String(value), { size: 20, bold: true, color: PALETTE.accent })]), x + 12, y - 8, 24);
    ts.draw(page, ts.shape([span(label.toUpperCase(), { size: 6.6, bold: true, color: PALETTE.muted })]), x + 12, y - 34, 12);
  });
  y -= 76;
  const proofChips = [
    ["Local / user proof", data.userProof.length > 0],
    ["Root / Administrator proof", data.rootProof.length > 0],
  ];
  let chipX = LEFT;
  for (const [label, ready] of proofChips) {
    chipX += chip(`${ready ? "✓" : "✗"} ${label}`, ready ? { fg: PALETTE.accent, bg: PALETTE.accentSoft } : { fg: PALETTE.warn, bg: PALETTE.warnSoft }, chipX, y) + 8;
  }
  const coverNote = span("This report was generated by Fieldnotes from target-scoped checklist notes and attached evidence. The complete workspace and every evidence file are embedded as PDF attachments, so the report can restore the notebook later. It contains credentials and exam evidence in plain text — handle it accordingly.", { size: 8.2, color: PALETTE.muted });
  const coverNoteLines = ts.wrapProse(ts.shape([coverNote]), CONTENT_W).length;
  y = Math.min(y, CONTENT_BOTTOM + coverNoteLines * 12 + 4);
  paragraph(coverNote, { lineHeight: 12, after: 0 });

  // ---- 1. Executive summary ---------------------------------------------
  section("Executive Summary");
  prose(data.report.executiveSummary || "Explain in plain language whether unauthorized access was achieved, what that access would mean to the organization, and the most important corrective action. Avoid commands, tool names, port numbers, and acronyms.", { color: data.report.executiveSummary ? PALETTE.body : PALETTE.faint });

  // ---- 2. Scope and attack surface --------------------------------------
  section("Scope and Attack Surface");
  prose(data.report.scope || `${data.target?.host || workspace.variables.rhost} (${targetName})`);
  space(4);
  eyebrow("Endpoints");
  table(
    [{ label: "Address", width: 0.2, mono: true, bold: true }, { label: "Hostnames", width: 0.34, mono: true }, { label: "TCP", width: 0.28, mono: true }, { label: "UDP", width: 0.18, mono: true }],
    endpoints.map((endpoint) => [endpoint.address, (endpoint.hostnames || []).join(", "), portList(endpoint.tcpPorts), portList(endpoint.udpPorts)]),
    { empty: "No endpoints were recorded for this machine." },
  );
  const ports = data.discoveries.filter((entry) => entry.type === "port")
    .sort((a, b) => (a.protocol || "").localeCompare(b.protocol || "") || Number(a.value) - Number(b.value));
  eyebrow("Open ports");
  table(
    [{ label: "Port", width: 0.14, mono: true, bold: true }, { label: "Protocol", width: 0.14, mono: true }, { label: "State", width: 0.2, mono: true, color: PALETTE.accent }, { label: "Service", width: 0.26, mono: true }, { label: "Endpoint", width: 0.26, mono: true }],
    ports.map((entry) => [entry.value, (entry.protocol || "").toUpperCase(), entry.state || "open", entry.service, entry.address]),
    { empty: "No ports were parsed from scan output." },
  );
  const otherDiscoveries = data.discoveries.filter((entry) => entry.type !== "port");
  if (otherDiscoveries.length) {
    eyebrow("Other parsed discoveries");
    const groups = new Map();
    for (const entry of otherDiscoveries) groups.set(entry.type, [...(groups.get(entry.type) || []), entry]);
    table(
      [{ label: "Type", width: 0.2, bold: true }, { label: "Values", width: 0.8, mono: true }],
      [...groups].map(([type, entries]) => [type.replace(/-/g, " "), entries.map((entry) => formatDiscovery(entry).replace(/^[^:]+:\s*/, "")).join(", ")]),
    );
  }

  // ---- 3. Credentials and users -----------------------------------------
  section("Credentials and Users");
  eyebrow("Credentials obtained");
  table(
    [{ label: "Account", width: 0.34, mono: true, bold: true }, { label: "Secret", width: 0.42, mono: true }, { label: "Status", width: 0.24 }],
    data.accounts.map((account) => [`${account.domain ? `${account.domain}\\` : ""}${account.username}`, account.secret, account.status || "credential"]),
    { empty: "No credentials were saved for this machine." },
  );
  eyebrow("Tracked users");
  table(
    [{ label: "User", width: 0.5, mono: true, bold: true }, { label: "Source", width: 0.5 }],
    data.users.map((user) => [`${user.domain ? `${user.domain}\\` : ""}${user.username}`, user.source]),
    { empty: "No standalone usernames were saved." },
  );

  // ---- 4. Attack narrative ----------------------------------------------
  section("Attack Narrative");
  paragraph(span("This section explains the assessment as a chain of decisions: what was being tested, what the evidence established, and why that result justified the next action. Exact commands and short console excerpts are retained in the appendix for reproducibility.", { size: 9.4, color: PALETTE.muted }), { after: 12 });
  const narrativeItems = data.items.filter((item) => item.note || item.nextStep || item.evidence.some((evidence) => evidence.dataUrl && !PROOF_CATEGORIES.has(evidence.category)));
  if (narrativeItems.length === 0) callout("Narrative incomplete", "Recorded activity is preserved in the appendix, but no readable attack narrative has been written. Complete the two narrative prompts on the checklist before submission.", { fg: PALETTE.warn, bg: PALETTE.warnSoft });
  const orderedCommands = orderCommandRuns(data.commandHistory);
  const phaseNumbers = new Map(CHECKLIST.map((phase) => [phase.id, phase.number]));
  let currentPhase = null;
  for (const item of narrativeItems) {
    if (item.phaseId !== currentPhase) {
      currentPhase = item.phaseId;
      space(4);
      eyebrow(`Phase ${phaseNumbers.get(item.phaseId) || ""} — ${item.phaseTitle}`, { keep: 140 });
    }
    subheading(item.title);
    const commands = data.commandHistory.filter((command) => command.itemId === item.id);
    const objective = item.detail || (commands[0] ? describeCommand(commands[0].command, commands[0].label).purpose : "Review the available evidence for this stage of the assessment.");
    paragraph([span("Objective  ", { size: 8, bold: true, color: PALETTE.muted }), span(objective, { size: 9, color: PALETTE.body })], { lineHeight: 13, after: 8 });
    if (item.note) callout("What the evidence established", item.note, { fg: PALETTE.ink, bg: PALETTE.tint });
    else callout("Narrative needed", "Explain the useful fact established by this step in plain language. Do not repeat the command.", { fg: PALETTE.warn, bg: PALETTE.warnSoft });
    if (item.nextStep) callout("Why the next action followed", item.nextStep, { fg: PALETTE.accent, bg: PALETTE.accentSoft });
    else callout("Decision needed", "Explain how the result narrowed the attack path or justified the next test.", { fg: PALETTE.warn, bg: PALETTE.warnSoft });
    const itemDiscoveries = [...new Map(item.evidence.flatMap((evidence) => evidence.discoveries || []).map((entry) => [discoveryKey(entry), entry])).values()];
    parsedFindingsBlock(itemDiscoveries);
    for (const evidence of item.evidence) {
      if (evidence.dataUrl && PROOF_CATEGORIES.has(evidence.category)) {
        paragraph([span("Proof screenshot  ", { size: 8.6, bold: true, color: PALETTE.accent }), span(`${evidence.label} — shown under Proof of Compromise.`, { size: 8.6, color: PALETTE.muted })], { after: 8 });
      } else if (evidence.dataUrl) {
        figure(await loadFigure(evidence.dataUrl, evidence.mimeType), `${item.title} — ${evidence.label}`);
      }
    }
    space(14);
  }

  // ---- 5. Proof of compromise -------------------------------------------
  section("Proof of Compromise");
  paragraph(span("Proof screenshots should show the flag contents together with the target's IP configuration in the same interactive shell.", { size: 9.4, color: PALETTE.muted }), { after: 12 });
  for (const [title, entries] of [["Local / user proof", data.userProof], ["Root / Administrator proof", data.rootProof]]) {
    const figures = await Promise.all(entries.map((entry) => loadFigure(entry.dataUrl, entry.mimeType)));
    subheading(title, { keep: figures[0] ? figures[0].height + 40 : 60 });
    if (entries.length === 0) {
      callout("Missing", `No ${title.toLowerCase()} screenshot was attached. Add one from the Report page before submission.`, { fg: PALETTE.warn, bg: PALETTE.warnSoft });
      continue;
    }
    entries.forEach((entry, index) => figure(figures[index], `${title} — ${entry.label}`));
  }

  // ---- 6. Recommendations ------------------------------------------------
  section("Conclusion and Recommendations");
  prose(data.report.recommendations || "Record the remediation actions that would prevent the attack path and reduce the impact of credential reuse or excessive privilege.", { color: data.report.recommendations ? PALETTE.body : PALETTE.faint });
  space(8);
  eyebrow("Loot and proof inventory");
  table(
    [{ label: "Item", width: 0.28, bold: true }, { label: "Location", width: 0.34, mono: true }, { label: "Value", width: 0.38, mono: true }],
    data.loot.map((entry) => [entry.label, entry.location, entry.value]),
    { empty: "No loot records were saved." },
  );

  // ---- Appendix: concise command evidence --------------------------------
  section("Appendix — Commands and Evidence", { startPage: true });
  paragraph(span(`Commands are listed in execution order. Console output is limited to ${TERMINAL_LINE_LIMIT} lines per result to keep the report readable; complete logs remain embedded as PDF attachments.`, { size: 9.4, color: PALETTE.muted }), { after: 12 });
  const terminalEvidence = data.items.flatMap((item) => item.evidence).filter((evidence) => evidence.commandRunId);
  if (orderedCommands.length === 0) callout("No terminal runs", "No commands were launched through the local runner for this target.", { fg: PALETTE.warn, bg: PALETTE.warnSoft });
  for (const [commandIndex, command] of orderedCommands.entries()) {
    const item = data.items.find((candidate) => candidate.id === command.itemId);
    const insight = describeCommand(command.command, command.label);
    subheading(`${commandIndex + 1}. ${command.label || "Command"}`);
    paragraph([
      span(`${item?.title || "Checklist command"}  ·  `, { size: 8, bold: true, color: PALETTE.muted }),
      span(insight.purpose, { size: 8.4, color: PALETTE.body }),
    ], { lineHeight: 12, after: 7 });
    terminal({
      title: command.label || "Command",
      meta: [command.address, formatTimestamp(command.startedAt || command.copiedAt)].filter(Boolean).join(" · "),
      lines: kaliPrompt(command.command),
    });
    const results = terminalEvidence.filter((candidate) => candidate.commandRunId === command.id);
    if (results.length === 0) paragraph(span("No captured console result was linked to this run.", { size: 8, color: PALETTE.warn }), { after: 9 });
    for (const evidence of results) if (evidence.content) outputBlock(evidence, attachmentNames.get(evidence));
  }
  const additionalOutputs = data.items.flatMap((item) => item.evidence).filter((evidence) => evidence.content && !evidence.commandRunId);
  if (additionalOutputs.length > 0) {
    subheading("Additional pasted or attached output");
    for (const evidence of additionalOutputs) outputBlock(evidence, attachmentNames.get(evidence));
  }

  // ---- Appendix: embedded files ------------------------------------------
  section("Appendix — Embedded Files", { startPage: data.loot.length > 6 });
  paragraph(span(`Open the PDF's attachments panel to extract these files. ${WORKSPACE_ATTACHMENT} restores the complete Fieldnotes workspace through Report → Restore workspace from PDF.`, { size: 9.4, color: PALETTE.muted }), { after: 10 });
  table(
    [{ label: "Attachment", width: 0.5, mono: true, bold: true }, { label: "Type", width: 0.3, mono: true }, { label: "Size", width: 0.2, mono: true }],
    [
      [WORKSPACE_ATTACHMENT, "application/json", "workspace"],
      ...[...attachmentNames].map(([evidence, name]) => {
        const encoded = evidence.dataUrl || evidence.fileDataUrl;
        const size = evidence.size || (encoded ? Math.floor(((encoded.split(",")[1] || "").length * 3) / 4) : new TextEncoder().encode(evidence.content || "").length);
        return [name, evidence.mimeType || "text/plain", formatBytes(size)];
      }),
    ],
  );

  // ---- Contents (inserted after the cover) -------------------------------
  const tocPageCount = Math.max(1, Math.ceil((toc.length + 2) / TOC_ENTRIES_PER_PAGE));
  const tocPages = Array.from({ length: tocPageCount }, (_, index) => pdf.insertPage(1 + index, PAGE_SIZE));
  const pageNumber = (target) => pdf.getPages().indexOf(target) + 1;
  let tocIndex = 0;
  tocPages.forEach((tocPage, pageIndex) => {
    page = tocPage;
    y = CONTENT_TOP;
    if (pageIndex === 0) {
      ts.draw(page, ts.shape([mono("REPORT", { size: 7.5, bold: true, color: PALETTE.accent })]), LEFT, y, 11);
      y -= 13;
      paragraph(span("Contents", { size: 20, bold: true, color: PALETTE.ink }), { lineHeight: 25, after: 4 });
      page.drawRectangle({ x: LEFT, y: y - 1, width: 34, height: 2.4, color: color(PALETTE.accent) });
      y -= 22;
      outline.unshift({ title: "Contents", page: tocPage, top: CONTENT_TOP + 10 });
    }
    while (tocIndex < toc.length && y - 18 > CONTENT_BOTTOM) {
      const entry = toc[tocIndex];
      const level1 = entry.level === 1;
      const indent = level1 ? 0 : 22;
      const size = level1 ? 10.4 : 9;
      const lineHeight = level1 ? 22 : 16;
      if (level1 && tocIndex > 0) y -= 4;
      const numberUnits = ts.shape([span(entry.number, { size, bold: level1, color: PALETTE.accent })]);
      const titleUnits = ts.truncate(ts.shape([span(entry.title, { size, bold: level1, color: level1 ? PALETTE.ink : PALETTE.body })]), CONTENT_W - indent - 90);
      const pageUnits = ts.shape([span(String(pageNumber(entry.page)), { size, bold: level1, color: PALETTE.ink })]);
      ts.draw(page, numberUnits, LEFT + indent, y, lineHeight);
      const titleX = LEFT + indent + (level1 ? 26 : 30);
      const titleEnd = titleX + ts.draw(page, titleUnits, titleX, y, lineHeight);
      const pageX = RIGHT - ts.lineWidth(pageUnits);
      ts.draw(page, pageUnits, pageX, y, lineHeight);
      const leaderY = y - lineHeight / 2 - size * 0.35;
      page.drawLine({ start: { x: titleEnd + 6, y: leaderY }, end: { x: pageX - 6, y: leaderY }, thickness: 0.7, color: color(PALETTE.line), dashArray: [0.8, 2.6] });
      addLink(pdf, page, [LEFT + indent, y - lineHeight, RIGHT, y], { page: entry.page, top: entry.top });
      y -= lineHeight;
      tocIndex += 1;
    }
  });

  // ---- Header and footer on every page ------------------------------------
  const pages = pdf.getPages();
  const headerFonts = { bold: families.sansBold[0].font };
  pages.forEach((pdfPage, index) => {
    const avatarY = PAGE_H - 50;
    drawAvatar(pdfPage, { image: avatarImage, name: data.profile.name, fonts: headerFonts }, LEFT + 15, avatarY, 15);
    const textX = LEFT + 40;
    const nameUnits = ts.truncate(ts.shape([span(data.profile.name || "Operator", { size: 10, bold: true, color: PALETTE.ink })]), CONTENT_W * 0.45);
    ts.draw(pdfPage, nameUnits, textX, avatarY + 13, 13);
    const detailSpans = [];
    if (data.profile.osid) detailSpans.push(span("OSID ", { size: 7.4, bold: true, color: PALETTE.muted }), mono(data.profile.osid, { size: 7.4, color: PALETTE.body }));
    if (data.profile.osid && github) detailSpans.push(span("   ·   ", { size: 7.4, color: PALETTE.faint }));
    let githubStart = null;
    if (github) {
      githubStart = ts.lineWidth(ts.shape(detailSpans));
      detailSpans.push(span(github.display, { size: 7.4, color: PALETTE.accent }));
    }
    if (detailSpans.length) {
      const width = ts.draw(pdfPage, ts.truncate(ts.shape(detailSpans), CONTENT_W * 0.5), textX, avatarY - 1, 11);
      if (github && githubStart !== null && githubStart < width) addLink(pdf, pdfPage, [textX + githubStart, avatarY - 12, textX + width, avatarY - 1], { uri: github.url });
    }
    const titleUnits = ts.truncate(ts.shape([span(reportTitle, { size: 8.6, bold: true, color: PALETTE.ink })]), CONTENT_W * 0.45);
    ts.draw(pdfPage, titleUnits, RIGHT - ts.lineWidth(titleUnits), avatarY + 13, 13);
    const subtitleUnits = ts.truncate(ts.shape([span(`OSCP+ Exam Report  ·  ${targetName}`, { size: 7.4, color: PALETTE.muted })]), CONTENT_W * 0.45);
    ts.draw(pdfPage, subtitleUnits, RIGHT - ts.lineWidth(subtitleUnits), avatarY - 1, 11);
    pdfPage.drawLine({ start: { x: LEFT, y: PAGE_H - 76 }, end: { x: RIGHT, y: PAGE_H - 76 }, thickness: 0.6, color: color(PALETTE.line) });
    pdfPage.drawRectangle({ x: LEFT, y: PAGE_H - 76.9, width: 44, height: 1.8, color: color(PALETTE.accent) });

    pdfPage.drawLine({ start: { x: LEFT, y: 54 }, end: { x: RIGHT, y: 54 }, thickness: 0.6, color: color(PALETTE.line) });
    const footerLeft = ts.truncate(ts.shape([span("CONFIDENTIAL", { size: 6.8, bold: true, color: PALETTE.accent }), span(`   ·   ${targetName}   ·   Generated ${formatTimestamp(generatedAt)}`, { size: 6.8, color: PALETTE.muted })]), CONTENT_W - 90);
    ts.draw(pdfPage, footerLeft, LEFT, 48, 12);
    const footerRight = ts.shape([span("Page ", { size: 7.2, color: PALETTE.muted }), span(`${index + 1}`, { size: 7.2, bold: true, color: PALETTE.ink }), span(` of ${pages.length}`, { size: 7.2, color: PALETTE.muted })]);
    ts.draw(pdfPage, footerRight, RIGHT - ts.lineWidth(footerRight), 48, 12);
  });
  if (coverPage !== pages[0]) throw new Error("Cover page moved unexpectedly.");
  addOutline(pdf, outline);

  pdf.setTitle(reportTitle, { showInWindowTitleBar: true });
  pdf.setAuthor(data.profile.name || "Fieldnotes OSCP+");
  pdf.setSubject(`OSCP+ penetration test report for ${targetName} with embedded Fieldnotes workspace`);
  pdf.setKeywords(["OSCP+", "penetration test", targetName, data.profile.osid].filter(Boolean));
  pdf.setCreator("Fieldnotes OSCP+");
  pdf.setProducer("Fieldnotes OSCP+ (pdf-lib)");
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  await pdf.attach(new TextEncoder().encode(JSON.stringify(workspace)), WORKSPACE_ATTACHMENT, {
    mimeType: "application/json",
    description: "Complete Fieldnotes workspace for import",
    creationDate: generatedAt,
  });
  for (const [evidence, name] of attachmentNames) {
    const encodedFile = evidence.dataUrl || evidence.fileDataUrl;
    const bytes = encodedFile ? dataUrlBytes(encodedFile) : new TextEncoder().encode(evidence.content);
    await pdf.attach(bytes, name, {
      mimeType: evidence.mimeType || "text/plain",
      description: `Evidence for ${targetName}: ${evidence.label || name}`,
    });
  }
  return { bytes: await pdf.save(), pages: pages.length };
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
  const { loadPdfFonts, rasterizeEmoji } = await import("./pdfAssets.js");
  const { bytes, pages } = await buildReportPdf(workspace, targetId, { fonts: await loadPdfFonts(), rasterizeEmoji });
  const target = workspace.targets.find((entry) => entry.id === targetId) || workspace.targets.find((entry) => entry.id === workspace.activeTargetId);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(target?.name || workspace.variables.targetName)}-report.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { pages };
}

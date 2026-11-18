export const TERMINAL_CAPTURE_MODES = Object.freeze({
  PROOF: "proof",
  VISIBLE: "visible",
  LAST: "last",
  FULL: "full",
});

export const TERMINAL_CAPTURE_LIMITS = Object.freeze({
  minLastLines: 5,
  maxLastLines: 500,
  maxCanvasHeight: 8192,
  maxCanvasPixels: 32 * 1024 * 1024,
  minCanvasWidth: 640,
  maxCanvasWidth: 4096,
  cellWidth: 8,
  lineHeight: 18,
  horizontalPadding: 16,
  headerHeight: 46,
  footerHeight: 25,
});

const integer = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const rowText = (row) => String(typeof row === "string" ? row : row?.text || "");

const normalizeRow = (row) => ({
  ...(typeof row === "object" && row ? row : {}),
  text: rowText(row),
  isWrapped: Boolean(typeof row === "object" && row?.isWrapped),
  cells: Array.isArray(row?.cells) ? row.cells.map((cell) => ({ ...cell })) : [],
});

export function normalizeTerminalSnapshot(snapshot = {}) {
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines.map(normalizeRow) : [];
  const columns = clamp(integer(snapshot.columns, 80) || 80, 1, 500);
  const rows = clamp(integer(snapshot.rows, 24) || 24, 1, 500);
  return {
    columns,
    rows,
    viewportY: clamp(integer(snapshot.viewportY, 0), 0, Math.max(0, lines.length - 1)),
    lines,
  };
}

export function normalizeLastLineCount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new TypeError("Last-line capture requires a whole number.");
  }
  if (typeof value === "string" && !/^\d+$/u.test(value.trim())) {
    throw new TypeError("Last-line capture requires a whole number.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Last-line capture requires a whole number.");
  return clamp(parsed, TERMINAL_CAPTURE_LIMITS.minLastLines, TERMINAL_CAPTURE_LIMITS.maxLastLines);
}

const PROMPT = /(?:\*Evil-WinRM\*\s+)?(?:PS\s+)?[A-Z]:\\[^>\r\n]*>\s*|(?:^|\s)[^\s@]+@[^:\s]+:[^\r\n]*[$#]\s*|^\s*(?:bash|sh|zsh|cmd|powershell)(?:\.exe)?[>$#]\s*/iu;
const WINDOWS_IDENTITY = /^\s*[a-z0-9._$-]+\\[a-z0-9._$-]+\s*$/iu;
const UNIX_IDENTITY = /\buid=\d+\([^)]+\)/iu;
const STANDALONE_ROOT = /^\s*root\s*$/iu;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/u;
const PROOF_PATH = /(?:proof\s+path\s*:|[A-Z]:\\[^\r\n]*(?:proof|root|user|local)\.txt\b|\/(?:home|root|tmp|var|opt|srv|mnt|media|usr|etc)\/[^\r\n]*(?:proof|root|user|local)\.txt\b)/iu;

const containsExact = (text, value) => Boolean(value) && String(text).toLowerCase().includes(String(value).toLowerCase());

const latestIndex = (lines, predicate) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) if (predicate(rowText(lines[index]), index)) return index;
  return -1;
};

const previousIndex = (lines, start, predicate, distance = 60) => {
  const minimum = Math.max(0, start - distance);
  for (let index = start; index >= minimum; index -= 1) if (predicate(rowText(lines[index]), index)) return index;
  return -1;
};

const nextIndex = (lines, start, predicate, distance = 12) => {
  const maximum = Math.min(lines.length - 1, start + distance);
  for (let index = start; index <= maximum; index += 1) if (predicate(rowText(lines[index]), index)) return index;
  return -1;
};

const meaningfulEnd = (lines) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) if (rowText(lines[index]).trim()) return index + 1;
  return lines.length;
};

const beginningOfWrappedLine = (lines, index) => {
  let start = index;
  while (start > 0 && lines[start]?.isWrapped) start -= 1;
  return start;
};

const selectedCompleteness = (rows, { proofValue = "", proofPath = "", targetAddress = "" } = {}) => {
  const values = rows.map(rowText);
  const joined = values.join("\n");
  const prompt = values.some((value) => PROMPT.test(value));
  const identity = values.some((value) => WINDOWS_IDENTITY.test(value) || UNIX_IDENTITY.test(value) || STANDALONE_ROOT.test(value));
  const address = targetAddress ? containsExact(joined, targetAddress) : values.some((value) => IPV4.test(value));
  const path = proofPath ? containsExact(joined, proofPath) : values.some((value) => PROOF_PATH.test(value));
  const value = containsExact(joined, proofValue);
  return { prompt, identity, address, path, value };
};

const missingCompleteness = (completeness) => Object.entries(completeness)
  .filter(([, present]) => !present)
  .map(([name]) => name);

export function terminalCaptureDimensions(columns, lineCount, limits = TERMINAL_CAPTURE_LIMITS) {
  const safeColumns = clamp(integer(columns, 80) || 80, 1, 500);
  const safeLines = Math.max(1, integer(lineCount, 1));
  const width = clamp(
    safeColumns * limits.cellWidth + limits.horizontalPadding * 2,
    limits.minCanvasWidth,
    limits.maxCanvasWidth,
  );
  const fixedHeight = limits.headerHeight + limits.footerHeight;
  const maxByHeight = Math.max(1, Math.floor((limits.maxCanvasHeight - fixedHeight) / limits.lineHeight));
  const maxByPixels = Math.max(1, Math.floor((Math.floor(limits.maxCanvasPixels / width) - fixedHeight) / limits.lineHeight));
  const linesPerPage = Math.max(1, Math.min(maxByHeight, maxByPixels));
  const height = fixedHeight + Math.min(safeLines, linesPerPage) * limits.lineHeight;
  return { width, height, linesPerPage, fixedHeight };
}

export function paginateTerminalRows(rows = [], { start = 0, columns = 80 } = {}) {
  const normalized = rows.map(normalizeRow);
  const dimensions = terminalCaptureDimensions(columns, Math.max(1, normalized.length));
  if (!normalized.length) return [{ index: 0, start, end: start, rows: [], dimensions: { ...dimensions, height: dimensions.fixedHeight + TERMINAL_CAPTURE_LIMITS.lineHeight } }];
  const pages = [];
  for (let offset = 0; offset < normalized.length; offset += dimensions.linesPerPage) {
    const pageRows = normalized.slice(offset, offset + dimensions.linesPerPage);
    pages.push({
      index: pages.length,
      start: start + offset,
      end: start + offset + pageRows.length,
      rows: pageRows,
      dimensions: terminalCaptureDimensions(columns, pageRows.length),
    });
  }
  return pages;
}

const rangePlan = (snapshot, requestedMode, mode, start, end, details = {}) => {
  const safeStart = clamp(start, 0, snapshot.lines.length);
  const safeEnd = clamp(end, safeStart, snapshot.lines.length);
  const rows = snapshot.lines.slice(safeStart, safeEnd);
  const pages = paginateTerminalRows(rows, { start: safeStart, columns: snapshot.columns });
  return {
    requestedMode,
    mode,
    start: safeStart,
    end: safeEnd,
    lineCount: rows.length,
    totalLines: snapshot.lines.length,
    rows,
    pages,
    ...details,
  };
};

function proofCapturePlan(snapshot, options) {
  const proofValue = String(options.proofValue || "").trim();
  const valueIndex = proofValue ? latestIndex(snapshot.lines, (text) => containsExact(text, proofValue)) : -1;
  if (valueIndex < 0) {
    const visible = visibleCapturePlan(snapshot, TERMINAL_CAPTURE_MODES.PROOF);
    return {
      ...visible,
      fallbackMode: TERMINAL_CAPTURE_MODES.VISIBLE,
      reviewRequired: true,
      proofFound: false,
      completeness: { prompt: false, identity: false, address: false, path: false, value: false },
      missing: ["prompt", "identity", "address", "path", "value"],
      reason: proofValue
        ? "The detected proof value is no longer present in terminal scrollback; review the visible viewport or rerun the proof command."
        : "No proof value is associated with this session; review the visible viewport or rerun the proof command.",
    };
  }

  const promptStart = previousIndex(snapshot.lines, valueIndex, (text) => PROMPT.test(text));
  const contextualStart = Math.max(0, valueIndex - 18);
  let start = promptStart >= 0 ? promptStart : contextualStart;
  start = beginningOfWrappedLine(snapshot.lines, start);
  const nextPrompt = nextIndex(snapshot.lines, valueIndex + 1, (text) => PROMPT.test(text));
  const end = nextPrompt >= 0 ? nextPrompt + 1 : Math.min(snapshot.lines.length, valueIndex + 4);
  const rows = snapshot.lines.slice(start, end);
  const completeness = {
    ...selectedCompleteness(rows, options),
    prompt: promptStart >= 0 && nextPrompt >= 0,
  };
  const missing = missingCompleteness(completeness);
  const missingLabels = missing.map((name) => (name === "prompt" ? "command prompt and returned prompt" : name));
  return rangePlan(snapshot, TERMINAL_CAPTURE_MODES.PROOF, TERMINAL_CAPTURE_MODES.PROOF, start, end, {
    proofFound: true,
    proofLine: valueIndex,
    completeness,
    missing,
    reviewRequired: missing.length > 0,
    reason: missing.length
      ? `Proof context needs review; the selected rows do not visibly contain: ${missingLabels.join(", ")}.`
      : `Detected ${end - start} proof-context rows from the command prompt through the returned prompt.`,
  });
}

function visibleCapturePlan(snapshot, requestedMode = TERMINAL_CAPTURE_MODES.VISIBLE) {
  const start = clamp(snapshot.viewportY, 0, snapshot.lines.length);
  return rangePlan(snapshot, requestedMode, TERMINAL_CAPTURE_MODES.VISIBLE, start, Math.min(snapshot.lines.length, start + snapshot.rows), {
    reviewRequired: false,
    reason: `Selected the ${Math.min(snapshot.rows, Math.max(0, snapshot.lines.length - start))} rows currently visible in the terminal viewport.`,
  });
}

export function planTerminalCapture(inputSnapshot, options = {}) {
  const snapshot = normalizeTerminalSnapshot(inputSnapshot);
  const requestedMode = options.mode === "auto" ? TERMINAL_CAPTURE_MODES.PROOF : (options.mode || TERMINAL_CAPTURE_MODES.PROOF);
  if (requestedMode === TERMINAL_CAPTURE_MODES.PROOF) return proofCapturePlan(snapshot, options);
  if (requestedMode === TERMINAL_CAPTURE_MODES.VISIBLE) return visibleCapturePlan(snapshot);
  const end = meaningfulEnd(snapshot.lines);
  if (requestedMode === TERMINAL_CAPTURE_MODES.LAST) {
    const count = normalizeLastLineCount(options.lineCount ?? 40);
    return rangePlan(snapshot, requestedMode, requestedMode, Math.max(0, end - count), end, {
      requestedLineCount: count,
      reviewRequired: false,
      reason: `Selected the last ${Math.min(count, end)} available terminal rows.`,
    });
  }
  if (requestedMode === TERMINAL_CAPTURE_MODES.FULL) {
    const pageCount = paginateTerminalRows(snapshot.lines, { columns: snapshot.columns }).length;
    return rangePlan(snapshot, requestedMode, requestedMode, 0, snapshot.lines.length, {
      reviewRequired: false,
      reason: `Selected all ${snapshot.lines.length} terminal rows in ${pageCount} PNG part${pageCount === 1 ? "" : "s"}.`,
    });
  }
  throw new TypeError(`Unsupported terminal capture mode: ${requestedMode}`);
}

const safeFilenamePart = (value, fallback) => String(value || "")
  .replace(/[øØ]/g, "o")
  .replace(/[łŁ]/g, "l")
  .replace(/[ðĐđÐ]/g, "d")
  .replace(/[þÞ]/g, "th")
  .replace(/æ/gi, "ae")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80) || fallback;

const safeTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError("Terminal capture timestamp is invalid.");
  return date.toISOString().replace(/[:.]/g, "-");
};

export function terminalCaptureFilename({ targetSlug, proofKind, mode = "terminal", timestamp, part = 1, parts = 1 } = {}) {
  const target = safeFilenamePart(targetSlug, "target");
  const kind = safeFilenamePart(proofKind || mode, "terminal");
  const suffix = parts > 1 ? `-part-${String(part).padStart(2, "0")}-of-${String(parts).padStart(2, "0")}` : "";
  return `${target}-${kind}-${safeTimestamp(timestamp)}${suffix}.png`;
}

const ellipsis = (context, text, maxWidth) => {
  if (context.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next && context.measureText(`${next}…`).width > maxWidth) next = next.slice(0, -1);
  return `${next}…`;
};

// Browser-only renderer. Planning remains pure and fully testable in Node.
export function renderTerminalCaptureCanvas(page, metadata = {}, { scale = 1 } = {}) {
  if (typeof document === "undefined") throw new Error("Terminal PNG rendering requires a browser document.");
  const dimensions = page?.dimensions || terminalCaptureDimensions(metadata.columns || 80, page?.rows?.length || 1);
  const requestedScale = clamp(Number(scale) || 1, 1, 2);
  const heightScale = TERMINAL_CAPTURE_LIMITS.maxCanvasHeight / dimensions.height;
  const pixelScale = Math.sqrt(TERMINAL_CAPTURE_LIMITS.maxCanvasPixels / (dimensions.width * dimensions.height));
  const safeScale = Math.max(1, Math.min(requestedScale, heightScale, pixelScale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(dimensions.width * safeScale);
  canvas.height = Math.round(dimensions.height * safeScale);
  const context = canvas.getContext("2d");
  context.scale(safeScale, safeScale);
  context.fillStyle = "#070a08";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  context.fillStyle = "#111814";
  context.fillRect(0, 0, dimensions.width, TERMINAL_CAPTURE_LIMITS.headerHeight);
  context.fillStyle = "#b7f34b";
  context.font = '700 12px Consolas, "DejaVu Sans Mono", monospace';
  context.fillText("FIELDNOTES TERMINAL", 16, 19);
  context.fillStyle = "#d9e6d7";
  context.font = '12px Consolas, "DejaVu Sans Mono", monospace';
  const identity = [metadata.targetName, metadata.address, metadata.context].filter(Boolean).join(" · ");
  context.fillText(ellipsis(context, identity || "Local terminal capture", dimensions.width - 32), 16, 36);

  const top = TERMINAL_CAPTURE_LIMITS.headerHeight;
  const cellWidth = TERMINAL_CAPTURE_LIMITS.cellWidth;
  const lineHeight = TERMINAL_CAPTURE_LIMITS.lineHeight;
  const left = TERMINAL_CAPTURE_LIMITS.horizontalPadding;
  for (let rowIndex = 0; rowIndex < (page?.rows || []).length; rowIndex += 1) {
    const row = normalizeRow(page.rows[rowIndex]);
    const baseline = top + rowIndex * lineHeight + 14;
    if (row.cells.length) {
      for (const cell of row.cells) {
        const column = integer(cell.column, 0);
        const width = Math.max(1, integer(cell.width, 1));
        let foreground = cell.fg || "#d9e6d7";
        let background = cell.bg || "#070a08";
        if (cell.inverse) [foreground, background] = [background, foreground];
        if (background !== "#070a08") {
          context.fillStyle = background;
          context.fillRect(left + column * cellWidth, baseline - 14, width * cellWidth, lineHeight);
        }
        context.fillStyle = foreground;
        context.globalAlpha = cell.dim ? 0.65 : 1;
        context.font = `${cell.italic ? "italic " : ""}${cell.bold ? "700 " : ""}13px Consolas, "DejaVu Sans Mono", monospace`;
        context.fillText(cell.text || " ", left + column * cellWidth, baseline);
        context.globalAlpha = 1;
        if (cell.underline) {
          context.fillRect(left + column * cellWidth, baseline + 2, width * cellWidth, 1);
        }
        if (cell.strike) {
          context.fillRect(left + column * cellWidth, baseline - 5, width * cellWidth, 1);
        }
      }
    } else {
      context.fillStyle = "#d9e6d7";
      context.font = '13px Consolas, "DejaVu Sans Mono", monospace';
      context.fillText(row.text, left, baseline);
    }
  }

  const footerY = dimensions.height - TERMINAL_CAPTURE_LIMITS.footerHeight;
  context.fillStyle = "#0d120e";
  context.fillRect(0, footerY, dimensions.width, TERMINAL_CAPTURE_LIMITS.footerHeight);
  context.fillStyle = "#7d8f83";
  context.font = '10px Consolas, "DejaVu Sans Mono", monospace';
  const pageText = metadata.parts > 1 ? ` · part ${metadata.part} of ${metadata.parts}` : "";
  const footer = `Rows ${page.start + 1}–${page.end}${pageText} · captured locally ${metadata.timestamp || ""}`;
  context.fillText(ellipsis(context, footer, dimensions.width - 32), 16, footerY + 16);
  return canvas;
}

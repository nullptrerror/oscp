// Shared terminal-output model for the app and the PDF report: ANSI SGR colors,
// carriage-return overwrites, and light highlighting for output pasted without colors.

export const TERMINAL_THEME = {
  foreground: "#d9f2cb",
  background: "#0b0f0c",
  chrome: "#161d18",
  muted: "#7d8f83",
};

const NORMAL = ["#3a4440", "#ff5f5f", "#8be04e", "#ffcc4d", "#5fa8ff", "#d77cff", "#4fd6d6", "#d9e2dc"];
const BRIGHT = ["#6f7d75", "#ff8787", "#b7f34b", "#ffe08a", "#8cc4ff", "#e9a8ff", "#7eeeee", "#ffffff"];
const CUBE = [0, 95, 135, 175, 215, 255];

const hex = (r, g, b) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;

export function xtermColor(index) {
  if (index < 8) return NORMAL[index];
  if (index < 16) return BRIGHT[index - 8];
  if (index < 232) {
    const value = index - 16;
    return hex(CUBE[Math.floor(value / 36)], CUBE[Math.floor(value / 6) % 6], CUBE[value % 6]);
  }
  const gray = 8 + (index - 232) * 10;
  return hex(gray, gray, gray);
}

// CSI, OSC, and two-character escapes. Only CSI "m" (SGR) changes the style.
const ESCAPE = /\x1b(?:\[([0-?]*)[ -/]*([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;

export const hasAnsi = (text) => /\x1b\[[0-9;:]*m/.test(String(text ?? ""));

function applySgr(style, params) {
  // ISO-8613 colon-form truecolor may include an empty color-space slot (38:2::R:G:B).
  const normalized = params.replace(/::/g, ":");
  const codes = normalized === "" ? [0] : normalized.split(/[;:]/).map((value) => Number(value || 0));
  const next = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0) Object.keys(next).forEach((key) => delete next[key]);
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) { delete next.bold; delete next.dim; }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 29) delete next.strike;
    else if (code === 27) delete next.inverse;
    else if (code >= 30 && code <= 37) next.fg = NORMAL[code - 30];
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = NORMAL[code - 40];
    else if (code === 49) delete next.bg;
    else if (code >= 90 && code <= 97) next.fg = BRIGHT[code - 90];
    else if (code >= 100 && code <= 107) next.bg = BRIGHT[code - 100];
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (codes[index + 1] === 5) {
        next[key] = xtermColor(codes[index + 2] ?? 0);
        index += 2;
      } else if (codes[index + 1] === 2) {
        next[key] = hex(codes[index + 2] ?? 0, codes[index + 3] ?? 0, codes[index + 4] ?? 0);
        index += 4;
      }
    }
  }
  return next;
}

const sameStyle = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

const pushSegment = (line, text, style) => {
  if (!text) return;
  const last = line[line.length - 1];
  if (last && sameStyle(last.style, style)) last.text += text;
  else line.push({ text, style: { ...style } });
};

const expandTabs = (text, column) => text.replace(/\t/g, () => {
  const spaces = 8 - (column % 8);
  return " ".repeat(spaces);
});

// Returns lines of styled segments: [[{ text, style: { fg, bg, bold, dim, italic, underline, inverse } }]]
export function parseAnsi(input) {
  const text = String(input ?? "").replace(/\r\n/g, "\n");
  const lines = [[]];
  let style = {};
  let pendingOverwrite = false;
  let column = 0;

  const writeText = (chunk) => {
    const parts = chunk.split(/(\n|\r)/);
    for (const part of parts) {
      if (part === "\n") {
        lines.push([]);
        pendingOverwrite = false;
        column = 0;
      } else if (part === "\r") {
        pendingOverwrite = true;
      } else if (part) {
        const clean = part.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
        if (!clean) continue;
        if (pendingOverwrite) {
          lines[lines.length - 1] = [];
          pendingOverwrite = false;
          column = 0;
        }
        const expanded = expandTabs(clean, column);
        column += expanded.length;
        pushSegment(lines[lines.length - 1], expanded, style);
      }
    }
  };

  let cursor = 0;
  for (const match of text.matchAll(ESCAPE)) {
    writeText(text.slice(cursor, match.index));
    if (match[2] === "m") style = applySgr(style, match[1] ?? "");
    cursor = match.index + match[0].length;
  }
  writeText(text.slice(cursor));
  return lines;
}

const GREEN = BRIGHT[2];
const RED = NORMAL[1];
const BLUE = NORMAL[4];
const YELLOW = NORMAL[3];
const CYAN = NORMAL[6];

const HIGHLIGHTS = [
  { pattern: /\[\+\]/g, style: { fg: GREEN, bold: true } },
  { pattern: /\[-\]/g, style: { fg: RED, bold: true } },
  { pattern: /\[\*\]/g, style: { fg: BLUE, bold: true } },
  { pattern: /\[!\]/g, style: { fg: YELLOW, bold: true } },
  { pattern: /\(Pwn3d!\)/g, style: { fg: YELLOW, bold: true } },
  { pattern: /\bCVE-\d{4}-\d{4,7}\b/gi, style: { fg: YELLOW } },
  { pattern: /\bSTATUS_[A-Z_]+\b/g, style: { fg: RED } },
];

function highlightLine(line) {
  const ranges = [];
  const port = line.match(/^(\d{1,5}\/(?:tcp|udp))(\s+)(open\|filtered|open|filtered|closed)\b/i);
  if (port) {
    ranges.push({ start: 0, end: port[1].length, style: { fg: CYAN } });
    const stateStart = port[1].length + port[2].length;
    const state = port[3].toLowerCase();
    ranges.push({ start: stateStart, end: stateStart + port[3].length, style: { fg: state === "open" ? GREEN : state === "closed" ? RED : YELLOW, bold: state === "open" } });
  }
  if (/^Nmap scan report for /i.test(line)) ranges.push({ start: 0, end: line.length, style: { bold: true } });
  for (const { pattern, style } of HIGHLIGHTS) {
    for (const match of line.matchAll(pattern)) ranges.push({ start: match.index, end: match.index + match[0].length, style });
  }
  if (ranges.length === 0) return line ? [{ text: line, style: {} }] : [];
  ranges.sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ text: line.slice(cursor, range.start), style: {} });
    segments.push({ text: line.slice(range.start, range.end), style: range.style });
    cursor = range.end;
  }
  if (cursor < line.length) segments.push({ text: line.slice(cursor), style: {} });
  return segments;
}

// ANSI output keeps its own colors; plain pasted output gets conservative tool-marker highlighting.
export function terminalLines(input) {
  if (hasAnsi(input)) return parseAnsi(input);
  return parseAnsi(input).map((segments) => highlightLine(segments.map((segment) => segment.text).join("")));
}

export const stripAnsi = (input) => parseAnsi(input).map((line) => line.map((segment) => segment.text).join("")).join("\n");

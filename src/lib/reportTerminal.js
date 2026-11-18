const lineText = (line) => (typeof line === "string"
  ? line
  : (line || []).map((segment) => segment.text || "").join(""));

const lineSegments = (line) => (typeof line === "string"
  ? [{ text: line, style: {} }]
  : (line || []));

const sliceLine = (line, start = 0, end = Number.POSITIVE_INFINITY) => {
  const sliced = [];
  let offset = 0;
  for (const segment of lineSegments(line)) {
    const text = String(segment.text || "");
    const segmentStart = offset;
    const segmentEnd = offset + text.length;
    offset = segmentEnd;
    if (segmentEnd <= start || segmentStart >= end) continue;
    const from = Math.max(0, start - segmentStart);
    const to = Math.min(text.length, end - segmentStart);
    if (to > from) sliced.push({ ...segment, text: text.slice(from, to) });
  }
  return sliced;
};

const normalizedShellTokens = (value = "") => String(value)
  .toLowerCase()
  .match(/[a-z0-9_.@\\/-]{2,}/gu) || [];

const isRenderedCommandEcho = (lineTextValue, commandText) => {
  const line = String(lineTextValue || "").trim();
  const command = String(commandText || "").trim();
  if (!line || !command) return false;
  if (line.includes(command)) return true;

  // Readline and remote shells can repaint only the tail of a long command.
  // Treat it as an echo only when it still resembles shell syntax and most of
  // its useful tokens came from the exact reviewed command.
  if (!/(?:^|\s)(?:sudo|test|net|nmap|cmd\.exe|evil-winrm|impacket-[a-z0-9_-]+)\b|(?:^|\s)-[a-z]\b|[;&|]{2}|;\s*\}/iu.test(line)) return false;
  const commandTokens = new Set(normalizedShellTokens(command));
  const lineTokens = normalizedShellTokens(line).filter((token) => token.length >= 3);
  if (lineTokens.length < 3) return false;
  const overlap = lineTokens.filter((token) => commandTokens.has(token)).length;
  return overlap / lineTokens.length >= 0.65;
};

const collapseRepeatedPrompt = (line) => {
  const text = lineText(line);
  const promptMatches = [...text.matchAll(/\*Evil-WinRM\*\s+PS\s+/giu)];
  if (promptMatches.length < 2) return lineSegments(line);
  const first = promptMatches[0].index;
  const second = promptMatches[1].index;
  const left = text.slice(first, second).trim();
  const right = text.slice(second).trim();
  return left === right ? sliceLine(line, 0, second) : lineSegments(line);
};

const isKaliPromptDecoration = (value) => (
  /^[\s▽]*[┌└](?:──|─).*?(?:kali(?:㉿|@)kali|\$\s*(?:=)?\s*$)/iu.test(String(value || ""))
);

// Display-only cleanup shared by both report renderers. The exact evidence
// attachment remains untouched; this removes terminal repaint artifacts that
// otherwise obscure results and proof context in a bounded report excerpt.
export function normalizeTerminalDisplayLines(sourceLines = [], commandText = "") {
  const normalized = [];
  for (const sourceLine of sourceLines) {
    const text = lineText(sourceLine);
    if (!text.trim() || isKaliPromptDecoration(text) || isRenderedCommandEcho(text, commandText)) continue;
    const line = collapseRepeatedPrompt(sourceLine);
    const compactText = lineText(line).trimEnd();
    if (!compactText) continue;
    const previous = normalized.at(-1);
    if (previous && lineText(previous).trimEnd() === compactText) continue;
    normalized.push(sliceLine(line, 0, compactText.length));
  }
  return normalized;
}

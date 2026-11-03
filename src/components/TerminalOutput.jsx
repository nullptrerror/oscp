import { useMemo } from "react";
import { TERMINAL_THEME, terminalLines } from "../lib/terminalText";

const MAX_LINES = 2000;

const segmentStyle = (style) => {
  if (!style || Object.keys(style).length === 0) return undefined;
  let color = style.fg;
  let background = style.bg;
  if (style.inverse) [color, background] = [background || TERMINAL_THEME.background, color || TERMINAL_THEME.foreground];
  return {
    color,
    backgroundColor: background,
    fontWeight: style.bold ? 700 : undefined,
    opacity: style.dim ? 0.6 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
  };
};

export default function TerminalOutput({ content }) {
  const lines = useMemo(() => terminalLines(content), [content]);
  return (
    <pre className="terminal-output">
      {lines.slice(0, MAX_LINES).map((segments, lineIndex) => (
        <span key={lineIndex}>
          {segments.map((segment, segmentIndex) => (
            <span key={segmentIndex} style={segmentStyle(segment.style)}>{segment.text}</span>
          ))}
          {"\n"}
        </span>
      ))}
      {lines.length > MAX_LINES && (
        <span className="terminal-more">… {lines.length - MAX_LINES} more lines are saved and included in exports.</span>
      )}
    </pre>
  );
}

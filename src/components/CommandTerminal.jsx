import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLocalRunner } from "../context/LocalRunnerContext";
import { xtermColor } from "../lib/terminalText";

const rgbColor = (value) => `#${Number(value || 0).toString(16).padStart(6, "0").slice(-6)}`;

const cellColor = (cell, foreground) => {
  const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
  const palette = foreground ? cell.isFgPalette() : cell.isBgPalette();
  const value = foreground ? cell.getFgColor() : cell.getBgColor();
  if (rgb) return rgbColor(value);
  if (palette) return xtermColor(value);
  return "";
};

const terminalStyledRow = (terminal, buffer, rowIndex) => {
  const line = buffer.getLine(rowIndex);
  const cells = [];
  if (line) {
    const reusable = buffer.getNullCell();
    const columns = Math.min(terminal.cols, line.length);
    for (let column = 0; column < columns; column += 1) {
      const cell = line.getCell(column, reusable);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars();
      const fg = cellColor(cell, true);
      const bg = cellColor(cell, false);
      const bold = Boolean(cell.isBold());
      const dim = Boolean(cell.isDim());
      const italic = Boolean(cell.isItalic());
      const underline = Boolean(cell.isUnderline());
      const inverse = Boolean(cell.isInverse());
      const strike = Boolean(cell.isStrikethrough());
      const hasVisibleStyle = Boolean(fg || bg || underline || inverse || strike);
      if ((!chars.trim() || cell.isInvisible()) && !hasVisibleStyle) continue;
      cells.push({
        column,
        text: cell.isInvisible() ? " " : (chars || " "),
        width: Math.max(1, cell.getWidth()),
        fg,
        bg,
        bold,
        dim,
        italic,
        underline,
        inverse,
        strike,
      });
    }
  }
  return {
    index: rowIndex,
    text: line?.translateToString(true) || "",
    isWrapped: Boolean(line?.isWrapped),
    cells,
  };
};

const terminalBufferSnapshot = (terminal) => {
  if (!terminal) return null;
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) lines.push(terminalStyledRow(terminal, buffer, index));
  return {
    columns: terminal.cols,
    rows: terminal.rows,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    bufferType: buffer.type,
    lines,
  };
};

const CommandTerminal = forwardRef(function CommandTerminal({ session, active, onStarted, onOutput, onExit, onFailed, onProof }, ref) {
  const runner = useLocalRunner();
  const hostRef = useRef(null);
  const socketRef = useRef(null);
  const fitRef = useRef(null);
  const terminalRef = useRef(null);
  const finishedRef = useRef(false);
  const lastInputRef = useRef("");
  const lastStopRef = useRef(0);
  const activeRef = useRef(active);
  const callbacksRef = useRef({ onStarted, onOutput, onExit, onFailed, onProof });
  activeRef.current = active;
  callbacksRef.current = { onStarted, onOutput, onExit, onFailed, onProof };

  useImperativeHandle(ref, () => ({
    snapshot: () => terminalBufferSnapshot(terminalRef.current),
  }), []);

  useEffect(() => {
    if (!runner.available || !hostRef.current) return undefined;
    let terminal;
    let socket;
    let input;
    let resize;
    let disposed = false;
    finishedRef.current = false;

    const setupTimer = window.setTimeout(() => {
      if (disposed || !hostRef.current) return;
      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 12000,
        theme: { background: "#070a08", foreground: "#d9e6d7", cursor: "#a8d45b" },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(hostRef.current);
      if (activeRef.current) fit.fit();
      fitRef.current = fit;
      terminalRef.current = terminal;

      socket = new WebSocket(runner.terminalUrl);
      socketRef.current = socket;
      input = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      });
      resize = new ResizeObserver(() => {
        if (!activeRef.current || !hostRef.current?.offsetWidth) return;
        try { fit.fit(); } catch { return; }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      });
      resize.observe(hostRef.current);

      socket.addEventListener("open", () => {
        if (disposed) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({
          type: "start",
          command: session.command,
          cwd: session.cwd,
          label: session.label,
          flagNames: session.flagNames,
          cols: terminal.cols,
          rows: terminal.rows,
        }));
      });
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          callbacksRef.current.onFailed?.("The terminal returned an invalid response.");
          return;
        }
        if (message.type === "started") {
          callbacksRef.current.onStarted?.(message);
          return;
        }
        if (message.type === "output") {
          terminal.write(message.data);
          callbacksRef.current.onOutput?.(message.data);
          return;
        }
        if (message.type === "flag") {
          callbacksRef.current.onProof?.(message);
          return;
        }
        if (message.type === "exit") {
          finishedRef.current = true;
          terminal.write("", () => callbacksRef.current.onExit?.({ ...message, terminalSnapshot: terminalBufferSnapshot(terminal) }));
          return;
        }
        if (message.type === "error") {
          terminal.writeln(`\r\n[Fieldnotes] ${message.message}`, () => callbacksRef.current.onFailed?.(message.message, { ...message, terminalSnapshot: terminalBufferSnapshot(terminal) }));
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed) callbacksRef.current.onFailed?.("Terminal connection failed. Confirm the embedded runner is still connected.", {});
      });
      socket.addEventListener("close", () => {
        if (!disposed && !finishedRef.current) callbacksRef.current.onFailed?.("The embedded terminal connection closed before the process finished.", {});
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(setupTimer);
      resize?.disconnect();
      input?.dispose();
      terminal?.dispose();
      fitRef.current = null;
      terminalRef.current = null;
      if (socket?.readyState === WebSocket.OPEN) {
        if (!finishedRef.current) socket.send(JSON.stringify({ type: "kill" }));
        socket.close();
      }
      socketRef.current = null;
    };
  // A session owns one PTY for its lifetime. Context, tabs, and capture state
  // deliberately do not recreate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.available, runner.terminalUrl, session.id]);

  useEffect(() => {
    if (!active) return undefined;
    const frame = window.requestAnimationFrame(() => {
      try { fitRef.current?.fit(); } catch { /* fitted after the terminal becomes visible */ }
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const request = session.inputRequest;
    if (!request?.id || lastInputRef.current === request.id) return;
    const socket = socketRef.current;
    if (session.status !== "running" || socket?.readyState !== WebSocket.OPEN) return;
    lastInputRef.current = request.id;
    socket.send(JSON.stringify({
      type: "input",
      data: request.data,
      proofCommand: request.proofCommand,
      commandLabel: request.commandLabel,
      flagNames: request.flagNames,
    }));
  }, [session.inputRequest, session.status]);

  useEffect(() => {
    if (!session.stopRequest || lastStopRef.current === session.stopRequest) return;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    lastStopRef.current = session.stopRequest;
    socket.send(JSON.stringify({ type: "kill" }));
  }, [session.status, session.stopRequest]);

  return (
    <div className={`terminal-workspace-screen ${active ? "is-active" : ""}`} hidden={!active}>
      <div className="xterm-host" ref={hostRef} />
    </div>
  );
});

export default CommandTerminal;

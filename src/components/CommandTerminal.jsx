import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLocalRunner } from "../context/LocalRunnerContext";

const CAPTURE_LIMIT = 1024 * 1024;

export default function CommandTerminal({ command, cwd, label, onClose, onFinish }) {
  const runner = useLocalRunner();
  const hostRef = useRef(null);
  const outputRef = useRef("");
  const socketRef = useRef(null);
  const [state, setState] = useState({ status: "connecting", logPath: "", message: "" });

  useEffect(() => {
    if (!runner.available || !hostRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 8000,
      theme: { background: "#070a08", foreground: "#d9e6d7", cursor: "#a8d45b" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();

    const socket = new WebSocket(runner.terminalUrl);
    socketRef.current = socket;
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    const resize = new ResizeObserver(() => {
      fit.fit();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    });
    resize.observe(hostRef.current);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "start", command, cwd, label, cols: terminal.cols, rows: terminal.rows }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "started") {
        setState({ status: "running", logPath: message.logPath, message: "" });
        return;
      }
      if (message.type === "output") {
        terminal.write(message.data);
        if (outputRef.current.length < CAPTURE_LIMIT) outputRef.current += message.data.slice(0, CAPTURE_LIMIT - outputRef.current.length);
        return;
      }
      if (message.type === "exit") {
        setState({ status: message.exitCode === 0 ? "complete" : "failed", logPath: message.logPath, message: `Exit ${message.exitCode}` });
        onFinish?.({ content: outputRef.current, exitCode: message.exitCode, signal: message.signal, logPath: message.logPath, journeyPath: message.journeyPath });
        return;
      }
      if (message.type === "error") {
        terminal.writeln(`\r\n[Fieldnotes] ${message.message}`);
        setState((current) => ({ ...current, status: "failed", message: message.message }));
      }
    });
    socket.addEventListener("error", () => setState((current) => ({ ...current, status: "failed", message: "Terminal connection failed." })));

    return () => {
      resize.disconnect();
      input.dispose();
      terminal.dispose();
      if (socket.readyState === WebSocket.OPEN && state.status === "running") socket.send(JSON.stringify({ type: "kill" }));
      socket.close();
    };
  }, [command, cwd, label, onFinish, runner.available, runner.terminalUrl]);

  const stop = () => socketRef.current?.readyState === WebSocket.OPEN && socketRef.current.send(JSON.stringify({ type: "kill" }));

  return (
    <div className="command-terminal">
      <div className="terminal-toolbar">
        <span className={`terminal-state ${state.status}`}>{state.status}</span>
        {state.logPath && <code title={state.logPath}>{state.logPath}</code>}
        {state.status === "running" && <button type="button" className="text-button danger" onClick={stop}>Stop</button>}
        <button type="button" className="text-button" onClick={onClose}>Hide</button>
      </div>
      <div className="xterm-host" ref={hostRef} />
      {state.message && <p className={state.status === "failed" ? "form-error" : "terminal-message"}>{state.message}</p>}
    </div>
  );
}

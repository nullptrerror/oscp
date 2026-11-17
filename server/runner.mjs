import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as pty from "node-pty";
import { WebSocketServer } from "ws";

const REQUIRED_TOOLS = [
  "bash",
  "nmap",
  "nxc",
  "smbclient",
  "ldapsearch",
  "hashcat",
  "impacket-Get-GPPPassword",
  "impacket-GetNPUsers",
  "impacket-GetUserSPNs",
  "impacket-wmiexec",
  "impacket-psexec",
  "evil-winrm",
];
export const MAX_WEBSOCKET_PAYLOAD = 256 * 1024;
export const MAX_WEBSOCKET_BUFFER = 1024 * 1024;
const WEBSOCKET_RESUME_BUFFER = 256 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const TERMINAL_LIMITS = Object.freeze({ minCols: 20, maxCols: 300, minRows: 5, maxRows: 120, defaultCols: 120, defaultRows: 32 });
const token = crypto.randomBytes(24).toString("hex");
const allowedRoot = path.resolve(process.env.FIELDNOTES_WORKSPACE_ROOT || (process.platform === "win32" ? process.cwd() : "/home/kali/oscp"));
const allowedRootExisted = fs.existsSync(allowedRoot);
fs.mkdirSync(allowedRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
if (!allowedRootExisted) fs.chmodSync(allowedRoot, PRIVATE_DIRECTORY_MODE);
const allowedRootReal = fs.realpathSync(allowedRoot);

const json = (response, status, body) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
};

let readinessCache;
export const toolReadiness = () => {
  if (readinessCache) return readinessCache;
  if (process.platform === "win32") readinessCache = REQUIRED_TOOLS.map((name) => ({ name, ready: name === "bash" }));
  else readinessCache = REQUIRED_TOOLS.map((name) => ({
    name,
    ready: spawnSync("/bin/bash", ["-lc", `command -v '${name}' >/dev/null 2>&1`]).status === 0,
  }));
  return readinessCache;
};

const safeSlug = (value, fallback = "command") => String(value || fallback)
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 72) || fallback;

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const createPrivateDirectory = (directory) => {
  fs.mkdirSync(directory, { mode: PRIVATE_DIRECTORY_MODE });
  // mkdir's mode is filtered by the process umask; force the intended mode on
  // directories this runner just created without changing pre-existing paths.
  fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE);
};

// Walk one path component at a time. This catches an existing symlink before
// creating a child through it, then verifies the final canonical directory.
export const resolveConfinedDirectory = (root, requested) => {
  const lexicalRoot = path.resolve(root);
  if (!fs.existsSync(lexicalRoot)) {
    fs.mkdirSync(lexicalRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    fs.chmodSync(lexicalRoot, PRIVATE_DIRECTORY_MODE);
  }
  const realRoot = fs.realpathSync(lexicalRoot);
  const resolved = path.resolve(requested || lexicalRoot);
  if (!isWithin(lexicalRoot, resolved)) throw new Error(`Working directory must stay under ${lexicalRoot}`);

  const relative = path.relative(lexicalRoot, resolved);
  let cursor = lexicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) createPrivateDirectory(cursor);
    const canonical = fs.realpathSync(cursor);
    if (!isWithin(realRoot, canonical)) throw new Error(`Working directory must not traverse a symlink outside ${lexicalRoot}`);
  }
  const canonical = fs.realpathSync(resolved);
  if (!isWithin(realRoot, canonical)) throw new Error(`Working directory must stay under ${lexicalRoot}`);
  return canonical;
};

const resolveWorkingDirectory = (requested) => resolveConfinedDirectory(allowedRootReal, requested);

export const createPrivateLogStream = (filePath) => {
  let descriptor;
  try {
    try {
      const existing = fs.lstatSync(filePath);
      if (existing.isSymbolicLink()) throw new Error("Terminal log path must not be a symbolic link");
      if (!existing.isFile()) throw new Error("Terminal log path must be a regular file");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow;
    descriptor = fs.openSync(filePath, flags, PRIVATE_FILE_MODE);
    if (!fs.fstatSync(descriptor).isFile()) throw new Error("Terminal log descriptor must reference a regular file");
    fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    return fs.createWriteStream(filePath, { fd: descriptor, autoClose: true });
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw error;
  }
};

export const terminalLogHeading = (label, command, timestamp = new Date().toISOString()) => {
  const safeLabel = String(label || "Command").replace(/[\r\n]+/g, " ").slice(0, 240);
  return `\n### ${timestamp} · ${safeLabel}\n$ ${String(command || "")}\n`;
};

const clampedInteger = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
};

export const terminalDimensions = (cols, rows) => ({
  cols: clampedInteger(cols, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, TERMINAL_LIMITS.defaultCols),
  rows: clampedInteger(rows, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, TERMINAL_LIMITS.defaultRows),
});

// node-pty's Unix transport reports EIO/errno 5 as the normal final read when
// the slave side exits, and may transiently surface EAGAIN while opening it.
// Its own listener deliberately ignores these values; our additional listener
// must do the same so the later onExit event remains authoritative.
export const isExpectedPtyError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  return code === "EAGAIN" || code === "EIO" || /\berrno\s*5\b/iu.test(String(error?.message || ""));
};

const send = (socket, message) => {
  if (socket.readyState !== socket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

export const selectProofConfig = (command, flagNames = {}) => {
  const commandText = String(command || "").toLowerCase();
  return [
    { kind: "user", name: String(flagNames?.user || "") },
    { kind: "root", name: String(flagNames?.root || "") },
  ].find((entry) => entry.name && commandText.includes(entry.name.toLowerCase())) || null;
};

export const createTerminalFinalizer = ({ commandLog, journeyLog, logPath, journeyPath, notify }) => {
  let finalized = false;
  return ({ exitCode = null, signal = null, notifyClient = true } = {}) => {
    if (finalized) return false;
    finalized = true;
    const ending = `\n[Fieldnotes] exit=${exitCode ?? "unknown"} signal=${signal ?? "none"}\n`;
    for (const stream of [commandLog, journeyLog]) {
      if (!stream || stream.destroyed || stream.writableEnded) continue;
      try { stream.end(ending); } catch { /* the stream already reported its failure */ }
    }
    if (notifyClient) notify?.({ type: "exit", exitCode, signal, logPath, journeyPath });
    return true;
  };
};

const normalizeHost = (hostHeader) => {
  if (typeof hostHeader !== "string" || !hostHeader.trim()) return null;
  try {
    const parsed = new URL(`http://${hostHeader.trim()}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return { host: parsed.host.toLowerCase(), hostname: parsed.hostname.toLowerCase().replace(/\.$/, "") };
  } catch {
    return null;
  }
};

export const isLoopbackHost = (hostHeader) => {
  const parsed = normalizeHost(hostHeader);
  return Boolean(parsed && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
};

// The browser UI is the only supported terminal client. Requiring an exact
// Origin/Host match prevents another local or DNS-rebound page from driving the
// PTY even if it somehow learns the per-process bearer token.
export const isSameOriginTerminalRequest = (headers = {}) => {
  const requestHost = normalizeHost(headers.host);
  if (!requestHost || !isLoopbackHost(headers.host) || typeof headers.origin !== "string") return false;
  try {
    const origin = new URL(headers.origin);
    if (!["http:", "https:"].includes(origin.protocol)) return false;
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
    return isLoopbackHost(origin.host) && origin.host.toLowerCase() === requestHost.host;
  } catch {
    return false;
  }
};

const rejectUpgrade = (socket, status, reason) => {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

export function runnerMiddleware(request, response, next) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/api/health") return next?.();
  if (!isLoopbackHost(request.headers.host)) return json(response, 403, { error: "Loopback host required" });
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  return json(response, 200, {
    mode: "local",
    platform: process.platform,
    workspaceRoot: allowedRoot,
    token,
    tools: toolReadiness(),
  });
}

export function attachRunnerWebSocket(server) {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/api/terminal") return;
    if (!isSameOriginTerminalRequest(request.headers)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (url.searchParams.get("token") !== token) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit("connection", client, request));
  });

  webSocketServer.on("connection", (socket) => {
    let terminal = null;
    let commandLog = null;
    let journeyLog = null;
    let started = false;
    let proofConfig = null;
    let proofBuffer = "";
    let proofReported = false;
    let finalizeSession = null;
    let closeFallback = null;
    let flowTimer = null;
    let outputPaused = false;
    let acceptingOutput = false;
    let logFailureReported = false;
    let terminalFailureReported = false;
    let sessionLogPath = "";
    let sessionJourneyPath = "";

    const clearFlowTimer = () => {
      if (flowTimer) clearTimeout(flowTimer);
      flowTimer = null;
    };

    const failForTerminalError = (error, operation = "I/O") => {
      if (terminalFailureReported) return;
      terminalFailureReported = true;
      acceptingOutput = false;
      clearFlowTimer();
      send(socket, {
        type: "error",
        message: `Embedded terminal ${operation} failed: ${error instanceof Error ? error.message : "unknown PTY error"}`,
        logPath: sessionLogPath,
        journeyPath: sessionJourneyPath,
      });
      finalizeSession?.({ exitCode: null, signal: "terminal-error", notifyClient: false });
      const failedTerminal = terminal;
      try { failedTerminal?.kill(); } catch { terminal = null; }
    };

    const outputBackedUp = () => (
      Boolean(commandLog?.writableNeedDrain)
      || Boolean(journeyLog?.writableNeedDrain)
      || (socket.readyState === socket.OPEN && socket.bufferedAmount > WEBSOCKET_RESUME_BUFFER)
    );

    const scheduleFlowCheck = () => {
      if (flowTimer || !outputPaused) return;
      flowTimer = setTimeout(() => {
        flowTimer = null;
        if (!acceptingOutput || !terminal) return;
        if (outputBackedUp()) {
          scheduleFlowCheck();
          return;
        }
        outputPaused = false;
        try { terminal.resume?.(); } catch (error) { failForTerminalError(error, "resume"); }
      }, 25);
      flowTimer.unref?.();
    };

    const applyOutputBackpressure = () => {
      const websocketBackedUp = socket.readyState === socket.OPEN && socket.bufferedAmount > MAX_WEBSOCKET_BUFFER;
      if (!commandLog?.writableNeedDrain && !journeyLog?.writableNeedDrain && !websocketBackedUp) return;
      if (!outputPaused) {
        outputPaused = true;
        try { terminal?.pause?.(); } catch (error) {
          failForTerminalError(error, "pause");
          return;
        }
      }
      scheduleFlowCheck();
    };

    const failForLogError = (error) => {
      if (logFailureReported) return;
      logFailureReported = true;
      acceptingOutput = false;
      clearFlowTimer();
      send(socket, {
        type: "error",
        message: `Terminal evidence log failed: ${error instanceof Error ? error.message : "unknown write error"}`,
        logPath: sessionLogPath,
        journeyPath: sessionJourneyPath,
      });
      finalizeSession?.({ exitCode: null, signal: "log-error", notifyClient: false });
      try { terminal?.kill(); } catch { terminal = null; }
    };

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        send(socket, { type: "error", message: "Invalid terminal message." });
        return;
      }

      if (message.type === "start" && !started) {
        started = true;
        try {
          proofConfig = selectProofConfig(message.command, message.flagNames);
          const cwd = resolveWorkingDirectory(message.cwd);
          const notesDirectory = resolveConfinedDirectory(cwd, path.join(cwd, "notes"));
          const logDirectory = resolveConfinedDirectory(cwd, path.join(cwd, "notes", "commands"));
          fs.chmodSync(notesDirectory, PRIVATE_DIRECTORY_MODE);
          fs.chmodSync(logDirectory, PRIVATE_DIRECTORY_MODE);
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const uniqueSuffix = crypto.randomBytes(6).toString("hex");
          sessionLogPath = path.join(logDirectory, `${stamp}-${safeSlug(message.label)}-${uniqueSuffix}.log`);
          sessionJourneyPath = path.join(cwd, "notes", "terminal.log");
          commandLog = createPrivateLogStream(sessionLogPath);
          journeyLog = createPrivateLogStream(sessionJourneyPath);
          finalizeSession = createTerminalFinalizer({
            commandLog,
            journeyLog,
            logPath: sessionLogPath,
            journeyPath: sessionJourneyPath,
            notify: (payload) => send(socket, payload),
          });
          commandLog.on("error", failForLogError);
          journeyLog.on("error", failForLogError);
          const heading = terminalLogHeading(message.label, message.command);
          commandLog.write(heading);
          journeyLog.write(heading);

          const shell = process.platform === "win32" ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
          const args = process.platform === "win32"
            ? ["-NoLogo", "-NoProfile", "-Command", message.command]
            : ["-lc", message.command];
          const dimensions = terminalDimensions(message.cols, message.rows);
          acceptingOutput = true;
          terminal = pty.spawn(shell, args, {
            name: "xterm-256color",
            ...dimensions,
            cwd,
            env: { ...process.env, TERM: "xterm-256color" },
          });
          send(socket, { type: "started", logPath: sessionLogPath, journeyPath: sessionJourneyPath, pid: terminal.pid });
          terminal.onData((data) => {
            if (!acceptingOutput) return;
            try {
              commandLog.write(data);
              journeyLog.write(data);
            } catch (error) {
              failForLogError(error);
              return;
            }
            send(socket, { type: "output", data });
            applyOutputBackpressure();
            if (proofConfig && !proofReported) {
              proofBuffer = `${proofBuffer}${data.replace(/\x1b\[[0-9;:]*[A-Za-z]/g, "")}`.slice(-2048);
              const candidate = proofBuffer.match(/(?:^|\s)([a-f0-9]{32,64})(?=\s|$)/i);
              if (candidate) {
                proofReported = true;
                send(socket, { type: "flag", kind: proofConfig.kind, flagName: proofConfig.name, value: candidate[1].toLowerCase() });
              }
            }
          });
          terminal.onExit(({ exitCode, signal }) => {
            if (closeFallback) clearTimeout(closeFallback);
            closeFallback = null;
            acceptingOutput = false;
            clearFlowTimer();
            finalizeSession?.({ exitCode, signal });
            terminal = null;
          });
          terminal.on?.("error", (error) => {
            if (!isExpectedPtyError(error)) failForTerminalError(error, "PTY");
          });
        } catch (error) {
          acceptingOutput = false;
          clearFlowTimer();
          if (finalizeSession) finalizeSession({ exitCode: null, signal: "start-error", notifyClient: false });
          else {
            const ending = "\n[Fieldnotes] exit=unknown signal=start-error\n";
            commandLog?.end(ending);
            journeyLog?.end(ending);
          }
          const failedTerminal = terminal;
          terminal = null;
          try { failedTerminal?.kill(); } catch { /* the failed PTY is already gone */ }
          send(socket, {
            type: "error",
            message: error instanceof Error ? error.message : "Could not start terminal.",
            logPath: sessionLogPath,
            journeyPath: sessionJourneyPath,
          });
        }
        return;
      }

      if (message.type === "input" && terminal && acceptingOutput) {
        if (Object.hasOwn(message, "proofCommand")) {
          const stagedCommand = String(message.proofCommand || "");
          if (stagedCommand) {
            const heading = terminalLogHeading(message.commandLabel, stagedCommand);
            try {
              commandLog?.write(heading);
              journeyLog?.write(heading);
            } catch (error) {
              failForLogError(error);
              return;
            }
            applyOutputBackpressure();
          }
          proofConfig = selectProofConfig(message.proofCommand, message.flagNames);
          proofBuffer = "";
          proofReported = false;
        }
        try { terminal.write(String(message.data || "")); } catch (error) { failForTerminalError(error, "input"); }
      }
      if (message.type === "resize" && terminal) {
        const dimensions = terminalDimensions(message.cols, message.rows);
        try { terminal.resize(dimensions.cols, dimensions.rows); } catch (error) { failForTerminalError(error, "resize"); }
      }
      if (message.type === "kill" && terminal) {
        try { terminal.kill(); } catch (error) { failForTerminalError(error, "stop"); }
      }
    });

    // `ws` emits EventEmitter errors for transport failures. Handling the
    // event avoids a process-level uncaught exception; termination then drives
    // the normal close path that stops the PTY and finalizes its logs.
    socket.on("error", () => {
      try { socket.terminate(); } catch { /* the socket is already closed */ }
    });

    socket.on("close", () => {
      clearFlowTimer();
      if (!terminal) {
        finalizeSession?.({ exitCode: null, signal: "socket-closed", notifyClient: false });
        return;
      }
      closeFallback = setTimeout(() => {
        acceptingOutput = false;
        clearFlowTimer();
        finalizeSession?.({ exitCode: null, signal: "socket-closed", notifyClient: false });
        const stuckTerminal = terminal;
        terminal = null;
        try { stuckTerminal?.kill("SIGKILL"); } catch { /* already gone */ }
      }, 250);
      closeFallback.unref?.();
      try {
        terminal.kill();
      } catch {
        clearTimeout(closeFallback);
        closeFallback = null;
        acceptingOutput = false;
        finalizeSession?.({ exitCode: null, signal: "kill-error", notifyClient: false });
        terminal = null;
      }
    });
  });

  return webSocketServer;
}

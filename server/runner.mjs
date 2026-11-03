import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as pty from "node-pty";
import { WebSocketServer } from "ws";

const REQUIRED_TOOLS = ["bash", "nmap", "nxc", "smbclient", "ldapsearch", "hashcat", "impacket-GetUserSPNs", "evil-winrm"];
const token = crypto.randomBytes(24).toString("hex");
const allowedRoot = path.resolve(process.env.FIELDNOTES_WORKSPACE_ROOT || (process.platform === "win32" ? process.cwd() : "/home/kali/oscp"));

const json = (response, status, body) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
};

const toolReadiness = () => {
  if (process.platform === "win32") return REQUIRED_TOOLS.map((name) => ({ name, ready: name === "bash" }));
  return REQUIRED_TOOLS.map((name) => ({
    name,
    ready: spawnSync("/bin/bash", ["-lc", `command -v '${name}' >/dev/null 2>&1`]).status === 0,
  }));
};

const safeSlug = (value, fallback = "command") => String(value || fallback)
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 72) || fallback;

const resolveWorkingDirectory = (requested) => {
  const resolved = path.resolve(requested || allowedRoot);
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Working directory must stay under ${allowedRoot}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
};

const send = (socket, message) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

export function runnerMiddleware(request, response, next) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/api/health") return next?.();
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
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/api/terminal") return;
    if (url.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit("connection", client, request));
  });

  webSocketServer.on("connection", (socket) => {
    let terminal = null;
    let commandLog = null;
    let journeyLog = null;
    let started = false;

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
          const cwd = resolveWorkingDirectory(message.cwd);
          const logDirectory = path.join(cwd, "notes", "commands");
          fs.mkdirSync(logDirectory, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const logPath = path.join(logDirectory, `${stamp}-${safeSlug(message.label)}.log`);
          const journeyPath = path.join(cwd, "notes", "terminal.log");
          commandLog = fs.createWriteStream(logPath, { flags: "a" });
          journeyLog = fs.createWriteStream(journeyPath, { flags: "a" });
          const heading = `\n### ${new Date().toISOString()} · ${message.label || "Command"}\n$ ${message.command}\n`;
          commandLog.write(heading);
          journeyLog.write(heading);

          const shell = process.platform === "win32" ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
          const args = process.platform === "win32"
            ? ["-NoLogo", "-NoProfile", "-Command", message.command]
            : ["-lc", message.command];
          terminal = pty.spawn(shell, args, {
            name: "xterm-256color",
            cols: Number(message.cols) || 120,
            rows: Number(message.rows) || 32,
            cwd,
            env: { ...process.env, TERM: "xterm-256color" },
          });
          send(socket, { type: "started", logPath, journeyPath, pid: terminal.pid });
          terminal.onData((data) => {
            commandLog.write(data);
            journeyLog.write(data);
            send(socket, { type: "output", data });
          });
          terminal.onExit(({ exitCode, signal }) => {
            const ending = `\n[Fieldnotes] exit=${exitCode} signal=${signal ?? "none"}\n`;
            commandLog.end(ending);
            journeyLog.end(ending);
            send(socket, { type: "exit", exitCode, signal, logPath, journeyPath });
            terminal = null;
          });
        } catch (error) {
          send(socket, { type: "error", message: error instanceof Error ? error.message : "Could not start terminal." });
        }
        return;
      }

      if (message.type === "input" && terminal) terminal.write(String(message.data || ""));
      if (message.type === "resize" && terminal) terminal.resize(Math.max(20, Number(message.cols) || 120), Math.max(5, Number(message.rows) || 32));
      if (message.type === "kill" && terminal) terminal.kill();
    });

    socket.on("close", () => {
      if (terminal) terminal.kill();
      commandLog?.end();
      journeyLog?.end();
    });
  });

  return webSocketServer;
}

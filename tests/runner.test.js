import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPrivateLogIdentity,
  createPrivateLogStream,
  createTerminalFinalizer,
  createTranscriptOwnershipRegistry,
  isExpectedPtyError,
  isLoopbackHost,
  isSameOriginTerminalRequest,
  MAX_WEBSOCKET_BUFFER,
  MAX_WEBSOCKET_PAYLOAD,
  prepareTerminalJourney,
  resolveConfinedDirectory,
  selectProofConfig,
  terminalDimensions,
  terminalLogHeading,
  transcriptShellJourneyPath,
  toolReadiness,
  withPrivateUmask,
} from "../server/runner.mjs";

test("runner creates and resolves working directories only inside its root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-outside-"));
  try {
    const nested = resolveConfinedDirectory(root, path.join(root, "machine", "notes"));
    assert.equal(nested, path.join(root, "machine", "notes"));
    assert.throws(() => resolveConfinedDirectory(root, outside), /must stay under/);
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    assert.throws(() => resolveConfinedDirectory(root, path.join(root, "escape", "child")), /symlink outside/);
    assert.equal(fs.existsSync(path.join(outside, "child")), false, "no directory is created through the escaping symlink");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("runner accepts only explicit loopback Host headers", () => {
  for (const host of ["127.0.0.1:4173", "localhost:5173", "LOCALHOST", "[::1]:4173"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of [undefined, "", "0.0.0.0:4173", "127.0.0.2:4173", "localhost.example:4173", "example.test", "localhost:4173/path", "user@localhost:4173"]) {
    assert.equal(isLoopbackHost(host), false, String(host));
  }
});

test("terminal WebSocket requires an exact same-origin loopback page", () => {
  assert.equal(isSameOriginTerminalRequest({ host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" }), true);
  assert.equal(isSameOriginTerminalRequest({ host: "localhost:5173", origin: "http://localhost:5173" }), true);
  assert.equal(isSameOriginTerminalRequest({ host: "[::1]:4173", origin: "https://[::1]:4173" }), true);

  for (const headers of [
    { host: "127.0.0.1:4173" },
    { host: "127.0.0.1:4173", origin: "http://127.0.0.1:5173" },
    { host: "localhost:4173", origin: "http://127.0.0.1:4173" },
    { host: "127.0.0.1:4173", origin: "https://example.test" },
    { host: "example.test", origin: "https://example.test" },
    { host: "127.0.0.1:4173", origin: "file://" },
    { host: "127.0.0.1:4173", origin: "not a URL" },
  ]) {
    assert.equal(isSameOriginTerminalRequest(headers), false, JSON.stringify(headers));
  }
});

test("proof detection is armed only by a configured proof filename", () => {
  const flagNames = { user: "local.txt", root: "proof.txt" };
  assert.deepEqual(selectProofConfig("cat /home/student/local.txt", flagNames), { kind: "user", name: "local.txt" });
  assert.deepEqual(selectProofConfig("type C:\\Users\\Administrator\\Desktop\\PROOF.TXT", flagNames), { kind: "root", name: "proof.txt" });
  assert.equal(selectProofConfig("whoami /all", flagNames), null);
  assert.equal(selectProofConfig("cat /tmp/proof.txt", {}), null);
  assert.equal(selectProofConfig("", flagNames), null);
});

test("normal node-pty Unix close errors remain non-fatal", () => {
  assert.equal(isExpectedPtyError(Object.assign(new Error("read EIO"), { code: "EIO" })), true);
  assert.equal(isExpectedPtyError(Object.assign(new Error("resource unavailable"), { code: "EAGAIN" })), true);
  assert.equal(isExpectedPtyError(new Error("pty errno 5")), true);
  assert.equal(isExpectedPtyError(new Error("pty errno 50")), false);
  assert.equal(isExpectedPtyError(Object.assign(new Error("permission denied"), { code: "EACCES" })), false);
});

test("runner-created directories and logs stay private despite a permissive umask", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-private-"));
  const previousUmask = process.umask(0o000);
  try {
    const nested = resolveConfinedDirectory(root, path.join(root, "machine", "notes", "commands"));
    for (const directory of [path.join(root, "machine"), path.join(root, "machine", "notes"), nested]) {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700, directory);
    }

    const logPath = path.join(nested, "terminal.log");
    const stream = createPrivateLogStream(logPath);
    assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
    stream.end("test\n");
    await new Promise((resolve, reject) => {
      stream.once("finish", resolve);
      stream.once("error", reject);
    });
  } finally {
    process.umask(previousUmask);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("terminal child creation uses a private umask without changing the runner", () => {
  const original = process.umask();
  let inherited;
  const result = withPrivateUmask(() => {
    inherited = process.umask();
    return "spawned";
  });

  assert.equal(result, "spawned");
  assert.equal(inherited, 0o077);
  assert.equal(process.umask(), original);
});

test("private log streams reject symlinks without touching their destination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-log-link-"));
  try {
    const destination = path.join(root, "outside.log");
    const link = path.join(root, "terminal.log");
    fs.writeFileSync(destination, "unchanged\n", { mode: 0o644 });
    fs.symlinkSync(destination, link);

    assert.throws(() => createPrivateLogStream(link), /must not be a symbolic link/);
    assert.equal(fs.readFileSync(destination, "utf8"), "unchanged\n");
    assert.equal(fs.statSync(destination).mode & 0o777, 0o644, "destination mode is not changed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only the exact standard transcript shell command owns the journey log", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-exact-script-"));
  try {
    const cwd = resolveConfinedDirectory(root, path.join(root, "forest"));
    resolveConfinedDirectory(cwd, path.join(cwd, "notes"));
    const journeyPath = path.join(cwd, "notes", "terminal.log");
    const exact = `script -a '${journeyPath}'`;
    assert.equal(transcriptShellJourneyPath(exact, cwd), journeyPath);
    assert.equal(transcriptShellJourneyPath(`  ${exact}  `, cwd), journeyPath);
    for (const command of [
      `script -a ${journeyPath}`,
      `script -a '${journeyPath}.other'`,
      `script -q -a '${journeyPath}'`,
      `${exact}; id`,
      `sudo ${exact}`,
    ]) {
      assert.equal(transcriptShellJourneyPath(command, cwd), "", command);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a transcript shell gets one private child-owned journey file and no runner writer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-transcript-"));
  try {
    const cwd = resolveConfinedDirectory(root, path.join(root, "forest"));
    resolveConfinedDirectory(cwd, path.join(cwd, "notes"));
    const journeyPath = path.join(cwd, "notes", "terminal.log");
    const owned = prepareTerminalJourney(`script -a '${journeyPath}'`, cwd);
    assert.equal(owned.childOwned, true);
    assert.equal(owned.journeyPath, journeyPath);
    assert.equal(owned.journeyLog, null, "the runner must not become a second transcript writer");
    assert.equal(fs.statSync(journeyPath).mode & 0o777, 0o600);

    const normalPath = path.join(cwd, "notes", "normal-terminal.log");
    fs.renameSync(journeyPath, normalPath);
    const normal = prepareTerminalJourney("whoami", cwd);
    assert.equal(normal.childOwned, false);
    assert.ok(normal.journeyLog);
    normal.journeyLog.end("one copy\n");
    await new Promise((resolve, reject) => {
      normal.journeyLog.once("finish", resolve);
      normal.journeyLog.once("error", reject);
    });
    assert.equal(fs.readFileSync(normal.journeyPath, "utf8"), "one copy\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a symlinked in-root workspace still recognizes the exact app-rendered transcript command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-transcript-link-"));
  try {
    const workspaces = resolveConfinedDirectory(root, path.join(root, "workspaces"));
    const lexicalRoot = path.join(root, "current");
    fs.symlinkSync(workspaces, lexicalRoot, "dir");
    const lexicalCwd = path.join(lexicalRoot, "forest");
    const canonicalCwd = resolveConfinedDirectory(root, lexicalCwd);
    resolveConfinedDirectory(canonicalCwd, path.join(canonicalCwd, "notes"));
    const lexicalJourneyPath = path.join(lexicalCwd, "notes", "terminal.log");
    const canonicalJourneyPath = path.join(canonicalCwd, "notes", "terminal.log");

    const owned = prepareTerminalJourney(`script -a '${lexicalJourneyPath}'`, canonicalCwd, lexicalCwd);
    assert.equal(owned.childOwned, true);
    assert.equal(owned.journeyPath, canonicalJourneyPath);
    assert.equal(owned.journeyLog, null, "the canonical transcript must still have only the child writer");
    assert.equal(fs.statSync(canonicalJourneyPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lexical repeated slashes and in-root parent segments retain one transcript owner", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-transcript-lexical-"));
  try {
    const repeatedRoot = `${root}//repeated//`;
    const repeatedCwd = `${repeatedRoot.replace(/\/$/u, "")}/forest`;
    const repeatedCanonical = resolveConfinedDirectory(root, repeatedCwd);
    resolveConfinedDirectory(repeatedCanonical, path.join(repeatedCanonical, "notes"));
    const repeatedJourney = `${repeatedRoot}/forest/notes/terminal.log`;
    const repeated = prepareTerminalJourney(`script -a '${repeatedJourney}'`, repeatedCanonical, repeatedCwd);
    assert.equal(repeated.childOwned, true);
    assert.equal(repeated.journeyLog, null);
    assert.equal(repeated.journeyPath, path.join(repeatedCanonical, "notes", "terminal.log"));

    const holding = resolveConfinedDirectory(root, path.join(root, "holding"));
    const parentCwd = `${holding}/../parent-segment/forest`;
    const parentCanonical = resolveConfinedDirectory(root, parentCwd);
    resolveConfinedDirectory(parentCanonical, path.join(parentCanonical, "notes"));
    const parentJourney = `${parentCwd}/notes/terminal.log`;
    const parent = prepareTerminalJourney(`script -a '${parentJourney}'`, parentCanonical, parentCwd);
    assert.equal(parent.childOwned, true);
    assert.equal(parent.journeyLog, null);
    assert.equal(parent.journeyPath, path.join(parentCanonical, "notes", "terminal.log"));

    const quotedCwd = path.join(root, "operator's workspace", "forest");
    const quotedCanonical = resolveConfinedDirectory(root, quotedCwd);
    resolveConfinedDirectory(quotedCanonical, path.join(quotedCanonical, "notes"));
    const quotedJourney = path.join(quotedCwd, "notes", "terminal.log");
    const shellQuotedJourney = `'${quotedJourney.replaceAll("'", `'"'"'`)}'`;
    const quoted = prepareTerminalJourney(`script -a ${shellQuotedJourney}`, quotedCanonical, quotedCwd);
    assert.equal(quoted.childOwned, true);
    assert.equal(quoted.journeyLog, null);
    assert.equal(quoted.journeyPath, path.join(quotedCanonical, "notes", "terminal.log"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transcript leases reject other browser or endpoint owners until the live owner releases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-owner-"));
  try {
    const realNotes = resolveConfinedDirectory(root, path.join(root, "workspaces", "forest", "notes"));
    const linkedNotes = path.join(root, "linked-notes");
    fs.symlinkSync(realNotes, linkedNotes, "dir");
    const canonicalPath = path.join(realNotes, "terminal.log");
    const linkedPath = path.join(linkedNotes, "terminal.log");
    fs.writeFileSync(canonicalPath, "", { mode: 0o600 });
    const registry = createTranscriptOwnershipRegistry();

    const first = registry.acquire(linkedPath, "browser-a:endpoint-a");
    assert.equal(first.filePath, canonicalPath);
    assert.equal(registry.isOwned(canonicalPath), true);
    assert.equal(registry.size, 1);
    assert.throws(
      () => registry.acquire(canonicalPath, "browser-b:endpoint-b"),
      /already owns this machine transcript/,
    );

    assert.equal(first.release(), true);
    assert.equal(first.release(), false, "release is idempotent");
    assert.equal(registry.isOwned(canonicalPath), false);
    const replacement = registry.acquire(canonicalPath, "browser-b:endpoint-b");
    assert.equal(replacement.ownerId, "browser-b:endpoint-b");
    assert.equal(replacement.release(), true);
    assert.equal(registry.size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transcript ownership rejects symlink and non-file destinations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-transcript-path-"));
  try {
    const cwd = resolveConfinedDirectory(root, path.join(root, "forest"));
    const notes = resolveConfinedDirectory(cwd, path.join(cwd, "notes"));
    const journeyPath = path.join(notes, "terminal.log");
    const command = `script -a '${journeyPath}'`;
    const destination = path.join(root, "outside.log");
    fs.writeFileSync(destination, "unchanged\n");
    fs.symlinkSync(destination, journeyPath);
    assert.throws(() => prepareTerminalJourney(command, cwd), /must not be a symbolic link/);
    assert.equal(fs.readFileSync(destination, "utf8"), "unchanged\n");

    fs.unlinkSync(journeyPath);
    fs.mkdirSync(journeyPath);
    assert.throws(() => prepareTerminalJourney(command, cwd), /must be a regular file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recorded-shell startup detects a transcript pathname swap", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-transcript-swap-"));
  try {
    const cwd = resolveConfinedDirectory(root, path.join(root, "forest"));
    resolveConfinedDirectory(cwd, path.join(cwd, "notes"));
    const journeyPath = path.join(cwd, "notes", "terminal.log");
    const owned = prepareTerminalJourney(`script -a '${journeyPath}'`, cwd);
    fs.renameSync(journeyPath, `${journeyPath}.original`);
    fs.writeFileSync(journeyPath, "replacement\n", { mode: 0o600 });
    assert.throws(
      () => assertPrivateLogIdentity(journeyPath, owned.childIdentity),
      /transcript changed while the recorded shell was starting/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("terminal log headings preserve exact staged commands and flatten labels", () => {
  const heading = terminalLogHeading("Proof\r\ncollection", "type C:\\proof.txt", "2026-11-17T12:00:00.000Z");
  assert.equal(heading, "\n### 2026-11-17T12:00:00.000Z · Proof collection\n$ type C:\\proof.txt\n");
});

test("terminal finalization appends one exit record and closes each log once", () => {
  const commandEndings = [];
  const journeyEndings = [];
  const notifications = [];
  const finalize = createTerminalFinalizer({
    commandLog: { end: (value) => commandEndings.push(value) },
    journeyLog: { end: (value) => journeyEndings.push(value) },
    logPath: "/workspace/command.log",
    journeyPath: "/workspace/terminal.log",
    notify: (message) => notifications.push(message),
  });

  assert.equal(finalize({ exitCode: 130, signal: "SIGINT" }), true);
  assert.equal(finalize({ exitCode: null, signal: "socket-closed" }), false);
  assert.deepEqual(commandEndings, ["\n[Fieldnotes] exit=130 signal=SIGINT\n"]);
  assert.deepEqual(journeyEndings, commandEndings);
  assert.deepEqual(notifications, [{
    type: "exit",
    exitCode: 130,
    signal: "SIGINT",
    logPath: "/workspace/command.log",
    journeyPath: "/workspace/terminal.log",
  }]);
});

test("terminal dimensions and WebSocket payloads are bounded", () => {
  assert.deepEqual(terminalDimensions(undefined, undefined), { cols: 120, rows: 32 });
  assert.deepEqual(terminalDimensions(-500, 0), { cols: 20, rows: 5 });
  assert.deepEqual(terminalDimensions(10_000, Number.POSITIVE_INFINITY), { cols: 300, rows: 32 });
  assert.deepEqual(terminalDimensions(80.9, 24.8), { cols: 80, rows: 24 });
  assert.equal(MAX_WEBSOCKET_PAYLOAD, 256 * 1024);
  assert.equal(MAX_WEBSOCKET_BUFFER, 1024 * 1024);
});

test("tool readiness is cached for the runner process", () => {
  assert.strictEqual(toolReadiness(), toolReadiness());
});

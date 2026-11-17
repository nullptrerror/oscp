import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBoundedTerminalText,
  compatibleTerminalSessions,
  normalizeTerminalContext,
  terminalInputForCommand,
  terminalWorkspaceInitialState,
  terminalWorkspaceReducer,
} from "../src/lib/terminalWorkspace.js";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { PIVOT_STEPS } from "../src/data/pivotPlaybooks.js";

const session = (patch = {}) => ({
  id: "terminal-a",
  targetId: "target-a",
  targetName: "Target A",
  endpointId: "endpoint-a",
  address: "192.0.2.10",
  context: "foothold-windows",
  contextConfirmed: true,
  status: "running",
  transcript: "",
  activeStep: null,
  pendingStep: null,
  flagNames: { user: "local.txt", root: "proof.txt" },
  ...patch,
});

test("named terminal labels map to typed embedded contexts", () => {
  assert.equal(normalizeTerminalContext("lhost", "operator-terminal"), "lhost");
  assert.equal(normalizeTerminalContext("pivot", "pivot-terminal"), "pivot");
  assert.equal(normalizeTerminalContext("lhost", "ligolo-console"), "ligolo-console");
  assert.equal(normalizeTerminalContext("foothold-windows"), "foothold-windows");
  assert.equal(normalizeTerminalContext("lhost", "future-console"), null);
  assert.equal(normalizeTerminalContext("future-host"), null);
});

test("every eligible catalog command has a recognized embedded execution route", () => {
  const commands = [...ALL_ITEMS.flatMap((item) => item.commands), ...PIVOT_STEPS];
  const eligible = commands.filter((command) => command.executionEnabled === true || (command.policy === "exam-core" && command.terminal));
  const unrouted = eligible.filter((command) => !normalizeTerminalContext(command.runsOn, command.terminal));
  assert.deepEqual(unrouted.map((command) => command.id), []);
});

test("compatible sessions require the same target, confirmed context, and an idle live PTY", () => {
  const sessions = [
    session(),
    session({ id: "wrong-target", targetId: "target-b" }),
    session({ id: "wrong-context", context: "foothold-linux" }),
    session({ id: "unconfirmed", contextConfirmed: false }),
    session({ id: "busy", activeStep: { runId: "run" } }),
    session({ id: "ended", status: "complete" }),
  ];
  assert.deepEqual(
    compatibleTerminalSessions(sessions, { targetId: "target-a", endpointId: "endpoint-a", address: "192.0.2.10", runsOn: "foothold-windows" }).map((entry) => entry.id),
    ["terminal-a"],
  );
});

test("compatible sessions are isolated to the endpoint snapshot that opened them", () => {
  const sessions = [
    session(),
    session({ id: "endpoint-b", endpointId: "endpoint-b", address: "192.0.2.20" }),
  ];
  const request = {
    targetId: "target-a",
    endpointId: "endpoint-b",
    address: "192.0.2.20",
    runsOn: "foothold-windows",
  };
  assert.deepEqual(compatibleTerminalSessions(sessions, request).map((entry) => entry.id), ["endpoint-b"]);
});

test("staging is inert until the operator explicitly runs the reviewed command", () => {
  const base = terminalWorkspaceReducer(terminalWorkspaceInitialState, { type: "add-session", session: session() });
  const step = { runId: "run-a", targetId: "target-a", requiredContext: "foothold-windows", runsOn: "foothold-windows", terminal: "", label: "Identity", command: "whoami", flagNames: { user: "user.txt", root: "root.txt" } };
  const staged = terminalWorkspaceReducer(base, { type: "stage-command", id: "terminal-a", step });
  assert.equal(staged.sessions[0].pendingStep.command, "whoami");
  assert.equal(staged.sessions[0].activeStep, null);
  assert.equal(staged.sessions[0].inputRequest, undefined);

  const running = terminalWorkspaceReducer(staged, { type: "run-staged", id: "terminal-a", startedAt: "2026-11-17T12:00:00Z", requestId: "input-a" });
  assert.equal(running.sessions[0].pendingStep, null);
  assert.equal(running.sessions[0].activeStep.command, "whoami");
  assert.equal(running.sessions[0].inputRequest.data, "whoami\r");
  assert.equal(running.sessions[0].inputRequest.proofCommand, "whoami");
  assert.equal(running.sessions[0].inputRequest.commandLabel, "Identity");
  assert.deepEqual(running.sessions[0].inputRequest.flagNames, { user: "user.txt", root: "root.txt" });
});

test("a staged command cannot cross machine or session-context boundaries", () => {
  const base = terminalWorkspaceReducer(terminalWorkspaceInitialState, { type: "add-session", session: session() });
  const wrongTarget = terminalWorkspaceReducer(base, { type: "stage-command", id: "terminal-a", step: { targetId: "target-b", requiredContext: "foothold-windows", runsOn: "foothold-windows", command: "hostname" } });
  const wrongContext = terminalWorkspaceReducer(base, { type: "stage-command", id: "terminal-a", step: { targetId: "target-a", requiredContext: "foothold-linux", runsOn: "foothold-linux", command: "id" } });
  assert.equal(wrongTarget.sessions[0].pendingStep, null);
  assert.equal(wrongContext.sessions[0].pendingStep, null);
});

test("collapsing or selecting another tab preserves every live session", () => {
  let state = terminalWorkspaceReducer(terminalWorkspaceInitialState, { type: "add-session", session: session() });
  state = terminalWorkspaceReducer(state, { type: "add-session", session: session({ id: "terminal-b", context: "lhost" }) });
  state = terminalWorkspaceReducer(state, { type: "set-collapsed", value: true });
  state = terminalWorkspaceReducer(state, { type: "select-session", id: "terminal-a" });
  assert.equal(state.sessions.length, 2);
  assert.ok(state.sessions.every((entry) => entry.status === "running"));
  assert.equal(state.activeSessionId, "terminal-a");
});

test("Ctrl-C cleanup cards send an interrupt byte instead of instructional prose", () => {
  assert.equal(terminalInputForCommand("Press Ctrl-C in the terminal running nc."), "\u0003");
  assert.equal(terminalInputForCommand("session_list"), "session_list\r");
});

test("a reviewed Ctrl-C cleanup can target a busy owned session without enabling other commands", () => {
  const busy = session({ context: "pivot", activeStep: { runId: "agent", command: "./agent" } });
  const cleanup = {
    runId: "cleanup",
    targetId: "target-a",
    requiredContext: "pivot",
    runsOn: "pivot",
    terminal: "pivot-terminal",
    label: "Stop agent",
    command: "Press Ctrl-C in the terminal running the agent.",
  };
  assert.deepEqual(compatibleTerminalSessions([busy], cleanup).map((entry) => entry.id), ["terminal-a"]);
  assert.deepEqual(compatibleTerminalSessions([busy], { targetId: "target-a", runsOn: "pivot", command: "whoami" }), []);
  const base = terminalWorkspaceReducer(terminalWorkspaceInitialState, { type: "add-session", session: busy });
  const staged = terminalWorkspaceReducer(base, { type: "stage-command", id: "terminal-a", step: cleanup });
  const running = terminalWorkspaceReducer(staged, { type: "run-staged", id: "terminal-a", startedAt: "2026-11-17T12:00:00Z", requestId: "interrupt" });
  assert.equal(running.sessions[0].activeStep.runId, "cleanup");
  assert.equal(running.sessions[0].inputRequest.data, "\u0003");
});

test("operator-terminal cleanup still finds an LHOST-owned tab after it becomes a console", () => {
  const proxy = session({ context: "ligolo-console", originContext: "lhost" });
  const request = { targetId: "target-a", runsOn: "lhost", terminal: "operator-terminal", command: "Press Ctrl-C in the terminal running ligolo-proxy." };
  assert.deepEqual(compatibleTerminalSessions([proxy], request).map((entry) => entry.id), ["terminal-a"]);
});

test("terminal step capture is bounded without storing unbounded output in React state", () => {
  const huge = "x".repeat((1024 * 1024) + 100);
  const captured = appendBoundedTerminalText("prefix", huge);
  assert.equal(captured.length, 1024 * 1024);
  assert.equal(captured, "x".repeat(1024 * 1024));
});

test("saving a snapshot rearms capture for later output from the same command", () => {
  const active = session({ activeStep: { runId: "run-a", command: "long-task", hasCapture: true } });
  const base = terminalWorkspaceReducer(terminalWorkspaceInitialState, { type: "add-session", session: active });
  const saved = terminalWorkspaceReducer(base, { type: "mark-step-saved", id: active.id });
  assert.equal(saved.sessions[0].activeStep.evidenceSaved, true);
  assert.equal(saved.sessions[0].activeStep.hasCapture, false);
  assert.equal(saved.sessions[0].activeStep.snapshotCount, 1);

  const moreOutput = terminalWorkspaceReducer(saved, { type: "mark-step-output", id: active.id });
  assert.equal(moreOutput.sessions[0].activeStep.hasCapture, true);
  const savedAgain = terminalWorkspaceReducer(moreOutput, { type: "mark-step-saved", id: active.id });
  assert.equal(savedAgain.sessions[0].activeStep.snapshotCount, 2);
  assert.equal(savedAgain.sessions[0].activeStep.hasCapture, false);
});

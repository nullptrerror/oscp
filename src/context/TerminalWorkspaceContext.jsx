import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { createId } from "../lib/workspace";
import {
  appendBoundedTerminalText,
  compatibleTerminalSessions,
  isInterruptInstruction,
  normalizeTerminalContext,
  terminalWorkspaceInitialState,
  terminalWorkspaceReducer,
} from "../lib/terminalWorkspace";

const TerminalWorkspaceContext = createContext(null);

export function TerminalWorkspaceProvider({ children }) {
  const { actions } = useWorkspace();
  const [state, dispatch] = useReducer(terminalWorkspaceReducer, terminalWorkspaceInitialState);
  const stateRef = useRef(state);
  const captureRef = useRef(new Map());
  const recordedRunsRef = useRef(new Set());
  const failedSessionsRef = useRef(new Set());

  stateRef.current = state;

  const recordStep = useCallback((step) => {
    if (!step || recordedRunsRef.current.has(step.runId)) return;
    recordedRunsRef.current.add(step.runId);
    actions.recordCommand(step.itemId, {
      id: step.runId,
      targetId: step.targetId,
      commandKey: step.commandKey,
      label: step.label,
      command: step.command,
      endpointId: step.endpointId,
      address: step.address,
      source: "local runner",
      startedAt: step.startedAt || new Date().toISOString(),
    });
  }, [actions]);

  const persistStepEvidence = useCallback((session, step, details = {}) => {
    if (!session || !step) return false;
    const capture = captureRef.current.get(session.id) || "";
    const hasCapture = Boolean(capture.trim());
    const hasExitStatus = details.exitCode !== undefined || details.signal !== undefined;
    if (!hasCapture && step.evidenceSaved && !details.errorMessage && !hasExitStatus) return false;
    const exitStatus = hasExitStatus
      ? `[Fieldnotes] Process ended${details.exitCode === null || details.exitCode === undefined ? "" : ` with exit code ${details.exitCode}`}${details.signal ? ` (${details.signal})` : ""}.`
      : "";
    const content = [capture, details.errorMessage ? `[Fieldnotes] ${details.errorMessage}` : "", exitStatus].filter(Boolean).join("\n");
    actions.addEvidence(step.itemId, {
      targetId: step.targetId,
      label: `${step.label} · embedded terminal ${details.errorMessage ? "failure" : hasExitStatus ? "final result" : "snapshot"}`,
      content: content || "[Fieldnotes] No terminal output was captured for this reviewed step.",
      substantive: hasCapture || Boolean(details.errorMessage),
      source: "embedded-terminal",
      exitCode: details.exitCode,
      logPath: details.logPath || session.logPath,
      journeyPath: details.journeyPath || session.journeyPath,
      commandRunId: step.runId,
      commandKey: step.commandKey,
      commandLabel: step.label,
      commandText: step.command,
      endpointId: step.endpointId,
      address: step.address,
    });
    captureRef.current.set(session.id, "");
    return true;
  }, [actions]);

  const openCommand = useCallback((request) => {
    const now = new Date().toISOString();
    const id = createId("terminal");
    const step = {
      runId: createId("command"),
      targetId: request.targetId,
      itemId: request.itemId,
      commandKey: request.commandKey,
      label: request.label,
      command: request.command,
      endpointId: request.endpointId,
      address: request.address,
      requiredContext: "lhost",
      startedAt: now,
      initial: true,
    };
    captureRef.current.set(id, "");
    dispatch({
      type: "add-session",
      session: {
        id,
        targetId: request.targetId,
        targetName: request.targetName,
        endpointId: request.endpointId,
        address: request.address,
        label: request.label,
        command: request.command,
        cwd: request.cwd,
        flagNames: request.flagNames,
        context: "lhost",
        originContext: "lhost",
        contextConfirmed: true,
        status: "connecting",
        activeStep: step,
        pendingStep: null,
        inputRequest: null,
        stopRequest: 0,
        logPath: "",
        journeyPath: "",
        proof: null,
      },
    });
    return id;
  }, []);

  const stageCommand = useCallback((sessionId, request) => {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    const requiredContext = normalizeTerminalContext(request.runsOn, request.terminal);
    if (!session || !requiredContext || compatibleTerminalSessions([session], request).length === 0) return false;
    dispatch({
      type: "stage-command",
      id: sessionId,
      step: {
        runId: createId("command"),
        targetId: request.targetId,
        itemId: request.itemId,
        commandKey: request.commandKey,
        label: request.label,
        command: request.command,
        endpointId: request.endpointId,
        address: request.address,
        requiredContext,
        runsOn: request.runsOn,
        terminal: request.terminal,
        flagNames: request.flagNames,
      },
    });
    dispatch({ type: "select-session", id: sessionId });
    return true;
  }, []);

  const runStaged = useCallback((sessionId) => {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    const interrupt = isInterruptInstruction(session?.pendingStep?.command);
    if (!session?.pendingStep || (!interrupt && session.activeStep) || session.status !== "running") return;
    if (interrupt && session.activeStep) {
      const saved = persistStepEvidence(session, session.activeStep);
      if (saved) dispatch({ type: "mark-step-saved", id: sessionId });
    }
    const startedAt = new Date().toISOString();
    const step = { ...session.pendingStep, startedAt };
    captureRef.current.set(sessionId, "");
    recordStep(step);
    dispatch({ type: "run-staged", id: sessionId, startedAt, requestId: createId("input") });
  }, [persistStepEvidence, recordStep]);

  const terminalStarted = useCallback((sessionId, details) => {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;
    recordStep(session.activeStep);
    dispatch({
      type: "update-session",
      id: sessionId,
      patch: {
        status: "running",
        logPath: details.logPath || "",
        journeyPath: details.journeyPath || "",
        pid: details.pid,
        started: true,
      },
    });
  }, [recordStep]);

  const terminalOutput = useCallback((sessionId, data) => {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    if (!session?.activeStep) return;
    const previousCapture = captureRef.current.get(sessionId) || "";
    const capture = appendBoundedTerminalText(previousCapture, data);
    captureRef.current.set(sessionId, capture);
    if (!previousCapture.trim() && capture.trim()) dispatch({ type: "mark-step-output", id: sessionId });
  }, []);

  const terminalExited = useCallback((sessionId, details) => {
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;
    if (session.activeStep) persistStepEvidence(session, session.activeStep, details);
    dispatch({
      type: "update-session",
      id: sessionId,
      patch: {
        status: details.exitCode === 0 ? "complete" : "failed",
        exitCode: details.exitCode,
        signal: details.signal,
        logPath: details.logPath || session.logPath,
        journeyPath: details.journeyPath || session.journeyPath,
        activeStep: null,
        pendingStep: null,
      },
    });
  }, [persistStepEvidence]);

  const terminalFailed = useCallback((sessionId, message, details = {}) => {
    if (failedSessionsRef.current.has(sessionId)) return;
    const session = stateRef.current.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;
    failedSessionsRef.current.add(sessionId);
    const failedBeforeStart = !session.started;
    if (failedBeforeStart) recordStep(session.activeStep);
    if (session.activeStep) persistStepEvidence(session, session.activeStep, {
      errorMessage: message,
      logPath: details.logPath,
      journeyPath: details.journeyPath,
    });
    dispatch({ type: "update-session", id: sessionId, patch: {
      status: "failed",
      message,
      logPath: details.logPath || session.logPath,
      journeyPath: details.journeyPath || session.journeyPath,
      activeStep: null,
      pendingStep: null,
    } });
  }, [persistStepEvidence, recordStep]);

  const terminalProof = useCallback((sessionId, proof) => {
    dispatch({ type: "update-session", id: sessionId, patch: { proof } });
  }, []);

  const value = useMemo(() => ({
    ...state,
    activeSession: state.sessions.find((session) => session.id === state.activeSessionId) || null,
    compatibleSessions: (request) => compatibleTerminalSessions(state.sessions, request),
    hasSessionsForTarget: (targetId) => state.sessions.some((session) => session.targetId === targetId),
    hasSessionsForEndpoint: (targetId, endpointId) => state.sessions.some((session) => session.targetId === targetId && session.endpointId === endpointId),
    openCommand,
    stageCommand,
    runStaged,
    cancelStaged: (id) => dispatch({ type: "cancel-staged", id }),
    saveActiveStep: (id) => {
      const session = stateRef.current.sessions.find((entry) => entry.id === id);
      if (!session?.activeStep?.hasCapture) return false;
      if (!persistStepEvidence(session, session.activeStep)) return false;
      dispatch({ type: "mark-step-saved", id });
      return true;
    },
    markSessionReady: (id) => {
      const session = stateRef.current.sessions.find((entry) => entry.id === id);
      if (!session?.activeStep || (!session.activeStep.hasCapture && !session.activeStep.evidenceSaved)) return false;
      if (session.activeStep.hasCapture) persistStepEvidence(session, session.activeStep);
      dispatch({ type: "finish-step", id });
      return true;
    },
    confirmContext: (id, context) => dispatch({ type: "confirm-context", id, context }),
    selectSession: (id) => dispatch({ type: "select-session", id }),
    setCollapsed: (collapsed) => dispatch({ type: "set-collapsed", value: collapsed }),
    stopSession: (id) => {
      const session = stateRef.current.sessions.find((entry) => entry.id === id);
      if (session?.status === "running" || session?.status === "connecting") {
        dispatch({ type: "update-session", id, patch: { stopRequest: (session.stopRequest || 0) + 1 } });
      }
    },
    closeSession: (id) => {
      const session = stateRef.current.sessions.find((entry) => entry.id === id);
      if (!session || ["running", "connecting"].includes(session.status) || session.activeStep || session.pendingStep) return false;
      captureRef.current.delete(id);
      failedSessionsRef.current.delete(id);
      dispatch({ type: "remove-session", id });
      return true;
    },
    terminalStarted,
    terminalOutput,
    terminalExited,
    terminalFailed,
    terminalProof,
  }), [
    openCommand,
    persistStepEvidence,
    runStaged,
    stageCommand,
    state,
    terminalExited,
    terminalFailed,
    terminalOutput,
    terminalProof,
    terminalStarted,
  ]);

  return <TerminalWorkspaceContext.Provider value={value}>{children}</TerminalWorkspaceContext.Provider>;
}

export function useTerminalWorkspace() {
  const context = useContext(TerminalWorkspaceContext);
  if (!context) throw new Error("useTerminalWorkspace must be used inside TerminalWorkspaceProvider");
  return context;
}

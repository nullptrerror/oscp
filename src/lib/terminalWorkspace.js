export const TERMINAL_CONTEXTS = Object.freeze([
  { value: "lhost", label: "Kali / LHOST" },
  { value: "foothold-linux", label: "Linux foothold" },
  { value: "foothold-windows", label: "Windows foothold" },
  { value: "pivot", label: "Pivot shell" },
  { value: "ligolo-console", label: "Ligolo console" },
]);

const CONTEXT_VALUES = new Set(TERMINAL_CONTEXTS.map((entry) => entry.value));
const TERMINAL_ALIASES = Object.freeze({
  "operator-terminal": "lhost",
  "pivot-terminal": "pivot",
  "ligolo-console": "ligolo-console",
});
const TRANSCRIPT_LIMIT = 1024 * 1024;
export const appendBoundedTerminalText = (value, addition) => `${value || ""}${addition || ""}`.slice(-TRANSCRIPT_LIMIT);

export const normalizeTerminalContext = (runsOn = "lhost", terminal = "") => {
  if (terminal) return TERMINAL_ALIASES[terminal] || null;
  return CONTEXT_VALUES.has(runsOn) ? runsOn : null;
};

export const isInterruptInstruction = (command = "") => /^\s*Press\s+Ctrl-C\b/iu.test(String(command));

export const terminalInputForCommand = (command = "") => (
  isInterruptInstruction(command) ? "\u0003" : `${command}\r`
);

export function terminalSessionMatchesRequest(session, request = {}) {
  const context = normalizeTerminalContext(request.runsOn, request.terminal);
  if (!context || session.targetId !== request.targetId || session.contextConfirmed !== true || session.status !== "running") return false;
  if (request.endpointId && session.endpointId !== request.endpointId) return false;
  if (request.address && session.address !== request.address) return false;
  if (request.terminal === "operator-terminal") return (session.originContext || "lhost") === "lhost";
  return session.context === context;
}

export function compatibleTerminalSessions(sessions = [], request = {}) {
  const interrupt = isInterruptInstruction(request.command);
  return sessions.filter((session) => (
    terminalSessionMatchesRequest(session, request)
    && !session.pendingStep
    && (interrupt || !session.activeStep)
  ));
}

export const terminalWorkspaceInitialState = Object.freeze({
  sessions: [],
  activeSessionId: "",
  collapsed: false,
});

const updateSession = (state, id, recipe) => ({
  ...state,
  sessions: state.sessions.map((session) => session.id === id ? recipe(session) : session),
});

export function terminalWorkspaceReducer(state, action) {
  switch (action.type) {
    case "add-session":
      return {
        ...state,
        collapsed: false,
        activeSessionId: action.session.id,
        sessions: [...state.sessions, action.session],
      };
    case "select-session":
      return state.sessions.some((session) => session.id === action.id)
        ? { ...state, activeSessionId: action.id, collapsed: false }
        : state;
    case "set-collapsed":
      return { ...state, collapsed: Boolean(action.value) };
    case "update-session":
      return updateSession(state, action.id, (session) => ({ ...session, ...action.patch }));
    case "confirm-context":
      if (!CONTEXT_VALUES.has(action.context)) return state;
      return updateSession(state, action.id, (session) => ({
        ...session,
        context: action.context,
        contextConfirmed: true,
      }));
    case "stage-command":
      return updateSession(state, action.id, (session) => {
        const interrupt = isInterruptInstruction(action.step.command);
        if (session.pendingStep || (!interrupt && session.activeStep)) return session;
        if (!terminalSessionMatchesRequest(session, action.step)) return session;
        return { ...session, pendingStep: action.step };
      });
    case "cancel-staged":
      return updateSession(state, action.id, (session) => ({ ...session, pendingStep: null }));
    case "run-staged":
      return updateSession(state, action.id, (session) => {
        const interrupt = isInterruptInstruction(session.pendingStep?.command);
        if (!session.pendingStep || (!interrupt && session.activeStep) || session.status !== "running") return session;
        return {
          ...session,
          activeStep: { ...session.pendingStep, startedAt: action.startedAt },
          pendingStep: null,
          proof: null,
          inputRequest: {
            id: action.requestId,
            data: terminalInputForCommand(session.pendingStep.command),
            proofCommand: session.pendingStep.command,
            commandLabel: session.pendingStep.label,
            flagNames: session.pendingStep.flagNames || session.flagNames,
          },
        };
      });
    case "mark-step-saved":
      return updateSession(state, action.id, (session) => ({
        ...session,
        activeStep: session.activeStep ? {
          ...session.activeStep,
          evidenceSaved: true,
          hasCapture: false,
          snapshotCount: (session.activeStep.snapshotCount || 0) + 1,
        } : null,
      }));
    case "mark-step-output":
      return updateSession(state, action.id, (session) => ({
        ...session,
        activeStep: session.activeStep ? { ...session.activeStep, hasCapture: true } : null,
      }));
    case "finish-step":
      return updateSession(state, action.id, (session) => ({ ...session, activeStep: null }));
    case "remove-session": {
      const sessions = state.sessions.filter((session) => session.id !== action.id);
      return {
        ...state,
        sessions,
        activeSessionId: state.activeSessionId === action.id ? (sessions.at(-1)?.id || "") : state.activeSessionId,
      };
    }
    default:
      return state;
  }
}

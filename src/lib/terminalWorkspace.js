export const TERMINAL_CONTEXTS = Object.freeze([
  { value: "lhost", label: "Kali / LHOST" },
  { value: "foothold-linux", label: "Linux foothold" },
  { value: "foothold-windows", label: "Windows foothold" },
  { value: "pivot", label: "Pivot shell" },
  { value: "ligolo-console", label: "Ligolo console" },
]);

export const TERMINAL_SESSION_ROLES = Object.freeze({
  GENERAL: "general",
  MACHINE_LOG: "machine-log",
});

export const TERMINAL_BEHAVIORS = Object.freeze({
  ONE_SHOT: "one-shot",
  INTERACTIVE_SHELL: "interactive-shell",
  EXISTING_SESSION_ONLY: "existing-session-only",
});

const CONTEXT_VALUES = new Set(TERMINAL_CONTEXTS.map((entry) => entry.value));
const TERMINAL_ALIASES = Object.freeze({
  "operator-terminal": "lhost",
  "pivot-terminal": "pivot",
  "ligolo-console": "ligolo-console",
});
const TRANSCRIPT_LIMIT = 1024 * 1024;
export const appendBoundedTerminalText = (value, addition) => `${value || ""}${addition || ""}`.slice(-TRANSCRIPT_LIMIT);

const snapshotRowText = (row) => String(typeof row === "string" ? row : row?.text || "").replace(/\s+$/u, "");

// Xterm stores a long logical line as one physical row followed by rows marked
// `isWrapped`. Rejoin those rows before saving evidence so PDF wrapping happens
// once, from the text the operator actually saw, rather than from raw readline
// cursor-redraw bytes emitted by interactive tools.
export function logicalTerminalSnapshotLines(snapshot = {}) {
  const rows = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const lines = [];
  for (const row of rows) {
    const text = snapshotRowText(row);
    if (row?.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines;
}

const searchableTerminalText = (value = "") => String(value)
  .replace(/\r?\n/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

// Return only the latest rendered step from a full xterm scrollback. An empty
// result deliberately means "fall back to the bounded raw PTY capture".
export function terminalStepSnapshotText(snapshot = {}, command = "") {
  const lines = logicalTerminalSnapshotLines(snapshot);
  const needle = searchableTerminalText(command);
  if (!lines.length || !needle) return "";

  const probe = needle.length > 72 ? needle.slice(0, 72) : needle;
  let start = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = searchableTerminalText(lines[index]);
    if (candidate.includes(needle) || (probe.length >= 24 && candidate.includes(probe))) {
      start = index;
      break;
    }
  }
  if (start < 0) return "";
  return lines.slice(start).join("\n").trimEnd();
}

export const normalizeTerminalContext = (runsOn = "lhost", terminal = "") => {
  if (terminal) return TERMINAL_ALIASES[terminal] || null;
  return CONTEXT_VALUES.has(runsOn) ? runsOn : null;
};

export const isInterruptInstruction = (command = "") => /^\s*Press\s+Ctrl-C\b/iu.test(String(command));

export const terminalInputForCommand = (command = "") => (
  isInterruptInstruction(command) ? "\u0003" : `${command}\r`
);

export const terminalCommandCwd = (workspaceRoot = "/home/kali/oscp", targetSlug = "unassigned") => {
  const trimmedRoot = String(workspaceRoot || "/home/kali/oscp").trim();
  const base = trimmedRoot === "/" ? "" : trimmedRoot.replace(/\/+$/u, "");
  return `${base || ""}/${String(targetSlug || "unassigned")}`;
};

const normalizedCwd = (value = "") => String(value || "").replace(/\/+$/u, "");

export const terminalTranscriptScopeMatches = (session = {}, request = {}) => {
  if (!session.targetId || session.targetId !== request.targetId) return false;
  const sessionCwd = normalizedCwd(session.cwd);
  const requestCwd = normalizedCwd(request.cwd);
  return !sessionCwd || !requestCwd ? true : sessionCwd === requestCwd;
};

const requestUsesTranscriptScope = (session = {}, request = {}, context = normalizeTerminalContext(request.runsOn, request.terminal)) => (
  context === "lhost"
  && session.sessionRole === TERMINAL_SESSION_ROLES.MACHINE_LOG
  && (!request.sessionRole || request.sessionRole === TERMINAL_SESSION_ROLES.MACHINE_LOG)
);

export function terminalSessionMatchesRequest(session, request = {}) {
  const context = normalizeTerminalContext(request.runsOn, request.terminal);
  if (!context || session.targetId !== request.targetId || session.contextConfirmed !== true || session.status !== "running") return false;
  const transcriptScoped = requestUsesTranscriptScope(session, request, context);
  if (transcriptScoped && !terminalTranscriptScopeMatches(session, request)) return false;
  if (!transcriptScoped && request.endpointId && session.endpointId !== request.endpointId) return false;
  if (!transcriptScoped && request.address && session.address !== request.address) return false;
  if (request.cwd && normalizedCwd(session.cwd) !== normalizedCwd(request.cwd)) return false;
  if (request.sessionRole && (session.sessionRole || TERMINAL_SESSION_ROLES.GENERAL) !== request.sessionRole) return false;
  if (request.terminal === "operator-terminal") return (session.originContext || "lhost") === "lhost";
  return session.context === context;
}

export function compatibleTerminalSessions(sessions = [], request = {}) {
  const interrupt = isInterruptInstruction(request.command);
  return sessions.filter((session) => (
    terminalSessionMatchesRequest(session, request)
    && !session.pendingStep
    && (interrupt || (!session.activeStep && session.promptReady === true))
  ));
}

export function rankTerminalSessions(sessions = [], request = {}, { activeSessionId = "" } = {}) {
  return compatibleTerminalSessions(sessions, request)
    .map((session) => {
      let score = 100;
      const transcriptScoped = requestUsesTranscriptScope(session, request);
      const reasons = [
        "same machine",
        transcriptScoped ? "same transcript folder" : "same endpoint",
        `${normalizeTerminalContext(request.runsOn, request.terminal)} context`,
        "ready prompt",
      ];
      if (request.cwd && normalizedCwd(session.cwd) === normalizedCwd(request.cwd)) {
        score += 25;
        reasons.push("same working folder");
      }
      if (request.sessionRole && (session.sessionRole || TERMINAL_SESSION_ROLES.GENERAL) === request.sessionRole) {
        score += 40;
        reasons.push(`${request.sessionRole} role`);
      } else if (!request.sessionRole && session.sessionRole === TERMINAL_SESSION_ROLES.MACHINE_LOG) {
        score += 15;
        reasons.push("recorded machine shell");
      }
      if (session.terminalBehavior === TERMINAL_BEHAVIORS.INTERACTIVE_SHELL) {
        score += 12;
        reasons.push("reusable shell");
      }
      if (session.id === activeSessionId) {
        score += 18;
        reasons.push("currently selected tab");
      }
      return { session, score, reasons };
    })
    .sort((left, right) => (
      right.score - left.score
      || Date.parse(right.session.lastUsedAt || 0) - Date.parse(left.session.lastUsedAt || 0)
      || String(left.session.id).localeCompare(String(right.session.id))
    ));
}

export function suggestedTerminalSession(sessions = [], request = {}, options = {}) {
  if (isInterruptInstruction(request.command) || request.requiresExplicitSession) return null;
  const ranked = rankTerminalSessions(sessions, request, options);
  if (ranked.length === 1) return ranked[0];
  return ranked.length > 1 && ranked[0].score > ranked[1].score ? ranked[0] : null;
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
        if (!interrupt && session.promptReady !== true) return session;
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
          promptReady: false,
          readyConfirmedAt: "",
          lastUsedAt: action.startedAt,
          commandCount: (session.commandCount || 0) + 1,
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
      return updateSession(state, action.id, (session) => ({
        ...session,
        activeStep: null,
        promptReady: true,
        readyConfirmedAt: action.readyAt,
        lastUsedAt: action.readyAt,
      }));
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

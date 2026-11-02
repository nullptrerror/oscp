import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createDefaultWorkspace,
  createId,
  getActiveScope,
  getItemStateKey,
  getScopedItemValue,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
} from "../lib/workspace";
import { guidanceForDiscoveries, parseEvidence } from "../lib/evidence";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [saveState, setSaveState] = useState({ status: "saved", message: "Saved locally" });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        saveWorkspace(workspace);
        setSaveState({ status: "saved", message: "Saved locally" });
      } catch (error) {
        setSaveState({ status: "error", message: "Local storage is full. Export a backup, then remove large results." });
        console.error(error);
      }
    }, 180);
    setSaveState((current) => (current.status === "error" ? current : { status: "saving", message: "Saving…" }));
    return () => window.clearTimeout(timeout);
  }, [workspace]);

  const update = (recipe) => {
    setWorkspace((current) => {
      const next = typeof recipe === "function" ? recipe(current) : recipe;
      return { ...next, updatedAt: new Date().toISOString() };
    });
  };

  const actions = useMemo(
    () => ({
      updateVariables(values) {
        update((current) => ({ ...current, variables: { ...current.variables, ...values } }));
      },
      toggleCompleted(itemId) {
        update((current) => {
          const key = getItemStateKey(current, itemId);
          return {
            ...current,
            completed: {
              ...current.completed,
              [key]: !getScopedItemValue(current.completed, current, itemId, false),
            },
          };
        });
      },
      updateNote(itemId, note) {
        update((current) => {
          const key = getItemStateKey(current, itemId);
          return { ...current, notes: { ...current.notes, [key]: note } };
        });
      },
      addEvidence(itemId, evidence) {
        update((current) => {
          const key = getItemStateKey(current, itemId);
          const target = current.targets.find((entry) => entry.id === current.activeTargetId);
          const parsed = evidence.discoveries ?? parseEvidence(evidence.content, evidence.filename || evidence.label);
          const guidance = guidanceForDiscoveries(parsed);
          const createdAt = new Date().toISOString();
          const enrichedEvidence = {
            id: createId("evidence"),
            createdAt,
            targetId: current.activeTargetId,
            targetName: target?.name || current.variables.targetName,
            itemId,
            ...evidence,
            discoveries: parsed,
            guidance,
          };
          const newDiscoveries = parsed.filter((candidate) => !current.discoveries.some((saved) => (
            saved.targetId === current.activeTargetId
            && saved.type === candidate.type
            && String(saved.value).toLowerCase() === String(candidate.value).toLowerCase()
          ))).map((candidate) => ({
            id: createId("discovery"),
            createdAt,
            targetId: current.activeTargetId,
            targetName: target?.name || current.variables.targetName,
            itemId,
            evidenceId: enrichedEvidence.id,
            ...candidate,
          }));
          const foundPorts = parsed.filter((entry) => entry.type === "port").map((entry) => entry.value);
          const foundDomain = parsed.find((entry) => entry.type === "domain")?.value;
          const parsedAccounts = parsed.filter((entry) => entry.type === "credential").filter((entry) => !current.accounts.some((saved) => (
            saved.targetId === current.activeTargetId
            && saved.username?.toLowerCase() === entry.username?.toLowerCase()
            && saved.secret === entry.secret
          ))).map((entry) => ({
            id: createId("account"),
            createdAt,
            targetId: current.activeTargetId,
            target: target?.name || current.variables.targetName,
            domain: entry.domain || current.variables.domain,
            username: entry.username,
            secret: entry.secret,
            source: evidence.filename || evidence.label || "parsed evidence",
            status: "untested",
          }));
          return {
            ...current,
            variables: {
              ...current.variables,
              ...(foundPorts.length > 0 ? { rport: [...new Set(foundPorts)].sort((a, b) => Number(a) - Number(b)).join(",") } : {}),
              ...(foundDomain && !current.variables.domain ? { domain: foundDomain } : {}),
            },
            accounts: [...current.accounts, ...parsedAccounts],
            discoveries: [...current.discoveries, ...newDiscoveries],
            evidence: {
              ...current.evidence,
              [key]: [
                ...getScopedItemValue(current.evidence, current, itemId, []),
                enrichedEvidence,
              ],
            },
          };
        });
      },
      deleteEvidence(itemId, evidenceId) {
        update((current) => {
          const key = getItemStateKey(current, itemId);
          return {
            ...current,
            evidence: {
              ...current.evidence,
              [key]: getScopedItemValue(current.evidence, current, itemId, []).filter((entry) => entry.id !== evidenceId),
            },
          };
        });
      },
      addTarget(target) {
        const id = createId("target");
        update((current) => {
          const becomesActive = !current.activeTargetId;
          return {
            ...current,
            activeTargetId: current.activeTargetId ?? id,
            variables: becomesActive ? {
              ...current.variables,
              targetName: target.name || current.variables.targetName,
              rhost: target.host || current.variables.rhost,
              rport: target.port || current.variables.rport,
              domain: target.domain || current.variables.domain,
            } : current.variables,
            targets: [...current.targets, { id, createdAt: new Date().toISOString(), ...target }],
          };
        });
      },
      updateTarget(id, patch) {
        update((current) => ({
          ...current,
          targets: current.targets.map((target) => (target.id === id ? { ...target, ...patch } : target)),
        }));
      },
      deleteTarget(id) {
        update((current) => ({
          ...current,
          activeTargetId: current.activeTargetId === id ? null : current.activeTargetId,
          targets: current.targets.filter((target) => target.id !== id),
        }));
      },
      useTarget(target) {
        update((current) => ({
          ...current,
          activeTargetId: target.id,
          variables: {
            ...current.variables,
            targetName: target.name || current.variables.targetName,
            rhost: target.host || current.variables.rhost,
            rport: target.port || current.variables.rport,
            domain: target.domain || current.variables.domain,
          },
        }));
      },
      addRecord(kind, record) {
        if (!['accounts', 'loot'].includes(kind)) return;
        update((current) => ({
          ...current,
          [kind]: [...current[kind], {
            id: createId(kind.slice(0, -1)),
            createdAt: new Date().toISOString(),
            ...record,
            targetId: current.activeTargetId,
            target: record.target || current.variables.targetName,
          }],
        }));
      },
      updateReport(patch) {
        update((current) => {
          const scope = getActiveScope(current);
          return { ...current, reports: { ...current.reports, [scope]: { ...(current.reports[scope] ?? {}), ...patch } } };
        });
      },
      deleteRecord(kind, id) {
        if (!['accounts', 'loot'].includes(kind)) return;
        update((current) => ({ ...current, [kind]: current[kind].filter((record) => record.id !== id) }));
      },
      importWorkspace(value) {
        setWorkspace(normalizeWorkspace(value));
      },
      resetWorkspace() {
        setWorkspace(createDefaultWorkspace());
      },
    }),
    [],
  );

  return (
    <WorkspaceContext.Provider value={{ workspace, saveState, actions }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

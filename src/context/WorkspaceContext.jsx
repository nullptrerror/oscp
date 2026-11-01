import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createDefaultWorkspace,
  createId,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
} from "../lib/workspace";

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
        update((current) => ({
          ...current,
          completed: { ...current.completed, [itemId]: !current.completed[itemId] },
        }));
      },
      updateNote(itemId, note) {
        update((current) => ({ ...current, notes: { ...current.notes, [itemId]: note } }));
      },
      addEvidence(itemId, evidence) {
        update((current) => ({
          ...current,
          evidence: {
            ...current.evidence,
            [itemId]: [
              ...(current.evidence[itemId] ?? []),
              { id: createId("evidence"), createdAt: new Date().toISOString(), ...evidence },
            ],
          },
        }));
      },
      deleteEvidence(itemId, evidenceId) {
        update((current) => ({
          ...current,
          evidence: {
            ...current.evidence,
            [itemId]: (current.evidence[itemId] ?? []).filter((entry) => entry.id !== evidenceId),
          },
        }));
      },
      addTarget(target) {
        const id = createId("target");
        update((current) => ({
          ...current,
          activeTargetId: current.activeTargetId ?? id,
          targets: [...current.targets, { id, createdAt: new Date().toISOString(), ...target }],
        }));
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
          [kind]: [...current[kind], { id: createId(kind.slice(0, -1)), createdAt: new Date().toISOString(), ...record }],
        }));
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

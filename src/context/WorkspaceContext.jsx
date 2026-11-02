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
import { guidanceForDiscoveries, mergePortLists, parseEvidence } from "../lib/evidence";

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
        update((current) => {
          const targetPatch = {
            ...(values.targetName !== undefined ? { name: values.targetName } : {}),
            ...(values.rhost !== undefined ? { host: values.rhost } : {}),
            ...(values.rport !== undefined ? { port: values.rport } : {}),
            ...(values.uport !== undefined ? { udpPorts: values.uport } : {}),
            ...(values.domain !== undefined ? { domain: values.domain } : {}),
          };
          return {
            ...current,
            variables: { ...current.variables, ...values },
            targets: current.activeTargetId
              ? current.targets.map((target) => (target.id === current.activeTargetId ? { ...target, ...targetPatch } : target))
              : current.targets,
          };
        });
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
            && (saved.protocol || "") === (candidate.protocol || "")
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
          const foundTcpPorts = parsed.filter((entry) => entry.type === "port" && entry.protocol === "tcp").map((entry) => entry.value);
          const foundUdpPorts = parsed.filter((entry) => entry.type === "port" && entry.protocol === "udp").map((entry) => entry.value);
          const tcpPorts = mergePortLists(target?.port || current.variables.rport, foundTcpPorts);
          const udpPorts = mergePortLists(target?.udpPorts || current.variables.uport, foundUdpPorts);
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
              ...(foundTcpPorts.length > 0 ? { rport: tcpPorts } : {}),
              ...(foundUdpPorts.length > 0 ? { uport: udpPorts } : {}),
              ...(foundDomain && !current.variables.domain ? { domain: foundDomain } : {}),
            },
            accounts: [...current.accounts, ...parsedAccounts],
            discoveries: [...current.discoveries, ...newDiscoveries],
            targets: current.targets.map((entry) => entry.id === current.activeTargetId ? {
              ...entry,
              ...(foundTcpPorts.length > 0 ? { port: tcpPorts } : {}),
              ...(foundUdpPorts.length > 0 ? { udpPorts } : {}),
              ...(foundDomain && !entry.domain ? { domain: foundDomain } : {}),
            } : entry),
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
              rport: target.port || "",
              uport: target.udpPorts || "",
              domain: target.domain || "",
            } : current.variables,
            targets: [...current.targets, { id, createdAt: new Date().toISOString(), ...target }],
          };
        });
      },
      updateTarget(id, patch) {
        update((current) => ({
          ...current,
          variables: current.activeTargetId === id ? {
            ...current.variables,
            ...(patch.name !== undefined ? { targetName: patch.name } : {}),
            ...(patch.host !== undefined ? { rhost: patch.host } : {}),
            ...(patch.port !== undefined ? { rport: patch.port } : {}),
            ...(patch.udpPorts !== undefined ? { uport: patch.udpPorts } : {}),
            ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
          } : current.variables,
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
            targetName: target.name,
            rhost: target.host,
            rport: target.port || "",
            uport: target.udpPorts || "",
            domain: target.domain || "",
            baseDn: "",
            dc: "",
            user: "",
            password: "",
            gppCpassword: "",
            hash: "",
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
            ...(kind === "accounts" ? { domain: record.domain || current.variables.domain } : {}),
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

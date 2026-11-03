import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createDefaultWorkspace,
  createId,
  domainToBaseDn,
  getActiveScope,
  getItemStateKey,
  getScopedItemValue,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
} from "../lib/workspace";
import { discoveriesForChecklistItem, guidanceForDiscoveries, mergePortLists, parseEvidence } from "../lib/evidence";
import { stripAnsi } from "../lib/terminalText";

const WorkspaceContext = createContext(null);

const activeEndpoint = (target) => target?.endpoints?.find((endpoint) => endpoint.id === target.activeEndpointId) || target?.endpoints?.[0];
const endpointVariables = (target, endpoint = activeEndpoint(target)) => ({
  targetName: target?.name || "",
  rhost: endpoint?.address || target?.host || "",
  rport: endpoint?.tcpPorts || target?.port || "",
  uport: endpoint?.udpPorts || target?.udpPorts || "",
  domain: target?.domain || "",
  baseDn: domainToBaseDn(target?.domain),
});

const mergeScopedState = (record, sourceId, destinationId, combine) => {
  const next = { ...record };
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith(`${sourceId}::`)) continue;
    const destinationKey = `${destinationId}::${key.slice(sourceId.length + 2)}`;
    next[destinationKey] = combine(next[destinationKey], value);
    delete next[key];
  }
  return next;
};

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
          const shouldDeriveBaseDn = values.domain !== undefined
            && values.baseDn === undefined
            && (!current.variables.baseDn || current.variables.baseDn === domainToBaseDn(current.variables.domain));
          const variableValues = shouldDeriveBaseDn ? { ...values, baseDn: domainToBaseDn(values.domain) } : values;
          return {
            ...current,
            variables: { ...current.variables, ...variableValues },
            targets: current.activeTargetId
              ? current.targets.map((target) => {
                if (target.id !== current.activeTargetId) return target;
                const endpoints = (target.endpoints || []).map((endpoint) => endpoint.id === target.activeEndpointId ? {
                  ...endpoint,
                  ...(variableValues.rhost !== undefined ? { address: variableValues.rhost } : {}),
                  ...(variableValues.rport !== undefined ? { tcpPorts: variableValues.rport } : {}),
                  ...(variableValues.uport !== undefined ? { udpPorts: variableValues.uport } : {}),
                } : endpoint);
                const selected = endpoints.find((endpoint) => endpoint.id === target.activeEndpointId) || endpoints[0];
                return {
                  ...target,
                  ...(variableValues.targetName !== undefined ? { name: variableValues.targetName } : {}),
                  ...(variableValues.domain !== undefined ? { domain: variableValues.domain } : {}),
                  endpoints,
                  host: selected?.address || target.host,
                  port: selected?.tcpPorts || "",
                  udpPorts: selected?.udpPorts || "",
                };
              })
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
          const parsed = discoveriesForChecklistItem(
            itemId,
            evidence.discoveries ?? parseEvidence(stripAnsi(evidence.content), evidence.filename || evidence.label),
            { lhost: current.variables.lhost },
          );
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
            && (saved.address || "") === (candidate.address || "")
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
          const selectedEndpoint = activeEndpoint(target);
          const tcpPorts = mergePortLists(selectedEndpoint?.tcpPorts || current.variables.rport, foundTcpPorts);
          const udpPorts = mergePortLists(selectedEndpoint?.udpPorts || current.variables.uport, foundUdpPorts);
          const foundDomain = parsed.find((entry) => entry.type === "domain")?.value;
          const foundLocalIp = parsed.find((entry) => entry.type === "local-ip")?.value;
          const discoveredAddresses = [...new Set([...parsed.flatMap((entry) => (
            entry.type === "endpoint" ? [entry.value] : entry.type === "hostname" && entry.address ? [entry.address] : []
          )), ...(parsed.some((entry) => entry.type === "hostname" && !entry.address) ? [current.variables.rhost] : [])]
            .filter((address) => address && address !== current.variables.lhost))];
          const hostnamesFor = (address) => parsed.filter((entry) => entry.type === "hostname" && (entry.address === address || (!entry.address && address === current.variables.rhost))).map((entry) => entry.value);
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
          const parsedUserCandidates = parsed.filter((entry) => entry.type === "user" || entry.type === "credential")
            .map((entry) => ({ username: entry.username || entry.value, domain: entry.domain || foundDomain || current.variables.domain }))
            .filter((entry) => entry.username);
          const parsedUsers = [...new Map(parsedUserCandidates.map((entry) => [entry.username.toLowerCase(), entry])).values()]
            .filter((entry) => entry.username && !current.users.some((saved) => (
              saved.targetId === current.activeTargetId && saved.username?.toLowerCase() === entry.username.toLowerCase()
            )))
            .map((entry) => ({
              id: createId("user"),
              createdAt,
              targetId: current.activeTargetId,
              target: target?.name || current.variables.targetName,
              source: evidence.filename || evidence.label || "parsed evidence",
              ...entry,
            }));
          return {
            ...current,
            variables: {
              ...current.variables,
              ...(foundTcpPorts.length > 0 ? { rport: tcpPorts } : {}),
              ...(foundUdpPorts.length > 0 ? { uport: udpPorts } : {}),
              ...(foundDomain && !current.variables.domain ? { domain: foundDomain, baseDn: domainToBaseDn(foundDomain) } : {}),
              ...(foundLocalIp ? { lhost: foundLocalIp } : {}),
            },
            accounts: [...current.accounts, ...parsedAccounts],
            users: [...current.users, ...parsedUsers],
            discoveries: [...current.discoveries, ...newDiscoveries],
            targets: current.targets.map((entry) => {
              if (entry.id !== current.activeTargetId) return entry;
              const baseEndpoints = entry.endpoints?.length ? entry.endpoints : [{
                id: createId("endpoint"), address: entry.host || current.variables.rhost, hostnames: [], tcpPorts: entry.port || "", udpPorts: entry.udpPorts || "", source: "initial",
              }];
              const selectedId = entry.activeEndpointId || baseEndpoints[0]?.id;
              let endpoints = baseEndpoints.map((endpoint) => endpoint.id === selectedId ? {
                ...endpoint,
                ...(foundTcpPorts.length > 0 ? { tcpPorts } : {}),
                ...(foundUdpPorts.length > 0 ? { udpPorts } : {}),
              } : endpoint);
              for (const address of discoveredAddresses) {
                const existing = endpoints.find((endpoint) => endpoint.address === address);
                const names = hostnamesFor(address);
                if (existing) {
                  endpoints = endpoints.map((endpoint) => endpoint.id === existing.id ? { ...endpoint, hostnames: [...new Set([...(endpoint.hostnames || []), ...names])] } : endpoint);
                } else {
                  endpoints.push({ id: createId("endpoint"), address, hostnames: names, tcpPorts: "", udpPorts: "", source: evidence.filename || evidence.label || "parsed evidence" });
                }
              }
              const selected = endpoints.find((endpoint) => endpoint.id === selectedId) || endpoints[0];
              return {
                ...entry,
                endpoints,
                activeEndpointId: selected?.id || null,
                host: selected?.address || entry.host,
                port: selected?.tcpPorts || "",
                udpPorts: selected?.udpPorts || "",
                ...(foundDomain && !entry.domain ? { domain: foundDomain } : {}),
              };
            }),
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
          const endpoint = {
            id: createId("endpoint"),
            address: target.host,
            hostnames: target.hostnames || [],
            tcpPorts: target.port || "",
            udpPorts: target.udpPorts || "",
            source: "initial",
          };
          const machine = { ...target, id, createdAt: new Date().toISOString(), endpoints: [endpoint], activeEndpointId: endpoint.id };
          return {
            ...current,
            activeTargetId: current.activeTargetId ?? id,
            variables: becomesActive ? {
              ...current.variables,
              ...endpointVariables(machine, endpoint),
            } : current.variables,
            targets: [...current.targets, machine],
          };
        });
      },
      updateTarget(id, patch) {
        update((current) => ({
          ...current,
          variables: current.activeTargetId === id ? {
            ...current.variables,
            ...(patch.name !== undefined ? { targetName: patch.name } : {}),
            ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
            ...(patch.domain !== undefined ? { baseDn: domainToBaseDn(patch.domain) } : {}),
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
      mergeTarget(sourceId, destinationId) {
        if (!sourceId || !destinationId || sourceId === destinationId) return;
        update((current) => {
          const source = current.targets.find((target) => target.id === sourceId);
          const destination = current.targets.find((target) => target.id === destinationId);
          if (!source || !destination) return current;
          const endpoints = (destination.endpoints || []).map((endpoint) => ({ ...endpoint, hostnames: [...(endpoint.hostnames || [])] }));
          for (const endpoint of source.endpoints || []) {
            const existingIndex = endpoints.findIndex((entry) => entry.address === endpoint.address);
            if (existingIndex >= 0) {
              const existing = endpoints[existingIndex];
              endpoints[existingIndex] = {
                ...existing,
                hostnames: [...new Set([...(existing.hostnames || []), ...(endpoint.hostnames || [])])],
                tcpPorts: mergePortLists(existing.tcpPorts, String(endpoint.tcpPorts || "").split(",")),
                udpPorts: mergePortLists(existing.udpPorts, String(endpoint.udpPorts || "").split(",")),
              };
            } else endpoints.push(endpoint);
          }
          const selected = endpoints.find((endpoint) => endpoint.id === destination.activeEndpointId) || endpoints[0];
          const mergedTarget = {
            ...destination,
            endpoints,
            activeEndpointId: selected?.id || null,
            host: selected?.address || destination.host,
            port: selected?.tcpPorts || "",
            udpPorts: selected?.udpPorts || "",
            notes: [destination.notes, source.notes].filter(Boolean).join("\n\n"),
          };
          const retarget = (entry) => entry.targetId === sourceId ? { ...entry, targetId: destinationId, target: destination.name, targetName: destination.name } : entry;
          const becomesActive = current.activeTargetId === sourceId;
          const reports = { ...current.reports, [destinationId]: { ...(current.reports[sourceId] || {}), ...(current.reports[destinationId] || {}) } };
          delete reports[sourceId];
          return {
            ...current,
            activeTargetId: becomesActive ? destinationId : current.activeTargetId,
            variables: becomesActive ? { ...current.variables, ...endpointVariables(mergedTarget, selected) } : current.variables,
            targets: current.targets.filter((target) => target.id !== sourceId).map((target) => target.id === destinationId ? mergedTarget : target),
            accounts: current.accounts.map(retarget),
            users: current.users.map(retarget),
            loot: current.loot.map(retarget),
            discoveries: current.discoveries.map(retarget),
            commandHistory: current.commandHistory.map(retarget),
            completed: mergeScopedState(current.completed, sourceId, destinationId, (destinationValue, sourceValue) => Boolean(destinationValue || sourceValue)),
            notes: mergeScopedState(current.notes, sourceId, destinationId, (destinationValue, sourceValue) => [destinationValue, sourceValue].filter(Boolean).join("\n\n")),
            evidence: mergeScopedState(current.evidence, sourceId, destinationId, (destinationValue = [], sourceValue = []) => [...destinationValue, ...sourceValue.map(retarget)]),
            reports,
          };
        });
      },
      useTarget(target) {
        const endpoint = activeEndpoint(target);
        update((current) => ({
          ...current,
          activeTargetId: target.id,
          variables: {
            ...current.variables,
            ...endpointVariables(target, endpoint),
            dc: "",
            user: "",
            password: "",
            gppCpassword: "",
            hash: "",
          },
        }));
      },
      addEndpoint(targetId, endpoint) {
        update((current) => ({
          ...current,
          targets: current.targets.map((target) => {
            if (target.id !== targetId || target.endpoints?.some((saved) => saved.address === endpoint.address)) return target;
            const created = { id: createId("endpoint"), hostnames: [], tcpPorts: "", udpPorts: "", source: "manual", ...endpoint };
            return { ...target, endpoints: [...(target.endpoints || []), created] };
          }),
        }));
      },
      updateEndpoint(targetId, endpointId, patch) {
        update((current) => ({
          ...current,
          targets: current.targets.map((target) => {
            if (target.id !== targetId) return target;
            const endpoints = (target.endpoints || []).map((endpoint) => endpoint.id === endpointId ? { ...endpoint, ...patch } : endpoint);
            const selected = endpoints.find((endpoint) => endpoint.id === target.activeEndpointId) || endpoints[0];
            return { ...target, endpoints, host: selected?.address || "", port: selected?.tcpPorts || "", udpPorts: selected?.udpPorts || "" };
          }),
          variables: current.activeTargetId === targetId && current.targets.find((target) => target.id === targetId)?.activeEndpointId === endpointId ? {
            ...current.variables,
            ...(patch.address !== undefined ? { rhost: patch.address } : {}),
            ...(patch.tcpPorts !== undefined ? { rport: patch.tcpPorts } : {}),
            ...(patch.udpPorts !== undefined ? { uport: patch.udpPorts } : {}),
          } : current.variables,
        }));
      },
      useEndpoint(target, endpoint) {
        update((current) => ({
          ...current,
          activeTargetId: target.id,
          targets: current.targets.map((entry) => entry.id === target.id ? {
            ...entry, activeEndpointId: endpoint.id, host: endpoint.address, port: endpoint.tcpPorts || "", udpPorts: endpoint.udpPorts || "",
          } : entry),
          variables: {
            ...current.variables,
            ...endpointVariables(target, endpoint),
            user: "", password: "", gppCpassword: "", hash: "",
          },
        }));
      },
      deleteEndpoint(targetId, endpointId) {
        update((current) => ({
          ...current,
          targets: current.targets.map((target) => {
            if (target.id !== targetId || (target.endpoints || []).length <= 1) return target;
            const endpoints = target.endpoints.filter((endpoint) => endpoint.id !== endpointId);
            const activeEndpointId = target.activeEndpointId === endpointId ? endpoints[0]?.id : target.activeEndpointId;
            const selected = endpoints.find((endpoint) => endpoint.id === activeEndpointId) || endpoints[0];
            return { ...target, endpoints, activeEndpointId, host: selected?.address || "", port: selected?.tcpPorts || "", udpPorts: selected?.udpPorts || "" };
          }),
        }));
      },
      addRecord(kind, record) {
        if (!['accounts', 'users', 'loot'].includes(kind)) return;
        update((current) => ({
          ...current,
          [kind]: [...current[kind], {
            id: createId(kind.slice(0, -1)),
            createdAt: new Date().toISOString(),
            ...record,
            targetId: current.activeTargetId,
            target: record.target || current.variables.targetName,
            ...(['accounts', 'users'].includes(kind) ? { domain: record.domain || current.variables.domain } : {}),
          }],
        }));
      },
      recordCommand(itemId, command) {
        update((current) => {
          const target = current.targets.find((entry) => entry.id === current.activeTargetId);
          const endpoint = activeEndpoint(target);
          return {
            ...current,
            commandHistory: [...current.commandHistory, {
              id: createId("command"),
              copiedAt: new Date().toISOString(),
              targetId: current.activeTargetId,
              targetName: target?.name || current.variables.targetName,
              endpointId: endpoint?.id || null,
              address: current.variables.rhost,
              itemId,
              ...command,
            }],
          };
        });
      },
      updateProfile(patch) {
        update((current) => ({ ...current, profile: { ...(current.profile ?? {}), ...patch } }));
      },
      updateExam(patch) {
        update((current) => ({ ...current, exam: { ...(current.exam ?? {}), ...patch } }));
      },
      updateReport(patch) {
        update((current) => {
          const scope = getActiveScope(current);
          return { ...current, reports: { ...current.reports, [scope]: { ...(current.reports[scope] ?? {}), ...patch } } };
        });
      },
      deleteRecord(kind, id) {
        if (!['accounts', 'users', 'loot'].includes(kind)) return;
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

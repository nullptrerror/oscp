import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createDefaultWorkspace,
  createId,
  clearMachineVariables,
  COMPLETING_RESULT_STATES,
  deleteMachineData,
  domainToBaseDn,
  getActiveScope,
  getCommandResultStateKey,
  getItemStateKey,
  getScopedItemValue,
  importMachineData,
  loadWorkspace,
  normalizeWorkspace,
  pickMachineVariables,
  RESULT_STATES,
  saveWorkspace,
  slugifyTarget,
  uniqueTargetSlug,
} from "../lib/workspace";
import { discoveriesForChecklistItem, discoveryKey, mergePortLists, parseEvidence, visibleDiscoveries } from "../lib/evidence";
import { stripAnsi } from "../lib/terminalText";
import { normalizeFlagSettings } from "../lib/flagProfiles";
import { commandNarrativeDraft, narrativeFromDiscoveries } from "../lib/narrative";
import { credentialVariables, isNtHash } from "../lib/credentials";

const WorkspaceContext = createContext(null);

const activeEndpoint = (target) => target?.endpoints?.find((endpoint) => endpoint.id === target.activeEndpointId) || target?.endpoints?.[0];
const endpointVariables = (target, endpoint = activeEndpoint(target)) => ({
  targetName: target?.name || "",
  targetSlug: target?.slug || slugifyTarget(target?.name || ""),
  rhost: endpoint?.address || target?.host || "",
  rport: endpoint?.tcpPorts || target?.port || "",
  uport: endpoint?.udpPorts || target?.udpPorts || "",
  tcpPorts: endpoint?.tcpPorts || target?.port || "",
  udpPorts: endpoint?.udpPorts || target?.udpPorts || "",
  selectedServiceHost: endpoint?.address || target?.host || "",
  domain: target?.domain || "",
  baseDn: domainToBaseDn(target?.domain),
  userFlagName: target ? normalizeFlagSettings(target).userFlagName : "",
  rootFlagName: target ? normalizeFlagSettings(target).rootFlagName : "",
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
          const variableValues = shouldDeriveBaseDn ? { ...values, baseDn: domainToBaseDn(values.domain) } : { ...values };
          if (variableValues.tcpPorts !== undefined && variableValues.rport === undefined) variableValues.rport = variableValues.tcpPorts;
          if (variableValues.rport !== undefined && variableValues.tcpPorts === undefined) variableValues.tcpPorts = variableValues.rport;
          if (variableValues.udpPorts !== undefined && variableValues.uport === undefined) variableValues.uport = variableValues.udpPorts;
          if (variableValues.uport !== undefined && variableValues.udpPorts === undefined) variableValues.udpPorts = variableValues.uport;
          const changesCredentialContext = ["domain", "user", "password", "hash"].some((key) => values[key] !== undefined);
          return {
            ...current,
            variables: {
              ...current.variables,
              ...variableValues,
              ...(changesCredentialContext ? { selectedCredentialId: "", credentialType: "" } : {}),
            },
            selectedCredentials: changesCredentialContext && current.activeTargetId
              ? { ...(current.selectedCredentials || {}), [current.activeTargetId]: "" }
              : current.selectedCredentials,
            targets: current.activeTargetId
              ? current.targets.map((target) => {
                if (target.id !== current.activeTargetId) return target;
                const endpoints = (target.endpoints || []).map((endpoint) => endpoint.id === target.activeEndpointId ? {
                  ...endpoint,
                  ...(variableValues.rhost !== undefined ? { address: variableValues.rhost } : {}),
                  ...(variableValues.tcpPorts !== undefined ? { tcpPorts: variableValues.tcpPorts } : {}),
                  ...(variableValues.udpPorts !== undefined ? { udpPorts: variableValues.udpPorts } : {}),
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
                  commandContext: {
                    ...(target.commandContext || {}),
                    ...pickMachineVariables(variableValues),
                  },
                };
              })
              : current.targets,
          };
        });
      },
      toggleCompleted(itemId) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const key = getItemStateKey(current, itemId);
          const completed = !getScopedItemValue(current.completed, current, itemId, false);
          return {
            ...current,
            completed: {
              ...current.completed,
              [key]: completed,
            },
            resultStates: {
              ...current.resultStates,
              [key]: completed ? RESULT_STATES.CONFIRMED : RESULT_STATES.REVIEW,
            },
          };
        });
      },
      setCompleted(itemId, value = true) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const key = getItemStateKey(current, itemId);
          const completed = Boolean(value);
          return {
            ...current,
            completed: { ...current.completed, [key]: completed },
            resultStates: {
              ...current.resultStates,
              [key]: completed ? RESULT_STATES.CONFIRMED : RESULT_STATES.REVIEW,
            },
          };
        });
      },
      setResultState(itemId, state) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const allowed = new Set(Object.values(RESULT_STATES));
          if (!allowed.has(state)) return current;
          const key = getItemStateKey(current, itemId);
          return {
            ...current,
            resultStates: { ...current.resultStates, [key]: state },
            completed: { ...current.completed, [key]: COMPLETING_RESULT_STATES.has(state) },
          };
        });
      },
      setCommandResultState(itemId, commandKey, state) {
        update((current) => {
          if (!current.activeTargetId || !commandKey) return current;
          const allowed = new Set(Object.values(RESULT_STATES));
          if (!allowed.has(state)) return current;
          const evidence = getScopedItemValue(current.evidence, current, itemId, [])
            .filter((entry) => entry.commandKey === commandKey);
          if (COMPLETING_RESULT_STATES.has(state) && evidence.length === 0) return current;
          const key = getCommandResultStateKey(current, itemId, commandKey);
          return {
            ...current,
            commandResultStates: { ...(current.commandResultStates || {}), [key]: state },
          };
        });
      },
      updateNote(itemId, note) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const key = getItemStateKey(current, itemId);
          return { ...current, notes: { ...current.notes, [key]: note } };
        });
      },
      updateNextStep(itemId, nextStep) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const key = getItemStateKey(current, itemId);
          return { ...current, nextSteps: { ...current.nextSteps, [key]: nextStep } };
        });
      },
      addEvidence(itemId, evidence) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const key = getItemStateKey(current, itemId);
          const target = current.targets.find((entry) => entry.id === current.activeTargetId);
          const endpointId = target?.activeEndpointId || null;
          const parsed = visibleDiscoveries(
            discoveriesForChecklistItem(
              itemId,
              evidence.discoveries ?? parseEvidence(
                stripAnsi(evidence.content),
                [evidence.filename, evidence.label, evidence.commandText].filter(Boolean).join(" "),
                normalizeFlagSettings(target),
              ),
              { lhost: current.variables.lhost },
            ),
            {
              settings: current.parserSettings,
              ignored: current.ignoredDiscoveries,
              targetId: current.activeTargetId,
            },
          );
          const candidates = parsed.map((entry) => {
            const existing = current.discoveries.find((saved) => (
              saved.targetId === current.activeTargetId && discoveryKey(saved) === discoveryKey(entry)
            ));
            return { ...entry, endpointId: entry.endpointId || endpointId, status: existing?.status === "confirmed" ? "confirmed" : "candidate" };
          });
          // Exit status and parser output are evidence, not proof. Keep a
          // neutral draft until the operator confirms the result and facts.
          const runNarrative = narrativeFromDiscoveries([], {
            exitCode: evidence.exitCode,
            command: evidence.commandText,
            label: evidence.commandLabel || evidence.label,
          });
          const createdAt = new Date().toISOString();
          const enrichedEvidence = {
            id: createId("evidence"),
            createdAt,
            targetId: current.activeTargetId,
            targetName: target?.name || current.variables.targetName,
            endpointId,
            itemId,
            ...evidence,
            discoveries: candidates,
            guidance: [],
          };
          const newDiscoveries = candidates.filter((candidate) => !current.discoveries.some((saved) => (
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
          const commandStateKey = evidence.commandKey
            ? getCommandResultStateKey(current, itemId, evidence.commandKey)
            : "";
          return {
            ...current,
            discoveries: [...current.discoveries, ...newDiscoveries],
            commandHistory: evidence.commandRunId ? current.commandHistory.map((entry) => entry.id === evidence.commandRunId ? {
              ...entry,
              established: runNarrative.finding,
              nextAction: runNarrative.nextStep,
              exitCode: evidence.exitCode,
            } : entry) : current.commandHistory,
            evidence: {
              ...current.evidence,
              [key]: [
                ...getScopedItemValue(current.evidence, current, itemId, []),
                enrichedEvidence,
              ],
            },
            resultStates: {
              ...current.resultStates,
              [key]: RESULT_STATES.REVIEW,
            },
            completed: {
              ...current.completed,
              [key]: false,
            },
            commandResultStates: commandStateKey ? {
              ...(current.commandResultStates || {}),
              [commandStateKey]: RESULT_STATES.REVIEW,
            } : current.commandResultStates,
          };
        });
      },
      deleteEvidence(itemId, evidenceId) {
        update((current) => {
          const key = getItemStateKey(current, itemId);
          const removed = getScopedItemValue(current.evidence, current, itemId, []).find((entry) => entry.id === evidenceId);
          const commandStateKey = removed?.commandKey
            ? getCommandResultStateKey(current, itemId, removed.commandKey)
            : "";
          return {
            ...current,
            discoveries: current.discoveries.filter((entry) => entry.evidenceId !== evidenceId || entry.status === "confirmed"),
            evidence: {
              ...current.evidence,
              [key]: getScopedItemValue(current.evidence, current, itemId, []).filter((entry) => entry.id !== evidenceId),
            },
            resultStates: {
              ...current.resultStates,
              [key]: RESULT_STATES.REVIEW,
            },
            completed: {
              ...current.completed,
              [key]: false,
            },
            commandResultStates: commandStateKey ? {
              ...(current.commandResultStates || {}),
              [commandStateKey]: RESULT_STATES.REVIEW,
            } : current.commandResultStates,
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
          const slug = uniqueTargetSlug(current.targets, target.slug || target.name);
          const machine = {
            ...target,
            ...normalizeFlagSettings(target),
            id,
            createdAt: new Date().toISOString(),
            slug,
            endpoints: [endpoint],
            activeEndpointId: endpoint.id,
            commandContext: pickMachineVariables({
              ...target,
              ...endpointVariables(target, endpoint),
              targetSlug: slug,
            }),
          };
          return {
            ...current,
            activeTargetId: current.activeTargetId ?? id,
            variables: becomesActive ? {
              ...clearMachineVariables(current.variables),
              ...machine.commandContext,
              ...endpointVariables(machine, endpoint),
            } : current.variables,
            targets: [...current.targets, machine],
          };
        });
      },
      updateTarget(id, patch) {
        update((current) => {
          const existing = current.targets.find((target) => target.id === id);
          const updated = existing ? { ...existing, ...patch } : null;
          const updatedFlagSettings = updated ? normalizeFlagSettings(updated) : null;
          return {
            ...current,
            variables: current.activeTargetId === id ? {
              ...current.variables,
              ...(patch.name !== undefined ? { targetName: patch.name } : {}),
              ...(patch.domain !== undefined ? { domain: patch.domain, baseDn: domainToBaseDn(patch.domain) } : {}),
              ...(updated && (patch.labType !== undefined || patch.userFlagName !== undefined || patch.rootFlagName !== undefined) ? {
                userFlagName: updatedFlagSettings.userFlagName,
                rootFlagName: updatedFlagSettings.rootFlagName,
              } : {}),
            } : current.variables,
            targets: current.targets.map((target) => (target.id === id ? {
              ...target,
              ...patch,
              ...(updatedFlagSettings || {}),
              commandContext: {
                ...(target.commandContext || {}),
                ...pickMachineVariables({
                  ...(patch.name !== undefined ? { targetName: patch.name } : {}),
                  ...(patch.domain !== undefined ? { domain: patch.domain, baseDn: domainToBaseDn(patch.domain) } : {}),
                  ...(updatedFlagSettings ? {
                    userFlagName: updatedFlagSettings.userFlagName,
                    rootFlagName: updatedFlagSettings.rootFlagName,
                  } : {}),
                }),
              },
            } : target)),
          };
        });
      },
      deleteTarget(id) {
        update((current) => deleteMachineData(current, id));
      },
      clearTargetSelection() {
        update((current) => ({ ...current, activeTargetId: null, variables: clearMachineVariables(current.variables) }));
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
          const activeContext = current.activeTargetId === sourceId
            ? pickMachineVariables(current.variables)
            : current.activeTargetId === destinationId ? pickMachineVariables(current.variables) : {};
          const mergedTarget = {
            ...destination,
            endpoints,
            activeEndpointId: selected?.id || null,
            host: selected?.address || destination.host,
            port: selected?.tcpPorts || "",
            udpPorts: selected?.udpPorts || "",
            notes: [destination.notes, source.notes].filter(Boolean).join("\n\n"),
            commandContext: {
              ...(source.commandContext || {}),
              ...(destination.commandContext || {}),
              ...activeContext,
            },
          };
          const retarget = (entry) => entry.targetId === sourceId ? { ...entry, targetId: destinationId, target: destination.name, targetName: destination.name } : entry;
          const becomesActive = current.activeTargetId === sourceId;
          const reports = { ...current.reports, [destinationId]: { ...(current.reports[sourceId] || {}), ...(current.reports[destinationId] || {}) } };
          delete reports[sourceId];
          const mergedResultStates = mergeScopedState(current.resultStates, sourceId, destinationId, (destinationValue, sourceValue) => destinationValue || sourceValue);
          const mergedCompleted = mergeScopedState(current.completed, sourceId, destinationId, (destinationValue, sourceValue) => Boolean(destinationValue || sourceValue));
          for (const key of Object.keys(mergedCompleted)) {
            if (!key.startsWith(`${destinationId}::`)) continue;
            mergedCompleted[key] = COMPLETING_RESULT_STATES.has(mergedResultStates[key]);
          }
          return {
            ...current,
            activeTargetId: becomesActive ? destinationId : current.activeTargetId,
            variables: becomesActive ? {
              ...clearMachineVariables(current.variables),
              ...mergedTarget.commandContext,
              ...endpointVariables(mergedTarget, selected),
            } : current.variables,
            targets: current.targets.filter((target) => target.id !== sourceId).map((target) => target.id === destinationId ? mergedTarget : target),
            accounts: current.accounts.map(retarget),
            users: current.users.map(retarget),
            loot: current.loot.map(retarget),
            discoveries: current.discoveries.map(retarget),
            ignoredDiscoveries: current.ignoredDiscoveries.map(retarget),
            commandHistory: current.commandHistory.map(retarget),
            selectedCredentials: Object.fromEntries(Object.entries({
              ...(current.selectedCredentials || {}),
              [destinationId]: current.selectedCredentials?.[destinationId] || current.selectedCredentials?.[sourceId] || "",
            }).filter(([key]) => key !== sourceId)),
            selectedPivotPlaybooks: Object.fromEntries(Object.entries({
              ...(current.selectedPivotPlaybooks || {}),
              [destinationId]: current.selectedPivotPlaybooks?.[destinationId] || current.selectedPivotPlaybooks?.[sourceId] || "pivot-direct",
            }).filter(([key]) => key !== sourceId)),
            completed: mergedCompleted,
            resultStates: mergedResultStates,
            commandResultStates: mergeScopedState(current.commandResultStates || {}, sourceId, destinationId, (destinationValue, sourceValue) => destinationValue || sourceValue),
            notes: mergeScopedState(current.notes, sourceId, destinationId, (destinationValue, sourceValue) => [destinationValue, sourceValue].filter(Boolean).join("\n\n")),
            nextSteps: mergeScopedState(current.nextSteps, sourceId, destinationId, (destinationValue, sourceValue) => [destinationValue, sourceValue].filter(Boolean).join("\n\n")),
            narrativeSources: mergeScopedState(current.narrativeSources, sourceId, destinationId, (destinationValue = {}, sourceValue = {}) => ({ ...sourceValue, ...destinationValue })),
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
            ...clearMachineVariables(current.variables),
            ...(target.commandContext || {}),
            ...endpointVariables(target, endpoint),
          },
        }));
      },
      selectPivotPlaybook(playbookId) {
        update((current) => {
          if (!current.activeTargetId || typeof playbookId !== "string" || !playbookId.startsWith("pivot-")) return current;
          const key = getItemStateKey(current, "pivot-playbook");
          return {
            ...current,
            selectedPivotPlaybooks: { ...(current.selectedPivotPlaybooks || {}), [current.activeTargetId]: playbookId },
            resultStates: { ...current.resultStates, [key]: RESULT_STATES.REVIEW },
            completed: { ...current.completed, [key]: false },
          };
        });
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
            ...(patch.address !== undefined ? { rhost: patch.address, selectedServiceHost: patch.address } : {}),
            ...(patch.tcpPorts !== undefined ? { rport: patch.tcpPorts, tcpPorts: patch.tcpPorts } : {}),
            ...(patch.udpPorts !== undefined ? { uport: patch.udpPorts, udpPorts: patch.udpPorts } : {}),
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
            ...clearMachineVariables(current.variables),
            ...(target.commandContext || {}),
            ...endpointVariables(target, endpoint),
          },
        }));
      },
      deleteEndpoint(targetId, endpointId) {
        update((current) => {
          const target = current.targets.find((entry) => entry.id === targetId);
          if (!target || (target.endpoints || []).length <= 1) return current;
          const endpoints = target.endpoints.filter((endpoint) => endpoint.id !== endpointId);
          const activeEndpointId = target.activeEndpointId === endpointId ? endpoints[0]?.id : target.activeEndpointId;
          const selected = endpoints.find((endpoint) => endpoint.id === activeEndpointId) || endpoints[0];
          const context = {
            ...(target.commandContext || {}),
            ...endpointVariables(target, selected),
          };
          const nextTarget = {
            ...target,
            endpoints,
            activeEndpointId,
            host: selected?.address || "",
            port: selected?.tcpPorts || "",
            udpPorts: selected?.udpPorts || "",
            commandContext: context,
          };
          return {
            ...current,
            targets: current.targets.map((entry) => entry.id === targetId ? nextTarget : entry),
            variables: current.activeTargetId === targetId
              ? { ...clearMachineVariables(current.variables), ...context }
              : current.variables,
          };
        });
      },
      addRecord(kind, record) {
        if (!['accounts', 'users', 'loot'].includes(kind)) return;
        update((current) => !current.activeTargetId ? current : ({
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
      selectCredential(accountId) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const account = current.accounts.find((entry) => entry.id === accountId && entry.targetId === current.activeTargetId);
          if (!account) {
            const cleared = { user: "", password: "", hash: "", selectedCredentialId: "", credentialType: "" };
            return {
              ...current,
              selectedCredentials: { ...(current.selectedCredentials || {}), [current.activeTargetId]: "" },
              variables: { ...current.variables, ...cleared },
              targets: current.targets.map((entry) => entry.id === current.activeTargetId
                ? { ...entry, commandContext: { ...(entry.commandContext || {}), ...cleared } }
                : entry),
            };
          }
          const selected = {
            ...credentialVariables(account),
            selectedCredentialId: account.id,
            credentialType: isNtHash(account.secret) ? "nt-hash" : "password",
          };
          return {
            ...current,
            selectedCredentials: { ...(current.selectedCredentials || {}), [current.activeTargetId]: account.id },
            variables: { ...current.variables, ...selected },
            targets: current.targets.map((entry) => entry.id === current.activeTargetId
              ? { ...entry, commandContext: { ...(entry.commandContext || {}), ...pickMachineVariables(selected) } }
              : entry),
          };
        });
      },
      recordCommand(itemId, command) {
        update((current) => {
          if (!current.activeTargetId) return current;
          const target = current.targets.find((entry) => entry.id === current.activeTargetId);
          const endpoint = activeEndpoint(target);
          const key = getItemStateKey(current, itemId);
          const draft = commandNarrativeDraft(command.command, command.label);
          const hasFinding = Boolean(getScopedItemValue(current.notes, current, itemId, ""));
          const hasNextStep = Boolean(getScopedItemValue(current.nextSteps, current, itemId, ""));
          return {
            ...current,
            notes: hasFinding ? current.notes : { ...current.notes, [key]: draft.finding },
            nextSteps: hasNextStep ? current.nextSteps : { ...current.nextSteps, [key]: draft.nextStep },
            narrativeSources: hasFinding && hasNextStep ? current.narrativeSources : {
              ...current.narrativeSources,
              [key]: {
                ...getScopedItemValue(current.narrativeSources, current, itemId, {}),
                ...(!hasFinding ? { finding: draft.finding } : {}),
                ...(!hasNextStep ? { nextStep: draft.nextStep } : {}),
              },
            },
            commandHistory: [...current.commandHistory, {
              id: createId("command"),
              copiedAt: new Date().toISOString(),
              targetId: current.activeTargetId,
              targetName: target?.name || current.variables.targetName,
              endpointId: endpoint?.id || null,
              address: current.variables.rhost,
              itemId,
              established: draft.finding,
              nextAction: draft.nextStep,
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
          if (!current.activeTargetId) return current;
          const scope = getActiveScope(current);
          return { ...current, reports: { ...current.reports, [scope]: { ...(current.reports[scope] ?? {}), ...patch } } };
        });
      },
      updateParserSetting(type, enabled) {
        update((current) => ({
          ...current,
          parserSettings: { ...current.parserSettings, [type]: Boolean(enabled) },
        }));
      },
      confirmDiscovery(discoveryOrId) {
        update((current) => {
          const requested = typeof discoveryOrId === "string"
            ? current.discoveries.find((entry) => entry.id === discoveryOrId)
            : discoveryOrId;
          if (!requested) return current;
          const targetId = requested.targetId || current.activeTargetId;
          const candidate = current.discoveries.find((entry) => (
            entry.targetId === targetId
            && (entry.id === requested.id || discoveryKey(entry) === discoveryKey(requested))
          )) || requested;
          if (!targetId) return current;

          const target = current.targets.find((entry) => entry.id === targetId);
          const selectedEndpoint = candidate.endpointId
            ? target?.endpoints?.find((endpoint) => endpoint.id === candidate.endpointId)
            : activeEndpoint(target);
          const endpointIsActive = Boolean(selectedEndpoint && target?.activeEndpointId === selectedEndpoint.id);
          const createdAt = new Date().toISOString();
          let variables = current.variables;
          let targets = current.targets;
          let accounts = current.accounts;
          let users = current.users;

          const updateActiveVariables = (patch) => {
            if (current.activeTargetId === targetId) variables = { ...variables, ...patch };
          };
          const updateTarget = (recipe) => {
            targets = targets.map((entry) => entry.id === targetId ? recipe(entry) : entry);
          };

          if (candidate.type === "port" && selectedEndpoint) {
            const isUdp = candidate.protocol === "udp";
            const key = isUdp ? "udpPorts" : "tcpPorts";
            const legacyKey = isUdp ? "uport" : "rport";
            const ports = mergePortLists(selectedEndpoint[key], [candidate.value]);
            if (endpointIsActive) updateActiveVariables({ [key]: ports, [legacyKey]: ports });
            updateTarget((entry) => ({
              ...entry,
              ...(endpointIsActive ? (isUdp ? { udpPorts: ports } : { port: ports }) : {}),
              endpoints: (entry.endpoints || []).map((endpoint) => endpoint.id === selectedEndpoint.id
                ? { ...endpoint, [key]: ports }
                : endpoint),
              commandContext: endpointIsActive
                ? { ...(entry.commandContext || {}), [key]: ports, [legacyKey]: ports }
                : entry.commandContext,
            }));
          }
          if (candidate.type === "domain") {
            const patch = { domain: candidate.value, baseDn: domainToBaseDn(candidate.value) };
            updateActiveVariables(patch);
            updateTarget((entry) => ({ ...entry, domain: candidate.value, commandContext: { ...(entry.commandContext || {}), ...patch } }));
          }
          if (candidate.type === "local-ip") updateActiveVariables({ lhost: candidate.value });
          if (candidate.type === "gpp-cpassword") updateActiveVariables({ gppCpassword: candidate.value });

          if (candidate.type === "endpoint" && candidate.value !== current.variables.lhost) {
            updateTarget((entry) => {
              if ((entry.endpoints || []).some((endpoint) => endpoint.address === candidate.value)) return entry;
              return {
                ...entry,
                endpoints: [...(entry.endpoints || []), {
                  id: createId("endpoint"),
                  address: candidate.value,
                  hostnames: [],
                  tcpPorts: "",
                  udpPorts: "",
                  source: "operator-confirmed parser candidate",
                }],
              };
            });
          }
          if (candidate.type === "hostname") {
            const address = candidate.address || selectedEndpoint?.address;
            if (address || selectedEndpoint) updateTarget((entry) => ({
              ...entry,
              endpoints: (entry.endpoints || []).map((endpoint) => (selectedEndpoint
                ? endpoint.id === selectedEndpoint.id
                : endpoint.address === address)
                ? { ...endpoint, hostnames: [...new Set([...(endpoint.hostnames || []), candidate.value])] }
                : endpoint),
            }));
          }

          const username = candidate.username || (candidate.type === "user" ? candidate.value : "");
          if (username && !users.some((entry) => entry.targetId === targetId && entry.username?.toLowerCase() === String(username).toLowerCase())) {
            users = [...users, {
              id: createId("user"),
              createdAt,
              targetId,
              target: target?.name || current.variables.targetName,
              domain: candidate.domain || target?.domain || current.variables.domain,
              username,
              source: "operator-confirmed parser candidate",
            }];
          }
          if (candidate.type === "credential" && candidate.username && !accounts.some((entry) => (
            entry.targetId === targetId
            && entry.username?.toLowerCase() === candidate.username.toLowerCase()
            && entry.secret === candidate.secret
          ))) {
            accounts = [...accounts, {
              id: createId("account"),
              createdAt,
              targetId,
              target: target?.name || current.variables.targetName,
              domain: candidate.domain || target?.domain || current.variables.domain,
              username: candidate.username,
              secret: candidate.secret,
              source: candidate.source || "operator-confirmed parser candidate",
              status: "untested",
            }];
          }

          const matches = (entry) => entry.targetId === targetId && discoveryKey(entry) === discoveryKey(candidate);
          const evidence = Object.fromEntries(Object.entries(current.evidence).map(([key, entries]) => [key, (entries || []).map((entry) => {
            const belongsToTarget = entry.targetId ? entry.targetId === targetId : key.startsWith(`${targetId}::`);
            if (!belongsToTarget) return entry;
            return {
              ...entry,
              discoveries: (entry.discoveries || []).map((discovery) => discoveryKey(discovery) === discoveryKey(candidate)
                ? { ...discovery, status: "confirmed", confirmedAt: createdAt }
                : discovery),
            };
          })]));
          return {
            ...current,
            variables,
            targets,
            accounts,
            users,
            evidence,
            discoveries: current.discoveries.map((entry) => matches(entry)
              ? { ...entry, status: "confirmed", confirmedAt: createdAt }
              : entry),
          };
        });
      },
      ignoreDiscovery(discovery) {
        update((current) => {
          const targetId = discovery.targetId ?? current.activeTargetId;
          const { id: sourceDiscoveryId, ...snapshot } = discovery;
          const rule = {
            ...snapshot,
            id: createId("ignored"),
            createdAt: new Date().toISOString(),
            targetId,
            ...(sourceDiscoveryId ? { sourceDiscoveryId } : {}),
          };
          const sameRule = (entry) => entry.targetId === targetId && discoveryKey(entry) === discoveryKey(rule);
          return {
            ...current,
            ignoredDiscoveries: current.ignoredDiscoveries.some(sameRule)
              ? current.ignoredDiscoveries
              : [...current.ignoredDiscoveries, rule],
            discoveries: current.discoveries.filter((entry) => !sameRule(entry)),
          };
        });
      },
      restoreIgnoredDiscovery(id) {
        update((current) => {
          const ignored = current.ignoredDiscoveries.find((entry) => entry.id === id);
          if (!ignored) return current;
          const target = current.targets.find((entry) => entry.id === ignored.targetId);
          const { id: ignoredId, sourceDiscoveryId, ...snapshot } = ignored;
          const restored = {
            ...snapshot,
            id: createId("discovery"),
            restoredAt: new Date().toISOString(),
            targetName: snapshot.targetName || target?.name || current.variables.targetName,
            status: "candidate",
          };
          delete restored.confirmedAt;
          const alreadyPresent = current.discoveries.some((entry) => (
            entry.targetId === restored.targetId && discoveryKey(entry) === discoveryKey(restored)
          ));
          return {
            ...current,
            parserSettings: { ...current.parserSettings, [restored.type]: true },
            ignoredDiscoveries: current.ignoredDiscoveries.filter((entry) => entry.id !== ignoredId),
            discoveries: alreadyPresent ? current.discoveries : [...current.discoveries, restored],
          };
        });
      },
      deleteRecord(kind, id) {
        if (!['accounts', 'users', 'loot'].includes(kind)) return;
        update((current) => {
          const deletingSelected = kind === "accounts" && current.selectedCredentials?.[current.activeTargetId] === id;
          return {
            ...current,
            [kind]: current[kind].filter((record) => record.id !== id),
            variables: deletingSelected
              ? { ...current.variables, user: "", password: "", hash: "", selectedCredentialId: "", credentialType: "" }
              : current.variables,
            selectedCredentials: kind === "accounts"
              ? Object.fromEntries(Object.entries(current.selectedCredentials || {}).map(([targetId, accountId]) => [targetId, accountId === id ? "" : accountId]))
              : current.selectedCredentials,
          };
        });
      },
      importWorkspace(value) {
        setWorkspace(normalizeWorkspace(value));
      },
      importMachine(value, targetId, labType) {
        update((current) => importMachineData(current, value, targetId, labType));
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

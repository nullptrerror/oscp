import { DEFAULT_VARIABLES } from "../data/checklist.js";
import { DEFAULT_PARSER_SETTINGS } from "./evidence.js";
import { flagProfile, normalizeFlagSettings } from "./flagProfiles.js";

export const STORAGE_KEY = "fieldnotes.oscp.workspace.v1";
export const WORKSPACE_VERSION = 1;
export const MACHINE_VARIABLE_KEYS = [
  "targetName", "rhost", "rport", "uport", "subnet", "domain", "baseDn", "dc",
  "user", "memberUser", "targetGroup", "dcsyncUser", "password", "gppCpassword", "hash", "smbShare", "smbDirectory",
  "sprayPassword", "userFlagName", "rootFlagName",
];

export const pickMachineVariables = (values = {}) => Object.fromEntries(
  MACHINE_VARIABLE_KEYS.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]),
);

export const domainToBaseDn = (domain = "") => String(domain)
  .trim()
  .split(".")
  .filter(Boolean)
  .map((part) => `DC=${part}`)
  .join(",");

export const createId = (prefix = "item") => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
};

export const clearMachineVariables = (variables) => ({
  ...variables,
  targetName: "",
  rhost: "",
  rport: "",
  uport: "",
  domain: "",
  baseDn: "",
  dc: "",
  user: "",
  memberUser: "",
  targetGroup: "",
  dcsyncUser: "",
  password: "",
  gppCpassword: "",
  hash: "",
  smbShare: "",
  smbDirectory: "",
  subnet: "",
  sprayPassword: "",
  userFlagName: "",
  rootFlagName: "",
});

const withoutTargetScope = (record, targetId) => Object.fromEntries(
  Object.entries(record || {}).filter(([key]) => !key.startsWith(`${targetId}::`)),
);

export function deleteMachineData(workspace, targetId) {
  const target = workspace.targets.find((entry) => entry.id === targetId);
  if (!target) return workspace;
  const belongs = (entry) => entry.targetId === targetId || (!entry.targetId && [entry.target, entry.targetName].includes(target.name));
  const reports = { ...workspace.reports };
  delete reports[targetId];
  return {
    ...workspace,
    activeTargetId: workspace.activeTargetId === targetId ? null : workspace.activeTargetId,
    variables: workspace.activeTargetId === targetId ? clearMachineVariables(workspace.variables) : workspace.variables,
    targets: workspace.targets.filter((entry) => entry.id !== targetId),
    accounts: workspace.accounts.filter((entry) => !belongs(entry)),
    users: workspace.users.filter((entry) => !belongs(entry)),
    loot: workspace.loot.filter((entry) => !belongs(entry)),
    discoveries: workspace.discoveries.filter((entry) => !belongs(entry)),
    ignoredDiscoveries: workspace.ignoredDiscoveries.filter((entry) => !belongs(entry)),
    commandHistory: workspace.commandHistory.filter((entry) => !belongs(entry)),
    completed: withoutTargetScope(workspace.completed, targetId),
    notes: withoutTargetScope(workspace.notes, targetId),
    nextSteps: withoutTargetScope(workspace.nextSteps, targetId),
    narrativeSources: withoutTargetScope(workspace.narrativeSources, targetId),
    evidence: withoutTargetScope(workspace.evidence, targetId),
    reports,
  };
}

const uniqueMachineName = (targets, requested) => {
  const base = String(requested || "imported-machine").trim() || "imported-machine";
  const names = new Set(targets.map((target) => String(target.name).toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base}-imported-${suffix}`.toLowerCase())) suffix += 1;
  return `${base}-imported-${suffix}`;
};

const copyTargetScope = (destination, source, oldTargetId, newTargetId, transform = (value) => value) => {
  const next = { ...(destination || {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (!key.startsWith(`${oldTargetId}::`)) continue;
    next[`${newTargetId}::${key.slice(oldTargetId.length + 2)}`] = transform(value);
  }
  return next;
};

export function importMachineData(workspace, importedWorkspace, sourceTargetId, selectedLabType) {
  const imported = normalizeWorkspace(importedWorkspace);
  const source = imported.targets.find((target) => target.id === sourceTargetId);
  if (!source) throw new Error("The selected machine is not present in that PDF.");
  if (!selectedLabType && !source.labType) throw new Error("Choose a lab / proof style before importing this machine.");

  const id = createId("target");
  const name = uniqueMachineName(workspace.targets, source.name);
  const profile = flagProfile(selectedLabType || source.labType);
  const flagSettings = normalizeFlagSettings({
    ...source,
    ...(selectedLabType ? { labType: selectedLabType, userFlagName: profile.userFlagName, rootFlagName: profile.rootFlagName } : {}),
  });
  const endpointIds = new Map((source.endpoints || []).map((endpoint) => [endpoint.id, createId("endpoint")]));
  const endpoints = (source.endpoints || []).map((endpoint) => ({ ...endpoint, id: endpointIds.get(endpoint.id) }));
  const activeEndpointId = endpointIds.get(source.activeEndpointId) || endpoints[0]?.id || null;
  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === activeEndpointId) || endpoints[0];
  const machine = {
    ...source,
    ...flagSettings,
    id,
    name,
    importedAt: new Date().toISOString(),
    endpoints,
    activeEndpointId,
    host: selectedEndpoint?.address || source.host || "",
    port: selectedEndpoint?.tcpPorts || "",
    udpPorts: selectedEndpoint?.udpPorts || "",
    commandContext: {
      ...(source.commandContext || {}),
      targetName: name,
      rhost: selectedEndpoint?.address || source.host || "",
      rport: selectedEndpoint?.tcpPorts || "",
      uport: selectedEndpoint?.udpPorts || "",
      userFlagName: flagSettings.userFlagName,
      rootFlagName: flagSettings.rootFlagName,
    },
  };
  const belongs = (entry) => entry.targetId === source.id || (!entry.targetId && [entry.target, entry.targetName].includes(source.name));
  const retarget = (entry) => ({
    ...entry,
    targetId: id,
    ...(entry.target !== undefined ? { target: name } : {}),
    ...(entry.targetName !== undefined ? { targetName: name } : {}),
    ...(entry.endpointId ? { endpointId: endpointIds.get(entry.endpointId) || entry.endpointId } : {}),
  });
  const copyEntries = (key) => [...(workspace[key] || []), ...(imported[key] || []).filter(belongs).map(retarget)];
  const reports = { ...workspace.reports };
  if (imported.reports?.[source.id]) reports[id] = { ...imported.reports[source.id] };

  return {
    ...workspace,
    activeTargetId: id,
    variables: {
      ...clearMachineVariables(workspace.variables),
      ...machine.commandContext,
      domain: machine.domain || machine.commandContext.domain || "",
      baseDn: domainToBaseDn(machine.domain || machine.commandContext.domain),
    },
    targets: [...workspace.targets, machine],
    accounts: copyEntries("accounts"),
    users: copyEntries("users"),
    loot: copyEntries("loot"),
    discoveries: copyEntries("discoveries"),
    ignoredDiscoveries: copyEntries("ignoredDiscoveries"),
    commandHistory: copyEntries("commandHistory"),
    completed: copyTargetScope(workspace.completed, imported.completed, source.id, id),
    notes: copyTargetScope(workspace.notes, imported.notes, source.id, id),
    nextSteps: copyTargetScope(workspace.nextSteps, imported.nextSteps, source.id, id),
    narrativeSources: copyTargetScope(workspace.narrativeSources, imported.narrativeSources, source.id, id),
    evidence: copyTargetScope(workspace.evidence, imported.evidence, source.id, id, (entries) => entries.map(retarget)),
    reports,
  };
}

export const createDefaultWorkspace = () => ({
  version: WORKSPACE_VERSION,
  updatedAt: new Date().toISOString(),
  activeTargetId: null,
  variables: { ...DEFAULT_VARIABLES },
  targets: [],
  accounts: [],
  users: [],
  loot: [],
  completed: {},
  notes: {},
  nextSteps: {},
  narrativeSources: {},
  evidence: {},
  discoveries: [],
  parserSettings: { ...DEFAULT_PARSER_SETTINGS },
  ignoredDiscoveries: [],
  commandHistory: [],
  reports: {},
  profile: {},
  exam: {},
});

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asRecord = (value) => (isRecord(value) ? value : {});

const normalizeTarget = (target, index) => {
  const fallbackEndpoint = target.host ? [{
    id: `${target.id || `machine-${index}`}--endpoint-1`,
    address: target.host,
    hostnames: [],
    tcpPorts: target.port || "",
    udpPorts: target.udpPorts || "",
    source: "initial",
  }] : [];
  const endpoints = asArray(target.endpoints).length > 0 ? asArray(target.endpoints).map((endpoint, endpointIndex) => ({
    id: endpoint.id || `${target.id || `machine-${index}`}--endpoint-${endpointIndex + 1}`,
    address: endpoint.address || endpoint.host || "",
    hostnames: asArray(endpoint.hostnames).filter((hostname) => !["nmap.org", "www.nmap.org"].includes(String(hostname).toLowerCase())),
    tcpPorts: endpoint.tcpPorts || endpoint.port || "",
    udpPorts: endpoint.udpPorts || "",
    source: endpoint.source || "manual",
  })) : fallbackEndpoint;
  const activeEndpointId = endpoints.some((endpoint) => endpoint.id === target.activeEndpointId)
    ? target.activeEndpointId
    : endpoints[0]?.id || null;
  const activeEndpoint = endpoints.find((endpoint) => endpoint.id === activeEndpointId);
  return {
    ...target,
    ...normalizeFlagSettings(target),
    boxType: target.boxType || (target.os === "Linux" ? "linux" : target.os === "Windows" && target.domain ? "ad" : target.os === "Windows" ? "windows" : "unknown"),
    commandContext: isRecord(target.commandContext) ? target.commandContext : {},
    endpoints,
    activeEndpointId,
    host: activeEndpoint?.address || target.host || "",
    port: activeEndpoint?.tcpPorts || target.port || "",
    udpPorts: activeEndpoint?.udpPorts || target.udpPorts || "",
  };
};

export function normalizeWorkspace(value) {
  if (!isRecord(value)) throw new Error("Backup must contain a JSON object.");
  if (value.version !== WORKSPACE_VERSION) {
    throw new Error(`Unsupported backup version: ${value.version ?? "missing"}.`);
  }

  const base = createDefaultWorkspace();
  const variables = { ...base.variables, ...asRecord(value.variables) };
  if (!variables.baseDn && variables.domain) variables.baseDn = domainToBaseDn(variables.domain);
  const targets = asArray(value.targets).map(normalizeTarget);
  const activeTargetId = targets.some((target) => target.id === value.activeTargetId) ? value.activeTargetId : null;
  const fallbackTargetId = activeTargetId || (targets.length === 1 ? targets[0].id : null);
  const normalizedTargets = targets.map((target) => target.id === fallbackTargetId ? {
    ...target,
    commandContext: {
      ...pickMachineVariables(variables),
      ...(target.commandContext || {}),
    },
  } : target);
  const activeTarget = normalizedTargets.find((target) => target.id === activeTargetId);
  const normalizedVariables = activeTarget ? {
    ...variables,
    ...activeTarget.commandContext,
    userFlagName: activeTarget.userFlagName,
    rootFlagName: activeTarget.rootFlagName,
  } : clearMachineVariables(variables);
  const normalizeScopedRecord = (input) => {
    const record = asRecord(input);
    if (!fallbackTargetId) return record;
    const next = { ...record };
    for (const [key, entry] of Object.entries(record)) {
      if (key.includes("::")) continue;
      const scopedKey = `${fallbackTargetId}::${key}`;
      if (next[scopedKey] === undefined) next[scopedKey] = entry;
      delete next[key];
    }
    return next;
  };
  const scopeEntry = (entry) => {
    if (entry.targetId && targets.some((target) => target.id === entry.targetId)) return entry;
    const namedTarget = targets.find((target) => [entry.target, entry.targetName].includes(target.name));
    const target = namedTarget || targets.find((candidate) => candidate.id === fallbackTargetId);
    return target ? { ...entry, targetId: target.id, target: entry.target || target.name, targetName: entry.targetName || target.name } : entry;
  };
  return {
    ...base,
    ...value,
    activeTargetId,
    variables: normalizedVariables,
    targets: normalizedTargets,
    accounts: asArray(value.accounts).map(scopeEntry),
    users: asArray(value.users).map(scopeEntry),
    loot: asArray(value.loot).map(scopeEntry),
    completed: normalizeScopedRecord(value.completed),
    notes: normalizeScopedRecord(value.notes),
    nextSteps: normalizeScopedRecord(value.nextSteps),
    narrativeSources: normalizeScopedRecord(value.narrativeSources),
    evidence: normalizeScopedRecord(value.evidence),
    discoveries: asArray(value.discoveries).filter((entry) => {
      if (entry.type === "hostname" && ["nmap.org", "www.nmap.org"].includes(String(entry.value).toLowerCase())) return false;
      if (["ip", "endpoint"].includes(entry.type) && entry.value === variables.lhost) return false;
      return true;
    }).map(scopeEntry),
    parserSettings: { ...DEFAULT_PARSER_SETTINGS, ...asRecord(value.parserSettings) },
    ignoredDiscoveries: asArray(value.ignoredDiscoveries).map(scopeEntry),
    commandHistory: asArray(value.commandHistory).map(scopeEntry),
    reports: asRecord(value.reports),
    profile: asRecord(value.profile),
    exam: asRecord(value.exam),
  };
}

export function getActiveScope(workspace) {
  return workspace.activeTargetId || `name:${workspace.variables.targetName || "unassigned"}`;
}

export function getItemStateKey(workspace, itemId) {
  return `${getActiveScope(workspace)}::${itemId}`;
}

export function getScopedItemValue(record, workspace, itemId, fallback) {
  return record[getItemStateKey(workspace, itemId)] ?? record[itemId] ?? fallback;
}

export function getTargetScope(workspace, targetId) {
  if (targetId) return targetId;
  return getActiveScope(workspace);
}

export function getTargetItemValue(record, scope, itemId, fallback) {
  return record[`${scope}::${itemId}`] ?? record[itemId] ?? fallback;
}

export function loadWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeWorkspace(JSON.parse(stored)) : createDefaultWorkspace();
  } catch (error) {
    console.warn("Could not load saved workspace", error);
    return createDefaultWorkspace();
  }
}

export function saveWorkspace(workspace) {
  const next = { ...workspace, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next.updatedAt;
}

export function renderCommand(template, variables) {
  const missing = new Set();
  const command = template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(value);
  });
  return { command, missing: [...missing] };
}

export function downloadWorkspace(workspace) {
  const payload = JSON.stringify({ ...workspace, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `fieldnotes-oscp-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

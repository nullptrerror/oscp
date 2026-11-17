import { DEFAULT_VARIABLES } from "../data/checklist.js";
import { DEFAULT_PARSER_SETTINGS } from "./evidence.js";
import { flagProfile, normalizeFlagSettings } from "./flagProfiles.js";

// Keep the storage key stable so existing offline workspaces are migrated in place.
export const STORAGE_KEY = "fieldnotes.oscp.workspace.v1";
export const WORKSPACE_VERSION = 2;
export const LEGACY_WORKSPACE_VERSIONS = new Set([1]);
export const RESULT_STATES = Object.freeze({
  CONFIRMED: "finding-confirmed",
  NO_FINDING: "no-finding",
  FAILED: "command-failed",
  BLOCKED: "blocked",
  REVIEW: "needs-review",
});
export const COMPLETING_RESULT_STATES = new Set([RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING]);
export const MACHINE_VARIABLE_KEYS = [
  "targetName", "targetSlug", "rhost", "rport", "uport", "tcpPorts", "udpPorts",
  "selectedServiceHost", "selectedServicePort", "webScheme", "webPort", "vhost", "baseUrl",
  "webPath", "webParameter", "webValue", "sessionCookie", "uploadFile", "uploadField", "uploadedRemotePath",
  "subnet", "domain", "realm", "baseDn", "dc", "dcIp", "dnsServer",
  "user", "selectedCredentialId", "credentialType", "memberUser", "targetGroup", "aclTarget", "aclPrincipal", "aclRights", "dcsyncUser", "bloodhoundSource", "bloodhoundTarget", "password", "gppCpassword", "hash",
  "smbShare", "smbDirectory", "nfsExport", "gppXmlFile", "exploitQuery", "exploitId", "exploitFile", "compiledExploit", "transferFile", "hashesFile", "hashMode",
  "pivotHost", "pivotUser", "pivotInterface", "proxyPort", "internalHost", "internalSubnet", "callbackHost",
  "sprayPassword", "sprayJitter", "sprayRockyouLimit", "userFlagName", "rootFlagName",
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

export const slugifyTarget = (name = "") => {
  const source = String(name).trim();
  const ascii = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 80);
  if (ascii) return ascii;
  let hash = 2166136261;
  for (const character of source || "target") {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `target-${(hash >>> 0).toString(36)}`;
};

export const uniqueTargetSlug = (targets = [], requested = "target") => {
  const base = slugifyTarget(requested);
  const used = new Set(targets.map((target) => target.slug).filter(Boolean));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

export const createId = (prefix = "item") => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
};

export const clearMachineVariables = (variables) => ({
  ...variables,
  ...Object.fromEntries(MACHINE_VARIABLE_KEYS.map((key) => [key, DEFAULT_VARIABLES[key] ?? ""])),
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
    selectedCredentials: Object.fromEntries(Object.entries(workspace.selectedCredentials || {}).filter(([key]) => key !== targetId)),
    selectedPivotPlaybooks: Object.fromEntries(Object.entries(workspace.selectedPivotPlaybooks || {}).filter(([key]) => key !== targetId)),
    completed: withoutTargetScope(workspace.completed, targetId),
    resultStates: withoutTargetScope(workspace.resultStates, targetId),
    commandResultStates: withoutTargetScope(workspace.commandResultStates, targetId),
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
    slug: uniqueTargetSlug(workspace.targets, source.slug || name),
    importedAt: new Date().toISOString(),
    endpoints,
    activeEndpointId,
    host: selectedEndpoint?.address || source.host || "",
    port: selectedEndpoint?.tcpPorts || "",
    udpPorts: selectedEndpoint?.udpPorts || "",
    commandContext: {
      ...(source.commandContext || {}),
      targetName: name,
      targetSlug: uniqueTargetSlug(workspace.targets, source.slug || name),
      rhost: selectedEndpoint?.address || source.host || "",
      rport: selectedEndpoint?.tcpPorts || "",
      uport: selectedEndpoint?.udpPorts || "",
      tcpPorts: selectedEndpoint?.tcpPorts || "",
      udpPorts: selectedEndpoint?.udpPorts || "",
      selectedServiceHost: selectedEndpoint?.address || source.host || "",
      selectedCredentialId: "",
      credentialType: "",
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
      selectedCredentialId: "",
      credentialType: "",
    },
    targets: [...workspace.targets, machine],
    accounts: copyEntries("accounts"),
    users: copyEntries("users"),
    loot: copyEntries("loot"),
    discoveries: copyEntries("discoveries"),
    ignoredDiscoveries: copyEntries("ignoredDiscoveries"),
    commandHistory: copyEntries("commandHistory"),
    completed: copyTargetScope(workspace.completed, imported.completed, source.id, id),
    resultStates: copyTargetScope(workspace.resultStates, imported.resultStates, source.id, id),
    commandResultStates: copyTargetScope(workspace.commandResultStates, imported.commandResultStates, source.id, id),
    notes: copyTargetScope(workspace.notes, imported.notes, source.id, id),
    nextSteps: copyTargetScope(workspace.nextSteps, imported.nextSteps, source.id, id),
    narrativeSources: copyTargetScope(workspace.narrativeSources, imported.narrativeSources, source.id, id),
    evidence: copyTargetScope(workspace.evidence, imported.evidence, source.id, id, (entries) => entries.map(retarget)),
    selectedPivotPlaybooks: {
      ...(workspace.selectedPivotPlaybooks || {}),
      [id]: imported.selectedPivotPlaybooks?.[source.id] || "pivot-direct",
    },
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
  resultStates: {},
  commandResultStates: {},
  notes: {},
  nextSteps: {},
  narrativeSources: {},
  evidence: {},
  discoveries: [],
  selectedCredentials: {},
  selectedPivotPlaybooks: {},
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
    slug: target.slug || slugifyTarget(target.name || `machine-${index + 1}`),
    boxType: target.boxType || (target.os === "Linux" ? "linux" : target.os === "Windows" && target.domain ? "ad" : target.os === "Windows" ? "windows" : "unknown"),
    commandContext: {
      ...(isRecord(target.commandContext) ? target.commandContext : {}),
      targetSlug: target.commandContext?.targetSlug || target.slug || slugifyTarget(target.name || `machine-${index + 1}`),
      tcpPorts: target.commandContext?.tcpPorts || target.commandContext?.rport || activeEndpoint?.tcpPorts || target.port || "",
      udpPorts: target.commandContext?.udpPorts || target.commandContext?.uport || activeEndpoint?.udpPorts || target.udpPorts || "",
    },
    endpoints,
    activeEndpointId,
    host: activeEndpoint?.address || target.host || "",
    port: activeEndpoint?.tcpPorts || target.port || "",
    udpPorts: activeEndpoint?.udpPorts || target.udpPorts || "",
  };
};

export function normalizeWorkspace(value) {
  if (!isRecord(value)) throw new Error("Backup must contain a JSON object.");
  const sourceVersion = Number(value.version);
  if (sourceVersion !== WORKSPACE_VERSION && !LEGACY_WORKSPACE_VERSIONS.has(sourceVersion)) {
    throw new Error(`Unsupported backup version: ${value.version ?? "missing"}.`);
  }

  const base = createDefaultWorkspace();
  const inputVariables = asRecord(value.variables);
  const variables = {
    ...base.variables,
    ...inputVariables,
    tcpPorts: inputVariables.tcpPorts || inputVariables.rport || "",
    udpPorts: inputVariables.udpPorts || inputVariables.uport || "",
    rport: inputVariables.rport || inputVariables.tcpPorts || "",
    uport: inputVariables.uport || inputVariables.udpPorts || "",
    targetSlug: inputVariables.targetSlug || slugifyTarget(inputVariables.targetName || ""),
    selectedServiceHost: inputVariables.selectedServiceHost || inputVariables.rhost || "",
  };
  if (!variables.baseDn && variables.domain) variables.baseDn = domainToBaseDn(variables.domain);
  const targets = asArray(value.targets).map(normalizeTarget).reduce((list, target) => {
    const slug = uniqueTargetSlug(list, target.slug || target.name);
    list.push({
      ...target,
      slug,
      commandContext: { ...(target.commandContext || {}), targetSlug: slug },
    });
    return list;
  }, []);
  const activeTargetId = targets.some((target) => target.id === value.activeTargetId) ? value.activeTargetId : null;
  const fallbackTargetId = activeTargetId || (targets.length === 1 ? targets[0].id : null);
  const normalizedTargets = targets.map((target) => target.id === fallbackTargetId ? {
    ...target,
    commandContext: {
      ...pickMachineVariables(variables),
      ...(sourceVersion === 1
        ? Object.fromEntries(Object.entries(target.commandContext || {}).filter(([, entry]) => entry !== "" && entry !== null && entry !== undefined))
        : (target.commandContext || {})),
    },
  } : target);
  const activeTarget = normalizedTargets.find((target) => target.id === activeTargetId);
  const normalizedVariables = activeTarget ? {
    ...variables,
    ...activeTarget.commandContext,
    targetSlug: activeTarget.commandContext?.targetSlug || activeTarget.slug,
    tcpPorts: activeTarget.commandContext?.tcpPorts || activeTarget.commandContext?.rport || activeTarget.port || "",
    udpPorts: activeTarget.commandContext?.udpPorts || activeTarget.commandContext?.uport || activeTarget.udpPorts || "",
    rport: activeTarget.commandContext?.rport || activeTarget.commandContext?.tcpPorts || activeTarget.port || "",
    uport: activeTarget.commandContext?.uport || activeTarget.commandContext?.udpPorts || activeTarget.udpPorts || "",
    selectedServiceHost: activeTarget.commandContext?.selectedServiceHost || activeTarget.host || "",
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
  const accounts = asArray(value.accounts).map(scopeEntry);
  const selectedCredentials = Object.fromEntries(Object.entries(asRecord(value.selectedCredentials)).filter(([targetId, accountId]) => (
    targets.some((target) => target.id === targetId)
    && accounts.some((account) => account.id === accountId && account.targetId === targetId)
  )));
  const completed = normalizeScopedRecord(value.completed);
  const suppliedResultStates = normalizeScopedRecord(value.resultStates);
  const validResultStates = new Set(Object.values(RESULT_STATES));
  const resultStates = Object.fromEntries(Object.entries(suppliedResultStates).filter(([, state]) => validResultStates.has(state)));
  // Older and partially upgraded workspaces may only have the boolean. Keep
  // that work while making result state the single source of completion truth.
  for (const [key, isComplete] of Object.entries(completed)) {
    if (isComplete && !resultStates[key]) resultStates[key] = RESULT_STATES.CONFIRMED;
  }
  for (const [key, completedValue] of Object.entries(completed)) {
    const state = resultStates[key];
    const shouldComplete = COMPLETING_RESULT_STATES.has(state);
    if (Boolean(completedValue) !== shouldComplete) completed[key] = shouldComplete;
  }
  return {
    ...base,
    ...value,
    version: WORKSPACE_VERSION,
    activeTargetId,
    variables: {
      ...normalizedVariables,
      selectedCredentialId: selectedCredentials[activeTargetId] || "",
    },
    targets: normalizedTargets,
    accounts,
    users: asArray(value.users).map(scopeEntry),
    loot: asArray(value.loot).map(scopeEntry),
    completed,
    resultStates,
    commandResultStates: Object.fromEntries(Object.entries(normalizeScopedRecord(value.commandResultStates)).filter(([, state]) => validResultStates.has(state))),
    notes: normalizeScopedRecord(value.notes),
    nextSteps: normalizeScopedRecord(value.nextSteps),
    narrativeSources: normalizeScopedRecord(value.narrativeSources),
    evidence: normalizeScopedRecord(value.evidence),
    discoveries: asArray(value.discoveries).filter((entry) => {
      if (entry.type === "hostname" && ["nmap.org", "www.nmap.org"].includes(String(entry.value).toLowerCase())) return false;
      if (["ip", "endpoint"].includes(entry.type) && entry.value === variables.lhost) return false;
      return true;
    }).map((entry) => scopeEntry({
      ...entry,
      // Older parser findings had already been applied to variables and
      // records. Treat them as confirmed to avoid silently undoing user data.
      status: entry.status || (sourceVersion === 1 ? "confirmed" : "candidate"),
    })),
    parserSettings: { ...DEFAULT_PARSER_SETTINGS, ...asRecord(value.parserSettings) },
    ignoredDiscoveries: asArray(value.ignoredDiscoveries).map(scopeEntry),
    commandHistory: asArray(value.commandHistory).map(scopeEntry),
    selectedCredentials,
    selectedPivotPlaybooks: Object.fromEntries(Object.entries(asRecord(value.selectedPivotPlaybooks)).filter(([targetId, playbookId]) => (
      targets.some((target) => target.id === targetId) && typeof playbookId === "string" && playbookId.startsWith("pivot-")
    ))),
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

export function getCommandResultStateKey(workspace, itemId, commandKey) {
  return `${getItemStateKey(workspace, itemId)}::${commandKey}`;
}

export function getCommandResultStateValue(record, workspace, itemId, commandKey, fallback = "") {
  return record?.[getCommandResultStateKey(workspace, itemId, commandKey)] ?? fallback;
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

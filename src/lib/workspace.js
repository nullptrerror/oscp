import { DEFAULT_VARIABLES } from "../data/checklist.js";

export const STORAGE_KEY = "fieldnotes.oscp.workspace.v1";
export const WORKSPACE_VERSION = 1;

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
  evidence: {},
  discoveries: [],
  reports: {},
});

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asRecord = (value) => (isRecord(value) ? value : {});

export function normalizeWorkspace(value) {
  if (!isRecord(value)) throw new Error("Backup must contain a JSON object.");
  if (value.version !== WORKSPACE_VERSION) {
    throw new Error(`Unsupported backup version: ${value.version ?? "missing"}.`);
  }

  const base = createDefaultWorkspace();
  const variables = { ...base.variables, ...asRecord(value.variables) };
  if (!variables.baseDn && variables.domain) variables.baseDn = domainToBaseDn(variables.domain);
  return {
    ...base,
    ...value,
    variables,
    targets: asArray(value.targets),
    accounts: asArray(value.accounts),
    users: asArray(value.users),
    loot: asArray(value.loot),
    completed: asRecord(value.completed),
    notes: asRecord(value.notes),
    evidence: asRecord(value.evidence),
    discoveries: asArray(value.discoveries),
    reports: asRecord(value.reports),
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

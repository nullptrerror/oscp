export const RESULT_CATEGORIES = Object.freeze({
  PREPARATION: "preparation",
  DISCOVERY: "discovery",
  VALIDATION: "validation",
  ACCESS: "access",
  CHANGE: "change",
  CLEANUP: "cleanup",
  PROOF: "proof",
  MIXED: "mixed",
});

export const RESULT_CATEGORY_VALUES = Object.freeze(Object.values(RESULT_CATEGORIES));

const CATEGORY_LABELS = Object.freeze({
  [RESULT_CATEGORIES.PREPARATION]: "Preparation",
  [RESULT_CATEGORIES.DISCOVERY]: "Discovery",
  [RESULT_CATEGORIES.VALIDATION]: "Validation",
  [RESULT_CATEGORIES.ACCESS]: "Access",
  [RESULT_CATEGORIES.CHANGE]: "Controlled change",
  [RESULT_CATEGORIES.CLEANUP]: "Cleanup",
  [RESULT_CATEGORIES.PROOF]: "Proof",
  [RESULT_CATEGORIES.MIXED]: "Mixed activity",
});

// Keep these values aligned with RESULT_STATES without importing workspace.js.
// commandContract -> checklist -> workspace is an intentional dependency path;
// importing workspace here would turn it into a cycle during checklist startup.
const OUTCOMES = Object.freeze({
  REVIEW: "needs-review",
  CONFIRMED: "finding-confirmed",
  NO_FINDING: "no-finding",
  FAILED: "command-failed",
  BLOCKED: "blocked",
});

const OUTCOME_LABELS = Object.freeze({
  [RESULT_CATEGORIES.PREPARATION]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Preparation verified",
    [OUTCOMES.NO_FINDING]: "Not required / not applicable",
    [OUTCOMES.FAILED]: "Preparation failed",
    [OUTCOMES.BLOCKED]: "Preparation blocked",
  },
  [RESULT_CATEGORIES.DISCOVERY]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Useful result confirmed",
    [OUTCOMES.NO_FINDING]: "Nothing relevant observed",
    [OUTCOMES.FAILED]: "Discovery command failed",
    [OUTCOMES.BLOCKED]: "Discovery blocked",
  },
  [RESULT_CATEGORIES.VALIDATION]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Finding confirmed",
    [OUTCOMES.NO_FINDING]: "No finding",
    [OUTCOMES.FAILED]: "Validation failed",
    [OUTCOMES.BLOCKED]: "Validation blocked",
  },
  [RESULT_CATEGORIES.ACCESS]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Access confirmed",
    [OUTCOMES.NO_FINDING]: "Access not obtained",
    [OUTCOMES.FAILED]: "Access command failed",
    [OUTCOMES.BLOCKED]: "Access blocked",
  },
  [RESULT_CATEGORIES.CHANGE]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Change verified",
    [OUTCOMES.NO_FINDING]: "Change not applied",
    [OUTCOMES.FAILED]: "Change failed",
    [OUTCOMES.BLOCKED]: "Change blocked",
  },
  [RESULT_CATEGORIES.CLEANUP]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Cleanup verified",
    [OUTCOMES.NO_FINDING]: "Nothing remained to clean",
    [OUTCOMES.FAILED]: "Cleanup failed",
    [OUTCOMES.BLOCKED]: "Cleanup blocked",
  },
  [RESULT_CATEGORIES.PROOF]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Proof captured",
    [OUTCOMES.NO_FINDING]: "Proof not obtained",
    [OUTCOMES.FAILED]: "Proof command failed",
    [OUTCOMES.BLOCKED]: "Proof blocked",
  },
  [RESULT_CATEGORIES.MIXED]: {
    [OUTCOMES.REVIEW]: "Needs review",
    [OUTCOMES.CONFIRMED]: "Positive result confirmed",
    [OUTCOMES.NO_FINDING]: "No positive result",
    [OUTCOMES.FAILED]: "Activity failed",
    [OUTCOMES.BLOCKED]: "Activity blocked",
  },
});

const CLEANUP_PATTERN = /(?:^|[-_\s])(?:cleanup|restore|remove|delete|reset|teardown|rollback|stop|unmount|delmem)(?:$|[-_\s])/iu;
const PROOF_PATTERN = /(?:proof|flag|local\.txt|proof\.txt|user\.txt|root\.txt)/iu;
const ACCESS_PATTERN = /(?:\b(?:remote|authentication|logon|login|listener|shell|evil-winrm|wmiexec|psexec|xfreerdp|ssh)\b|reverse[-_\s]?shell|bind[-_\s]?shell)/iu;
const DISCOVERY_ITEM_PATTERN = /^(?:recon-|svc-|linux-(?:context|files|jobs|secrets|storage-groups|kernel)|windows-(?:context|services|jobs|secrets|privileges-policy)|ad-(?:baseline|enum|trusts|bloodhound-paths)|creds-identify|web-(?:baseline|content|vhosts|files-api))/u;
const DISCOVERY_TEXT_PATTERN = /(?:enumerat|discover|inventory|fingerprint|inspect|list|search|scan|identify|baseline|headers|source|shares|users|groups|policy|ports|services|routes?)/iu;
const CHANGE_STATES = new Set(["local-system", "listener", "target-file", "target-configuration", "directory-service", "network-route"]);

const commandSource = (command = {}) => [
  command.id,
  command.key,
  command.commandKey,
  command.label,
  command.title,
  command.command,
  command.commandText,
  command.template,
  command.value,
].filter(Boolean).join(" ");

const unwrapCommand = (command = {}) => command.command && typeof command.command === "object"
  ? { ...command.command, resultCategory: command.resultCategory || command.role || command.command.resultCategory }
  : command;

const validCategory = (value) => RESULT_CATEGORY_VALUES.includes(value) && value !== RESULT_CATEGORIES.MIXED;

export function classifyCommandResult(itemId = "", input = {}) {
  const command = unwrapCommand(input);
  const explicit = command.resultCategory || command.reportContext?.resultCategory;
  if (validCategory(explicit)) return explicit;

  const source = commandSource(command);
  const cleanupNote = `${command.cleanup?.note || ""} ${command.cleanup?.command || ""}`;
  if (CLEANUP_PATTERN.test(source) || /(?:is|performs?) the cleanup action/iu.test(cleanupNote)) return RESULT_CATEGORIES.CLEANUP;
  if (/^proof-(?:linux|windows|artifacts)$/u.test(itemId) || PROOF_PATTERN.test(source)) return RESULT_CATEGORIES.PROOF;
  if (/^setup-/u.test(itemId)) return RESULT_CATEGORIES.PREPARATION;
  if (itemId === "proof-cleanup") return RESULT_CATEGORIES.CLEANUP;
  if (["access-remote", "access-listener", "access-shells", "access-tty", "ad-remote", "creds-reuse"].includes(itemId)
    || ACCESS_PATTERN.test(source)) return RESULT_CATEGORIES.ACCESS;
  if (CHANGE_STATES.has(command.stateChange) || /^pivot-/u.test(itemId) || itemId === "pivot-playbook") return RESULT_CATEGORIES.CHANGE;
  if (DISCOVERY_ITEM_PATTERN.test(itemId) || DISCOVERY_TEXT_PATTERN.test(source)) return RESULT_CATEGORIES.DISCOVERY;
  return RESULT_CATEGORIES.VALIDATION;
}

export function classifyItemResult(item = {}, commands = []) {
  if (validCategory(item.resultCategory)) return item.resultCategory;
  if (/^setup-/u.test(item.id || "")) return RESULT_CATEGORIES.PREPARATION;
  if (item.id === "proof-cleanup") return RESULT_CATEGORIES.CLEANUP;
  if (/^proof-/u.test(item.id || "")) return RESULT_CATEGORIES.PROOF;
  if (["access-remote", "access-listener", "access-shells", "access-tty", "ad-remote", "creds-reuse"].includes(item.id)) return RESULT_CATEGORIES.ACCESS;
  if (/^(?:recon-|svc-)/u.test(item.id || "")) return RESULT_CATEGORIES.DISCOVERY;

  const categories = [...new Set((commands || []).map((command) => (
    validCategory(command?.role) ? command.role : classifyCommandResult(item.id, command)
  )))];
  if (categories.length === 1) return categories[0];
  if (categories.length > 1) return RESULT_CATEGORIES.MIXED;
  return classifyCommandResult(item.id, item);
}

export const resultCategoryLabel = (category) => CATEGORY_LABELS[category] || CATEGORY_LABELS[RESULT_CATEGORIES.VALIDATION];

export const resultStateOptions = (category) => {
  const labels = OUTCOME_LABELS[category] || OUTCOME_LABELS[RESULT_CATEGORIES.VALIDATION];
  return [OUTCOMES.REVIEW, OUTCOMES.CONFIRMED, OUTCOMES.NO_FINDING, OUTCOMES.FAILED, OUTCOMES.BLOCKED]
    .map((value) => ({ value, label: labels[value] }));
};

export const resultStateLabel = (state, category) => {
  const labels = OUTCOME_LABELS[category] || OUTCOME_LABELS[RESULT_CATEGORIES.VALIDATION];
  return labels[state] || String(state || "Unclassified").replace(/-/gu, " ");
};

export const resultNarrativeLabel = (category) => ({
  [RESULT_CATEGORIES.PREPARATION]: "Preparation",
  [RESULT_CATEGORIES.DISCOVERY]: "Discovery",
  [RESULT_CATEGORIES.VALIDATION]: "Finding",
  [RESULT_CATEGORIES.ACCESS]: "Access",
  [RESULT_CATEGORIES.CHANGE]: "Change",
  [RESULT_CATEGORIES.CLEANUP]: "Cleanup",
  [RESULT_CATEGORIES.PROOF]: "Proof",
  [RESULT_CATEGORIES.MIXED]: "Result",
}[category] || "Result");

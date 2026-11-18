import {
  VARIABLE_DEFINITIONS,
  requiredVariable,
  validateVariableValue,
} from "../data/variableDefinitions.js";
import { classifyCommandResult, RESULT_CATEGORY_VALUES } from "./resultClassification.js";

export const RUNS_ON = Object.freeze(["lhost", "foothold-linux", "foothold-windows", "pivot"]);
export const COMMAND_POLICIES = Object.freeze(["exam-core", "restricted", "prohibited", "study-only", "verify-current-policy"]);
export const COMMAND_RISKS = Object.freeze(["low", "medium", "high", "critical"]);
export const STATE_CHANGES = Object.freeze([
  "none",
  "local-evidence",
  "local-system",
  "listener",
  "target-file",
  "target-configuration",
  "directory-service",
  "network-route",
  "credential-attempt",
]);

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;
const MAGIC_PLACEHOLDERS = [
  { pattern: /\bEXPLOIT_ID\b/u, message: "EXPLOIT_ID must be a declared variable." },
  { pattern: /\bEXPLOIT_FILE\b/u, message: "EXPLOIT_FILE must be a declared variable." },
  { pattern: /\bHASH_MODE\b/u, message: "HASH_MODE must be a declared variable." },
  { pattern: /(?:^|[\s/:])FILE(?:$|[\s;&])/u, message: "FILE must be a declared variable." },
  { pattern: /\/path\/to\//u, message: "Example paths cannot be runnable placeholders." },
  { pattern: /:\/EXPORT(?:\s|$)/u, message: "NFS export paths must be declared variables." },
];

const SERVICE_FACTS = Object.freeze({
  "svc-smb": ["service.smb.confirmed"],
  "svc-smb-gpp": ["service.smb.confirmed", "smb.readable-content.confirmed"],
  "svc-ldap": ["service.ldap.confirmed"],
  "svc-nfs": ["service.nfs.confirmed"],
  "svc-snmp": ["service.snmp.confirmed"],
  "svc-dns": ["service.dns.confirmed"],
  "svc-mail-ftp": ["service.ftp-or-mail.confirmed"],
  "web-baseline": ["service.http.confirmed"],
  "web-content": ["service.http.confirmed"],
  "web-vhosts": ["service.http.confirmed"],
  "web-manual": ["service.http.confirmed", "web.input.confirmed"],
  "web-files-api": ["service.http.confirmed"],
  "ad-baseline": ["directory.active-directory.confirmed"],
  "ad-enum": ["directory.active-directory.confirmed", "credential.selected-and-confirmed"],
  "ad-bloodhound-paths": ["bloodhound.collection-imported"],
  "ad-temporary-user": ["acl.user-creation.operator-confirmed", "credential.selected-and-confirmed"],
  "ad-roast": ["directory.active-directory.confirmed", "users.operator-confirmed"],
  "ad-spn-tgs": ["directory.active-directory.confirmed", "credential.selected-and-confirmed"],
  "ad-group-membership": ["acl.group-control.operator-confirmed", "credential.selected-and-confirmed"],
  "ad-domain-writedacl": ["acl.write-dacl.operator-confirmed", "credential.selected-and-confirmed"],
  "ad-remote": ["credential.selected-and-confirmed", "service.remote-management.confirmed"],
  "ad-delegation-adcs": ["directory.active-directory.confirmed", "credential.selected-and-confirmed"],
  "creds-reuse": ["credential.selected-and-confirmed", "lockout-risk.reviewed"],
  "creds-spray": ["credential.selected-and-confirmed", "lockout-policy.confirmed"],
  "pivot-playbook": ["reachability.operator-confirmed", "pivot.topology.operator-selected"],
});

const slug = (value) => String(value || "command")
  .normalize("NFKD")
  .replace(/[^a-zA-Z0-9]+/gu, "-")
  .replace(/^-+|-+$/gu, "")
  .toLowerCase()
  .slice(0, 64) || "command";

export function extractCommandVariables(template = "") {
  return [...new Set([...String(template).matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const shellEscapeDouble = (value) => String(value).replace(/[\\"$`]/gu, "\\$&");

function interpolateSegment(segment, variables, missing, invalid, mode) {
  return segment.replace(PLACEHOLDER, (_, name) => {
    const input = variables[name];
    if (input === undefined || input === null || input === "") {
      missing.add(name);
      return `{{${name}}}`;
    }
    const result = validateVariableValue(name, input);
    if (!result.valid) {
      invalid.set(name, result.error);
      return `{{${name}}}`;
    }
    if (mode === "single") return result.value;
    if (mode === "double") return shellEscapeDouble(result.value);
    return VARIABLE_DEFINITIONS[name].shell === "token" ? result.value : shellQuote(result.value);
  });
}

/**
 * Render typed placeholders without evaluating shell text. A complete
 * single-quoted segment is rebuilt and quoted once; values in double quotes
 * have command-substitution characters escaped; unquoted data is shell quoted.
 */
export function renderCommandTemplate(template = "", variables = {}) {
  const missing = new Set();
  const invalid = new Map();
  const source = String(template);
  let command = "";
  let cursor = 0;
  let index = 0;

  while (index < source.length) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"') {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < source.length) {
      if (source[end] === quote && (quote === "'" || source[end - 1] !== "\\")) break;
      end += 1;
    }
    if (end >= source.length) break;
    command += interpolateSegment(source.slice(cursor, index), variables, missing, invalid, "bare");
    const inner = source.slice(index + 1, end);
    if (quote === "'") {
      const rendered = interpolateSegment(inner, variables, missing, invalid, "single");
      command += rendered.includes("{{") ? `'${rendered}'` : shellQuote(rendered);
    } else {
      command += `"${interpolateSegment(inner, variables, missing, invalid, "double")}"`;
    }
    cursor = end + 1;
    index = end + 1;
  }
  command += interpolateSegment(source.slice(cursor), variables, missing, invalid, "bare");

  return {
    command,
    missing: [...missing],
    invalid: Object.fromEntries(invalid),
    runnable: missing.size === 0 && invalid.size === 0,
  };
}

function inferRunsOn(itemId, command) {
  const value = `${command.label || ""} ${command.value || ""}`;
  if (itemId === "windows-helper" && /Find WinPEAS on Kali/iu.test(command.label || "")) return "lhost";
  if (/^linux-/u.test(itemId) || itemId === "access-tty" || itemId === "proof-linux") return "foothold-linux";
  if (/^windows-/u.test(itemId) || itemId === "proof-windows") return "foothold-windows";
  if (itemId === "pivot-ligolo-agent") return /Find agent/iu.test(command.label || "") ? "lhost" : "pivot";
  if (itemId === "access-transfer") {
    if (/Serve current folder/iu.test(command.label || "")) return "lhost";
    return /powershell|Windows/iu.test(value) ? "foothold-windows" : "foothold-linux";
  }
  if (itemId === "access-shells" && /bash -c/iu.test(value)) return "foothold-linux";
  return "lhost";
}

function inferPolicy(command) {
  const value = String(command.value || "");
  if (/\bnmap\b[^\n]*--script\s+(?:['"])?vuln(?:['"])?(?:\s|$)/iu.test(value)) return "verify-current-policy";
  if (/\b(?:nessus|openvas|nuclei)\b/iu.test(value)
    || /\bresponder\b/iu.test(value)) return "prohibited";
  if (/\b(?:msfconsole|meterpreter)\b/iu.test(value)) return "restricted";
  if (/\b(?:msfvenom|certipy\s+find)\b/iu.test(value)) return "verify-current-policy";
  return "exam-core";
}

function inferStateChange(command) {
  const value = String(command.value || "");
  if (/net rpc group (?:addmem|delmem)|dacledit\s+-action\s+(?:write|restore)/iu.test(value)) return "directory-service";
  if (/\b(?:spray|rockyou-bounded)\b|nxc\s+\w+[^\n]*(?:-p|-H)\s+(?:['"]?\{\{|['"]?\$|['"]?\/)/iu.test(value)) return "credential-attempt";
  if (/\bip\s+(?:route|tuntap|link)\s+(?:add|del|set)\b/iu.test(value)) return "network-route";
  if (/tee\s+-a\s+\/etc\/hosts|timedatectl\s+set-ntp|\bmount\s+-t|\bumount\b/iu.test(value)) return "local-system";
  if (/\b(?:nc|socat)\b[^\n]*(?:-l|listen)|python3\s+-m\s+http\.server|\.\/agent\s+-connect/iu.test(value)) return "listener";
  if (/\b(?:curl|wget)\b[^\n]*(?:-o|--output)\s+['"]?\/tmp\b|\biwr\b[^\n]*-OutFile\s+['"]?C:\\Windows\\Temp\\/iu.test(value)) return "target-file";
  if (/\bmkdir\b|\btee(?:\s+-a)?\b|(?:^|\s)(?:-oA|-oN|-oX|-oJ|-outputfile)\s|\b(?:ffuf|hashcat)\b[^\n]*\s(?:-o|--outfile)\s/iu.test(value)) return "local-evidence";
  return "none";
}

function inferRisk(policy, stateChange, command) {
  if (policy === "prohibited") return "critical";
  if (stateChange === "directory-service") return "high";
  if (stateChange === "credential-attempt") return /spray|rockyou|continue-on-success/iu.test(command.value || "") ? "high" : "medium";
  if (["local-system", "network-route", "target-configuration"].includes(stateChange)) return "medium";
  if (["listener", "target-file"].includes(stateChange)) return "medium";
  return "low";
}

function cleanupFor(stateChange, itemId, command) {
  const value = String(command.value || "");
  if (stateChange === "none") return { required: false, command: "", note: "No persistent state change is expected." };
  if (stateChange === "local-evidence") return { required: false, command: "", note: "Retain this machine-scoped artifact as report evidence; delete it only after the retention requirement ends." };
  if (stateChange === "credential-attempt") return { required: false, command: "", note: "Authentication attempts cannot be rolled back. Stop immediately on lockout indicators and record the attempt." };
  if (stateChange === "listener") return { required: true, command: "Ctrl-C in the terminal that owns this process.", note: "Confirm the listening socket or agent process has stopped." };
  if (/net rpc group addmem/iu.test(value)) {
    return { required: true, command: value.replace(/group addmem/iu, "group delmem"), note: "Remove only the membership added by this command." };
  }
  if (/dacledit\s+-action\s+write/iu.test(value)) return { required: true, command: "Run the separately listed DACL restore command with the recorded backup file.", note: "Do not attempt an inferred inverse ACE." };
  if (/tee\s+-a\s+\/etc\/hosts/iu.test(value)) return { required: true, command: "sudoedit /etc/hosts", note: "Remove only the line added for this machine." };
  if (/timedatectl\s+set-ntp\s+false/iu.test(value)) return { required: true, command: "sudo timedatectl set-ntp true", note: "Restore normal Kali time synchronization after Kerberos work." };
  if (/\bmount\s+-t\s+nfs/iu.test(value)) return { required: true, command: "sudo umount '/mnt/{{targetSlug}}'", note: "Unmount the assessment export." };
  if (/\bip\s+route\s+add/iu.test(value)) return { required: true, command: "sudo ip route del {{internalSubnet}} dev {{pivotInterface}}", note: "Remove the route owned by this tunnel." };
  if (/\bip\s+tuntap\s+add/iu.test(value)) return { required: true, command: "sudo ip link del {{pivotInterface}}", note: "Delete the operator-created tunnel interface after all owned routes are removed." };
  if (stateChange === "target-file") {
    if (itemId === "access-transfer" && /powershell/iu.test(value)) return { required: true, command: "powershell -c \"Remove-Item -Force 'C:\\Windows\\Temp\\{{transferFile}}'\"", note: "Remove only the transferred file after use." };
    if (itemId === "access-transfer") return { required: true, command: "rm -f '/tmp/{{transferFile}}'", note: "Remove only the transferred file after use." };
    return { required: true, command: "Remove the exact helper and output paths created by this command.", note: "Record the deleted paths in cleanup evidence." };
  }
  if (stateChange === "network-route") return { required: true, command: "Remove the route, stop the owning session, and delete its tunnel interface in reverse order.", note: "Verify reachability has returned to the pre-pivot state." };
  return { required: true, command: "Reverse only the recorded change made by this command.", note: "Capture verification output after rollback." };
}

function verificationFor(stateChange, command) {
  const value = String(command.value || "");
  if (/net rpc group (?:addmem|delmem)/iu.test(value)) return value.replace(/group (?:addmem|delmem)\s+([^ ]+)\s+([^ ]+)/iu, "group members $1");
  if (/dacledit\s+-action\s+(?:write|restore)/iu.test(value)) return "Run the separately listed DACL read command and inspect the effective ACE.";
  if (/\bmount\s+-t\s+nfs/iu.test(value)) return "findmnt '/mnt/{{targetSlug}}'";
  if (/tee\s+-a\s+\/etc\/hosts/iu.test(value)) return "tail -n 10 /etc/hosts";
  if (/timedatectl/iu.test(value)) return "timedatectl status";
  if (stateChange === "network-route") return "ip route show {{internalSubnet}}; ip -br link show {{pivotInterface}}";
  if (stateChange === "listener") return "ss -lntp";
  if (stateChange === "target-file") return "List the exact destination path and compare its checksum with the LHOST source.";
  if (stateChange === "local-evidence") return "Confirm the intended machine-scoped evidence path exists and is non-empty.";
  if (stateChange === "credential-attempt") return "Review the single selected identity's response and lockout indicators; do not infer access from exit status.";
  return String(command.verificationCommand || command.value || "Review the command output manually.");
}

function warningFor(stateChange, risk) {
  if (stateChange === "none") return "Run only after confirming the applicability facts; exit status alone never confirms a finding.";
  const warnings = {
    "local-evidence": "Writes machine-scoped evidence on LHOST. Check the destination before running.",
    "local-system": "Changes Kali system state. Record the prior state and use the listed cleanup.",
    listener: "Starts a persistent listener or agent. Keep it operator-controlled and stop it explicitly.",
    "target-file": "Creates or changes a file on the assessed host. Verify integrity, record the path, and remove it after use.",
    "target-configuration": "Changes target configuration. Capture the prior state and an exact rollback before running.",
    "directory-service": "Changes directory state and may affect multiple hosts. Confirm the exact object/right and record a tested rollback first.",
    "network-route": "Changes route or tunnel state. Confirm route ownership and callback direction before running.",
    "credential-attempt": "Can create authentication noise or lock an account. Use one explicitly selected credential only after reviewing lockout policy.",
  };
  return `${risk.toUpperCase()} risk: ${warnings[stateChange]}`;
}

function expectedSignals(command) {
  const value = String(command.value || "");
  if (/\bnmap\b/iu.test(value)) return {
    positive: "The output names a reachable port/service or records an explicit closed/filtered state for the selected host.",
    negative: "No responsive service is observed, or routing, permission, DNS, timeout, or tool errors make the result inconclusive.",
  };
  if (/\b(?:curl|whatweb|ffuf)\b/iu.test(value)) return {
    positive: "A reviewed HTTP response differs in status, size, content, timing, or headers in a way that supports the stated check.",
    negative: "Responses are absent or equivalent, or an error prevents a controlled comparison.",
  };
  if (/\b(?:nxc|smbclient|ldapsearch|impacket-|net rpc)\b/iu.test(value)) return {
    positive: "The selected server returns an explicit, operator-reviewed authentication, object, share, policy, or permission result.",
    negative: "The server denies the request, returns no matching object, or the output is ambiguous or incomplete.",
  };
  return {
    positive: "Operator-reviewed output supports the command's stated purpose with target context visible.",
    negative: "No supporting signal is present, or an error, timeout, or contradictory result requires review.",
  };
}

function applicabilityFor(itemId, runsOn, command) {
  const facts = ["target.selected-and-in-scope", ...(SERVICE_FACTS[itemId] || [])];
  if (runsOn !== "lhost") facts.push(`${runsOn}.operator-confirmed`);
  if (/\{\{(?:password|hash)\}\}/u.test(command.value || "")) facts.push("credential.selected-and-confirmed");
  return {
    mode: "all",
    predicates: [...new Set(facts)].map((fact) => ({ fact, value: true, source: "operator-confirmed" })),
  };
}

/** Normalize a legacy `{label, value}` command without changing its UI API. */
export function createCommandRecord(item, command, index = 0) {
  const key = command.key || `${item.id}-${index}`;
  const id = command.id || `command.${item.id}.${slug(key)}`;
  const variables = extractCommandVariables(command.template || command.value);
  const needsSelectedCredential = command.requiresSelectedCredential === true
    || /\{\{(?:password|hash)\}\}/u.test(command.value || "")
    || (["creds-reuse", "pivot-ssh"].includes(item.id) && /\bssh\b/iu.test(command.value || ""))
    || /^(?:remote-|spn-tgs-|acl-|spray-|smb-download-(?!guest|directory-guest))/u.test(key);
  if (needsSelectedCredential && !variables.includes("selectedCredentialId")) variables.push("selectedCredentialId");
  const runsOn = command.runsOn || inferRunsOn(item.id, command);
  const policy = command.policy || inferPolicy(command);
  const inferredStateChange = inferStateChange(command);
  const stateChange = command.stateChange
    || (inferredStateChange === "none" && needsSelectedCredential ? "credential-attempt" : inferredStateChange);
  const resultCategory = command.resultCategory || classifyCommandResult(item.id, { ...command, key, stateChange });
  const risk = command.risk || inferRisk(policy, stateChange, command);
  const cleanup = command.cleanup || cleanupFor(stateChange, item.id, command);
  const verificationCommand = command.verificationCommand || verificationFor(stateChange, command);
  for (const name of extractCommandVariables([
    verificationCommand,
    command.cleanupCommand,
    cleanup.command,
  ].filter(Boolean).join("\n"))) {
    if (!variables.includes(name)) variables.push(name);
  }
  const expected = expectedSignals(command);
  const executionEnabled = command.executionEnabled ?? policy === "exam-core";

  return Object.freeze({
    ...command,
    id,
    key,
    title: command.title || command.label,
    label: command.label || command.title,
    purpose: command.purpose || `${command.label || "Run this command"} for the operator-selected “${item.title}” check.`,
    runsOn,
    applicability: command.applicability || applicabilityFor(item.id, runsOn, command),
    prerequisites: command.prerequisites || ["Select exactly one in-scope machine.", "Confirm every applicability predicate manually.", "Resolve and validate every required variable."],
    requiredVariables: command.requiredVariables || variables.map(requiredVariable),
    template: command.template || command.value,
    value: command.value || command.template,
    expectedPositiveSignal: command.expectedPositiveSignal || expected.positive,
    expectedNegativeSignal: command.expectedNegativeSignal || expected.negative,
    positiveBranch: command.positiveBranch || "Preserve the reviewed output and continue only with a manually selected follow-up whose prerequisites are now satisfied.",
    negativeBranch: command.negativeBranch || "Preserve the reviewed output and use a listed fallback only when the saved result and its prerequisites justify that narrower check.",
    risk,
    stateChange,
    resultCategory,
    warning: command.warning || warningFor(stateChange, risk),
    evidence: command.evidence || ["Exact rendered command", "Timestamp and selected target", "Relevant raw output", "Operator result state and conclusion"],
    sideEffects: command.sideEffects || (stateChange === "none" ? "May create normal protocol traffic and service logs." : warningFor(stateChange, risk)),
    verificationCommand,
    cleanup,
    cleanupCommand: command.cleanupCommand ?? cleanup.command,
    fallback: command.fallback || "Re-check prerequisites, scope, reachability, syntax, and the smallest protocol-specific validation before selecting another card.",
    policy,
    executionEnabled,
    instructional: command.instructional ?? !executionEnabled,
  });
}

export function normalizeChecklist(checklist) {
  return checklist.map((phase) => ({
    ...phase,
    items: phase.items.map((item) => ({
      ...item,
      commands: item.commands.map((command, index) => createCommandRecord(item, command, index)),
    })),
  }));
}

export function renderCommandRecord(record, variables = {}) {
  const rendered = renderCommandTemplate(record.template || record.value, variables);
  const auxiliary = [record.verificationCommand, record.cleanupCommand, record.cleanup?.command]
    .filter(Boolean)
    .map((template) => renderCommandTemplate(template, variables));
  const implicitMissing = (record.requiredVariables || [])
    .filter((variable) => variable.required && (variables[variable.name] === undefined || variables[variable.name] === null || variables[variable.name] === ""))
    .map((variable) => variable.name);
  const missing = [...new Set([...rendered.missing, ...auxiliary.flatMap((entry) => entry.missing), ...implicitMissing])];
  const invalid = Object.fromEntries([
    ...Object.entries(rendered.invalid || {}),
    ...auxiliary.flatMap((entry) => Object.entries(entry.invalid || {})),
  ]);
  return {
    ...rendered,
    invalid,
    missing,
    runnable: rendered.runnable && missing.length === 0 && Object.keys(invalid).length === 0 && record.executionEnabled === true,
    renderedCommand: rendered.command,
  };
}

export function auditCommandRecord(record) {
  const errors = [];
  const warnings = [];
  const requiredFields = [
    "id", "title", "purpose", "runsOn", "applicability", "prerequisites", "requiredVariables", "template",
    "expectedPositiveSignal", "expectedNegativeSignal", "positiveBranch", "negativeBranch", "risk", "stateChange", "resultCategory",
    "evidence", "sideEffects", "verificationCommand", "cleanup", "fallback", "policy",
  ];
  for (const field of requiredFields) {
    if (record[field] === undefined || record[field] === null || record[field] === "") errors.push(`${record.id || "command"}: missing ${field}`);
  }
  if (!RUNS_ON.includes(record.runsOn)) errors.push(`${record.id}: invalid runsOn ${record.runsOn}`);
  if (!COMMAND_POLICIES.includes(record.policy)) errors.push(`${record.id}: invalid policy ${record.policy}`);
  if (!COMMAND_RISKS.includes(record.risk)) errors.push(`${record.id}: invalid risk ${record.risk}`);
  if (!STATE_CHANGES.includes(record.stateChange)) errors.push(`${record.id}: invalid stateChange ${record.stateChange}`);
  if (!RESULT_CATEGORY_VALUES.includes(record.resultCategory) || record.resultCategory === "mixed") errors.push(`${record.id}: invalid resultCategory ${record.resultCategory}`);
  if (record.sessionRole !== undefined && !["general", "machine-log"].includes(record.sessionRole)) errors.push(`${record.id}: invalid sessionRole ${record.sessionRole}`);
  if (record.terminalBehavior !== undefined && !["one-shot", "interactive-shell", "existing-session-only"].includes(record.terminalBehavior)) errors.push(`${record.id}: invalid terminalBehavior ${record.terminalBehavior}`);
  if (record.requiresExistingSession && record.requiresNewSession) errors.push(`${record.id}: cannot require both a new and an existing terminal session`);
  if (record.terminalBehavior === "interactive-shell" && !record.requiresNewSession) errors.push(`${record.id}: interactive-shell behavior must require a new terminal session`);
  if (record.terminalBehavior === "existing-session-only" && !record.requiresExistingSession) errors.push(`${record.id}: existing-session-only behavior must require an existing terminal session`);
  if (record.requiresExplicitSession && !record.requiresExistingSession) errors.push(`${record.id}: explicit terminal selection requires an existing terminal session`);
  if (record.policy !== "exam-core" && record.executionEnabled) errors.push(`${record.id}: ${record.policy} commands cannot be executable`);
  const contractText = [record.template, record.verificationCommand, record.cleanupCommand, record.cleanup?.command].filter(Boolean).join("\n");
  for (const name of extractCommandVariables(contractText)) {
    if (!VARIABLE_DEFINITIONS[name]) errors.push(`${record.id}: undeclared variable ${name}`);
  }
  for (const magic of MAGIC_PLACEHOLDERS) {
    if (magic.pattern.test(contractText)) errors.push(`${record.id}: ${magic.message}`);
  }
  if (record.stateChange !== "none") {
    if (!record.warning) errors.push(`${record.id}: state-changing command needs a warning`);
    if (!record.verificationCommand) errors.push(`${record.id}: state-changing command needs verification`);
    if (record.cleanup?.required && !record.cleanup.command && !record.cleanup.note) errors.push(`${record.id}: state-changing command needs cleanup or rollback`);
  }
  const placeholders = new Set(extractCommandVariables(contractText));
  const declaredRequired = new Set((record.requiredVariables || []).map((variable) => variable.name));
  for (const name of placeholders) if (!declaredRequired.has(name)) errors.push(`${record.id}: placeholder ${name} is not in requiredVariables`);
  for (const variable of record.requiredVariables || []) {
    if (!VARIABLE_DEFINITIONS[variable.name]) errors.push(`${record.id}: required variable ${variable.name} is undeclared`);
    if (VARIABLE_DEFINITIONS[variable.name] && variable.type !== VARIABLE_DEFINITIONS[variable.name].type) errors.push(`${record.id}: variable ${variable.name} has the wrong type`);
  }
  if (record.policy === "exam-core" && /\bnmap\b[^\n]*--script\s+(?:['"])?vuln/iu.test(record.template)) errors.push(`${record.id}: broad vuln-category NSE should be re-verified rather than silently treated as exam-core`);
  if (record.requiredVariables.some((variable) => ["password", "hash"].includes(variable.name))
    && !record.requiredVariables.some((variable) => variable.name === "selectedCredentialId")) errors.push(`${record.id}: credential command needs an explicit selectedCredentialId`);
  if (record.instructional) warnings.push(`${record.id}: instructional/non-executable command`);
  return { errors, warnings };
}

export function auditCommandRecords(records) {
  const ids = new Set();
  const keys = new Set();
  const errors = [];
  const warnings = [];
  for (const record of records) {
    const result = auditCommandRecord(record);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (ids.has(record.id)) errors.push(`${record.id}: duplicate command id`);
    ids.add(record.id);
    if (keys.has(record.key)) warnings.push(`${record.key}: duplicate command key outside an item scope`);
    keys.add(record.key);
  }
  return { errors, warnings };
}

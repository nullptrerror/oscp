import { confirmedDiscoveries, guidanceForDiscoveries, visibleDiscoveries } from "./evidence.js";
import { describeCommand } from "./commandInsights.js";
import {
  commandResultReference,
  getActiveScope,
  getTargetCommandRunResultStateValue,
  getTargetItemValue,
  RESULT_STATES,
} from "./workspace.js";
import { classifyCommandResult, classifyItemResult, RESULT_CATEGORIES } from "./resultClassification.js";

const list = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
};

const GENERIC_UNCLASSIFIED_DECISION = "Use the saved output to decide whether this hypothesis was confirmed or ruled out, then choose one narrower follow-up instead of repeating broad enumeration.";
const GENERIC_CONFIRMED_DECISION = "Preserve the confirmed evidence and continue only with a narrower applicable check whose prerequisites are satisfied.";

export const isAutomaticNarrative = (value = "") => !String(value).trim() || /^(?:Draft|Attempt|Result|Derived):/.test(String(value));

const decisionForCommand = (command = "", label = "") => {
  const source = `${label} ${command}`;
  if (/nmap|masscan|rustscan/i.test(source)) return "Use confirmed open services to replace broad scanning with focused service enumeration; if nothing is reachable, verify routing and test without relying on ICMP.";
  if (/ffuf|gobuster|ferox|dirsearch|whatweb|curl|http/i.test(source)) return "Prioritize unique pages, technologies, virtual hosts, and authorization boundaries; discard responses that are only size-identical noise.";
  if (/smb|rpcclient|enum4linux|netexec|\bnxc\b/i.test(source)) return "If access is allowed, inspect readable shares, domain details, users, and password policy; if authentication is rejected, preserve the error and try only a justified identity or protocol.";
  if (/ldap|bloodhound|GetNPUsers|GetUserSPNs|kerberos|\bdig\b|ntpdate|\bnet time\b/i.test(source)) return "Use confirmed directory relationships or Kerberos material to identify the smallest credential or privilege path; correct DNS and clock issues before repeating authentication tests.";
  if (/hashcat|\bjohn\b/i.test(source)) return "Test any recovered credential once across the services already observed, record each outcome, and stop broad guessing if the candidate fails.";
  if (/evil-winrm|wmiexec|psexec|xfreerdp|\bssh\b/i.test(source)) return "After a successful session, capture identity and network context immediately, then follow the matching privilege-escalation checklist; an authentication error should redirect effort to permissions or another exposed service.";
  if (/sudo -l|SUID|getcap|cron|systemd|service|schtasks|cmdkey|unattend|history|winpeas|linpeas/i.test(source)) return "Validate only the most promising privilege boundary with a minimal manual check, then document the exact writable path, delegated right, credential, or execution condition.";
  if (/local\.txt|proof\.txt|user\.txt|root\.txt|proof|flag/i.test(source)) return "Keep the original proof path, identity, and target IP visible in one terminal, capture the screenshot immediately, and submit the value before continuing.";
  if (/listener|nc -l|socat.*listen/i.test(source)) return "Trigger the intended connection once, stabilize any returned shell, and record the target identity before running further commands.";
  return GENERIC_UNCLASSIFIED_DECISION;
};

const confirmedDecisionForCommand = (command = "", label = "") => {
  const decision = decisionForCommand(command, label);
  return decision === GENERIC_UNCLASSIFIED_DECISION ? GENERIC_CONFIRMED_DECISION : decision;
};

export function commandNarrativeDraft(command, label) {
  const insight = describeCommand(command, label);
  return {
    finding: `Attempt: ${insight.purpose} The saved output determines whether that hypothesis was confirmed or ruled out.`,
    nextStep: `Attempt: ${decisionForCommand(command, label)}`,
  };
}

export function narrativeFromDiscoveries(discoveries = [], { exitCode, command = "", label = "" } = {}) {
  const ports = discoveries.filter((entry) => entry.type === "port");
  const credentials = discoveries.filter((entry) => entry.type === "credential");
  const flags = discoveries.filter((entry) => entry.type === "flag");
  const names = discoveries.filter((entry) => ["hostname", "domain", "endpoint"].includes(entry.type));
  const tickets = discoveries.filter((entry) => ["kerberos-ticket", "ntlm-hash"].includes(entry.type));
  const shares = discoveries.filter((entry) => entry.type === "share");
  const cves = discoveries.filter((entry) => entry.type === "cve");
  const facts = [];
  if (ports.length) facts.push(`The target exposed ${list(ports.map((entry) => `${entry.service || "a service"} on ${entry.value}/${entry.protocol || "tcp"}`))}.`);
  if (names.length) facts.push(`The output identified ${list(names.map((entry) => entry.value))} as target naming or addressing context.`);
  if (shares.length) facts.push(`The server exposed the SMB share${shares.length === 1 ? "" : "s"} ${list(shares.map((entry) => entry.value))}.`);
  if (credentials.length) facts.push(`The output disclosed a usable credential candidate for ${list(credentials.map((entry) => entry.username || entry.value))}.`);
  if (tickets.length) facts.push(`The output contained credential material that could be tested offline for account access.`);
  if (cves.length) facts.push(`The output referenced ${list(cves.map((entry) => entry.value))}, which requires version-specific validation before it can be treated as exploitable.`);
  for (const flag of flags) facts.push(`The ${flag.kind === "root" ? "root/administrator" : "user-level"} proof value ${flag.value} was retrieved, confirming that access objective.`);
  if (!facts.length && exitCode !== undefined) {
    const insight = describeCommand(command, label);
    facts.push(exitCode === 0
      ? `Result: The command completed. Its purpose was: ${insight.purpose} No parser-recognized finding was produced, so the saved output must be reviewed before claiming a result.`
      : `Result: The command exited with status ${exitCode}. Its purpose was: ${insight.purpose} It did not establish the intended result.`);
  }

  const guidance = guidanceForDiscoveries(discoveries);
  const hasCommandContext = Boolean(String(command).trim() || String(label).trim());
  let nextStep = guidance.length
    ? guidance.slice(0, 2).map((entry) => entry.text).join(" ")
    : (hasCommandContext ? decisionForCommand(command, label) : "");
  const flag = flags[0];
  if (flag) nextStep = flag.kind === "root"
    ? "Preserve the complete proof screenshot now, verify the value was submitted, and document the privilege-escalation path that produced administrative access."
    : "Preserve the complete proof screenshot now, submit the value, and continue with focused privilege-escalation checks.";
  return { finding: facts.join(" "), nextStep };
}

const KNOWN_RESULT_STATES = new Set(Object.values(RESULT_STATES));
const REPORT_READY_STATES = new Set([
  RESULT_STATES.CONFIRMED,
  RESULT_STATES.NO_FINDING,
  RESULT_STATES.FAILED,
  RESULT_STATES.BLOCKED,
]);

export function commandNarrativeRole(command = {}) {
  return classifyCommandResult(command.itemId || "", command);
}

const usefulPurpose = (purpose = "", label = "") => {
  const text = String(purpose).trim();
  if (!text) return "";
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  const normalizedLabel = String(label).toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  if (normalizedLabel && normalizedText.startsWith(normalizedLabel)) return "";
  if (/\bfor the operator selected\b/iu.test(normalizedText)) return "";
  return text;
};

const confirmedCategoryFinding = (category, label, purpose) => {
  const detail = usefulPurpose(purpose, label);
  const suffix = detail ? ` ${detail}` : "";
  return ({
    [RESULT_CATEGORIES.PREPARATION]: `Operator review verified the preparation step.${suffix}`,
    [RESULT_CATEGORIES.DISCOVERY]: `Operator review confirmed a useful discovery.${suffix}`,
    [RESULT_CATEGORIES.VALIDATION]: `Operator review confirmed the tested condition.${suffix}`,
    [RESULT_CATEGORIES.ACCESS]: `Operator review confirmed access.${suffix}`,
    [RESULT_CATEGORIES.CHANGE]: `Operator review verified the controlled change.${suffix}`,
    [RESULT_CATEGORIES.CLEANUP]: `Operator review verified cleanup or restoration.${suffix}`,
    [RESULT_CATEGORIES.PROOF]: `Operator review confirmed the intended proof context.${suffix}`,
  }[category] || `Operator review confirmed the intended result.${suffix}`);
};

const negativeCategoryFinding = (category, label) => ({
  [RESULT_CATEGORIES.PREPARATION]: `Operator review determined that the preparation step “${label}” was not required or applicable.`,
  [RESULT_CATEGORIES.DISCOVERY]: `Operator review found nothing relevant in the output from “${label}”.`,
  [RESULT_CATEGORIES.VALIDATION]: `Operator review found no evidence of the condition tested by “${label}”; this step does not establish a finding.`,
  [RESULT_CATEGORIES.ACCESS]: `Operator review confirmed that “${label}” did not obtain access.`,
  [RESULT_CATEGORIES.CHANGE]: `Operator review confirmed that the intended change from “${label}” was not applied.`,
  [RESULT_CATEGORIES.CLEANUP]: `Operator review confirmed that nothing remained for “${label}” to clean or restore.`,
  [RESULT_CATEGORIES.PROOF]: `Operator review confirmed that “${label}” did not obtain the intended proof.`,
}[category] || `Operator review found no positive result for “${label}”.`);

const confirmedCategoryNextStep = (category, commandText, label) => ({
  [RESULT_CATEGORIES.PREPARATION]: "Preserve the setup evidence and continue with the first applicable machine-scoped check.",
  [RESULT_CATEGORIES.DISCOVERY]: confirmedDecisionForCommand(commandText, label),
  [RESULT_CATEGORIES.VALIDATION]: confirmedDecisionForCommand(commandText, label),
  [RESULT_CATEGORIES.ACCESS]: "Capture the new session identity and network context, then continue with the matching privilege and proof checks.",
  [RESULT_CATEGORIES.CHANGE]: "Preserve verification output, record the exact owned change, and retain its rollback before continuing.",
  [RESULT_CATEGORIES.CLEANUP]: "Preserve the cleanup verification output and confirm that no temporary assessment state remains.",
  [RESULT_CATEGORIES.PROOF]: "Preserve and manually verify the complete proof screenshot, then submit the value through the required control panel before time expires.",
}[category] || decisionForCommand(commandText, label));

const latestExitCode = (command, evidence) => {
  if (command?.exitCode !== undefined) return command.exitCode;
  return [...(evidence || [])].reverse().find((entry) => entry.exitCode !== undefined)?.exitCode;
};

const withoutAutomaticPrefix = (value = "") => String(value).replace(/^(?:Draft|Attempt|Result|Derived):\s*/, "").trim();

const LEGACY_GENERIC_CLASSIFICATION_BRANCHES = new Set([
  "Save the exact output, mark the result needs review, then manually confirm or reject the finding before another card becomes applicable.",
  "Save the exact output and choose no finding, command failed, blocked, or needs review; use a listed fallback only after confirming why it applies.",
]);

const classifiedBranch = (value = "") => {
  const branch = withoutAutomaticPrefix(value);
  return LEGACY_GENERIC_CLASSIFICATION_BRANCHES.has(branch) ? "" : branch;
};

export function deriveCommandNarrative({
  command = {},
  resultState = RESULT_STATES.REVIEW,
  evidence = [],
  discoveries = [],
} = {}) {
  const state = KNOWN_RESULT_STATES.has(resultState) ? resultState : RESULT_STATES.REVIEW;
  const commandText = command.command || command.commandText || "";
  const label = command.label || command.commandLabel || "Command";
  const context = command.reportContext || {};
  const insight = describeCommand(commandText, label);
  const purpose = context.purpose || insight.purpose;
  const role = commandNarrativeRole(command);
  const confirmed = discoveries.filter((entry) => entry?.status === "confirmed");
  const exitCode = latestExitCode(command, evidence);
  const concrete = confirmed.length
    ? narrativeFromDiscoveries(confirmed, { exitCode, command: commandText, label })
    : null;

  if (state === RESULT_STATES.CONFIRMED) {
    const established = concrete?.finding
      || confirmedCategoryFinding(role, label, purpose);
    const concreteNextStep = concrete?.nextStep === GENERIC_UNCLASSIFIED_DECISION ? "" : concrete?.nextStep;
    return {
      finding: `Derived: ${withoutAutomaticPrefix(established)}`,
      nextStep: `Derived: ${withoutAutomaticPrefix(classifiedBranch(context.positiveBranch) || concreteNextStep || confirmedCategoryNextStep(role, commandText, label))}`,
      ready: true,
      resultState: state,
      role,
      resultCategory: role,
      cleanupResolved: true,
    };
  }

  if (state === RESULT_STATES.NO_FINDING) {
    return {
      finding: `Derived: ${negativeCategoryFinding(role, label)}`,
      nextStep: `Derived: ${withoutAutomaticPrefix(classifiedBranch(context.negativeBranch) || "Use another applicable validation only when the saved negative result and its prerequisites justify that narrower follow-up.")}`,
      ready: true,
      resultState: state,
      role,
      resultCategory: role,
      cleanupResolved: true,
    };
  }

  if (state === RESULT_STATES.FAILED) {
    return {
      finding: `Derived: The “${label}” command${Number.isInteger(exitCode) ? ` exited with status ${exitCode}` : " failed"} and did not establish its intended result.`,
      nextStep: `Derived: ${role === RESULT_CATEGORIES.CLEANUP ? "Cleanup remains unresolved; correct the failure and verify rollback before finalizing the assessment." : "Resolve the execution error and repeat the same bounded check before drawing a conclusion."}`,
      ready: true,
      resultState: state,
      role,
      resultCategory: role,
      cleanupResolved: role !== RESULT_CATEGORIES.CLEANUP,
    };
  }

  if (state === RESULT_STATES.BLOCKED) {
    return {
      finding: `Derived: The “${label}” step could not be completed because a prerequisite, route, credential, or access condition was unavailable; no finding is claimed.`,
      nextStep: `Derived: ${role === RESULT_CATEGORIES.CLEANUP ? "Cleanup remains unresolved; restore the required access path or record and escalate the rollback limitation." : "Resolve the missing prerequisite or record the limitation without treating the blocked check as a negative finding."}`,
      ready: true,
      resultState: state,
      role,
      resultCategory: role,
      cleanupResolved: role !== RESULT_CATEGORIES.CLEANUP,
    };
  }

  return {
    finding: `Attempt: ${purpose} The saved output remains unclassified, so no finding is claimed.`,
    nextStep: "Attempt: Review the exact captured output and choose an explicit result state before relying on this step in the report.",
    ready: false,
    resultState: RESULT_STATES.REVIEW,
    role,
    resultCategory: role,
    cleanupResolved: role !== RESULT_CATEGORIES.CLEANUP,
  };
}

export function rollupItemResultState(commandStates = [], explicitState = "") {
  if (KNOWN_RESULT_STATES.has(explicitState) && explicitState !== RESULT_STATES.REVIEW) return explicitState;
  if (!commandStates.length || commandStates.some((state) => !KNOWN_RESULT_STATES.has(state) || state === RESULT_STATES.REVIEW)) return RESULT_STATES.REVIEW;
  const unique = new Set(commandStates);
  if ([...unique].every((state) => [RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING].includes(state))) {
    return unique.has(RESULT_STATES.CONFIRMED) ? RESULT_STATES.CONFIRMED : RESULT_STATES.NO_FINDING;
  }
  if (unique.size === 1 && unique.has(RESULT_STATES.FAILED)) return RESULT_STATES.FAILED;
  if (unique.size === 1 && unique.has(RESULT_STATES.BLOCKED)) return RESULT_STATES.BLOCKED;
  return RESULT_STATES.REVIEW;
}

const distinct = (values) => [...new Set(values.map(withoutAutomaticPrefix).filter(Boolean))];
const substantiveEvidence = (entry) => entry?.substantive !== false && Boolean(
  String(entry?.content || "").trim() || entry?.dataUrl || entry?.fileDataUrl,
);

export function deriveItemNarrative({
  item = {},
  commands = [],
  discoveries = [],
  explicitResultState = "",
  storedFinding = "",
  storedNextStep = "",
} = {}) {
  const resultState = rollupItemResultState(commands.map((entry) => entry.resultState), explicitResultState);
  const resultCategory = classifyItemResult(item, commands);
  const manualFinding = storedFinding && !isAutomaticNarrative(storedFinding) ? String(storedFinding).trim() : "";
  const manualNextStep = storedNextStep && !isAutomaticNarrative(storedNextStep) ? String(storedNextStep).trim() : "";
  const confirmed = discoveries.filter((entry) => entry?.status === "confirmed");
  const concrete = confirmed.length ? narrativeFromDiscoveries(confirmed) : null;
  const commandFindings = distinct(commands.filter((entry) => entry.ready).map((entry) => entry.finding));
  const commandDecisions = distinct(commands.filter((entry) => entry.ready).map((entry) => entry.nextStep));
  const title = item.title || "This checklist item";
  let derivedFinding = "";
  let derivedNextStep = "";

  if (resultState === RESULT_STATES.CONFIRMED) {
    derivedFinding = concrete?.finding || commandFindings.slice(0, 2).join(" ") || confirmedCategoryFinding(resultCategory, title, "");
    derivedNextStep = concrete?.nextStep || commandDecisions.at(-1) || confirmedCategoryNextStep(resultCategory, "", title);
  } else if (resultState === RESULT_STATES.NO_FINDING) {
    derivedFinding = commandFindings.slice(0, 2).join(" ") || negativeCategoryFinding(resultCategory, title);
    derivedNextStep = commandDecisions.at(-1) || "Record the negative result and choose another check only when separate evidence justifies it.";
  } else if (resultState === RESULT_STATES.FAILED) {
    derivedFinding = commandFindings.slice(0, 2).join(" ") || `${title} could not establish a result because its documented command failed.`;
    derivedNextStep = commandDecisions.at(-1) || "Resolve the execution failure before drawing a conclusion from this item.";
  } else if (resultState === RESULT_STATES.BLOCKED) {
    derivedFinding = commandFindings.slice(0, 2).join(" ") || `${title} was blocked by an unmet prerequisite or unavailable access path.`;
    derivedNextStep = commandDecisions.at(-1) || "Record the limitation and resolve the prerequisite before retrying this item.";
  } else {
    derivedFinding = `${title} still has unclassified activity; no report finding is claimed.`;
    derivedNextStep = "Classify every saved command result or record an explicit item result before finalizing the report.";
  }

  const finding = manualFinding || `Derived: ${withoutAutomaticPrefix(derivedFinding)}`;
  const nextStep = manualNextStep || `Derived: ${withoutAutomaticPrefix(derivedNextStep)}`;
  return {
    finding,
    nextStep,
    resultState,
    resultCategory,
    ready: REPORT_READY_STATES.has(resultState) && Boolean(finding && nextStep),
    manualFinding: Boolean(manualFinding),
    manualNextStep: Boolean(manualNextStep),
    cleanupResolved: commands.every((entry) => entry.cleanupResolved !== false),
  };
}

export function buildTargetNarrativeModel(workspace, items = [], targetId = workspace.activeTargetId) {
  const scope = targetId || getActiveScope(workspace);
  const belongs = (entry) => entry?.targetId ? entry.targetId === targetId : true;
  const targetDiscoveries = confirmedDiscoveries(visibleDiscoveries(
    (workspace.discoveries || []).filter((entry) => belongs(entry)),
    {
      settings: workspace.parserSettings,
      ignored: workspace.ignoredDiscoveries,
      targetId,
    },
  ));
  const itemModels = {};
  const commandModels = {};
  const activityItemIds = [];

  for (const item of items) {
    const evidence = getTargetItemValue(workspace.evidence || {}, scope, item.id, []);
    const runs = (workspace.commandHistory || []).filter((entry) => (
      belongs(entry) && entry.source === "local runner" && entry.itemId === item.id
      && evidence.some((saved) => saved.commandRunId === entry.id && substantiveEvidence(saved))
    ));
    if (!runs.length && !evidence.length) continue;
    activityItemIds.push(item.id);
    const itemDiscoveries = targetDiscoveries.filter((entry) => entry.itemId === item.id);
    const commands = runs.map((command, index) => {
      const commandEvidence = evidence.filter((entry) => entry.commandRunId === command.id);
      const evidenceIds = new Set(commandEvidence.map((entry) => entry.id));
      const resultReference = commandResultReference({ commandRunId: command.id });
      const latestMatchingRun = command.commandKey
        ? runs.filter((entry) => entry.commandKey === command.commandKey).at(-1)
        : null;
      const resultState = command.commandKey
        ? getTargetCommandRunResultStateValue(
          workspace.commandResultStates,
          scope,
          item.id,
          command.commandKey,
          resultReference,
          RESULT_STATES.REVIEW,
          { allowLegacy: latestMatchingRun?.id === command.id },
        )
        : RESULT_STATES.REVIEW;
      const model = deriveCommandNarrative({
        command,
        resultState,
        evidence: commandEvidence,
        discoveries: itemDiscoveries.filter((entry) => evidenceIds.has(entry.evidenceId)),
      });
      commandModels[command.id || `${item.id}-${index}`] = model;
      return { ...model, command, evidence: commandEvidence };
    });
    itemModels[item.id] = {
      ...deriveItemNarrative({
        item,
        commands,
        discoveries: itemDiscoveries,
        explicitResultState: getTargetItemValue(workspace.resultStates || {}, scope, item.id, ""),
        storedFinding: getTargetItemValue(workspace.notes || {}, scope, item.id, ""),
        storedNextStep: getTargetItemValue(workspace.nextSteps || {}, scope, item.id, ""),
      }),
      commands,
      evidence,
    };
  }

  return { items: itemModels, commands: commandModels, activityItemIds };
}

import { guidanceForDiscoveries } from "./evidence.js";
import { describeCommand } from "./commandInsights.js";

const list = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
};

export const isAutomaticNarrative = (value = "") => !String(value).trim() || String(value).startsWith("Draft:");

export function commandNarrativeDraft(command, label) {
  const insight = describeCommand(command, label);
  return {
    finding: `Draft: This step was used to ${insight.purpose.charAt(0).toLowerCase()}${insight.purpose.slice(1)} Replace this draft with the useful fact confirmed by the saved output.`,
    nextStep: "Draft: Use the confirmed result to rule out an unproductive path or justify the next focused test. Replace this draft with the actual decision.",
  };
}

export function narrativeFromDiscoveries(discoveries = [], { exitCode } = {}) {
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
  if (!facts.length && exitCode !== undefined) facts.push(exitCode === 0
    ? "The command completed successfully, but the parser did not identify a reportable finding; review the output and record the useful result manually."
    : `The command exited with status ${exitCode} and did not establish the intended result.`);

  const guidance = guidanceForDiscoveries(discoveries);
  let nextStep = guidance.length ? guidance.slice(0, 2).map((entry) => entry.text).join(" ") : "Review the result, record what it ruled in or out, and choose the next narrow test rather than repeating broad enumeration.";
  const flag = flags[0];
  if (flag) nextStep = flag.kind === "root"
    ? "Preserve the complete proof screenshot now, verify the value was submitted, and document the privilege-escalation path that produced administrative access."
    : "Preserve the complete proof screenshot now, submit the value, and continue with focused privilege-escalation checks.";
  return { finding: facts.join(" "), nextStep };
}

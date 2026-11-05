import { guidanceForDiscoveries } from "./evidence.js";
import { describeCommand } from "./commandInsights.js";

const list = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
};

export const isAutomaticNarrative = (value = "") => !String(value).trim() || /^(?:Draft|Attempt|Result):/.test(String(value));

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
  return "Use the saved output to decide whether this hypothesis was confirmed or ruled out, then choose one narrower follow-up instead of repeating broad enumeration.";
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
  let nextStep = guidance.length ? guidance.slice(0, 2).map((entry) => entry.text).join(" ") : decisionForCommand(command, label);
  const flag = flags[0];
  if (flag) nextStep = flag.kind === "root"
    ? "Preserve the complete proof screenshot now, verify the value was submitted, and document the privilege-escalation path that produced administrative access."
    : "Preserve the complete proof screenshot now, submit the value, and continue with focused privilege-escalation checks.";
  return { finding: facts.join(" "), nextStep };
}

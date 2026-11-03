import { ALL_ITEMS } from "../data/checklist.js";
import { visibleDiscoveries } from "./evidence.js";
import { getActiveScope, getTargetItemValue } from "./workspace.js";

const sentenceList = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length < 2) return unique[0] || "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique.at(-1)}`;
};

const portList = (values) => [...new Set(values.flatMap((value) => String(value || "").split(",")).map((value) => value.trim()).filter(Boolean))]
  .sort((left, right) => Number(left) - Number(right));

export function buildReportStarters(workspace, targetId = workspace.activeTargetId) {
  const target = workspace.targets.find((entry) => entry.id === targetId)
    || { id: null, name: workspace.variables.targetName || "the target", host: workspace.variables.rhost, domain: workspace.variables.domain, endpoints: [] };
  const scope = target.id || getActiveScope(workspace);
  const belongs = (entry) => entry.targetId ? entry.targetId === target.id : entry.targetName === target.name || entry.target === target.name;
  const commands = (workspace.commandHistory || []).filter((entry) => belongs(entry) && entry.source === "local runner");
  const discoveries = visibleDiscoveries((workspace.discoveries || []).filter(belongs), {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId: target.id,
  });
  const evidence = ALL_ITEMS.flatMap((item) => getTargetItemValue(workspace.evidence, scope, item.id, []));
  const commandItems = new Set(commands.map((entry) => entry.itemId));
  const phases = [...new Set(ALL_ITEMS.filter((item) => commandItems.has(item.id)).map((item) => item.phaseTitle.toLowerCase()))];
  const endpoints = target.endpoints?.length ? target.endpoints : [{ address: target.host || workspace.variables.rhost, hostnames: [], tcpPorts: target.port, udpPorts: target.udpPorts }];
  const addresses = [...new Set(endpoints.map((endpoint) => endpoint.address).filter(Boolean))];
  const hostnames = [...new Set(endpoints.flatMap((endpoint) => endpoint.hostnames || []).filter(Boolean))];
  const tcpPorts = portList([...endpoints.map((endpoint) => endpoint.tcpPorts), ...discoveries.filter((entry) => entry.type === "port" && entry.protocol === "tcp").map((entry) => entry.value)]);
  const udpPorts = portList([...endpoints.map((endpoint) => endpoint.udpPorts), ...discoveries.filter((entry) => entry.type === "port" && entry.protocol === "udp").map((entry) => entry.value)]);
  const accounts = (workspace.accounts || []).filter(belongs);
  const proof = getTargetItemValue(workspace.evidence, scope, "proof-artifacts", []);
  const userProof = proof.some((entry) => entry.category === "user-flag");
  const rootProof = proof.some((entry) => entry.category === "root-flag");
  const access = rootProof
    ? "Administrative/root-level access is supported by saved proof evidence."
    : userProof
      ? "Local user-level access is supported by saved proof evidence; administrative/root-level proof has not yet been saved."
      : "No user or administrative proof screenshot has been saved yet, so the final access level should not be stated as confirmed.";
  const activity = phases.length ? sentenceList(phases) : "the recorded checklist activity";
  const findingSummary = [
    tcpPorts.length ? `${tcpPorts.length} TCP port${tcpPorts.length === 1 ? "" : "s"}` : "",
    udpPorts.length ? `${udpPorts.length} UDP port${udpPorts.length === 1 ? "" : "s"}` : "",
    accounts.length ? `${accounts.length} credential${accounts.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  const executiveSummary = [
    `A penetration test was performed against ${target.name || "the target"}${addresses.length ? ` (${addresses.join(", ")})` : ""}. Recorded terminal activity covered ${activity}, with ${commands.length} command run${commands.length === 1 ? "" : "s"} and ${evidence.length} saved evidence item${evidence.length === 1 ? "" : "s"}.`,
    `${findingSummary.length ? `Parsed evidence currently records ${sentenceList(findingSummary)}. ` : ""}${access}`,
    "[Before submission: replace this line with the confirmed initial-access weakness, privilege-escalation path, and practical impact in plain language.]",
  ].join("\n\n");

  const scopeLines = [
    `- Target: ${target.name || "[target name]"}`,
    `- In-scope address${addresses.length === 1 ? "" : "es"}: ${addresses.join(", ") || "[IP address]"}`,
    hostnames.length ? `- Hostnames: ${hostnames.join(", ")}` : "",
    (target.domain || workspace.variables.domain) ? `- Domain: ${target.domain || workspace.variables.domain}` : "",
    tcpPorts.length ? `- Recorded TCP attack surface: ${tcpPorts.join(", ")}` : "",
    udpPorts.length ? `- Recorded UDP attack surface: ${udpPorts.join(", ")}` : "",
    "- Testing was limited to the listed target and operator-initiated validation. Denial-of-service and destructive actions were excluded.",
  ].filter(Boolean);

  const recommendations = [];
  recommendations.push("1. Remediate the confirmed initial-access weakness and retest the exact attack path. [Name the vulnerable service, configuration, or application flaw.]");
  if (tcpPorts.length || udpPorts.length) recommendations.push(`${recommendations.length + 1}. Restrict the exposed network services to trusted administrative sources and remove services that are not required.`);
  if (accounts.length || discoveries.some((entry) => ["credential", "ntlm-hash", "kerberos-ticket"].includes(entry.type))) recommendations.push(`${recommendations.length + 1}. Rotate recovered credentials, prevent password reuse, use unique managed service-account secrets, and review affected accounts for excessive privilege.`);
  if ([...commandItems].some((id) => id.startsWith("ad-") || id === "svc-ldap")) recommendations.push(`${recommendations.length + 1}. Harden Active Directory by enforcing least privilege, reviewing delegation and group membership, and remediating accounts exposed to Kerberos roasting.`);
  if ([...commandItems].some((id) => id.startsWith("web-"))) recommendations.push(`${recommendations.length + 1}. Apply secure input handling and authorization checks, patch the identified web components, and remove sensitive files or development artifacts from the web root.`);
  if ([...commandItems].some((id) => /privesc|linux-|windows-/.test(id))) recommendations.push(`${recommendations.length + 1}. Correct the privilege-escalation condition by tightening service, task, file, and delegated-command permissions; verify that low-privileged users cannot modify privileged execution paths.`);
  recommendations.push(`${recommendations.length + 1}. After remediation, perform a focused retest and verify that the documented commands no longer reproduce the findings.`);

  return { executiveSummary, scope: scopeLines.join("\n"), recommendations: recommendations.join("\n") };
}

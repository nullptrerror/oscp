import { visibleDiscoveries } from "./evidence.js";
import { getActiveScope, getTargetItemValue } from "./workspace.js";

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
  const commandItems = new Set(commands.map((entry) => entry.itemId));
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
    ? `The assessment showed that an attacker could take full control of ${target.name || "the target"}. With this level of access, an attacker could view or alter sensitive information, disrupt normal operations, and use the system to reach other parts of the environment.`
    : userProof
      ? `The assessment showed that an attacker could gain unauthorized user-level access to ${target.name || "the target"}. This foothold could expose information available to that user and provide a starting point for attempts to gain broader control.`
      : `Testing identified areas that require review on ${target.name || "the target"}, but the saved evidence does not yet demonstrate confirmed unauthorized access. The final report should not claim a compromise until the required proof has been captured.`;
  const credentialImpact = accounts.length
    ? "Credentials were also recovered during testing. If those credentials are reused or have excessive access, a single weakness could affect additional systems and accounts."
    : "The primary business concern is the possibility that an exposed weakness could be used to access information or capabilities beyond what an unauthenticated user should have.";

  const usedWeb = [...commandItems].some((id) => id.startsWith("web-"));
  const usedDirectory = [...commandItems].some((id) => id.startsWith("ad-") || id === "svc-ldap");
  const usedRemoteCredential = [...commandItems].some((id) => ["access-remote", "creds-reuse"].includes(id));
  const usedPrivilegeEscalation = [...commandItems].some((id) => /privesc|linux-|windows-/.test(id));
  const weakness = usedWeb
    ? "The recorded path concentrated on weaknesses exposed through the target's web application and the trust placed in data or credentials recovered from it."
    : usedDirectory
      ? "The recorded path concentrated on directory-service exposure, account relationships, and credential material that could expand an attacker's privileges."
      : usedRemoteCredential || accounts.length
        ? "The recorded path concentrated on whether recovered credentials allowed access to exposed administrative services and additional privileges."
        : "The recorded path concentrated on the target's exposed services and whether their configuration or software created a path to unauthorized access.";
  const priority = rootProof || userProof
    ? "The priority is to remove the initial access condition, rotate any exposed credentials, and correct the privilege boundary documented in the technical narrative."
    : "The priority is to validate and remediate the exposed services described in the technical narrative before they can be combined into a reliable compromise path.";

  const executiveSummary = [
    access,
    `${weakness} ${credentialImpact} ${priority}`,
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
  recommendations.push(`1. ${usedWeb ? "Patch the affected application and correct the input-validation or authorization condition that enabled the recorded access path." : usedRemoteCredential || accounts.length ? "Remove the credential exposure that enabled access, rotate the affected secrets, and prevent reuse across services." : "Patch or disable the exposed service that enabled the recorded access path and restrict it to trusted sources."}`);
  if (tcpPorts.length || udpPorts.length) recommendations.push(`${recommendations.length + 1}. Restrict the exposed network services to trusted administrative sources and remove services that are not required.`);
  if (accounts.length || discoveries.some((entry) => ["credential", "ntlm-hash", "kerberos-ticket"].includes(entry.type))) recommendations.push(`${recommendations.length + 1}. Rotate recovered credentials, prevent password reuse, use unique managed service-account secrets, and review affected accounts for excessive privilege.`);
  if (usedDirectory) recommendations.push(`${recommendations.length + 1}. Enforce least privilege in Active Directory, review delegation and group membership, and remediate accounts exposed to Kerberos roasting.`);
  if (usedPrivilegeEscalation) recommendations.push(`${recommendations.length + 1}. Correct the privilege-escalation condition by tightening service, task, file, and delegated-command permissions; verify that low-privileged users cannot modify privileged execution paths.`);
  recommendations.push(`${recommendations.length + 1}. After remediation, perform a focused retest and verify that the documented commands no longer reproduce the findings.`);

  return { executiveSummary, scope: scopeLines.join("\n"), recommendations: recommendations.join("\n") };
}

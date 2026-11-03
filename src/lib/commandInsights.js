const TOOL_INSIGHTS = [
  [/\bnmap\b/i, ["Scans the target for reachable ports, services, versions, and selected script results.", "Open or filtered ports, service fingerprints, host details, and script findings."]],
  [/\b(?:nxc|netexec)\b/i, ["Tests or enumerates a network service with the supplied target and credential arguments.", "Authentication status, host/domain details, accessible resources, users, groups, policy, or execution results."]],
  [/\bsmbclient\b/i, ["Connects to SMB to enumerate or retrieve files from the selected share.", "Available shares, directory listings, transfer status, and SMB errors."]],
  [/\bldapsearch\b/i, ["Queries LDAP with the selected base, filter, and authentication context.", "Directory objects and requested attributes such as users, groups, and naming contexts."]],
  [/\b(?:dig|nslookup|host)\b/i, ["Queries DNS using the supplied server, name, and record type.", "DNS records, delegated names, service records, or zone-transfer status."]],
  [/\bffuf\b/i, ["Fuzzes the selected URL or Host header with a wordlist to discover hidden content or names.", "Matching paths, files, parameters, or virtual hosts with response status and size information."]],
  [/\bcurl\b/i, ["Sends the specified HTTP request and preserves the response for review.", "HTTP status, headers, and response body produced by the supplied URL and request arguments."]],
  [/\bwhatweb\b/i, ["Fingerprints the selected web application and server.", "Detected technologies, headers, frameworks, versions, and other web signatures."]],
  [/\b(?:impacket-GetNPUsers|GetNPUsers\.py)\b/i, ["Checks the supplied domain users for accounts that do not require Kerberos pre-authentication.", "AS-REP material for eligible accounts and errors for users that are not roastable."]],
  [/\b(?:impacket-GetUserSPNs|GetUserSPNs\.py)\b/i, ["Enumerates service principal names and optionally requests Kerberos service tickets.", "SPN accounts, service details, and crackable TGS ticket material when available."]],
  [/\bbloodhound-python\b/i, ["Collects Active Directory relationship data for BloodHound analysis.", "A ZIP archive of users, groups, computers, sessions, ACLs, and related directory objects."]],
  [/\b(?:hashcat|john)\b/i, ["Attempts an offline password recovery operation using the supplied hash mode and wordlist.", "Cracking progress, recovered candidates, and status or error information."]],
  [/\b(?:evil-winrm|impacket-(?:wmiexec|psexec)|ssh\b|xfreerdp)\b/i, ["Attempts remote administration with the selected host and credentials.", "An authenticated session or a protocol-specific authentication, authorization, or connectivity error."]],
  [/\b(?:showmount|mount -t nfs)\b/i, ["Enumerates or mounts NFS exports from the selected host.", "Export paths, mount status, and any permission or RPC errors."]],
  [/\b(?:snmpwalk|onesixtyone)\b/i, ["Enumerates SNMP using the selected community and target.", "Valid community strings or management information exposed by the device."]],
  [/\bsearchsploit\b/i, ["Searches the local Exploit-DB index for the supplied product or version.", "Candidate exploit references and local paths; results still require manual version and code validation."]],
  [/\b(?:id|whoami)(?:\b|\s)/i, ["Captures the current identity and host context.", "User, group, privilege, hostname, operating-system, or network details requested by the command."]],
  [/\bsudo -l\b/i, ["Lists commands the current Linux account may run through sudo.", "Permitted command rules, environment restrictions, or a denial/error."]],
  [/\b(?:find|getcap|grep)\b/i, ["Searches the specified paths for files, permissions, capabilities, or matching content.", "Matching paths and values, subject to the supplied filters and permission errors."]],
  [/\b(?:systemctl|schtasks|Get-CimInstance|reg query)\b/i, ["Enumerates services, scheduled execution, or configuration relevant to privilege escalation.", "Service, task, timer, registry, ownership, and execution-path details."]],
  [/\b(?:nc|socat)\b.*\b(?:listen|lvnp|tcp-listen)\b/i, ["Starts a listener for an incoming shell or network connection.", "Connection events and interactive data received from a connecting host."]],
  [/\b(?:sha256sum|Get-FileHash)\b/i, ["Calculates cryptographic hashes for collected evidence.", "A file-to-hash inventory that can be used to verify evidence integrity."]],
];

export const exactCommandRunCount = (history = [], command = "", { targetId, targetName } = {}) => history.filter((entry) => {
  const sameTarget = targetId ? entry.targetId === targetId : entry.targetName === targetName;
  return sameTarget && entry.source === "local runner" && String(entry.command || "").trim() === String(command || "").trim();
}).length;

export function describeCommand(command = "", label = "Command") {
  const match = TOOL_INSIGHTS.find(([pattern]) => pattern.test(command));
  if (match) return { purpose: match[1][0], returns: match[1][1] };
  return {
    purpose: `Runs the “${label}” procedure with the currently rendered arguments.`,
    returns: "Standard output, standard error, and an exit status from the invoked program or shell pipeline.",
  };
}

const TEXT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 3 * 1024 * 1024;

export const mergePortLists = (existing, found) => [...new Set([
  ...String(existing || "").split(","),
  ...found,
].map((port) => port.trim()).filter((port) => /^\d{1,5}$/.test(port)))]
  .sort((a, b) => Number(a) - Number(b))
  .join(",");

const unique = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${item.protocol || ""}:${item.address || ""}:${String(item.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function parseEvidence(content = "", filename = "") {
  const text = String(content);
  const discoveries = [];
  const add = (type, value, details = {}) => {
    const clean = String(value || "").trim().replace(/[),;]+$/, "");
    if (clean) discoveries.push({ type, value: clean, ...details });
  };

  for (const match of text.matchAll(/^(\d{1,5})\/(tcp|udp)\s+(open(?:\|filtered)?)\s+([^\s]+)/gim)) {
    add("port", match[1], { protocol: match[2].toLowerCase(), state: match[3].toLowerCase(), service: match[4] });
  }
  for (const match of text.matchAll(/Ports:\s*([^\n]+)/gi)) {
    for (const port of match[1].matchAll(/(\d{1,5})\/(open(?:\|filtered)?)\/(tcp|udp)\/\/([^/]*)/gi)) {
      add("port", port[1], { protocol: port[3].toLowerCase(), state: port[2].toLowerCase(), service: port[4] || "unknown" });
    }
  }
  for (const match of text.matchAll(/\b(?:domain|realm)\s*[:=]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi)) add("domain", match[1].toLowerCase());
  for (const match of text.matchAll(/\b(?:Domain Name|DNS_Domain_Name)\s*[:=]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi)) add("domain", match[1].toLowerCase());
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 4);
    if (!/^\/\d{1,2}\b/.test(suffix) && match[0].split(".").every((part) => Number(part) <= 255)) add("ip", match[0]);
  }
  for (const match of text.matchAll(/^tun\d*\s+\S+\s+((?:\d{1,3}\.){3}\d{1,3})\/\d+/gim)) add("local-ip", match[1]);
  for (const match of text.matchAll(/^Nmap scan report for (?:(?:[^\s(]+) \()?((?:\d{1,3}\.){3}\d{1,3})\)?/gim)) add("endpoint", match[1], { confidence: "high", source: "nmap-target" });
  for (const match of text.matchAll(/^Nmap scan report for ([^\s(]+) \(((?:\d{1,3}\.){3}\d{1,3})\)/gim)) add("hostname", match[1].toLowerCase(), { address: match[2] });
  for (const match of text.matchAll(/\bName:\s*([^\s]+)[\s\S]{0,80}?\bAddress:\s*((?:\d{1,3}\.){3}\d{1,3})/gi)) add("hostname", match[1].toLowerCase(), { address: match[2] });
  for (const match of text.matchAll(/\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+(?:has address|A\s+)\s*((?:\d{1,3}\.){3}\d{1,3})\b/gi)) add("hostname", match[1].toLowerCase(), { address: match[2] });
  for (const match of text.matchAll(/\bDNS:([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi)) add("hostname", match[1].toLowerCase());
  for (const match of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*)(?::\d+)?[^\s)]*/gi)) {
    const hostname = match[1].toLowerCase();
    if (!["nmap.org", "www.nmap.org"].includes(hostname)) add("url", match[0]);
  }
  for (const match of text.matchAll(/\bCVE-\d{4}-\d{4,7}\b/gi)) add("cve", match[0].toUpperCase());
  for (const match of text.matchAll(/^Disk\|([^|\r\n]+)\|/gim)) add("share", match[1]);

  for (const match of text.matchAll(/\$krb5tgs\$\d+\$\*?([^$*:\s]+)[*$]/gi)) add("kerberos-ticket", match[0], { username: match[1], ticket: "TGS" });
  for (const match of text.matchAll(/\$krb5asrep\$\d+\$([^@:]+)@([^:]+):[^\s]+/gi)) add("kerberos-ticket", match[0], { username: match[1], domain: match[2], ticket: "AS-REP" });
  for (const match of text.matchAll(/\b[a-f0-9]{32}\b/gi)) add("ntlm-hash", match[0].toLowerCase());
  for (const match of text.matchAll(/\bcpassword\s*=\s*["']([^"']+)["']/gi)) add("gpp-cpassword", match[1]);

  for (const line of text.split(/\r?\n/)) {
    const smbIdentity = line.match(/\bSMB\s+((?:\d{1,3}\.){3}\d{1,3}).*\(name:([^\s)]+)\).*\(domain:([^\s)]+)\)/i);
    if (smbIdentity) {
      add("endpoint", smbIdentity[1], { confidence: "high", source: "smb-host" });
      add("hostname", `${smbIdentity[2]}.${smbIdentity[3]}`.toLowerCase(), { address: smbIdentity[1] });
    }
    const toolHost = line.match(/^(?:SMB|LDAP|WINRM|SSH|MSSQL|RDP)\s+((?:\d{1,3}\.){3}\d{1,3})\s+/i);
    if (toolHost) add("endpoint", toolHost[1], { confidence: "high", source: "service-host" });
    const cracked = line.match(/^\$krb5(?:tgs|asrep)\$\d+\$\*?([^$*:\s]+)[*$].*:(\S+)$/i);
    if (cracked) add("credential", `${cracked[1]}:${cracked[2]}`, { username: cracked[1], secret: cracked[2], source: filename || "Kerberos crack" });
    const explicit = line.match(/\b([A-Za-z0-9_.-]+)\\([A-Za-z0-9.$_-]+):([^\s]+)\b/);
    if (explicit && !/STATUS_LOGON_FAILURE|STATUS_ACCOUNT_LOCKED_OUT/i.test(line)) {
      add("credential", `${explicit[1]}\\${explicit[2]}:${explicit[3]}`, { domain: explicit[1], username: explicit[2], secret: explicit[3], source: filename || "command output" });
    }
    const user = line.match(/^\s*(?:user(?:name)?|samaccountname)\s*[:=]\s*([^\s,;]+)/i);
    if (user) add("user", user[1]);
    const nxcUser = line.match(/^(?:SMB|LDAP)\s+\S+\s+\d+\s+\S+\s+([A-Za-z0-9._$-]+)\s+/i);
    if (nxcUser && !/^(?:username|[-*+]+)$/i.test(nxcUser[1]) && !nxcUser[1].endsWith("$")) add("user", nxcUser[1]);
    for (const principal of line.matchAll(/\b([A-Za-z0-9][A-Za-z0-9_.-]{1,})\\([A-Za-z0-9._$-]+)\b/g)) {
      if (!principal[2].endsWith("$")) add("user", principal[2], { domain: principal[1] });
    }
    const group = line.match(/^\s*(?:group|memberof)\s*[:=]\s*(.+)$/i);
    if (group) add("group", group[1]);
  }

  const deduped = unique(discoveries);
  const classifiedAddresses = new Set(deduped.flatMap((entry) => entry.type === "endpoint" || entry.type === "local-ip" ? [entry.value] : entry.type === "hostname" && entry.address ? [entry.address] : []));
  return deduped.filter((entry) => entry.type !== "ip" || !classifiedAddresses.has(entry.value));
}

export function discoveriesForChecklistItem(itemId, discoveries, { lhost = "" } = {}) {
  const withoutLocalHost = discoveries.filter((entry) => !(["ip", "endpoint"].includes(entry.type) && entry.value === lhost));
  if (itemId === "setup-network") return withoutLocalHost.filter((entry) => entry.type !== "ip" && entry.type !== "endpoint" && entry.type !== "hostname");
  return withoutLocalHost;
}

export function formatDiscovery(discovery) {
  if (discovery.type === "hostname") return `hostname: ${discovery.value}${discovery.address ? ` -> ${discovery.address}` : ""}`;
  if (discovery.type !== "port") return `${discovery.type}: ${discovery.value}`;
  return `port: ${discovery.value}/${discovery.protocol || "?"} ${discovery.state || "open"}${discovery.service ? ` ${discovery.service}` : ""}`;
}

export function routeEvidence(filename = "", content = "", fallbackItemId = "proof-artifacts") {
  const haystack = `${filename}\n${String(content).slice(0, 12000)}`.toLowerCase();
  if (/getuserspns|krb5tgs|kerberoast|tgs\.hash/.test(haystack)) return "ad-spn-tgs";
  if (/getnpusers|krb5asrep|as-?rep/.test(haystack)) return "ad-roast";
  if (/groups\.xml|cpassword|gpp/.test(haystack)) return "svc-smb-gpp";
  if (/smbclient|netexec|\bnxc\s+smb|\\\\.*\\|smb[-_. ]/.test(haystack)) return "svc-smb";
  if (/\.gnmap|\.nmap|nmap scan report|\d+\/(?:tcp|udp)\s+open(?:\|filtered)?/.test(haystack)) return /\d+\/udp|udp[-_. ]/.test(haystack) ? "recon-udp" : "recon-tcp-detail";
  if (/ldapsearch|bloodhound|domain users|samaccountname/.test(haystack)) return "ad-enum";
  if (/winpeas|windows privilege/.test(haystack)) return "windows-helper";
  if (/linpeas|linux privilege/.test(haystack)) return "linux-context";
  if (/proof|root\.txt|local\.txt|user\.txt|flag|screenshot/.test(haystack)) return "proof-artifacts";
  if (/ffuf|gobuster|ferox|http\/|server:|<html/.test(haystack)) return "web-baseline";
  return fallbackItemId;
}

export function guidanceForDiscoveries(discoveries) {
  const steps = [];
  const tcpPorts = new Set(discoveries.filter((item) => item.type === "port" && item.protocol === "tcp").map((item) => item.value));
  const udpPorts = new Set(discoveries.filter((item) => item.type === "port" && item.protocol === "udp").map((item) => item.value));
  if (["139", "445"].some((port) => tcpPorts.has(port)) || ["137", "138"].some((port) => udpPorts.has(port))) steps.push({ itemId: "svc-smb", text: "SMB/NetBIOS is exposed: enumerate shares, users, groups, and readable files." });
  if (["389", "636", "3268", "3269"].some((port) => tcpPorts.has(port))) steps.push({ itemId: "svc-ldap", text: "LDAP is open: identify the domain and test anonymous or authenticated enumeration." });
  if (udpPorts.has("53")) steps.push({ itemId: "svc-dns", text: "DNS is open over UDP: query records, attempt a zone transfer, and capture discovered names." });
  if (["88", "123"].some((port) => udpPorts.has(port))) steps.push({ itemId: "ad-baseline", text: "Kerberos/NTP over UDP suggests Active Directory: confirm DNS, realm, and clock alignment." });
  if (["5985", "5986", "445", "22", "3389"].some((port) => tcpPorts.has(port))) steps.push({ itemId: "access-remote", text: "A remote-management path is exposed: validate each discovered credential." });
  if (discoveries.some((item) => item.type === "credential")) steps.push({ itemId: "creds-reuse", text: "A credential was parsed: save it, validate it, then reuse it deliberately across exposed services." });
  if (discoveries.some((item) => item.type === "kerberos-ticket")) steps.push({ itemId: "creds-crack", text: "A Kerberos ticket was parsed: crack the saved hash and record the result." });
  if (discoveries.some((item) => item.type === "cve")) steps.push({ itemId: "access-research", text: "A CVE identifier was parsed: verify the exact product version and research that specific issue." });
  return unique(steps.map((step) => ({ ...step, type: "guidance", value: `${step.itemId}:${step.text}` }))).map(({ type, value, ...step }) => step);
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});

export async function fileToEvidence(file) {
  if (file.size > FILE_LIMIT) throw new Error(`${file.name} is larger than 3 MB. Keep the original under /home/kali/oscp and attach a smaller excerpt or screenshot.`);
  const isImage = /^image\/(png|jpeg)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
  const isText = file.type.startsWith("text/") || /\.(txt|log|nmap|gnmap|xml|json|md|csv|lst|out|hashes?)$/i.test(file.name);
  if (isText && file.size > TEXT_LIMIT) throw new Error(`${file.name} is larger than 1 MB. Attach a useful excerpt and record the full path on disk.`);
  const content = isText ? await file.text() : "";
  const encodedFile = isText ? undefined : await fileToDataUrl(file);
  return {
    label: file.name,
    filename: file.name,
    content,
    dataUrl: isImage ? encodedFile : undefined,
    fileDataUrl: !isImage ? encodedFile : undefined,
    source: "file",
    mimeType: file.type || (isText ? "text/plain" : "application/octet-stream"),
    size: file.size,
  };
}


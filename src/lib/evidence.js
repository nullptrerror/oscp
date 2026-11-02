const TEXT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 3 * 1024 * 1024;

const unique = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${String(item.value).toLowerCase()}`;
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

  for (const match of text.matchAll(/^(\d{1,5})\/(tcp|udp)\s+open\s+([^\s]+)/gim)) {
    add("port", match[1], { protocol: match[2].toLowerCase(), service: match[3] });
  }
  for (const match of text.matchAll(/Ports:\s*([^\n]+)/gi)) {
    for (const port of match[1].matchAll(/(\d{1,5})\/open\/(tcp|udp)\/\/([^/]*)/gi)) {
      add("port", port[1], { protocol: port[2].toLowerCase(), service: port[3] || "unknown" });
    }
  }
  for (const match of text.matchAll(/\b(?:domain|realm)\s*[:=]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi)) add("domain", match[1].toLowerCase());
  for (const match of text.matchAll(/\b(?:Domain Name|DNS_Domain_Name)\s*[:=]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi)) add("domain", match[1].toLowerCase());
  for (const match of text.matchAll(/\b(?:10|127)(?:\.\d{1,3}){3}\b|\b169\.254(?:\.\d{1,3}){2}\b|\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b|\b192\.168(?:\.\d{1,3}){2}\b/g)) add("ip", match[0]);

  for (const match of text.matchAll(/\$krb5tgs\$\d+\$\*?([^$*:\s]+)[*$]/gi)) add("kerberos-ticket", match[0], { username: match[1], ticket: "TGS" });
  for (const match of text.matchAll(/\$krb5asrep\$\d+\$([^@:]+)@([^:]+):[^\s]+/gi)) add("kerberos-ticket", match[0], { username: match[1], domain: match[2], ticket: "AS-REP" });
  for (const match of text.matchAll(/\b[a-f0-9]{32}\b/gi)) add("ntlm-hash", match[0].toLowerCase());

  for (const line of text.split(/\r?\n/)) {
    const cracked = line.match(/^\$krb5(?:tgs|asrep)\$\d+\$\*?([^$*:\s]+)[*$].*:(\S+)$/i);
    if (cracked) add("credential", `${cracked[1]}:${cracked[2]}`, { username: cracked[1], secret: cracked[2], source: filename || "Kerberos crack" });
    const explicit = line.match(/\b([A-Za-z0-9_.-]+)\\([A-Za-z0-9.$_-]+):([^\s]+)\b/);
    if (explicit && !/STATUS_LOGON_FAILURE|STATUS_ACCOUNT_LOCKED_OUT/i.test(line)) {
      add("credential", `${explicit[1]}\\${explicit[2]}:${explicit[3]}`, { domain: explicit[1], username: explicit[2], secret: explicit[3], source: filename || "command output" });
    }
    const user = line.match(/^\s*(?:user(?:name)?|samaccountname)\s*[:=]\s*([^\s,;]+)/i);
    if (user) add("user", user[1]);
    const group = line.match(/^\s*(?:group|memberof)\s*[:=]\s*(.+)$/i);
    if (group) add("group", group[1]);
  }

  return unique(discoveries);
}

export function routeEvidence(filename = "", content = "", fallbackItemId = "proof-artifacts") {
  const haystack = `${filename}\n${String(content).slice(0, 12000)}`.toLowerCase();
  if (/getuserspns|krb5tgs|kerberoast|tgs\.hash/.test(haystack)) return "ad-spn-tgs";
  if (/getnpusers|krb5asrep|as-?rep/.test(haystack)) return "ad-roast";
  if (/groups\.xml|cpassword|gpp/.test(haystack)) return "svc-smb-gpp";
  if (/smbclient|netexec|\bnxc\s+smb|\\\\.*\\|smb[-_. ]/.test(haystack)) return "svc-smb";
  if (/\.gnmap|\.nmap|nmap scan report|\d+\/(?:tcp|udp)\s+open/.test(haystack)) return haystack.includes("udp") ? "recon-udp" : "recon-tcp-detail";
  if (/ldapsearch|bloodhound|domain users|samaccountname/.test(haystack)) return "ad-enum";
  if (/winpeas|windows privilege/.test(haystack)) return "windows-helper";
  if (/linpeas|linux privilege/.test(haystack)) return "linux-context";
  if (/proof|root\.txt|local\.txt|user\.txt|flag|screenshot/.test(haystack)) return "proof-artifacts";
  if (/ffuf|gobuster|ferox|http\/|server:|<html/.test(haystack)) return "web-baseline";
  return fallbackItemId;
}

export function guidanceForDiscoveries(discoveries) {
  const steps = [];
  const ports = new Set(discoveries.filter((item) => item.type === "port").map((item) => item.value));
  if (["139", "445"].some((port) => ports.has(port))) steps.push({ itemId: "svc-smb", text: "SMB is open: enumerate shares, users, groups, and readable files." });
  if (["389", "636", "3268", "3269"].some((port) => ports.has(port))) steps.push({ itemId: "svc-ldap", text: "LDAP is open: identify the domain and test anonymous or authenticated enumeration." });
  if (["5985", "5986", "445", "22", "3389"].some((port) => ports.has(port))) steps.push({ itemId: "access-remote", text: "A remote-management path is exposed: validate each discovered credential." });
  if (discoveries.some((item) => item.type === "credential")) steps.push({ itemId: "creds-reuse", text: "A credential was parsed: save it, validate it, then reuse it deliberately across exposed services." });
  if (discoveries.some((item) => item.type === "kerberos-ticket")) steps.push({ itemId: "creds-crack", text: "A Kerberos ticket was parsed: crack the saved hash and record the result." });
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


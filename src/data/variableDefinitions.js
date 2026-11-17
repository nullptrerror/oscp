const patterns = {
  host: /^(?=.{1,253}$)(?:\[[0-9a-f:.]+\]|[0-9a-f:.]+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)(?:\.(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?))*)$/iu,
  domain: /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)(?:\.(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?))*$/u,
  interface: /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,31}$/,
  port: /^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/,
  portList: /^(?:[1-9]\d{0,4})(?:-(?:[1-9]\d{0,4}))?(?:,(?:[1-9]\d{0,4})(?:-(?:[1-9]\d{0,4}))?)*$/,
  slug: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/,
  integer: /^\d+$/,
  jitter: /^\d+(?:-\d+)?$/,
  hashMode: /^\d{1,6}$/,
  scheme: /^(?:http|https)$/,
};

const define = (label, type, options = {}) => Object.freeze({ label, type, ...options });

/**
 * Canonical command-variable registry. `shell: "token"` values are accepted in
 * shell syntax only after strict validation. `shell: "quote"` values are data
 * and must always be shell quoted by the renderer.
 */
export const VARIABLE_DEFINITIONS = Object.freeze({
  workspaceRoot: define("Workspace root", "absolute-path", { shell: "quote" }),
  lhost: define("LHOST address", "host", { shell: "token" }),
  lport: define("Listener port", "port", { shell: "token" }),
  interface: define("Kali interface", "interface", { shell: "token" }),
  rhost: define("Target host", "host", { shell: "token" }),
  targetName: define("Target display name (legacy)", "display-name", { shell: "quote", deprecated: "Use targetSlug in command paths." }),
  targetSlug: define("Target filesystem slug", "slug", { shell: "token" }),
  rport: define("TCP ports (legacy)", "port-list", { shell: "token", deprecated: "Use tcpPorts or webPort." }),
  uport: define("UDP ports (legacy)", "port-list", { shell: "token", deprecated: "Use udpPorts." }),
  tcpPorts: define("TCP port collection", "port-list", { shell: "token" }),
  udpPorts: define("UDP port collection", "port-list", { shell: "token" }),
  selectedServiceHost: define("Selected service host", "host", { shell: "token" }),
  selectedServicePort: define("Selected service port", "port", { shell: "token" }),
  webScheme: define("Web scheme", "scheme", { shell: "token" }),
  webPort: define("Web port", "port", { shell: "token" }),
  vhost: define("Virtual host", "host", { shell: "token" }),
  baseUrl: define("Base URL", "url", { shell: "quote" }),
  webPath: define("Observed web path", "relative-path", { shell: "quote" }),
  webParameter: define("Observed web parameter", "http-parameter", { shell: "quote" }),
  webValue: define("Operator-supplied web value", "display-name", { shell: "quote" }),
  sessionCookie: define("Selected session cookie", "secret", { shell: "quote", sensitive: true }),
  uploadFile: define("Upload source file", "absolute-path", { shell: "quote" }),
  uploadField: define("Upload form field", "http-parameter", { shell: "quote" }),
  uploadedRemotePath: define("Returned upload path", "relative-path", { shell: "quote" }),
  domain: define("AD/DNS domain", "domain", { shell: "token" }),
  realm: define("Kerberos realm", "domain", { shell: "token" }),
  baseDn: define("LDAP base DN", "ldap-dn", { shell: "quote" }),
  dc: define("Domain controller hostname", "host", { shell: "token" }),
  dcIp: define("Domain controller IP", "host", { shell: "token" }),
  dnsServer: define("DNS server", "host", { shell: "token" }),
  user: define("Selected username", "username", { shell: "quote" }),
  selectedCredentialId: define("Selected credential", "record-id", { shell: "quote" }),
  credentialType: define("Credential type", "credential-type", { shell: "token" }),
  password: define("Selected password", "secret", { shell: "quote", sensitive: true }),
  hash: define("Selected hash", "hash", { shell: "quote", sensitive: true }),
  memberUser: define("Group member", "username", { shell: "quote" }),
  temporaryUser: define("Temporary domain user", "username", { shell: "quote" }),
  temporaryPassword: define("Temporary domain password", "secret", { shell: "quote", sensitive: true }),
  temporaryCreatorCredentialId: define("Temporary-account creator credential", "record-id", { shell: "quote" }),
  targetGroup: define("Directory group", "directory-name", { shell: "quote" }),
  aclTarget: define("ACL target", "directory-name-or-dn", { shell: "quote" }),
  aclPrincipal: define("ACL principal", "directory-name", { shell: "quote" }),
  aclRights: define("ACL rights", "acl-right", { shell: "token" }),
  dcsyncUser: define("DCSync target user", "username", { shell: "quote" }),
  bloodhoundSource: define("BloodHound source object", "directory-name", { shell: "quote" }),
  bloodhoundTarget: define("BloodHound target object", "directory-name", { shell: "quote" }),
  gppCpassword: define("GPP cpassword", "secret", { shell: "quote", sensitive: true }),
  gppXmlFile: define("Saved GPP XML", "absolute-path", { shell: "quote" }),
  smbShare: define("SMB share", "share-name", { shell: "quote" }),
  smbDirectory: define("SMB directory", "relative-path", { shell: "quote" }),
  nfsExport: define("NFS export path", "absolute-path", { shell: "quote" }),
  wordlist: define("Wordlist path", "absolute-path", { shell: "quote" }),
  exploitQuery: define("Public-exploit search query", "display-name", { shell: "quote" }),
  exploitId: define("Searchsploit exploit ID", "exploit-id", { shell: "quote" }),
  exploitFile: define("Copied exploit path", "path", { shell: "quote" }),
  compiledExploit: define("Compiled exploit output", "absolute-path", { shell: "quote" }),
  transferFile: define("Transfer filename", "filename", { shell: "token" }),
  hashesFile: define("Hash input file", "absolute-path", { shell: "quote" }),
  hashMode: define("Hashcat mode", "hash-mode", { shell: "token" }),
  sprayPassword: define("Selected spray password", "secret", { shell: "quote", sensitive: true }),
  sprayJitter: define("Spray jitter", "jitter", { shell: "token" }),
  sprayRockyouLimit: define("Spray candidate limit", "positive-integer", { shell: "token" }),
  subnet: define("Internal subnet (legacy)", "cidr", { shell: "token", deprecated: "Use internalSubnet." }),
  pivotHost: define("Pivot host", "host", { shell: "token" }),
  pivotUser: define("Pivot username", "username", { shell: "quote" }),
  pivotInterface: define("Pivot interface", "interface", { shell: "token" }),
  proxyPort: define("Proxy port", "port", { shell: "token" }),
  internalHost: define("Internal host", "host", { shell: "token" }),
  internalSubnet: define("Internal subnet", "cidr", { shell: "token" }),
  callbackHost: define("Callback host visible to target", "host", { shell: "token" }),
  userFlagName: define("User proof filename", "filename", { shell: "token" }),
  rootFlagName: define("Administrator proof filename", "filename", { shell: "token" }),
});

const hasControl = (value) => /[\u0000-\u001f\u007f]/u.test(value);
const validPortList = (value) => patterns.portList.test(value)
  && value.split(",").every((part) => part.split("-").every((port) => Number(port) >= 1 && Number(port) <= 65535));

export function validateVariableValue(name, input) {
  const definition = VARIABLE_DEFINITIONS[name];
  if (!definition) return { valid: false, error: `Unknown command variable: ${name}` };
  const value = String(input ?? "");
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: `${definition.label} is required.` };
  if (hasControl(value)) return { valid: false, error: `${definition.label} cannot contain control characters.` };

  let valid = true;
  switch (definition.type) {
    case "host": valid = patterns.host.test(trimmed); break;
    case "domain": valid = patterns.domain.test(trimmed); break;
    case "interface": valid = patterns.interface.test(trimmed); break;
    case "port": valid = patterns.port.test(trimmed); break;
    case "port-list": valid = validPortList(trimmed); break;
    case "slug": valid = patterns.slug.test(trimmed); break;
    case "scheme": valid = patterns.scheme.test(trimmed); break;
    case "positive-integer": valid = patterns.integer.test(trimmed) && Number(trimmed) > 0; break;
    case "jitter": valid = patterns.jitter.test(trimmed); break;
    case "hash-mode": valid = patterns.hashMode.test(trimmed); break;
    case "http-parameter": valid = /^[a-zA-Z0-9_.\[\]-]{1,128}$/u.test(trimmed); break;
    case "credential-type": valid = /^(?:password|nt-hash|private-key|ticket)$/u.test(trimmed); break;
    case "acl-right": valid = /^(?:All|ResetPassword|WriteMembers|DCSync)$/u.test(trimmed); break;
    case "absolute-path": valid = trimmed.startsWith("/"); break;
    case "relative-path": valid = !trimmed.startsWith("/") && !/(?:^|\/)\.\.(?:\/|$)/u.test(trimmed); break;
    // Kept token-safe so one template renders correctly in POSIX, cmd.exe,
    // and PowerShell contexts. Display names and secrets retain full Unicode
    // and punctuation support because they are always quoted as data.
    case "filename": valid = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,254}$/u.test(trimmed); break;
    case "url": {
      try {
        const parsed = new URL(trimmed);
        valid = ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
      } catch { valid = false; }
      break;
    }
    case "cidr": {
      const match = trimmed.match(/^([^/]+)\/(\d{1,3})$/u);
      valid = Boolean(match) && patterns.host.test(match[1]) && Number(match[2]) <= (match[1].includes(":") ? 128 : 32);
      break;
    }
    case "hash": valid = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64}|\$[^\s]+)$/iu.test(trimmed); break;
    case "record-id": valid = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(trimmed); break;
    case "exploit-id": valid = /^[0-9]{1,8}(?:\.[a-zA-Z0-9]+)?$/u.test(trimmed); break;
    case "path": valid = true; break;
    case "display-name":
    case "username":
    case "secret":
    case "ldap-dn":
    case "directory-name":
    case "directory-name-or-dn":
    case "share-name": valid = true; break;
    default: valid = false;
  }

  return valid
    ? { valid: true, value: definition.type === "secret" ? value : trimmed }
    : { valid: false, error: `${definition.label} is not a valid ${definition.type}.` };
}

export function requiredVariable(name) {
  const definition = VARIABLE_DEFINITIONS[name];
  if (!definition) return { name, type: "undeclared", required: true };
  return { name, type: definition.type, required: true, sensitive: Boolean(definition.sensitive) };
}

export function declaredVariableNames() {
  return new Set(Object.keys(VARIABLE_DEFINITIONS));
}

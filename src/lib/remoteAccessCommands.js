const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

const credentialCandidates = (accounts, variables) => [
  {
    id: "command-context",
    domain: variables.domain,
    username: variables.user,
    secret: variables.password?.trim() || variables.hash?.trim(),
  },
  ...accounts,
];

export function buildRemoteAccessCommands(accounts = [], variables = {}) {
  const commands = [];
  const seen = new Set();

  for (const account of credentialCandidates(accounts, variables)) {
    const username = account.username?.trim();
    const secret = account.secret?.trim();
    const domain = account.domain?.trim() ?? "";
    if (!username || !secret) continue;

    const dedupeKey = `${domain.toLowerCase()}\u0000${username.toLowerCase()}\u0000${secret}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const identity = domain ? `${domain}\\${username}` : username;
    const key = account.id ?? `${domain}-${username}`;
    const userArg = shellQuote(username);
    const secretArg = shellQuote(secret);
    const domainArg = domain ? ` -d ${shellQuote(domain)}` : "";
    const isHash = /^[a-f0-9]{32}$/i.test(secret);
    const nxcAuth = isHash ? `-u ${userArg} -H ${secretArg}` : `-u ${userArg} -p ${secretArg}`;
    const evilAuth = isHash ? `-u ${userArg} -H ${secretArg}` : `-u ${userArg} -p ${secretArg}`;
    const principal = domain ? `${domain}/${username}` : username;

    commands.push({
      key: `remote-validate-${key}`,
      label: `Validate remote protocols — ${identity}`,
      value: isHash
        ? `nxc smb {{rhost}}${domainArg} ${nxcAuth}; nxc winrm {{rhost}}${domainArg} ${nxcAuth}`
        : `nxc smb {{rhost}}${domainArg} ${nxcAuth}; nxc winrm {{rhost}}${domainArg} ${nxcAuth}; nxc ssh {{rhost}} -u ${userArg} -p ${secretArg}`,
    });

    commands.push({
      key: `remote-winrm-${key}`,
      label: `Open Evil-WinRM shell — ${identity}`,
      value: `if nc -z -w 2 {{rhost}} 5985; then evil-winrm -i {{rhost}} ${evilAuth}; elif nc -z -w 2 {{rhost}} 5986; then evil-winrm -i {{rhost}} ${evilAuth} -S -P 5986; else echo 'WinRM ports 5985/5986 are closed'; fi`,
    });

    commands.push({
      key: `remote-nxc-exec-${key}`,
      label: `NetExec SMB command (admin / Pwn3d only) — ${identity}`,
      value: `nxc smb {{rhost}}${domainArg} ${nxcAuth} -x 'whoami && hostname && ipconfig'`,
    });

    commands.push({
      key: `remote-wmi-${key}`,
      label: `Open Impacket WMI shell (admin only) — ${identity}`,
      value: isHash
        ? `impacket-wmiexec -hashes ${shellQuote(`:${secret}`)} ${shellQuote(`${principal}@{{rhost}}`)}`
        : `impacket-wmiexec ${shellQuote(`${principal}:${secret}@{{rhost}}`)}`,
    });

    if (!isHash) {
      commands.push({
        key: `remote-ssh-${key}`,
        label: `Open SSH shell if port 22 is available — ${identity}`,
        value: `ssh -o PreferredAuthentications=password ${shellQuote(`${username}@{{rhost}}`)}`,
      });
    }
  }

  return commands;
}

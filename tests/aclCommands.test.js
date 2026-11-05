import test from "node:test";
import assert from "node:assert/strict";
import { buildAclCommands } from "../src/lib/aclCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "forest",
  rhost: "10.129.95.210",
  domain: "htb.local",
  user: "svc_exchange",
  password: "Password123!",
  hash: "8846f7eaee8fb117ad06bdd830b7586c",
  aclTarget: "htb.local",
  aclPrincipal: "svc_exchange",
  aclRights: "DCSync",
  dcsyncUser: "Administrator",
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

  assert.match(combined, /-TargetIdentity 'htb\.local'.*-PrincipalIdentity 'svc_exchange'.*-Rights 'DCSync'/);
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

  assert.match(combined, /Add-DomainObjectAcl.*-TargetIdentity 'Helpdesk'.*-PrincipalIdentity 'operator'.*-Rights 'WriteMembers'/);
  assert.match(combined, /Remove-DomainObjectAcl.*-TargetIdentity 'Helpdesk'.*-PrincipalIdentity 'operator'.*-Rights 'WriteMembers'/);
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

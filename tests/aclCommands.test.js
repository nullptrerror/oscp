import test from "node:test";
import assert from "node:assert/strict";
import { buildAclCommands } from "../src/lib/aclCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "Forest",
  rhost: "10.129.95.210",
  domain: "htb.local",
  baseDn: "DC=htb,DC=local",
  user: "svc-alfresco",
  memberUser: "svc-alfresco",
  targetGroup: "Exchange Windows Permissions",
  password: "Password123!",
  hash: "8846f7eaee8fb117ad06bdd830b7586c",
  aclTarget: "htb.local",
  aclPrincipal: "svc-alfresco",
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

test("DCSync workflow uses direct group membership and Impacket from Kali", () => {
  const commands = renderedCommands();
  const combined = commands.map((command) => command.value).join("\n");
  const addAt = commands.findIndex((command) => command.key === "acl-group-add-member");
  const grantAt = commands.findIndex((command) => command.key === "acl-grant");
  const retrieveAt = commands.findIndex((command) => command.key === "acl-dcsync-impacket-password");
  const cleanupAt = commands.findIndex((command) => command.key === "acl-cleanup");

  assert.match(combined, /net rpc group members 'Exchange Windows Permissions'/);
  assert.match(combined, /net rpc group addmem 'Exchange Windows Permissions' 'svc-alfresco'/);
  assert.match(combined, /impacket-dacledit -action write -rights 'DCSync'/);
  assert.match(combined, /-principal 'svc-alfresco'/);
  assert.match(combined, /-target-dn 'DC=htb,DC=local'/);
  assert.match(combined, /stamp=\$\(date \+%Y%m%d-%H%M%S\)/);
  assert.match(combined, /dcsync-before-\$stamp\.bak/);
  assert.match(combined, /DACL modified successfully!/);
  assert.match(combined, /dcsync-latest-backup\.txt/);
  assert.match(combined, /impacket-dacledit -action restore/);
  assert.match(combined, /net rpc group delmem/);
  assert.match(combined, /impacket-secretsdump -just-dc-user 'Administrator'/);
  assert.doesNotMatch(combined, /PowerView|powershell|nxc winrm|EncodedCommand/);
  assert.ok(addAt >= 0 && grantAt > addAt && retrieveAt > grantAt && cleanupAt > retrieveAt);
});

test("non-DCSync rights map All to Impacket FullControl and use a named target", () => {
  const commands = renderedCommands({ aclTarget: "Helpdesk", aclPrincipal: "operator", aclRights: "All", targetGroup: "" });
  const combined = commands.map((command) => command.value).join("\n");

  assert.match(combined, /-rights 'FullControl'/);
  assert.match(combined, /-target 'Helpdesk'/);
  assert.doesNotMatch(combined, /group addmem|secretsdump|lsadump::dcsync/);
});

test("DCSync for a different ACL principal omits credential-bound Impacket retrieval", () => {
  const commands = renderedCommands({ aclPrincipal: "other-user" });
  assert.ok(commands.some((command) => command.key === "acl-dcsync-mimikatz"));
  assert.equal(commands.some((command) => command.key.startsWith("acl-dcsync-impacket")), false);
});

test("unsupported rights produce a validation command", () => {
  const commands = renderedCommands({ aclRights: "arbitrary-right" });
  assert.deepEqual(commands.map((command) => command.key), ["acl-invalid-right"]);
  assert.match(commands[0].value, /All, ResetPassword, WriteMembers, DCSync/);
});

test("DCSync rejects a user ACL target and directs the operator to the domain", () => {
  const commands = renderedCommands({ aclTarget: "svc-alfresco" });
  assert.deepEqual(commands.map((command) => command.key), ["acl-invalid-dcsync-target"]);
  assert.match(commands[0].value, /Set ACL TARGET to htb\.local, not svc-alfresco/);
});

test("hash-only authentication uses Impacket hashes and Samba pw-nt-hash", () => {
  const commands = renderedCommands({ password: "" });
  const combined = commands.map((command) => command.value).join("\n");

  assert.match(combined, /-hashes ':8846f7eaee8fb117ad06bdd830b7586c'/);
  assert.match(combined, /--pw-nt-hash/);
  assert.match(combined, /htb\.local\/svc-alfresco%8846f7eaee8fb117ad06bdd830b7586c/);
});

test("shell-quotes passwords containing apostrophes", () => {
  const commands = renderedCommands({ password: "Winter'2026!" });
  const grant = commands.find((command) => command.key === "acl-grant");
  assert.match(grant.value, /Winter'"'"'2026!/);
});

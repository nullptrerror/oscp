import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { getChecklistCommands } from "../src/lib/checklistCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

test("generated account commands stay isolated to the active target", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.variables.targetName = "alpha";
  workspace.accounts = [
    { id: "a", targetId: "target-a", domain: "alpha.local", username: "alice", secret: "AlphaPassword!" },
    { id: "b", targetId: "target-b", domain: "beta.local", username: "bob", secret: "BetaPassword!" },
  ];
  const smb = ALL_ITEMS.find((item) => item.id === "svc-smb");
  const rendered = getChecklistCommands(smb, workspace).map((command) => command.value).join("\n");

  assert.match(rendered, /AlphaPassword!/);
  assert.doesNotMatch(rendered, /BetaPassword!/);
});

test("WriteDACL checklist commands regenerate from the active ACL selections", () => {
  const workspace = createDefaultWorkspace();
  workspace.variables = {
    ...workspace.variables,
    domain: "corp.local",
    user: "operator",
    password: "Password1!",
    aclTarget: "Helpdesk",
    aclPrincipal: "alice",
    aclRights: "ResetPassword",
  };
  const item = ALL_ITEMS.find((candidate) => candidate.id === "ad-domain-writedacl");
  const commands = getChecklistCommands(item, workspace);
  const generated = commands.find((command) => command.key === "acl-grant");
  const confirmation = commands.find((command) => command.key === "acl-powerview-check");

  assert.match(generated.label, /Grant ResetPassword.*alice on Helpdesk/);
  assert.match(generated.value, /Get-DomainObject -Identity .*\{\{aclTarget\}\}.*-Properties distinguishedName/);
  assert.match(generated.value, /-TargetIdentity \$ResolvedTarget.*-Rights .*ResetPassword/);
  assert.match(generated.value, /nxc winrm \{\{rhost\}\}.*-X/);
  assert.match(confirmation.label, /PowerView over WinRM/);
  assert.equal(commands.some((command) => command.key?.startsWith("acl-dcsync")), false);
});

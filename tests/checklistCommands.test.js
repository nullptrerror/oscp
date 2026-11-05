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
    rhost: "10.0.0.10",
    aclTarget: "Helpdesk",
    aclPrincipal: "alice",
    aclRights: "ResetPassword",
  };
  const item = ALL_ITEMS.find((candidate) => candidate.id === "ad-domain-writedacl");
  const commands = getChecklistCommands(item, workspace);
  const generated = commands.find((command) => command.key === "acl-grant");

  assert.match(generated.label, /Grant ResetPassword.*alice on Helpdesk/);
  assert.match(generated.value, /impacket-dacledit -action write -rights 'ResetPassword'/);
  assert.match(generated.value, /-target 'Helpdesk'/);
  assert.match(generated.value, /-principal 'alice'/);
  assert.doesNotMatch(generated.value, /PowerView|nxc winrm|EncodedCommand/);
  assert.equal(commands.some((command) => command.key?.startsWith("acl-dcsync")), false);
});

test("BloodHound path commands regenerate from the active path selections", () => {
  const workspace = createDefaultWorkspace();
  workspace.variables = {
    ...workspace.variables,
    domain: "corp.local",
    user: "operator",
    bloodhoundSource: "alice",
    bloodhoundTarget: "DC01.corp.local",
  };
  const item = ALL_ITEMS.find((candidate) => candidate.id === "ad-bloodhound-paths");
  const commands = getChecklistCommands(item, workspace);

  assert.equal(commands.length, 3);
  assert.match(commands[0].value, /ALICE@CORP\.LOCAL/);
  assert.match(commands[0].value, /DC01\.CORP\.LOCAL/);
  assert.doesNotMatch(commands[0].value, /DC01\.CORP\.LOCAL@CORP\.LOCAL/);
  assert.match(commands[0].value, /shortestPath/);
});

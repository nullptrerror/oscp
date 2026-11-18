import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { getChecklistCommands } from "../src/lib/checklistCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const item = (id) => ALL_ITEMS.find((entry) => entry.id === id);

test("anonymous AD enumeration preserves separate RPC and LDAP evidence", () => {
  const smb = item("svc-smb").commands;
  const ldap = item("svc-ldap").commands;
  const enumUsers = smb.find((command) => /enumdomusers/.test(command.template));
  const displayInfo = smb.find((command) => /querydispinfo/.test(command.template));
  const ldapUsers = ldap.find((command) => /anonymous-users\.txt/.test(command.template));

  assert.ok(enumUsers);
  assert.ok(displayInfo);
  assert.ok(ldapUsers);
  assert.match(enumUsers.template, /rpcclient -N -U ''/);
  assert.match(enumUsers.template, /enumdomusers\.txt/);
  assert.match(displayInfo.template, /querydispinfo\.txt/);
  assert.match(ldapUsers.template, /sAMAccountName memberOf/);
  assert.ok([enumUsers, displayInfo, ldapUsers].every((command) => command.stateChange === "local-evidence"));
});

test("AS-REP request and offline cracking remain separate operator steps", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.variables = {
    ...workspace.variables,
    targetName: "Directory target",
    targetSlug: "directory-target",
    rhost: "192.0.2.10",
    domain: "example.test",
  };
  workspace.targets = [{ id: "target-a", name: "Directory target", host: "192.0.2.10" }];
  workspace.discoveries = [{ targetId: "target-a", target: "Directory target", type: "user", value: "svc-web", status: "confirmed" }];

  const commands = getChecklistCommands(item("ad-roast"), workspace);
  const request = commands.find((command) => /GetNPUsers/.test(command.template));
  const preflight = commands.find((command) => /wc -l '\{\{wordlist\}\}'/.test(command.template));
  const hashcat = commands.find((command) => /hashcat -m 18200/.test(command.template));
  const john = commands.find((command) => /john --format=krb5asrep/.test(command.template));

  assert.ok(request);
  assert.ok(preflight);
  assert.ok(hashcat);
  assert.ok(john);
  assert.doesNotMatch(request.template, /hashcat -m|john --format/);
  assert.doesNotMatch(hashcat.template, /GetNPUsers/);
  assert.doesNotMatch(john.template, /GetNPUsers/);
  assert.match(request.template, /-usersfile "\$users_file"/);
  assert.match(hashcat.template, /asrep\.hashes/);
  assert.match(john.template, /asrep\.hashes/);
  assert.match(hashcat.template, /'\{\{wordlist\}\}'/);
  assert.match(john.template, /--wordlist='\{\{wordlist\}\}'/);
  assert.equal((hashcat.template.match(/--potfile-path "\$potfile"/g) || []).length, 2);
  assert.equal((john.template.match(/--pot="\$potfile"/g) || []).length, 2);
  assert.match(hashcat.template, /\{\{workspaceRoot\}\}\/\{\{targetSlug\}\}\/loot\/kerberos\/asrep/);
  assert.match(john.template, /\{\{workspaceRoot\}\}\/\{\{targetSlug\}\}\/loot\/kerberos\/asrep/);
  assert.doesNotMatch(hashcat.template, /sudo|gzip|rockyou/);
  assert.doesNotMatch(john.template, /sudo|gzip|rockyou/);
});

test("temporary domain account fallback is explicit, separate, and reversible", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.targets = [{ id: "target-a", name: "Directory target", host: "192.0.2.10" }];
  workspace.accounts = [
    { id: "creator-id", targetId: "target-a", domain: "example.test", username: "creator", secret: "Synthetic-Creator-42!" },
    { id: "temporary-id", targetId: "target-a", domain: "example.test", username: "fieldnotes-temp", secret: "Synthetic-Temporary-42!" },
  ];
  workspace.selectedCredentials = { "target-a": "creator-id" };
  workspace.variables = {
    ...workspace.variables,
    rhost: "192.0.2.10",
    domain: "example.test",
    temporaryUser: "fieldnotes-temp",
    temporaryPassword: "Synthetic-Temporary-42!",
    temporaryCreatorCredentialId: "creator-id",
  };
  const commands = getChecklistCommands(item("ad-temporary-user"), workspace);
  const create = commands.find((command) => command.label === "Create one temporary domain user");
  const verify = commands.find((command) => command.label === "Verify temporary domain user");
  const remove = commands.find((command) => command.label === "Cleanup: delete temporary domain user");

  assert.ok(create);
  assert.ok(verify);
  assert.ok(remove);
  assert.match(create.template, /net rpc user add/);
  assert.match(create.template, /\{\{temporaryUser\}\}.*\{\{temporaryPassword\}\}/);
  assert.match(create.template, /example\.test\/creator%Synthetic-Creator-42!/);
  assert.match(create.template, /test '\{\{selectedCredentialId\}\}' = 'creator-id'/);
  assert.equal(create.stateChange, "directory-service");
  assert.equal(create.cleanup.required, true);
  assert.match(create.cleanup.command, /net rpc user delete/);
  assert.match(verify.template, /net rpc user info/);
  assert.match(remove.template, /net rpc user delete/);
  assert.doesNotMatch(create.template, /group addmem|dacledit|secretsdump/);
  assert.doesNotMatch(remove.template, /group delmem|dacledit/);
  assert.ok(create.requiredVariables.some((variable) => variable.name === "selectedCredentialId"));
  assert.ok(create.requiredVariables.some((variable) => variable.name === "temporaryPassword" && variable.sensitive));
});

test("temporary account cleanup requires reselecting the original creator", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.targets = [{ id: "target-a", name: "Directory target", host: "192.0.2.10" }];
  workspace.accounts = [
    { id: "creator-id", targetId: "target-a", domain: "example.test", username: "creator", secret: "Synthetic-Creator-42!" },
    { id: "temporary-id", targetId: "target-a", domain: "example.test", username: "fieldnotes-temp", secret: "Synthetic-Temporary-42!" },
  ];
  workspace.variables = {
    ...workspace.variables,
    rhost: "192.0.2.10",
    temporaryUser: "fieldnotes-temp",
    temporaryPassword: "Synthetic-Temporary-42!",
    temporaryCreatorCredentialId: "creator-id",
  };

  workspace.selectedCredentials = { "target-a": "temporary-id" };
  const blocked = getChecklistCommands(item("ad-temporary-user"), workspace);
  const blockedCleanup = blocked.find((command) => command.key === "temporary-user-delete");
  assert.equal(blockedCleanup.executionEnabled, false);
  assert.match(blockedCleanup.disabledReason, /Reselect the recorded creator credential/);
  assert.match(blockedCleanup.template, /creator%Synthetic-Creator-42!/);
  assert.doesNotMatch(blockedCleanup.template, /fieldnotes-temp%Synthetic-Temporary-42!/);

  workspace.selectedCredentials = { "target-a": "creator-id" };
  const enabled = getChecklistCommands(item("ad-temporary-user"), workspace);
  assert.equal(enabled.find((command) => command.key === "temporary-user-delete").executionEnabled, true);
});

test("temporary account lifecycle stays disabled without a confirmed domain", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.targets = [{ id: "target-a", name: "Directory target", host: "192.0.2.10" }];
  workspace.accounts = [{ id: "creator-id", targetId: "target-a", username: "creator", secret: "Synthetic-Creator-42!" }];
  workspace.selectedCredentials = { "target-a": "creator-id" };
  workspace.variables = {
    ...workspace.variables,
    rhost: "192.0.2.10",
    temporaryUser: "fieldnotes-temp",
    temporaryPassword: "Synthetic-Temporary-42!",
    temporaryCreatorCredentialId: "creator-id",
  };

  const [instruction] = getChecklistCommands(item("ad-temporary-user"), workspace);
  assert.equal(instruction.executionEnabled, false);
  assert.match(instruction.disabledReason, /confirmed domain/);
});

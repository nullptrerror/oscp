import test from "node:test";
import assert from "node:assert/strict";
import { buildUsersFileCommand, trackedUsernames } from "../src/lib/userCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { getChecklistCommands } from "../src/lib/checklistCommands.js";

test("tracked users combine accounts, parsed users, and manual users for only the active target", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.variables.targetName = "active";
  workspace.variables.user = "SVC_TGS";
  workspace.accounts = [{ targetId: "active", username: "Administrator" }, { targetId: "other", username: "ignore-me" }];
  workspace.users = [{ targetId: "active", username: "alice" }];
  workspace.discoveries = [{ targetId: "active", type: "user", value: "bob" }];

  assert.deepEqual(trackedUsernames(workspace), ["Administrator", "alice", "bob", "SVC_TGS"]);
  const command = buildUsersFileCommand(workspace).value;
  assert.match(command, /\/loot\/users\.txt/);
  assert.match(command, /'Administrator'.*'alice'.*'bob'.*'SVC_TGS'/);
  assert.doesNotMatch(command, /ignore-me/);

  const roast = ALL_ITEMS.find((item) => item.id === "ad-roast");
  const combined = getChecklistCommands(roast, workspace)[1].value;
  assert.match(combined, /printf '%s\\n'.*Administrator.*SVC_TGS/);
  assert.match(combined, /impacket-GetNPUsers/);
  assert.match(combined, /-usersfile "\$users_file"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildSprayCommands } from "../src/lib/sprayCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

test("spray commands use only the explicitly selected credential", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.variables.targetName = "active";
  workspace.accounts = [
    { targetId: "active", username: "alice", secret: "Password1!" },
    { targetId: "active", username: "admin", secret: "8846f7eaee8fb117ad06bdd830b7586c" },
    { targetId: "other", username: "ignore", secret: "OtherPassword!" },
  ];
  const selected = { id: "selected", targetId: "active", username: "alice", secret: "Password1!" };
  const commands = buildSprayCommands(workspace, selected);
  const rendered = commands.map((command) => command.value).join("\n");
  assert.match(rendered, /loot\/users\.txt/);
  assert.match(rendered, /Password1!/);
  assert.doesNotMatch(rendered, /8846f7eaee8fb117ad06bdd830b7586c/);
  assert.doesNotMatch(rendered, /OtherPassword/);
  assert.match(rendered, /--jitter \{\{sprayJitter\}\}/);
  assert.doesNotMatch(rendered, /rockyou|passwords\.txt|hashes\.txt/iu);
  assert.match(rendered, /--log/);
});

test("spray commands are absent without an explicit selected account", () => {
  assert.deepEqual(buildSprayCommands(createDefaultWorkspace()), []);
});

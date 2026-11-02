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

import test from "node:test";
import assert from "node:assert/strict";
import { buildBloodHoundCommands } from "../src/lib/bloodhoundCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "Directory Lab",
  domain: "corp.test",
  user: "operator",
  bloodhoundSource: "operator",
  bloodhoundTarget: "DOMAIN ADMINS@CORP.TEST",
};

test("BloodHound commands create exact and high-value shortest-path queries", () => {
  const commands = buildBloodHoundCommands(variables).map((command) => ({
    ...command,
    value: renderCommand(command.value, variables).command,
  }));
  const combined = commands.map((command) => command.value).join("\n");

  assert.equal(commands.length, 3);
  assert.match(combined, /OPERATOR@CORP\.TEST/);
  assert.match(combined, /DOMAIN ADMINS@CORP\.TEST/);
  assert.match(combined, /shortestPath\(\(s\)-\[\*1\.\.\]->\(t\)\)/);
  assert.match(combined, /t\.highvalue = true/);
  assert.match(combined, /s\.owned = true/);
  assert.match(combined, /notes\/bloodhound\/shortest-to-target\.cypher/);
});

test("BloodHound source defaults to the active account and target defaults to Domain Admins", () => {
  const commands = buildBloodHoundCommands({ domain: "corp.test", user: "alice" });
  assert.match(commands[0].label, /ALICE@CORP\.TEST to DOMAIN ADMINS@CORP\.TEST/);
});

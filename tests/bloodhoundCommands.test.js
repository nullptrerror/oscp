import test from "node:test";
import assert from "node:assert/strict";
import { buildBloodHoundCommands } from "../src/lib/bloodhoundCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "Forest",
  domain: "htb.local",
  user: "svc-alfresco",
  bloodhoundSource: "svc-alfresco",
  bloodhoundTarget: "DOMAIN ADMINS@HTB.LOCAL",
};

test("BloodHound commands create exact and high-value shortest-path queries", () => {
  const commands = buildBloodHoundCommands(variables).map((command) => ({
    ...command,
    value: renderCommand(command.value, variables).command,
  }));
  const combined = commands.map((command) => command.value).join("\n");

  assert.equal(commands.length, 3);
  assert.match(combined, /SVC-ALFRESCO@HTB\.LOCAL/);
  assert.match(combined, /DOMAIN ADMINS@HTB\.LOCAL/);
  assert.match(combined, /shortestPath\(\(s\)-\[\*1\.\.\]->\(t\)\)/);
  assert.match(combined, /t\.highvalue = true/);
  assert.match(combined, /s\.owned = true/);
  assert.match(combined, /notes\/bloodhound\/shortest-to-target\.cypher/);
});

test("BloodHound source defaults to the active account and target defaults to Domain Admins", () => {
  const commands = buildBloodHoundCommands({ domain: "htb.local", user: "alice" });
  assert.match(commands[0].label, /ALICE@HTB\.LOCAL to DOMAIN ADMINS@HTB\.LOCAL/);
});

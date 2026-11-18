import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { buildKerberosTicketCommands, buildSpnTgsCommands } from "../src/lib/kerberosCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const occurrenceCount = (value, pattern) => [...String(value).matchAll(pattern)].length;

const assertTargetScopedPotfiles = (value, label) => {
  const hashcatRuns = occurrenceCount(value, /\bhashcat\s+-m\b/gu);
  const johnRuns = occurrenceCount(value, /\bjohn\s+--/gu);

  if (hashcatRuns) {
    assert.match(value, /\{\{workspaceRoot\}\}\/\{\{targetSlug\}\}\/loot\//u, `${label} must keep Hashcat state under the selected target`);
    assert.equal(occurrenceCount(value, /--potfile-path\s+"\$potfile"/gu), hashcatRuns, `${label} must give every Hashcat invocation the target potfile`);
    assert.match(value, /potfile="?\$loot\/hashcat\.potfile"?/u, `${label} must not use Hashcat's global potfile`);
  }

  if (johnRuns) {
    assert.match(value, /\{\{workspaceRoot\}\}\/\{\{targetSlug\}\}\/loot\//u, `${label} must keep John state under the selected target`);
    assert.equal(occurrenceCount(value, /--pot="\$potfile"/gu), johnRuns, `${label} must give every John invocation the target potfile`);
    assert.match(value, /potfile="?\$loot\/john\.pot"?/u, `${label} must not use John's global potfile`);
  }
};

test("all static cracking cards isolate crack and show state per target", () => {
  const crackingCards = ALL_ITEMS.flatMap((item) => item.commands)
    .filter((command) => /\bhashcat\s+-m\b|\bjohn\s+--(?:format|pot|wordlist)/u.test(command.template));

  assert.ok(crackingCards.length >= 4);
  for (const command of crackingCards) assertTargetScopedPotfiles(command.template, command.label);
});

test("generated SPN/TGS cracking cards isolate crack and show state per target", () => {
  const commands = buildSpnTgsCommands([], {
    domain: "example.test",
    user: "svc-kerberos",
    password: "Synthetic-Only-42!",
  }).filter((command) => /\b(?:hashcat|john)\b/u.test(command.value));

  assert.equal(commands.length, 2);
  for (const command of commands) assertTargetScopedPotfiles(command.value, command.label);
});

test("generated parsed-ticket cracking cards isolate crack and show state per target", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.variables.targetName = "Directory target";
  workspace.discoveries = [{
    targetId: "target-a",
    type: "kerberos-ticket",
    status: "confirmed",
    username: "svc-roastable",
    domain: "EXAMPLE.TEST",
    ticket: "AS-REP",
    value: "$krb5asrep$23$svc-roastable@EXAMPLE.TEST:0123456789abcdef$abcdef",
  }];

  const commands = buildKerberosTicketCommands(workspace)
    .filter((command) => /\b(?:hashcat|john)\b/u.test(command.value));

  assert.equal(commands.length, 2);
  for (const command of commands) assertTargetScopedPotfiles(command.value, command.label);
});

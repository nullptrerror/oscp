import test from "node:test";
import assert from "node:assert/strict";
import { buildSpnTgsCommands } from "../src/lib/kerberosCommands.js";

test("SPN TGS commands organize active credentials under target loot", () => {
  const commands = buildSpnTgsCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "GPPstillStandingStrong2k18",
  });

  assert.equal(commands.length, 2);
  assert.match(commands[0].value, /impacket-GetUserSPNs/);
  assert.match(commands[0].value, /active\.htb\/SVC_TGS:GPPstillStandingStrong2k18/);
  assert.match(commands[0].value, /\{\{workspaceRoot\}\}\/\{\{targetName\}\}\/loot\/kerberos\/spn_tgs\/active\.htb_SVC_TGS/);
  assert.match(commands[0].value, /tgs\.hashes/);
  assert.match(commands[0].value, /spn-enumeration\.txt/);
});

test("SPN TGS cracking selects the hash mode and saves cracked results", () => {
  const [, crack] = buildSpnTgsCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "Password1!",
  });

  assert.match(crack.value, /mode=13100/);
  assert.match(crack.value, /mode=19600/);
  assert.match(crack.value, /mode=19700/);
  assert.match(crack.value, /cracked\.txt/);
});

test("SPN TGS commands support NT hashes and deduplicate credentials", () => {
  const account = {
    domain: "corp.local",
    username: "operator",
    secret: "8846f7eaee8fb117ad06bdd830b7586c",
  };
  const commands = buildSpnTgsCommands([account], {
    domain: account.domain,
    user: account.username,
    hash: account.secret,
  });

  assert.equal(commands.length, 2);
  assert.match(commands[0].value, /-hashes ':8846f7eaee8fb117ad06bdd830b7586c'/);
});

test("SPN TGS commands require a complete domain credential", () => {
  assert.deepEqual(buildSpnTgsCommands([], { user: "user", password: "pass" }), []);
  assert.deepEqual(buildSpnTgsCommands([], { domain: "corp.local", user: "user" }), []);
});

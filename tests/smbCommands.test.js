import test from "node:test";
import assert from "node:assert/strict";
import { buildSmbDownloadCommands } from "../src/lib/smbCommands.js";

test("SMB commands include all-shares and one-directory variants per identity", () => {
  const commands = buildSmbDownloadCommands([
    { id: "one", domain: "corp.local", username: "alice", secret: "Password1!" },
    { id: "two", domain: "", username: "bob", secret: "" },
  ]);

  assert.equal(commands.length, 4);
  assert.match(commands[0].label, /guest/);
  assert.match(commands[0].value, /\{ smbclient -g -L .* -N .* \| awk/);
  assert.match(commands[0].value, /-N -c 'recurse ON; prompt OFF; mget \*' \|\| smbclient/);
  assert.match(commands[1].label, /one directory.*guest/i);
  assert.match(commands[1].value, /\{\{smbShare\}\}/);
  assert.match(commands[1].value, /-D '\{\{smbDirectory\}\}'/);
  assert.match(commands[2].label, /corp\.local\\alice/);
  assert.match(commands[2].value, /loot\/smb\/corp\.local_alice/);
  assert.match(commands[2].value, /recurse ON; prompt OFF; mget \*/);
  assert.match(commands[3].label, /one directory.*corp\.local\\alice/i);
});

test("SMB commands include the current command-context credential", () => {
  const commands = buildSmbDownloadCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "GPPstillStandingStrong2k18",
  });

  assert.equal(commands.length, 4);
  assert.match(commands[2].label, /active\.htb\\SVC_TGS/);
  assert.match(commands[2].value, /active\.htb\/SVC_TGS%GPPstillStandingStrong2k18/);
  assert.match(commands[2].value, /loot\/smb\/active\.htb_SVC_TGS/);
  assert.match(commands[3].value, /\{\{smbShare\}\}/);
});

test("SMB commands deduplicate command-context and saved credentials", () => {
  const account = { domain: "active.htb", username: "SVC_TGS", secret: "Password1!" };
  const commands = buildSmbDownloadCommands([account], {
    domain: account.domain,
    user: account.username,
    password: account.secret,
  });

  assert.equal(commands.length, 4);
});

test("SMB command generation deduplicates credentials and supports NT hashes", () => {
  const hash = "8846f7eaee8fb117ad06bdd830b7586c";
  const account = { domain: "CORP", username: "admin", secret: hash };
  const commands = buildSmbDownloadCommands([account, { ...account, id: "duplicate" }]);

  assert.equal(commands.length, 4);
  assert.match(commands[2].value, /--pw-nt-hash/);
  assert.match(commands[3].value, /--pw-nt-hash/);
});

test("SMB credentials containing apostrophes are shell quoted", () => {
  const commands = buildSmbDownloadCommands([
    { domain: "lab", username: "o'connor", secret: "pa'ss" },
  ]);

  const command = commands[2];
  assert.ok(commands[0]);
  assert.match(command.value, /o'\"'\"'connor/);
  assert.match(command.value, /pa'\"'\"'ss/);
});

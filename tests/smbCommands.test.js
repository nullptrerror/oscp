import test from "node:test";
import assert from "node:assert/strict";
import { buildSmbDownloadCommands } from "../src/lib/smbCommands.js";

test("SMB commands always include guest and add one command per credential", () => {
  const commands = buildSmbDownloadCommands([
    { id: "one", domain: "corp.local", username: "alice", secret: "Password1!" },
    { id: "two", domain: "", username: "bob", secret: "" },
  ]);

  assert.equal(commands.length, 2);
  assert.match(commands[0].label, /guest/);
  assert.match(commands[0].value, /\{ smbclient -g -L .* -N .* \| awk/);
  assert.match(commands[0].value, /-N -c 'recurse ON; prompt OFF; mget \*' \|\| smbclient/);
  assert.match(commands[1].label, /corp\.local\\alice/);
  assert.match(commands[1].value, /loot\/smb\/corp\.local_alice/);
  assert.match(commands[1].value, /recurse ON; prompt OFF; mget \*/);
});

test("SMB command generation deduplicates credentials and supports NT hashes", () => {
  const hash = "8846f7eaee8fb117ad06bdd830b7586c";
  const account = { domain: "CORP", username: "admin", secret: hash };
  const commands = buildSmbDownloadCommands([account, { ...account, id: "duplicate" }]);

  assert.equal(commands.length, 2);
  assert.match(commands[1].value, /--pw-nt-hash/);
});

test("SMB credentials containing apostrophes are shell quoted", () => {
  const [guest, command] = buildSmbDownloadCommands([
    { domain: "lab", username: "o'connor", secret: "pa'ss" },
  ]);

  assert.ok(guest);
  assert.match(command.value, /o'\"'\"'connor/);
  assert.match(command.value, /pa'\"'\"'ss/);
});

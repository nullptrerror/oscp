import test from "node:test";
import assert from "node:assert/strict";
import { buildRemoteAccessCommands } from "../src/lib/remoteAccessCommands.js";

test("remote access commands are generated from the active password credential", () => {
  const commands = buildRemoteAccessCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "Synthetic-Remote-42!",
  });

  assert.equal(commands.length, 8);
  assert.match(commands[0].value, /nxc smb/);
  assert.match(commands[1].value, /nxc winrm/);
  assert.match(commands[2].value, /nxc ssh/);
  assert.match(commands[3].value, /evil-winrm/);
  assert.match(commands[4].value, /-S -P 5986/);
  assert.match(commands[5].value, /-x 'whoami && hostname && ipconfig'/);
  assert.match(commands[6].value, /impacket-wmiexec/);
  assert.match(commands[7].value, /ssh/);
  assert.ok(commands.every((command) => !/nxc smb[^\n]*;[^\n]*nxc winrm/u.test(command.value)));
});

test("remote access commands support NT hashes and omit password-only SSH", () => {
  const commands = buildRemoteAccessCommands([
    { id: "admin", domain: "corp.local", username: "administrator", secret: "8846f7eaee8fb117ad06bdd830b7586c" },
  ]);

  assert.equal(commands.length, 6);
  assert.match(commands[0].value, /-H '8846f7eaee8fb117ad06bdd830b7586c'/);
  assert.match(commands[2].value, /evil-winrm.*-H/);
  assert.match(commands[5].value, /-hashes ':8846f7eaee8fb117ad06bdd830b7586c'/);
  assert.equal(commands.some((command) => command.label.includes("SSH shell")), false);
});

test("remote access commands deduplicate active and saved credentials", () => {
  const account = { domain: "active.htb", username: "SVC_TGS", secret: "Password1!" };
  const commands = buildRemoteAccessCommands([account], {
    domain: account.domain,
    user: account.username,
    password: account.secret,
  });

  assert.equal(commands.length, 8);
});

test("remote access commands stay empty until a complete credential exists", () => {
  assert.deepEqual(buildRemoteAccessCommands([], { domain: "active.htb", user: "SVC_TGS", password: "" }), []);
});

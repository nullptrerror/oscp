import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildAclCommands } from "../src/lib/aclCommands.js";
import { renderCommand } from "../src/lib/workspace.js";

const variables = {
  workspaceRoot: "/home/kali/oscp",
  targetName: "Directory Lab",
  rhost: "192.0.2.10",
  domain: "corp.test",
  baseDn: "DC=corp,DC=test",
  user: "operator",
  memberUser: "operator",
  targetGroup: "Directory Delegates",
  password: "Password123!",
  hash: "8846f7eaee8fb117ad06bdd830b7586c",
  aclTarget: "corp.test",
  aclPrincipal: "operator",
  aclRights: "DCSync",
  dcsyncUser: "Administrator",
};

const renderedCommands = (overrides = {}) => {
  const context = { ...variables, ...overrides };
  return buildAclCommands(context).map((command) => ({
    ...command,
    value: renderCommand(command.value, context).command,
  }));
};

test("DCSync workflow uses direct group membership and Impacket from Kali", () => {
  const commands = renderedCommands();
  const combined = commands.map((command) => command.value).join("\n");
  const addAt = commands.findIndex((command) => command.key === "acl-group-add-member");
  const grantAt = commands.findIndex((command) => command.key === "acl-grant");
  const retrieveAt = commands.findIndex((command) => command.key === "acl-dcsync-impacket-password");
  const cleanupAt = commands.findIndex((command) => command.key === "acl-cleanup");

  assert.match(combined, /net rpc group members 'Directory Delegates'/);
  assert.match(combined, /net rpc group addmem 'Directory Delegates' 'operator'/);
  assert.match(combined, /impacket-dacledit -action write -rights 'DCSync'/);
  assert.match(combined, /-principal 'operator'/);
  assert.match(combined, /-target-dn 'DC=corp,DC=test'/);
  assert.match(combined, /stamp=\$\(date \+%Y%m%d-%H%M%S\)/);
  assert.match(combined, /dcsync-before-\$stamp\.bak/);
  assert.match(combined, /DACL modified successfully!/);
  assert.match(combined, /dcsync-latest-backup\.txt/);
  assert.match(combined, /impacket-dacledit -action restore/);
  assert.match(combined, /net rpc group delmem/);
  assert.match(combined, /impacket-secretsdump -just-dc-user 'Administrator'/);
  assert.doesNotMatch(combined, /PowerView|powershell|nxc winrm|EncodedCommand/);
  assert.ok(addAt >= 0 && grantAt > addAt && retrieveAt > grantAt && cleanupAt > retrieveAt);
});

test("DACL grant and restore remain safe in zsh after an interrupted pointer write", () => {
  const commands = renderedCommands({ targetGroup: "" });
  const grant = commands.find((command) => command.key === "acl-grant");
  const cleanup = commands.find((command) => command.key === "acl-cleanup");

  assert.match(grant.value, /command_status=\$\?/);
  assert.doesNotMatch(grant.value, /PIPESTATUS|pipestatus/u);
  assert.doesNotMatch(grant.value, /(?:^|;)\s*status=/u);
  assert.match(grant.value, /test -s "\$backup"/);
  assert.match(cleanup.value, /pointer_backup=\$\(head -n1 "\$backup_pointer"/);
  assert.match(cleanup.value, /find "\$dacl_dir" -maxdepth 1 -type f -name 'dcsync-before-\*\.bak'/);
  assert.match(cleanup.value, /sort -n \| tail -n1/);
  assert.match(cleanup.value, /Recorded DACL pointer is stale; using the newest backup/);
});

test("DACL grant checks the real command status under the Kali zsh runner", { skip: !existsSync("/usr/bin/zsh") }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "fieldnotes-acl-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fake = join(root, "impacket-dacledit");
  writeFileSync(fake, `#!/bin/sh\naction=\nbackup=\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -action) shift; action="$1" ;;\n    -file) shift; backup="$1" ;;\n  esac\n  shift\ndone\nif [ "$action" = write ] && [ -n "$backup" ]; then printf 'backup\\n' > "$backup"; fi\nprintf '[*] DACL modified successfully!\\n'\n[ "$FAKE_DACL_FAIL" = 1 ] && exit 7\nexit 0\n`, { mode: 0o700 });
  chmodSync(fake, 0o700);
  const commands = renderedCommands({ workspaceRoot: root, targetSlug: "forest", targetGroup: "" });
  const grant = commands.find((command) => command.key === "acl-grant");
  const pointer = join(root, "forest", "loot", "dacl", "dcsync-latest-backup.txt");
  const command = `PATH='${root}':"$PATH"; export PATH; ${grant.value}`;
  const success = spawnSync("/usr/bin/zsh", ["-lc", command], { encoding: "utf8", env: process.env });

  assert.equal(success.status, 0, success.stderr || success.stdout);
  assert.match(success.stdout, /DACL modified successfully!/);
  assert.match(readFileSync(pointer, "utf8"), /dcsync-before-\d{8}-\d{6}\.bak/);

  unlinkSync(pointer);
  const failure = spawnSync("/usr/bin/zsh", ["-lc", command], {
    encoding: "utf8",
    env: { ...process.env, FAKE_DACL_FAIL: "1" },
  });
  assert.notEqual(failure.status, 0);
  assert.equal(existsSync(pointer), false);
});

test("DACL restore prefers the newest valid backup over stale or dangling pointers", { skip: !existsSync("/usr/bin/zsh") }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "fieldnotes-restore-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fake = join(root, "impacket-dacledit");
  writeFileSync(fake, `#!/bin/sh\nbackup=\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = -file ]; then shift; backup="$1"; fi\n  shift\ndone\nprintf 'RESTORED:%s\\n' "$backup"\n`, { mode: 0o700 });
  chmodSync(fake, 0o700);
  const commands = renderedCommands({ workspaceRoot: root, targetSlug: "forest", targetGroup: "" });
  const cleanup = commands.find((command) => command.key === "acl-cleanup");
  const daclDir = join(root, "forest", "loot", "dacl");
  const oldBackup = join(daclDir, "dcsync-before-20260101-000000.bak");
  const newBackup = join(daclDir, "dcsync-before-20260101-000001.bak");
  const pointer = join(daclDir, "dcsync-latest-backup.txt");
  mkdirSync(daclDir, { recursive: true });
  writeFileSync(oldBackup, "old\n");
  writeFileSync(newBackup, "new\n");
  const future = new Date(Date.now() + 60_000);
  utimesSync(newBackup, future, future);
  writeFileSync(pointer, `${oldBackup}\n`);
  const command = `PATH='${root}':"$PATH"; export PATH; ${cleanup.value}`;
  const stale = spawnSync("/usr/bin/zsh", ["-lc", command], { encoding: "utf8", env: process.env });

  assert.equal(stale.status, 0, stale.stderr || stale.stdout);
  assert.match(stale.stdout, /Recorded DACL pointer is stale/);
  assert.match(stale.stdout, new RegExp(`RESTORED:${newBackup.replaceAll("/", "\\/")}`));
  assert.equal(readFileSync(pointer, "utf8").trim(), newBackup);

  writeFileSync(pointer, `${join(daclDir, "dcsync-before-20260101-999999.bak")}\n`);
  const dangling = spawnSync("/usr/bin/zsh", ["-lc", command], { encoding: "utf8", env: process.env });
  assert.equal(dangling.status, 0, dangling.stderr || dangling.stdout);
  assert.match(dangling.stdout, /Ignoring missing DACL backup/);
  assert.match(dangling.stdout, new RegExp(`RESTORED:${newBackup.replaceAll("/", "\\/")}`));
});

test("non-DCSync rights map All to Impacket FullControl and use a named target", () => {
  const commands = renderedCommands({ aclTarget: "Helpdesk", aclPrincipal: "operator", aclRights: "All", targetGroup: "" });
  const combined = commands.map((command) => command.value).join("\n");

  assert.match(combined, /-rights 'FullControl'/);
  assert.match(combined, /-target 'Helpdesk'/);
  assert.doesNotMatch(combined, /group addmem|secretsdump|lsadump::dcsync/);
});

test("DCSync for a different ACL principal omits credential-bound Impacket retrieval", () => {
  const commands = renderedCommands({ aclPrincipal: "other-user" });
  assert.ok(commands.some((command) => command.key === "acl-dcsync-mimikatz"));
  assert.equal(commands.some((command) => command.key.startsWith("acl-dcsync-impacket")), false);
});

test("unsupported rights produce a validation command", () => {
  const commands = renderedCommands({ aclRights: "arbitrary-right" });
  assert.deepEqual(commands.map((command) => command.key), ["acl-invalid-right"]);
  assert.match(commands[0].value, /All, ResetPassword, WriteMembers, DCSync/);
});

test("DCSync rejects a user ACL target and directs the operator to the domain", () => {
  const commands = renderedCommands({ aclTarget: "operator" });
  assert.deepEqual(commands.map((command) => command.key), ["acl-invalid-dcsync-target"]);
  assert.match(commands[0].value, /Set ACL TARGET to corp\.test, not operator/);
});

test("hash-only authentication uses Impacket hashes and Samba pw-nt-hash", () => {
  const commands = renderedCommands({ password: "" });
  const combined = commands.map((command) => command.value).join("\n");

  assert.match(combined, /-hashes ':8846f7eaee8fb117ad06bdd830b7586c'/);
  assert.match(combined, /--pw-nt-hash/);
  assert.match(combined, /corp\.test\/operator%8846f7eaee8fb117ad06bdd830b7586c/);
});

test("shell-quotes passwords containing apostrophes", () => {
  const commands = renderedCommands({ password: "Winter'2026!" });
  const grant = commands.find((command) => command.key === "acl-grant");
  assert.match(grant.value, /Winter'"'"'2026!/);
});

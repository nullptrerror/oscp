import test from "node:test";
import assert from "node:assert/strict";
import { buildKerberosTicketCommands, buildSpnTgsCommands } from "../src/lib/kerberosCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

test("SPN TGS commands organize active credentials under target loot", () => {
  const commands = buildSpnTgsCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "GPPstillStandingStrong2k18",
  });

  assert.equal(commands.length, 3);
  assert.match(commands[0].value, /impacket-GetUserSPNs/);
  assert.match(commands[0].value, /active\.htb\/SVC_TGS:GPPstillStandingStrong2k18/);
  assert.match(commands[0].value, /\{\{workspaceRoot\}\}\/\{\{targetName\}\}\/loot\/kerberos\/spn_tgs\/active\.htb_SVC_TGS/);
  assert.match(commands[0].value, /hashes\.txt/);
  assert.match(commands[0].value, /spn-enumeration\.txt/);
  assert.match(commands[0].value, /cat \"\$hashes\"/);
});

test("SPN TGS cracking generates Hashcat and John commands", () => {
  const [, hashcat, john] = buildSpnTgsCommands([], {
    domain: "active.htb",
    user: "SVC_TGS",
    password: "Password1!",
  });

  assert.match(hashcat.value, /mode=13100/);
  assert.match(hashcat.value, /mode=19600/);
  assert.match(hashcat.value, /mode=19700/);
  assert.match(hashcat.value, /hashcat-cracked\.txt/);
  assert.match(john.value, /john --format=krb5tgs/);
  assert.match(john.value, /john-cracked\.txt/);
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

  assert.equal(commands.length, 3);
  assert.match(commands[0].value, /-hashes ':8846f7eaee8fb117ad06bdd830b7586c'/);
});

test("SPN TGS commands require a complete domain credential", () => {
  assert.deepEqual(buildSpnTgsCommands([], { user: "user", password: "pass" }), []);
  assert.deepEqual(buildSpnTgsCommands([], { domain: "corp.local", user: "user" }), []);
});

test("parsed Kerberos tickets generate per-user hashes.txt, Hashcat, and John commands", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.variables.targetName = "forest";
  workspace.variables.domain = "htb.local";
  workspace.discoveries = [{
    targetId: "active",
    type: "kerberos-ticket",
    username: "svc-sql",
    domain: "HTB.LOCAL",
    ticket: "TGS",
    value: "$krb5tgs$23$*svc-sql$HTB.LOCAL$MSSQLSvc/sql.htb.local*$abc$def",
  }];

  const commands = buildKerberosTicketCommands(workspace);
  assert.equal(commands.length, 3);
  assert.match(commands[0].value, /tickets\/HTB\.LOCAL_svc-sql_tgs_etype23\/hashes\.txt/);
  assert.match(commands[0].value, /\$krb5tgs\$23\$\*svc-sql\$HTB\.LOCAL/);
  assert.match(commands[1].value, /hashcat -m 13100/);
  assert.match(commands[1].value, /forest-HTB\.LOCAL_svc-sql_tgs_etype23-23/);
  assert.match(commands[2].value, /john --format=krb5tgs/);
});

test("multiple tickets for one user share a mode-specific hashes.txt", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.variables.targetName = "forest";
  workspace.discoveries = ["sql", "http"].map((service) => ({
    targetId: "active",
    type: "kerberos-ticket",
    username: "svc-shared",
    domain: "HTB.LOCAL",
    ticket: "TGS",
    value: `$krb5tgs$23$*svc-shared$HTB.LOCAL$${service}/host*$abc$${service}`,
  }));

  const commands = buildKerberosTicketCommands(workspace);
  assert.equal(commands.length, 3);
  assert.match(commands[0].label, /Save 2 TGS tickets/);
  assert.match(commands[0].value, /sql\/host/);
  assert.match(commands[0].value, /http\/host/);
});

test("parsed AS-REP tickets select the AS-REP cracking formats", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.variables.targetName = "forest";
  workspace.discoveries = [{
    targetId: "active",
    type: "kerberos-ticket",
    username: "roastable",
    domain: "HTB.LOCAL",
    ticket: "AS-REP",
    value: "$krb5asrep$23$roastable@HTB.LOCAL:0123456789abcdef$abcdef",
  }];

  const commands = buildKerberosTicketCommands(workspace);
  assert.equal(commands.length, 3);
  assert.match(commands[1].value, /hashcat -m 18200/);
  assert.match(commands[2].value, /john --format=krb5asrep/);
});

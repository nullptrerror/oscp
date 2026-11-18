import test from "node:test";
import assert from "node:assert/strict";
import { buildReportStarters } from "../src/lib/reportStarters.js";
import { createDefaultWorkspace, RESULT_STATES } from "../src/lib/workspace.js";

test("report starters use target-scoped runs, findings, and proof without inventing access", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.targets = [{
    id: "active",
    name: "dc01",
    host: "10.0.0.10",
    domain: "corp.local",
    endpoints: [{ id: "ep", address: "10.0.0.10", hostnames: ["dc01.corp.local"], tcpPorts: "53,445", udpPorts: "53" }],
  }];
  workspace.commandHistory = [
    { targetId: "active", targetName: "dc01", itemId: "svc-smb", source: "local runner", command: "nxc smb 10.0.0.10 --shares" },
    { targetId: "other", targetName: "other", itemId: "web-baseline", source: "local runner", command: "curl http://other" },
  ];
  workspace.accounts = [{ targetId: "active", username: "svc_backup", secret: "Password1!" }];

  const starters = buildReportStarters(workspace, "active");
  assert.match(starters.executiveSummary, /does not yet demonstrate confirmed unauthorized access/);
  assert.doesNotMatch(starters.executiveSummary, /command run|TCP port|SMB/i);
  assert.match(starters.scope, /10\.0\.0\.10/);
  assert.match(starters.scope, /53, 445/);
  assert.match(starters.recommendations, /Rotate recovered credentials/);
  assert.doesNotMatch(starters.executiveSummary, /other/);
});

test("failed or unreviewed commands do not drive weakness or remediation claims", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.targets = [{ id: "active", name: "dc01", host: "10.0.0.10", endpoints: [{ address: "10.0.0.10" }] }];
  workspace.commandHistory = [{
    id: "run-ad",
    targetId: "active",
    itemId: "ad-asrep",
    commandKey: "asrep",
    source: "local runner",
    command: "impacket-GetNPUsers corp.local/ -dc-ip 10.0.0.10",
  }];
  workspace.commandResultStates["active::ad-asrep::asrep"] = RESULT_STATES.FAILED;
  workspace.evidence["active::ad-asrep"] = [{
    targetId: "active",
    commandRunId: "run-ad",
    substantive: true,
    content: "No AS-REP roastable users were returned.",
  }];

  const failed = buildReportStarters(workspace, "active");
  assert.doesNotMatch(failed.executiveSummary, /directory-service exposure|account relationships/i);
  assert.doesNotMatch(failed.recommendations, /Active Directory|Kerberos roasting/i);

  workspace.commandResultStates["active::ad-asrep::asrep"] = RESULT_STATES.CONFIRMED;
  const confirmed = buildReportStarters(workspace, "active");
  assert.match(confirmed.executiveSummary, /directory-service exposure/i);
  assert.match(confirmed.recommendations, /Active Directory/i);
});

test("confirmed result-backed AS-REP and delegated DACL paths produce specific conservative guidance", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.targets = [{
    id: "active",
    name: "dc01",
    host: "10.0.0.10",
    domain: "corp.local",
    endpoints: [{ address: "10.0.0.10", tcpPorts: "88,389,5985" }],
  }];
  const runs = [
    ["asrep", "ad-roast", "asrep-request", "AS-REP tracked users into target loot", "impacket-GetNPUsers corp.local/ -usersfile users.txt"],
    ["crack", "ad-roast", "asrep-crack", "Crack saved AS-REP hashes with John", "john --format=krb5asrep --show asrep.hashes"],
    ["token", "windows-privileges-policy", "token-privileges", "Token privileges", "whoami /all"],
    ["group", "ad-group-membership", "group-add", "Add selected member", "net rpc group addmem 'Privileged Directory Group' 'audit-user'"],
    ["grant", "ad-domain-writedacl", "acl-grant", "Grant DCSync — audit-user on corp.local", "impacket-dacledit -action write -rights DCSync"],
    ["dcsync", "ad-domain-writedacl", "acl-dcsync", "Impacket DCSync with audit-user's password", "impacket-secretsdump -just-dc-user Administrator"],
  ];
  workspace.commandHistory = runs.map(([id, itemId, commandKey, label, command]) => ({
    id,
    targetId: "active",
    targetName: "dc01",
    itemId,
    commandKey,
    label,
    command,
    source: "local runner",
  }));
  const outputs = {
    asrep: "$krb5asrep$23$service-user@CORP.LOCAL:deadbeef",
    crack: "$krb5asrep$23$service-user@CORP.LOCAL:RecoveredPassword!",
    token: "CORP\\Service Accounts",
    group: "Added audit-user to Privileged Directory Group",
    grant: "DACL modified successfully!",
    dcsync: "Dumping Domain Credentials\ncorp.local\\Administrator:500:aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef:::",
  };
  for (const [id, itemId, commandKey] of runs) {
    workspace.commandResultStates[`active::${itemId}::${commandKey}`] = RESULT_STATES.CONFIRMED;
    workspace.evidence[`active::${itemId}`] ||= [];
    workspace.evidence[`active::${itemId}`].push({
      targetId: "active",
      commandRunId: id,
      substantive: true,
      content: outputs[id],
    });
  }
  workspace.evidence["active::proof-artifacts"] = [{
    targetId: "active",
    category: "root-flag",
    content: "proof screenshot",
  }];

  const starters = buildReportStarters(workspace, "active");
  assert.match(starters.executiveSummary, /service account was configured without Kerberos preauthentication/i);
  assert.match(starters.executiveSummary, /AS-REP authentication material.*password.*recovered offline/is);
  assert.match(starters.executiveSummary, /Excessive delegated Active Directory rights/i);
  assert.match(starters.executiveSummary, /domain access-control list.*administrator credentials.*full administrative access/is);
  assert.match(starters.recommendations, /Require Kerberos preauthentication/i);
  assert.match(starters.recommendations, /domain DACL.*replication rights/i);
  assert.doesNotMatch(starters.recommendations, /service, task, file, and delegated-command permissions/i);
});

test("an orphaned or unconfirmed path cannot produce specific AS-REP or DACL claims", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "active";
  workspace.targets = [{ id: "active", name: "dc01", host: "10.0.0.10", endpoints: [{ address: "10.0.0.10" }] }];
  workspace.commandHistory = [{
    id: "orphan-crack",
    targetId: "active",
    itemId: "ad-roast",
    commandKey: "asrep-crack",
    label: "Crack saved AS-REP hashes with Hashcat",
    command: "hashcat -m 18200 asrep.hashes rockyou.txt",
    source: "local runner",
  }];
  workspace.commandResultStates["active::ad-roast::asrep-crack"] = RESULT_STATES.CONFIRMED;

  const starters = buildReportStarters(workspace, "active");
  assert.doesNotMatch(starters.executiveSummary, /configured without Kerberos preauthentication/i);
  assert.doesNotMatch(starters.executiveSummary, /Excessive delegated Active Directory rights/i);
  assert.doesNotMatch(starters.recommendations, /Require Kerberos preauthentication/i);
});

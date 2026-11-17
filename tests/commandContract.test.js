import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { getChecklistCommands } from "../src/lib/checklistCommands.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";
import { stepsForPivotPlaybook } from "../src/data/pivotPlaybooks.js";
import {
  auditCommandRecord,
  createCommandRecord,
  extractCommandVariables,
  renderCommandRecord,
  renderCommandTemplate,
  RUNS_ON,
} from "../src/lib/commandContract.js";

test("every static command is a complete structured record with stable IDs", () => {
  const commands = ALL_ITEMS.flatMap((item) => item.commands);
  const ids = commands.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const command of commands) {
    assert.ok(RUNS_ON.includes(command.runsOn));
    assert.equal(command.title, command.label);
    assert.ok(command.purpose);
    assert.ok(command.applicability.predicates.length > 0);
    assert.ok(command.prerequisites.length > 0);
    assert.ok(command.expectedPositiveSignal);
    assert.ok(command.expectedNegativeSignal);
    assert.ok(command.positiveBranch);
    assert.ok(command.negativeBranch);
    assert.ok(command.verificationCommand);
    assert.ok(command.cleanup);
    assert.ok(command.policy);
    assert.deepEqual(auditCommandRecord(command).errors, []);
  }
});

test("typed rendering quotes hostile-but-valid data without changing its value", () => {
  const secret = "S p(a)'ss;$HOME—雪";
  const rendered = renderCommandTemplate("tool -u '{{user}}' -p '{{password}}' --host {{rhost}}", {
    user: "o'connor (ops)",
    password: secret,
    rhost: "example.test",
  });

  assert.equal(rendered.runnable, true);
  assert.deepEqual(rendered.invalid, {});
  assert.match(rendered.command, /o'"'"'connor \(ops\)/u);
  assert.match(rendered.command, /S p\(a\)'"'"'ss;\$HOME—雪/u);
  assert.match(rendered.command, /--host example\.test$/u);
});

test("typed rendering rejects shell syntax in token variables", () => {
  const rendered = renderCommandTemplate("nmap {{rhost}} -p {{tcpPorts}}", {
    rhost: "10.0.0.1;id",
    tcpPorts: "80,443",
  });
  assert.equal(rendered.runnable, false);
  assert.ok(rendered.invalid.rhost);
  assert.equal(rendered.command, "nmap {{rhost}} -p 80,443");
});

test("cross-platform filename tokens render without POSIX quotes in cmd.exe paths", () => {
  const item = ALL_ITEMS.find((candidate) => candidate.id === "proof-windows");
  const record = item.commands.find((command) => command.label === "User-level proof block");
  const rendered = renderCommandRecord(record, { userFlagName: "local-雪.txt" });
  assert.equal(rendered.runnable, true);
  assert.match(rendered.command, /Desktop\\local-雪\.txt/u);
  assert.doesNotMatch(rendered.command, /Desktop\\'local-雪\.txt'/u);
});

test("required variables are typed and credential commands require explicit selection", () => {
  const item = { id: "test-auth", title: "Authentication" };
  const record = createCommandRecord(item, {
    label: "Validate one credential",
    value: "client -h {{rhost}} -u '{{user}}' -p '{{password}}'",
  });
  const variables = Object.fromEntries(record.requiredVariables.map((variable) => [variable.name, variable.type]));
  assert.deepEqual(variables, {
    rhost: "host",
    user: "username",
    password: "secret",
    selectedCredentialId: "record-id",
  });
  const blocked = renderCommandRecord(record, { rhost: "192.0.2.2", user: "alice", password: "Password1!" });
  assert.equal(blocked.runnable, false);
  assert.deepEqual(blocked.missing, ["selectedCredentialId"]);
});

test("generated records honor requiresSelectedCredential", () => {
  const item = { id: "test-generated", title: "Generated" };
  const record = createCommandRecord(item, {
    key: "generated-auth",
    label: "Generated credential command",
    value: "client --embedded-secret",
    requiresSelectedCredential: true,
  });
  assert.deepEqual(record.requiredVariables, [{ name: "selectedCredentialId", type: "record-id", required: true, sensitive: false }]);
});

test("execution-side labels distinguish Kali discovery from target-side work", () => {
  const helper = ALL_ITEMS.find((item) => item.id === "windows-helper");
  assert.equal(helper.commands.find((command) => command.label === "Find WinPEAS on Kali").runsOn, "lhost");
  assert.equal(helper.commands.find((command) => command.label === "Save output").runsOn, "foothold-windows");
  const linuxProof = ALL_ITEMS.find((item) => item.id === "proof-linux");
  assert.ok(linuxProof.commands.every((command) => command.runsOn === "foothold-linux"));
});

test("state-change inference distinguishes inventory from actual file and route mutations", () => {
  const setup = ALL_ITEMS.find((item) => item.id === "setup-resources");
  assert.ok(setup.commands.every((command) => command.stateChange === "none"));
  const helper = ALL_ITEMS.find((item) => item.id === "windows-helper");
  assert.equal(helper.commands.find((command) => command.label === "Find WinPEAS on Kali").stateChange, "none");
  assert.equal(helper.commands.find((command) => command.label === "Save output").stateChange, "target-file");
  const transfer = ALL_ITEMS.find((item) => item.id === "access-transfer");
  assert.equal(transfer.commands.find((command) => command.label === "Stage on Linux").stateChange, "target-file");
  assert.equal(transfer.commands.find((command) => command.label === "Stage on Windows").stateChange, "target-file");
});

test("credential reuse requires explicit selection while pivot SSH uses its dedicated pivot identity", () => {
  const reuse = ALL_ITEMS.find((candidate) => candidate.id === "creds-reuse");
  for (const command of reuse.commands.filter((candidate) => /\bssh\b/iu.test(candidate.template))) {
    assert.ok(command.requiredVariables.some((variable) => variable.name === "selectedCredentialId"), command.id);
  }
  for (const command of stepsForPivotPlaybook("pivot-ssh").filter((candidate) => /\bssh\b/iu.test(candidate.template))) {
    assert.ok(command.requiredVariables.some((variable) => variable.name === "pivotUser"), command.id);
    assert.ok(command.requiredVariables.some((variable) => variable.name === "pivotHost"), command.id);
  }
});

test("broad Nmap vuln-category scans require current-policy verification and are non-executable", () => {
  const item = { id: "test-scan", title: "Scan" };
  const record = createCommandRecord(item, { label: "Vulnerability scan", value: "nmap --script vuln {{rhost}}" });
  assert.equal(record.policy, "verify-current-policy");
  assert.equal(record.executionEnabled, false);
  assert.equal(record.instructional, true);
});

test("command catalog contains no magic placeholders", () => {
  const magic = /\b(?:FILE|HASH_MODE|EXPLOIT_ID|EXPLOIT_FILE)\b|\/path\/to\/|:\/EXPORT(?:\s|$)/u;
  for (const item of ALL_ITEMS) {
    for (const command of item.commands) {
      const contractText = [command.template, command.verificationCommand, command.cleanupCommand, command.cleanup?.command].filter(Boolean).join("\n");
      assert.doesNotMatch(contractText, magic, command.id);
      assert.deepEqual(extractCommandVariables(contractText).sort(), command.requiredVariables
        .map((variable) => variable.name)
        .filter((name) => name !== "selectedCredentialId")
        .sort());
    }
  }
});

test("every state-changing command exposes risk, verification, and cleanup guidance", () => {
  for (const command of ALL_ITEMS.flatMap((item) => item.commands).filter((candidate) => candidate.stateChange !== "none")) {
    assert.ok(["low", "medium", "high", "critical"].includes(command.risk), command.id);
    assert.ok(command.warning, command.id);
    assert.ok(command.verificationCommand, command.id);
    assert.ok(command.cleanup.command || command.cleanup.note, command.id);
  }
});

test("static and dynamically generated commands pass the policy audit", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-a";
  workspace.targets = [{ id: "target-a", name: "Target A" }];
  workspace.accounts = [{ id: "credential-a", targetId: "target-a", domain: "corp.test", username: "alice", secret: "Password1!" }];
  workspace.selectedCredentials = { "target-a": "credential-a" };
  Object.assign(workspace.variables, {
    targetName: "Target A",
    targetSlug: "target-a",
    rhost: "192.0.2.10",
    tcpPorts: "80,445",
    udpPorts: "53",
    webScheme: "http",
    webPort: "80",
    domain: "corp.test",
    baseDn: "DC=corp,DC=test",
    user: "alice",
    password: "Password1!",
    selectedCredentialId: "credential-a",
    aclTarget: "Helpdesk",
    aclPrincipal: "alice",
    aclRights: "ResetPassword",
    internalSubnet: "172.16.10.0/24",
    pivotInterface: "ligolo",
  });

  const commands = ALL_ITEMS.flatMap((item) => getChecklistCommands(item, workspace));
  assert.ok(commands.length > ALL_ITEMS.flatMap((item) => item.commands).length);
  for (const command of commands) {
    assert.deepEqual(auditCommandRecord(command).errors, [], command.id);
    const protocols = [...command.template.matchAll(/\bnxc\s+(smb|winrm|ssh)\b/giu)].map((match) => match[1]);
    assert.ok(new Set(protocols).size <= 1, `${command.id} chains credential reuse across protocols`);
  }
});

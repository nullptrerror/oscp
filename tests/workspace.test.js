import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkspace,
  deleteMachineData,
  domainToBaseDn,
  getItemStateKey,
  getScopedItemValue,
  importMachineData,
  normalizeWorkspace,
  pickMachineVariables,
  renderCommand,
  WORKSPACE_VERSION,
} from "../src/lib/workspace.js";

test("command variables render and report missing values", () => {
  const result = renderCommand("nmap {{rhost}} -p {{rport}} {{missing}}", {
    rhost: "192.0.2.10",
    rport: "80,443",
  });

  assert.equal(result.command, "nmap 192.0.2.10 -p 80,443 {{missing}}");
  assert.deepEqual(result.missing, ["missing"]);
});

test("a backup is normalized without dropping default variables", () => {
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    variables: { rhost: "198.51.100.25" },
    targets: [{ id: "target-1", name: "lab" }],
  });

  assert.equal(restored.variables.rhost, "");
  assert.equal(restored.targets[0].commandContext.rhost, "198.51.100.25");
  assert.equal(restored.variables.interface, "tun0");
  assert.equal(restored.targets.length, 1);
  assert.deepEqual(restored.accounts, []);
  assert.deepEqual(restored.nextSteps, {});
});

test("unsupported backup versions are rejected", () => {
  assert.throws(() => normalizeWorkspace({ version: 99 }), /Unsupported backup version/);
});

test("new workspaces have independent variable objects", () => {
  const first = createDefaultWorkspace();
  const second = createDefaultWorkspace();
  first.variables.rhost = "changed";

  assert.notEqual(first.variables.rhost, second.variables.rhost);
});

test("parser settings and ignored findings persist with safe defaults", () => {
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    parserSettings: { cve: false },
    ignoredDiscoveries: [{ type: "user", value: "Policies", targetId: "active" }],
  });
  assert.equal(restored.parserSettings.cve, false);
  assert.equal(restored.parserSettings.user, true);
  assert.equal(restored.ignoredDiscoveries[0].value, "Policies");
});

test("checklist state is scoped to the active target", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-active";
  workspace.completed["target-active::svc-smb"] = true;

  assert.equal(getItemStateKey(workspace, "svc-smb"), "target-active::svc-smb");
  assert.equal(getScopedItemValue(workspace.completed, workspace, "svc-smb", false), true);

  workspace.activeTargetId = "target-other";
  assert.equal(getScopedItemValue(workspace.completed, workspace, "svc-smb", false), false);
});

test("attack-narrative decisions persist when a workspace is normalized", () => {
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    notes: { "target-active::svc-smb": "Anonymous access exposed a readable share." },
    nextSteps: { "target-active::svc-smb": "The share contents justified searching for reusable credentials." },
  });

  assert.equal(restored.notes["target-active::svc-smb"], "Anonymous access exposed a readable share.");
  assert.equal(restored.nextSteps["target-active::svc-smb"], "The share contents justified searching for reusable credentials.");
});

test("active command variables migrate into and restore from the selected machine", () => {
  const migrated = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    activeTargetId: "target-active",
    variables: { user: "operator", password: "legacy-secret", domain: "corp.local" },
    targets: [{ id: "target-active", name: "active", host: "192.0.2.12" }],
  });
  assert.equal(migrated.targets[0].commandContext.user, "operator");
  assert.equal(migrated.targets[0].commandContext.password, "legacy-secret");

  const restored = normalizeWorkspace({
    ...migrated,
    variables: { ...migrated.variables, user: "", password: "", domain: "" },
  });
  assert.equal(restored.variables.user, "operator");
  assert.equal(restored.variables.password, "legacy-secret");
  assert.equal(restored.variables.domain, "corp.local");
});

test("deleting a machine removes every machine-scoped record and preserves other machines", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "delete-me";
  workspace.targets = [{ id: "delete-me", name: "old" }, { id: "keep-me", name: "keep" }];
  for (const key of ["accounts", "users", "loot", "discoveries", "ignoredDiscoveries", "commandHistory"]) {
    workspace[key] = [{ id: `${key}-old`, targetId: "delete-me" }, { id: `${key}-keep`, targetId: "keep-me" }];
  }
  for (const key of ["completed", "notes", "nextSteps", "narrativeSources", "evidence"]) {
    workspace[key] = { [`delete-me::item`]: key === "evidence" ? [] : true, [`keep-me::item`]: key === "evidence" ? [] : true };
  }
  workspace.reports = { "delete-me": { title: "old" }, "keep-me": { title: "keep" } };
  workspace.variables.targetName = "old";
  workspace.variables.rhost = "10.0.0.1";

  const result = deleteMachineData(workspace, "delete-me");
  assert.equal(result.activeTargetId, null);
  assert.equal(result.targets.length, 1);
  assert.equal(result.variables.targetName, "");
  assert.equal(result.variables.rhost, "");
  for (const key of ["accounts", "users", "loot", "discoveries", "ignoredDiscoveries", "commandHistory"]) assert.deepEqual(result[key].map((entry) => entry.targetId), ["keep-me"]);
  for (const key of ["completed", "notes", "nextSteps", "narrativeSources", "evidence"]) assert.deepEqual(Object.keys(result[key]), ["keep-me::item"]);
  assert.deepEqual(Object.keys(result.reports), ["keep-me"]);
});

test("a PDF machine import merges scoped data without replacing existing machines", () => {
  const current = createDefaultWorkspace();
  current.activeTargetId = "existing";
  current.targets = [{ id: "existing", name: "existing", host: "192.0.2.1" }];
  const imported = createDefaultWorkspace();
  imported.activeTargetId = "source";
  imported.targets = [{ id: "source", name: "active", host: "10.10.10.100", labType: "htb", userFlagName: "user.txt", rootFlagName: "root.txt" }];
  imported.notes["source::svc-smb"] = "Anonymous SMB access was confirmed.";
  imported.commandHistory = [{ id: "run", targetId: "source", targetName: "active", itemId: "svc-smb", command: "nxc smb" }];

  const merged = importMachineData(current, imported, "source", "htb");
  const added = merged.targets.find((target) => target.id !== "existing");
  assert.equal(merged.activeTargetId, added.id);
  assert.equal(merged.targets.length, 2);
  assert.equal(added.labType, "htb");
  assert.equal(merged.notes[`${added.id}::svc-smb`], "Anonymous SMB access was confirmed.");
  assert.equal(merged.commandHistory.at(-1).targetId, added.id);
});

test("the default Kali workspace root is /home/kali/oscp", () => {
  assert.equal(createDefaultWorkspace().variables.workspaceRoot, "/home/kali/oscp");
});

test("LDAP group-control selections remain machine scoped", () => {
  const variables = pickMachineVariables({
    targetGroup: "Account Operators",
    memberUser: "svc_alfresco",
    aclTarget: "Account Operators",
    aclPrincipal: "svc_alfresco",
    aclRights: "WriteMembers",
    dcsyncUser: "Administrator",
    unrelated: "discarded",
  });
  assert.equal(variables.targetGroup, "Account Operators");
  assert.equal(variables.memberUser, "svc_alfresco");
  assert.equal(variables.aclTarget, "Account Operators");
  assert.equal(variables.aclPrincipal, "svc_alfresco");
  assert.equal(variables.aclRights, "WriteMembers");
  assert.equal(variables.dcsyncUser, "Administrator");
  assert.equal(variables.unrelated, undefined);
});

test("domains derive LDAP base DNs when one is not supplied", () => {
  assert.equal(domainToBaseDn("active.htb"), "DC=active,DC=htb");
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    activeTargetId: "target-active",
    targets: [{ id: "target-active", name: "active", host: "192.0.2.12" }],
    variables: { domain: "corp.example.com", baseDn: "" },
  });
  assert.equal(restored.variables.baseDn, "DC=corp,DC=example,DC=com");
});

test("legacy targets migrate into machines with a primary endpoint", () => {
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    targets: [{ id: "active", name: "active", host: "10.129.81.60", port: "53,445" }],
  });
  assert.equal(restored.targets[0].endpoints.length, 1);
  assert.equal(restored.targets[0].endpoints[0].address, "10.129.81.60");
  assert.equal(restored.targets[0].endpoints[0].tcpPorts, "53,445");
});

test("workspace normalization removes historical Nmap vendor hostnames", () => {
  const restored = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    targets: [{ id: "active", name: "active", endpoints: [{ id: "ep", address: "10.129.81.76", hostnames: ["nmap.org", "dc.active.htb"] }] }],
    variables: { lhost: "10.10.15.240" },
    discoveries: [{ type: "hostname", value: "nmap.org" }, { type: "hostname", value: "dc.active.htb" }, { type: "ip", value: "10.10.15.240" }],
  });
  assert.deepEqual(restored.targets[0].endpoints[0].hostnames, ["dc.active.htb"]);
  assert.deepEqual(restored.discoveries.map((entry) => entry.value), ["dc.active.htb"]);
});

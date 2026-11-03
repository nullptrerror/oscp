import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkspace,
  domainToBaseDn,
  getItemStateKey,
  getScopedItemValue,
  normalizeWorkspace,
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

  assert.equal(restored.variables.rhost, "198.51.100.25");
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

test("the default Kali workspace root is /home/kali/oscp", () => {
  assert.equal(createDefaultWorkspace().variables.workspaceRoot, "/home/kali/oscp");
});

test("domains derive LDAP base DNs when one is not supplied", () => {
  assert.equal(domainToBaseDn("active.htb"), "DC=active,DC=htb");
  const restored = normalizeWorkspace({ version: WORKSPACE_VERSION, variables: { domain: "corp.example.com", baseDn: "" } });
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

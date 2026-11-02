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

test("checklist state is scoped to the active target", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-active";
  workspace.completed["target-active::svc-smb"] = true;

  assert.equal(getItemStateKey(workspace, "svc-smb"), "target-active::svc-smb");
  assert.equal(getScopedItemValue(workspace.completed, workspace, "svc-smb", false), true);

  workspace.activeTargetId = "target-other";
  assert.equal(getScopedItemValue(workspace.completed, workspace, "svc-smb", false), false);
});

test("the default Kali workspace root is /home/kali/oscp", () => {
  assert.equal(createDefaultWorkspace().variables.workspaceRoot, "/home/kali/oscp");
});

test("domains derive LDAP base DNs when one is not supplied", () => {
  assert.equal(domainToBaseDn("active.htb"), "DC=active,DC=htb");
  const restored = normalizeWorkspace({ version: WORKSPACE_VERSION, variables: { domain: "corp.example.com", baseDn: "" } });
  assert.equal(restored.variables.baseDn, "DC=corp,DC=example,DC=com");
});

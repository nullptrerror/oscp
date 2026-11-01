import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkspace,
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

import test from "node:test";
import assert from "node:assert/strict";
import { rankApplicableChecks } from "../src/lib/decisionSupport.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

const workspaceFor = (discoveries = []) => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-1";
  workspace.targets = [{ id: "target-1", name: "lab", boxType: "ad" }];
  workspace.discoveries = discoveries.map((entry, index) => ({ id: `d-${index}`, targetId: "target-1", ...entry }));
  return workspace;
};

test("decision support ignores unverified parser candidates", () => {
  const workspace = workspaceFor([{ type: "port", value: "445", protocol: "tcp", status: "candidate" }]);
  const ranked = rankApplicableChecks(workspace);
  assert.deepEqual(ranked.map((entry) => entry.itemId), ["setup-reachability", "recon-tcp-all"]);
});

test("decision support ranks only a few checks from confirmed facts", () => {
  const workspace = workspaceFor([
    { type: "port", value: "445", protocol: "tcp", status: "confirmed" },
    { type: "port", value: "389", protocol: "tcp", status: "confirmed" },
  ]);
  const ranked = rankApplicableChecks(workspace);
  assert.deepEqual(ranked.map((entry) => entry.itemId), ["recon-tcp-detail", "svc-ldap", "svc-smb"]);
  assert.ok(ranked.every((entry) => entry.reason));
});

test("remote access is not suggested until a credential is explicitly selected", () => {
  const workspace = workspaceFor([{ type: "port", value: "5985", protocol: "tcp", status: "confirmed" }]);
  workspace.accounts = [{ id: "account-1", targetId: "target-1", username: "operator", secret: "secret" }];
  assert.equal(rankApplicableChecks(workspace).some((entry) => entry.itemId === "access-remote"), false);
  workspace.selectedCredentials = { "target-1": "account-1" };
  assert.equal(rankApplicableChecks(workspace).some((entry) => entry.itemId === "access-remote"), true);
});

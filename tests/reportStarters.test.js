import test from "node:test";
import assert from "node:assert/strict";
import { buildReportStarters } from "../src/lib/reportStarters.js";
import { createDefaultWorkspace } from "../src/lib/workspace.js";

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
  assert.match(starters.executiveSummary, /1 command run/);
  assert.match(starters.executiveSummary, /No user or administrative proof/);
  assert.match(starters.scope, /10\.0\.0\.10/);
  assert.match(starters.scope, /53, 445/);
  assert.match(starters.recommendations, /Rotate recovered credentials/);
  assert.doesNotMatch(starters.executiveSummary, /other/);
});

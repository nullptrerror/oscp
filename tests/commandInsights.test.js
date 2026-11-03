import test from "node:test";
import assert from "node:assert/strict";
import { describeCommand, exactCommandRunCount } from "../src/lib/commandInsights.js";

test("exact command counters include arguments and only count local terminal runs", () => {
  const history = [
    { targetId: "active", source: "local runner", command: "nxc smb 10.0.0.1 -u 'user1'" },
    { targetId: "active", source: "local runner", command: "nxc smb 10.0.0.1 -u 'user2'" },
    { targetId: "active", command: "nxc smb 10.0.0.1 -u 'user1'" },
    { targetId: "other", source: "local runner", command: "nxc smb 10.0.0.1 -u 'user1'" },
  ];

  assert.equal(exactCommandRunCount(history, "nxc smb 10.0.0.1 -u 'user1'", { targetId: "active" }), 1);
  assert.equal(exactCommandRunCount(history, "nxc smb 10.0.0.1 -u 'user2'", { targetId: "active" }), 1);
  assert.equal(exactCommandRunCount(history, "nxc smb 10.0.0.1 -u 'user3'", { targetId: "active" }), 0);
});

test("command descriptions explain purpose and expected return data", () => {
  const insight = describeCommand("nmap -sCV 10.0.0.1", "Focused scan");
  assert.match(insight.purpose, /ports|services/i);
  assert.match(insight.returns, /service fingerprints/i);
});

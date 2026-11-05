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

test("Samba group commands are described as direct membership changes", () => {
  const insight = describeCommand("net rpc group addmem 'Helpdesk' 'alice' -S 10.0.0.1", "Add member");
  assert.match(insight.purpose, /direct membership/i);
  assert.match(insight.returns, /authorization|membership/i);
});

test("WriteDACL and single-account DCSync commands describe their impact", () => {
  const grant = describeCommand("impacket-dacledit -action write -principal alice -rights DCSync", "Grant DCSync");
  const retrieve = describeCommand("mkdir -p loot/dcsync; impacket-secretsdump -just-dc-user Administrator domain/alice@dc", "DCSync");
  assert.match(grant.purpose, /selected.*object.*DACL/i);
  assert.match(retrieve.purpose, /only.*selected directory account/i);
});

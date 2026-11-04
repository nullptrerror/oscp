import test from "node:test";
import assert from "node:assert/strict";
import { commandNarrativeDraft, isAutomaticNarrative, narrativeFromDiscoveries } from "../src/lib/narrative.js";

test("commands receive editable generic narrative drafts", () => {
  const draft = commandNarrativeDraft("nmap -sCV 10.0.0.1", "Focused scan");
  assert.equal(isAutomaticNarrative(draft.finding), true);
  assert.match(draft.finding, /saved output/i);
  assert.match(draft.nextStep, /focused service enumeration/i);
});

test("parsed output produces concrete findings and next-step context", () => {
  const narrative = narrativeFromDiscoveries([
    { type: "port", value: "445", protocol: "tcp", service: "microsoft-ds", state: "open" },
    { type: "flag", value: "ed7471e27363eaa77b804cd997ac8fe2", kind: "user" },
  ], { exitCode: 0 });
  assert.match(narrative.finding, /445\/tcp/);
  assert.match(narrative.finding, /user-level proof/);
  assert.match(narrative.nextStep, /privilege-escalation/i);
});

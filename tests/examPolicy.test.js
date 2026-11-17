import test from "node:test";
import assert from "node:assert/strict";
import {
  EXAM_SAFETY_RULES,
  OFFSEC_POLICY_SOURCES,
  POLICY_CLASSIFICATIONS,
  POLICY_NOTICE,
  PROOF_REQUIREMENTS,
  RULES_LAST_VERIFIED,
  rules_last_verified,
} from "../src/data/examPolicy.js";

test("exam policy records a dated verification against all required official sources", () => {
  assert.equal(RULES_LAST_VERIFIED, "2026-11-17");
  assert.equal(rules_last_verified, RULES_LAST_VERIFIED);
  assert.equal(OFFSEC_POLICY_SOURCES.length, 5);
  assert.equal(new Set(OFFSEC_POLICY_SOURCES.map((source) => source.id)).size, 5);
  for (const source of OFFSEC_POLICY_SOURCES) {
    assert.match(source.url, /^https:\/\/help\.offsec\.com\/hc\/en-us\/articles\//);
    assert.match(source.sourceUpdated, /^2026-\d{2}-\d{2}$/);
  }
});

test("policy rules classify actions and reference only declared sources", () => {
  const allowedClassifications = new Set(POLICY_CLASSIFICATIONS);
  const sourceIds = new Set(OFFSEC_POLICY_SOURCES.map((source) => source.id));
  assert.equal(new Set(EXAM_SAFETY_RULES.map((rule) => rule.id)).size, EXAM_SAFETY_RULES.length);
  for (const rule of EXAM_SAFETY_RULES) {
    assert.ok(allowedClassifications.has(rule.classification));
    assert.ok(rule.sourceIds.length > 0);
    assert.ok(rule.sourceIds.every((id) => sourceIds.has(id)));
  }
});

test("critical restrictions are conspicuous and conservative", () => {
  const byId = Object.fromEntries(EXAM_SAFETY_RULES.map((rule) => [rule.id, rule]));
  for (const id of ["automatic-exploitation", "mass-scanning", "spoofing-poisoning", "runtime-ai", "metasploit-pivot"]) {
    assert.equal(byId[id].classification, "prohibited");
  }
  assert.equal(byId["metasploit-one-target"].classification, "restricted");
  assert.match(byId["metasploit-one-target"].summary, /check or failed attempt still commits/i);
  assert.match(byId["metasploit-pivot"].summary, /cannot be used for pivoting/i);
  assert.match(byId["ambiguous-features"].summary, /ask OffSec/i);
  assert.match(POLICY_NOTICE.body, /not an authorization or a guarantee/i);
});

test("proof guidance requires interactive original-location evidence and manual submission", () => {
  const guidance = PROOF_REQUIREMENTS.join(" ");
  assert.match(guidance, /interactive shell/i);
  assert.match(guidance, /original location/i);
  assert.match(guidance, /proof value and the target IP context together/i);
  assert.match(guidance, /Manually submit/i);
  assert.match(guidance, /PDF report/i);
});

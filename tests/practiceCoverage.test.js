import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import {
  COVERAGE_SCOPE_RECORDS,
  GLOBAL_NAME_COLLISIONS,
  LAB_RESOURCE_ENTRIES,
  NORMALIZED_MACHINE_NAMES,
  NORMALIZED_PRACTICE_BOXES,
  PRACTICE_BOXES,
  PRACTICE_COVERAGE,
  PRACTICE_LIST_META,
  PRACTICE_GROUPS,
  RAW_MACHINE_ENTRIES,
  RAW_PRACTICE_ENTRIES,
  TECHNIQUE_REGISTRY,
  practiceBoxById,
} from "../src/data/practiceBoxes.js";

test("the complete supplied PWK V3 table is accounted for without hiding repeats", () => {
  assert.equal(PRACTICE_LIST_META.sourceUpdated, "2026-07-18");
  assert.equal(RAW_PRACTICE_ENTRIES.length, 208);
  assert.equal(RAW_MACHINE_ENTRIES.length, 204);
  assert.equal(LAB_RESOURCE_ENTRIES.length, 4);
  assert.equal(NORMALIZED_MACHINE_NAMES.length, 189);
  assert.equal(PRACTICE_BOXES.length, 204);
  assert.equal(NORMALIZED_PRACTICE_BOXES.length, 196);

  const rawIds = RAW_PRACTICE_ENTRIES.map((entry) => entry.rawId);
  assert.equal(new Set(rawIds).size, rawIds.length);

  const accounted = PRACTICE_BOXES.flatMap((box) => box.rawEntryIds);
  assert.equal(accounted.length, RAW_PRACTICE_ENTRIES.length);
  assert.deepEqual([...accounted].sort(), [...rawIds].sort());
});

test("catalog IDs remain unique and known legacy IDs continue to resolve", () => {
  assert.equal(new Set(PRACTICE_BOXES.map((box) => box.id)).size, PRACTICE_BOXES.length);
  assert.equal(practiceBoxById("htb-linux-outbound-assumed-breach")?.name, "Outbound");
  assert.equal(practiceBoxById("htb-active-directory-adagio-enterprise")?.name, "Adagio");
  assert.equal(practiceBoxById("pg-play-windows-sams")?.platform, "windows");
  assert.equal(practiceBoxById("htb-linux-outbound-assumed-breach-box")?.name, "Outbound");
});

test("all exact pre-upgrade annotated IDs remain compatible", () => {
  for (const id of [
    "htb-linux-outbound-assumed-breach-",
    "htb-linux-expressway-old-system-",
    "htb-windows-tombwatcher-assumed-breach-",
    "htb-active-directory-adagio-enterprise-",
    "htb-active-directory-signed-assumed-breach-",
    "htb-active-directory-eighteen-assumed-breach-",
  ]) assert.ok(practiceBoxById(id), id);
});

test("the preset selector separates scope and excludes lab-building resources", () => {
  assert.ok(PRACTICE_GROUPS.every((group) => group.scope && group.label.includes(" — ")));
  assert.equal(PRACTICE_GROUPS.flatMap((group) => group.boxes).some((box) => box.source === "other-labs"), false);
  assert.ok(PRACTICE_GROUPS.some((group) => group.scope === "optional-legacy"));
  assert.ok(PRACTICE_GROUPS.some((group) => group.scope === "enterprise-chain"));
});

test("duplicates, category conflicts, and provider name collisions are explicit", () => {
  const repeated = PRACTICE_BOXES.filter((box) => box.duplicateCount > 1).map((box) => box.name).sort();
  assert.deepEqual(repeated, ["Blogger", "Editor", "Nagoya", "Stapler"]);

  const htbEscape = NORMALIZED_PRACTICE_BOXES.find((entry) => entry.source === "htb" && entry.name === "Escape");
  assert.equal(htbEscape.categoryConflict, true);
  assert.deepEqual(htbEscape.categories, ["Windows", "Active Directory"]);

  const sams = PRACTICE_BOXES.find((box) => box.source === "pg-play" && box.name === "Sams");
  assert.match(sams.conflicts.join(" "), /Source column says Linux/);
  assert.ok(GLOBAL_NAME_COLLISIONS.some((collision) => collision.name === "escape"));
});

test("every catalog record has a traceable coverage record and explicit research status", () => {
  assert.equal(PRACTICE_COVERAGE.length, PRACTICE_BOXES.length);
  const coverageByBox = new Map(PRACTICE_COVERAGE.map((record) => [record.boxId, record]));

  for (const box of PRACTICE_BOXES) {
    const coverage = coverageByBox.get(box.id);
    assert.ok(coverage, `missing coverage for ${box.id}`);
    assert.ok(coverage.methodologyIds.length > 0, `missing baseline for ${box.id}`);
    assert.equal(coverage.researchStatus, "unresolved");
    assert.match(coverage.unresolvedReason, /No public, spoiler-safe/);
    assert.ok(coverage.sourceUrls.every((url) => /^https:\/\//.test(url)));
  }
});

test("all technique mappings resolve to a checklist item or an explicit scope record", () => {
  const checklistIds = new Set(ALL_ITEMS.map((item) => item.id));
  const techniqueIds = new Set(Object.keys(TECHNIQUE_REGISTRY));

  for (const coverage of PRACTICE_COVERAGE) {
    for (const techniqueId of [...coverage.methodologyIds, ...coverage.techniqueIds]) {
      assert.ok(techniqueIds.has(techniqueId), `unknown technique ${techniqueId}`);
    }
  }

  for (const [techniqueId, technique] of Object.entries(TECHNIQUE_REGISTRY)) {
    assert.ok(technique.checklistIds.every((id) => checklistIds.has(id)), `${techniqueId} has an unknown checklist mapping`);
    assert.ok(technique.checklistIds.length > 0 || COVERAGE_SCOPE_RECORDS[technique.scopeRecordId], `${techniqueId} is silently unmapped`);
  }
});

test("coverage data is spoiler-safe", () => {
  const serialized = JSON.stringify({ boxes: PRACTICE_BOXES, coverage: PRACTICE_COVERAGE });
  assert.doesNotMatch(serialized, /(?:^|[^\d])(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}/);
  assert.doesNotMatch(serialized, /(?:password|passwd|proof_value|flag_value)\s*[:=]/i);
});

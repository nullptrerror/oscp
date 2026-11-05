import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS, CHECKLIST, DEFAULT_VARIABLES } from "../src/data/checklist.js";
import { PLATFORM_PHASES, PRACTICE_BOXES } from "../src/data/practiceBoxes.js";

test("phase and checklist item IDs are unique", () => {
  const phaseIds = CHECKLIST.map((phase) => phase.id);
  const itemIds = ALL_ITEMS.map((item) => item.id);

  assert.equal(new Set(phaseIds).size, phaseIds.length);
  assert.equal(new Set(itemIds).size, itemIds.length);
});

test("every command placeholder has an editable default variable", () => {
  const declared = new Set(Object.keys(DEFAULT_VARIABLES));
  const used = new Set(
    ALL_ITEMS.flatMap((item) =>
      item.commands.flatMap((command) =>
        [...command.value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((match) => match[1]),
      ),
    ),
  );

  assert.deepEqual([...used].filter((name) => !declared.has(name)), []);
});

test("each checklist item includes at least one command", () => {
  const generatedItems = new Set(["ad-domain-writedacl", "ad-bloodhound-paths"]);
  assert.deepEqual(ALL_ITEMS.filter((item) => item.commands.length === 0 && !generatedItems.has(item.id)), []);
});

test("delegated group control includes direct membership, change, verification, and rollback commands", () => {
  const item = ALL_ITEMS.find((candidate) => candidate.id === "ad-group-membership");
  const commands = item.commands.map((command) => command.value).join("\n");

  assert.match(commands, /net rpc group members/);
  assert.match(commands, /net rpc group addmem/);
  assert.match(commands, /net rpc group delmem/);
  assert.match(commands, /\{\{targetGroup\}\}.*\{\{memberUser\}\}/);
  assert.doesNotMatch(commands, /ldapmodify|adsisearcher/);
});

test("domain WriteDACL checklist delegates grants to the variable-driven command builder", () => {
  const item = ALL_ITEMS.find((candidate) => candidate.id === "ad-domain-writedacl");
  assert.match(item.detail, /Kali-side.*impacket-dacledit/);
  assert.deepEqual(item.commands, []);
});

test("every supplied practice box maps to a complete reusable methodology", () => {
  assert.ok(PRACTICE_BOXES.length > 100);
  assert.equal(new Set(PRACTICE_BOXES.map((box) => box.id)).size, PRACTICE_BOXES.length);
  for (const box of PRACTICE_BOXES) {
    const phases = PLATFORM_PHASES[box.platform];
    assert.ok(phases?.has("setup"));
    assert.ok(phases?.has("recon"));
    assert.ok(phases?.has("proof"));
    assert.ok(box.labType === "htb" || box.labType === "oscp");
  }
});

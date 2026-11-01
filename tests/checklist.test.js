import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS, CHECKLIST, DEFAULT_VARIABLES } from "../src/data/checklist.js";

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
  assert.deepEqual(ALL_ITEMS.filter((item) => item.commands.length === 0), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("example audit redacts parsed target values by default", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-audit-"));
  const secret = "NeverPrintThisPassword123!";
  try {
    fs.writeFileSync(path.join(directory, "sample.txt"), `alice:${secret}\n`);
    const result = spawnSync(process.execPath, ["scripts/audit-examples.mjs", directory], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.doesNotMatch(result.stdout, /alice/);
    assert.match(result.stdout, /"valuesRedacted":true/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

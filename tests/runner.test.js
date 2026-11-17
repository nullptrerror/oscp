import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfinedDirectory } from "../server/runner.mjs";

test("runner creates and resolves working directories only inside its root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fieldnotes-runner-outside-"));
  try {
    const nested = resolveConfinedDirectory(root, path.join(root, "machine", "notes"));
    assert.equal(nested, path.join(root, "machine", "notes"));
    assert.throws(() => resolveConfinedDirectory(root, outside), /must stay under/);
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    assert.throws(() => resolveConfinedDirectory(root, path.join(root, "escape", "child")), /symlink outside/);
    assert.equal(fs.existsSync(path.join(outside, "child")), false, "no directory is created through the escaping symlink");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

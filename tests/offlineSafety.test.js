import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_ITEMS } from "../src/data/checklist.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = ["src", "server"].flatMap((directory) => fs.readdirSync(path.join(root, directory), { recursive: true })
  .filter((entry) => /\.(?:js|jsx|mjs)$/u.test(entry))
  .map((entry) => path.join(root, directory, entry))
  .filter((entry) => fs.statSync(entry).isFile()));

test("exam-time runtime has no AI SDK or external AI endpoint", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dependencies = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  assert.equal(dependencies.some((name) => /(?:openai|anthropic|langchain|gemini|copilot)/iu.test(name)), false);

  const executableSource = sourceFiles
    .filter((file) => !file.endsWith(`${path.sep}examPolicy.js`))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(executableSource, /api\.(?:openai|anthropic)\.com|generativelanguage\.googleapis\.com/iu);
  assert.doesNotMatch(executableSource, /fetch\(\s*["']https?:\/\//u, "runtime fetches must not call an external service");
});

test("the local command runner remains loopback-only and has no chained-run API", () => {
  const server = fs.readFileSync(path.join(root, "server/local-server.mjs"), "utf8");
  const runner = fs.readFileSync(path.join(root, "server/runner.mjs"), "utf8");
  assert.match(server, /listen\(port, "127\.0\.0\.1"/u);
  assert.doesNotMatch(runner, /(?:runNext|executeChain|autoExploit|submitProof)/iu);
});

test("prohibited and policy-verification commands are never executable", () => {
  const guarded = ALL_ITEMS.flatMap((item) => item.commands)
    .filter((command) => ["prohibited", "restricted", "study-only", "verify-current-policy"].includes(command.policy));
  assert.ok(guarded.length > 0);
  assert.ok(guarded.every((command) => command.executionEnabled === false));
});

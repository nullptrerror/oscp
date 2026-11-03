import test from "node:test";
import assert from "node:assert/strict";
import { hasAnsi, parseAnsi, stripAnsi, terminalLines, xtermColor } from "../src/lib/terminalText.js";
import { getOperatorProfile, githubProfile, initials } from "../src/lib/profile.js";

test("ANSI SGR colors and attributes become styled segments", () => {
  const [line] = parseAnsi("\x1b[1;32m[+]\x1b[0m ok \x1b[38;5;208morange\x1b[39m \x1b[38;2;1;2;3mrgb\x1b[0m");
  assert.deepEqual(line.map((segment) => segment.text), ["[+]", " ok ", "orange", " ", "rgb"]);
  assert.equal(line[0].style.bold, true);
  assert.equal(line[0].style.fg, xtermColor(2));
  assert.deepEqual(line[1].style, {});
  assert.equal(line[2].style.fg, xtermColor(208));
  assert.equal(line[4].style.fg, "#010203");
});

test("styles carry across newlines and non-SGR escapes are dropped", () => {
  const lines = parseAnsi("\x1b[31mred\nstill red\x1b[0m\x1b[2K\x1b]0;title\x07 plain");
  assert.equal(lines[1][0].style.fg, "#ff5f5f");
  assert.equal(lines[1].map((segment) => segment.text).join(""), "still red plain");
});

test("carriage returns keep only the final progress state", () => {
  assert.equal(stripAnsi("10%\r55%\r100% done\nnext"), "100% done\nnext");
  assert.equal(stripAnsi("line\r\nnext"), "line\nnext");
});

test("emoji and Unicode survive parsing", () => {
  assert.equal(stripAnsi("\x1b[33m🔥 ✓ ╔══╣ é\x1b[0m"), "🔥 ✓ ╔══╣ é");
});

test("colon-form truecolor and strikethrough styles are preserved", () => {
  const lines = parseAnsi("\x1b[38:2::255:64:32;9mstyled\x1b[0m");
  assert.equal(lines[0][0].style.fg, "#ff4020");
  assert.equal(lines[0][0].style.strike, true);
});

test("plain output gets tool-marker highlighting; ANSI output keeps its own colors", () => {
  const [line] = terminalLines("SMB 10.0.0.1 445 DC [+] corp\\svc:pw (Pwn3d!)");
  assert.ok(line.some((segment) => segment.text === "[+]" && segment.style.fg));
  assert.ok(line.some((segment) => segment.text === "(Pwn3d!)" && segment.style.bold));
  const [port] = terminalLines("445/tcp  open  microsoft-ds");
  assert.equal(port.find((segment) => segment.text === "open").style.bold, true);
  assert.equal(hasAnsi("\x1b[0mx"), true);
  const [ansi] = terminalLines("\x1b[0m[+] untouched");
  assert.deepEqual(ansi, [{ text: "[+] untouched", style: {} }]);
});

test("GitHub values normalize to a profile link", () => {
  assert.deepEqual(githubProfile("https://github.com/nullptrerror/oscp"), { handle: "nullptrerror", display: "github.com/nullptrerror", url: "https://github.com/nullptrerror" });
  assert.equal(githubProfile("@octo-cat").handle, "octo-cat");
  assert.equal(githubProfile("not a handle"), null);
  assert.equal(githubProfile(""), null);
});

test("operator profile prefers workspace values and falls back to legacy report fields", () => {
  const legacy = getOperatorProfile({ profile: {} }, { operatorName: "Legacy", candidateId: "OS-1", profileImage: "data:x" });
  assert.deepEqual(legacy, { name: "Legacy", osid: "OS-1", github: "", avatar: "data:x" });
  assert.equal(getOperatorProfile({ profile: { name: "New" } }, { operatorName: "Legacy" }).name, "New");
  assert.equal(initials("ada lovelace byron"), "AL");
  assert.equal(initials(""), "OP");
});

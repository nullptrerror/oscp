import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLastLineCount,
  normalizeTerminalSnapshot,
  paginateTerminalRows,
  planTerminalCapture,
  terminalCaptureDimensions,
  terminalCaptureFilename,
  TERMINAL_CAPTURE_LIMITS,
} from "../src/lib/terminalCapture.js";

const rows = (values) => values.map((value) => typeof value === "string" ? { text: value } : value);

test("automatic proof capture selects the latest complete prompt-to-prompt block", () => {
  const value = "0123456789abcdef0123456789abcdef";
  const snapshot = {
    columns: 120,
    rows: 24,
    viewportY: 0,
    lines: rows([
      "older unrelated output",
      value,
      "noise between proof attempts",
      "*Evil-WinRM* PS C:\\Users\\svc\\Documents> cmd.exe /d /c proof-command",
      "FOREST",
      "htb\\svc-alfresco",
      "   IPv4 Address. . . . . . . . . . . : 10.129.95.210",
      "Proof path: C:\\Users\\svc-alfresco\\Desktop\\user.txt",
      value,
      "[Fieldnotes] User-level proof candidate detected.",
      "*Evil-WinRM* PS C:\\Users\\svc\\Documents>",
      "later terminal output",
    ]),
  };

  const plan = planTerminalCapture(snapshot, {
    mode: "proof",
    proofValue: value,
    proofPath: "C:\\Users\\svc-alfresco\\Desktop\\user.txt",
    targetAddress: "10.129.95.210",
  });

  assert.equal(plan.proofFound, true);
  assert.equal(plan.reviewRequired, false);
  assert.deepEqual(plan.completeness, { prompt: true, identity: true, address: true, path: true, value: true });
  assert.equal(plan.start, 3);
  assert.equal(plan.end, 11);
  assert.equal(plan.lineCount, 8);
  assert.equal(plan.rows[0].text.startsWith("*Evil-WinRM*"), true);
  assert.equal(plan.rows.at(-1).text.endsWith("Documents>"), true);
});

test("automatic proof capture preserves wrapped command rows and reports incomplete context", () => {
  const value = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const snapshot = {
    columns: 30,
    rows: 10,
    lines: rows([
      { text: "PS C:\\Users\\student> cmd.exe", isWrapped: false },
      { text: " /c type root.txt", isWrapped: true },
      "student",
      value,
      "PS C:\\Users\\student>",
    ]),
  };
  const plan = planTerminalCapture(snapshot, { mode: "proof", proofValue: value });
  assert.equal(plan.start, 0);
  assert.equal(plan.proofFound, true);
  assert.equal(plan.reviewRequired, true);
  assert.deepEqual(plan.missing.sort(), ["address", "identity", "path"].sort());
  assert.match(plan.reason, /needs review/iu);
});

test("automatic proof capture waits for the returned interactive prompt", () => {
  const value = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const snapshot = {
    columns: 100,
    rows: 18,
    lines: rows([
      "PS C:\\Users\\student\\Desktop> cmd.exe /d /c proof-command",
      "lab\\student",
      "IPv4 Address: 10.10.10.10",
      "Proof path: C:\\Users\\student\\Desktop\\user.txt",
      value,
    ]),
  };
  const plan = planTerminalCapture(snapshot, {
    mode: "proof",
    proofValue: value,
    proofPath: "C:\\Users\\student\\Desktop\\user.txt",
    targetAddress: "10.10.10.10",
  });

  assert.equal(plan.proofFound, true);
  assert.equal(plan.reviewRequired, true);
  assert.deepEqual(plan.completeness, { prompt: false, identity: true, address: true, path: true, value: true });
  assert.deepEqual(plan.missing, ["prompt"]);
  assert.match(plan.reason, /command prompt and returned prompt/iu);
});

test("missing proof value explicitly falls back to the visible viewport", () => {
  const snapshot = { columns: 80, rows: 3, viewportY: 2, lines: rows(["zero", "one", "two", "three", "four", "five"]) };
  const plan = planTerminalCapture(snapshot, { mode: "proof", proofValue: "not-present" });
  assert.equal(plan.requestedMode, "proof");
  assert.equal(plan.mode, "visible");
  assert.equal(plan.fallbackMode, "visible");
  assert.equal(plan.reviewRequired, true);
  assert.deepEqual(plan.rows.map((row) => row.text), ["two", "three", "four"]);
  assert.match(plan.reason, /no longer present/iu);
});

test("visible capture uses public viewport bounds without changing row order", () => {
  const source = rows(["zero", "one", "two", "", "four", "five"]);
  const plan = planTerminalCapture({ columns: 80, rows: 4, viewportY: 1, lines: source }, { mode: "visible" });
  assert.equal(plan.start, 1);
  assert.equal(plan.end, 5);
  assert.deepEqual(plan.rows.map((row) => row.text), ["one", "two", "", "four"]);
  assert.deepEqual(source.map((row) => row.text), ["zero", "one", "two", "", "four", "five"]);
});

test("last-line capture validates whole numbers and clamps to safe bounds", () => {
  assert.equal(normalizeLastLineCount(1), 5);
  assert.equal(normalizeLastLineCount("40"), 40);
  assert.equal(normalizeLastLineCount(9000), 500);
  for (const invalid of ["", "4.5", -1, 2.5, "10;rm -rf", null, undefined]) {
    assert.throws(() => normalizeLastLineCount(invalid), /whole number/iu);
  }
  const plan = planTerminalCapture({ columns: 80, rows: 3, lines: rows(["a", "b", "c", "d", "e", "f", "", ""]) }, { mode: "last", lineCount: 5 });
  assert.deepEqual(plan.rows.map((row) => row.text), ["b", "c", "d", "e", "f"]);
});

test("full capture preserves every physical row and paginates without loss", () => {
  const count = 1200;
  const source = Array.from({ length: count }, (_, index) => ({ text: `row-${index}`, isWrapped: index % 7 === 0 }));
  const plan = planTerminalCapture({ columns: 220, rows: 24, lines: source }, { mode: "full" });
  assert.equal(plan.start, 0);
  assert.equal(plan.end, count);
  assert.equal(plan.lineCount, count);
  assert.ok(plan.pages.length > 1);
  const flattened = plan.pages.flatMap((page) => page.rows.map((row) => row.text));
  assert.deepEqual(flattened, source.map((row) => row.text));
  for (const page of plan.pages) {
    assert.ok(page.dimensions.height <= TERMINAL_CAPTURE_LIMITS.maxCanvasHeight);
    assert.ok(page.dimensions.width * page.dimensions.height <= TERMINAL_CAPTURE_LIMITS.maxCanvasPixels);
  }
  for (let index = 1; index < plan.pages.length; index += 1) {
    assert.equal(plan.pages[index - 1].end, plan.pages[index].start);
  }
});

test("pagination keeps styled cells, Unicode, and wrapped-row metadata", () => {
  const source = [{
    text: "λ shell 🚩",
    isWrapped: true,
    cells: [{ column: 0, width: 1, text: "λ", fg: "#ffcc4d", bold: true }],
  }];
  const [page] = paginateTerminalRows(source, { columns: 80, start: 12 });
  assert.equal(page.start, 12);
  assert.equal(page.end, 13);
  assert.equal(page.rows[0].text, "λ shell 🚩");
  assert.equal(page.rows[0].isWrapped, true);
  assert.deepEqual(page.rows[0].cells[0], source[0].cells[0]);
});

test("capture dimensions derive from columns and obey height and pixel budgets", () => {
  const narrow = terminalCaptureDimensions(1, 1);
  const wide = terminalCaptureDimensions(999, 5000);
  assert.equal(narrow.width, TERMINAL_CAPTURE_LIMITS.minCanvasWidth);
  assert.ok(wide.width <= TERMINAL_CAPTURE_LIMITS.maxCanvasWidth);
  assert.ok(wide.width > narrow.width);
  assert.ok(wide.height <= TERMINAL_CAPTURE_LIMITS.maxCanvasHeight);
  assert.ok(wide.width * wide.height <= TERMINAL_CAPTURE_LIMITS.maxCanvasPixels);
  assert.ok(wide.linesPerPage > 0);
});

test("filenames are deterministic, filesystem-safe, and number multipart captures", () => {
  const filename = terminalCaptureFilename({
    targetSlug: "Førést / 10.129.95.210; $(bad)",
    proofKind: "Root proof",
    timestamp: "2026-11-17T15:53:58.491Z",
    part: 2,
    parts: 12,
  });
  assert.equal(filename, "forest-10-129-95-210-bad-root-proof-2026-11-17T15-53-58-491Z-part-02-of-12.png");
  assert.doesNotMatch(filename, /[/$(); ]/u);
});

test("snapshot normalization copies input rows and bounds public dimensions", () => {
  const source = { columns: 900, rows: 0, viewportY: 99, lines: [{ text: "one", cells: [{ text: "o" }] }] };
  const normalized = normalizeTerminalSnapshot(source);
  assert.equal(normalized.columns, 500);
  assert.equal(normalized.rows, 24);
  assert.equal(normalized.viewportY, 0);
  normalized.lines[0].cells[0].text = "changed";
  assert.equal(source.lines[0].cells[0].text, "o");
});

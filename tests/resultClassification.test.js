import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ITEMS } from "../src/data/checklist.js";
import { PIVOT_STEPS } from "../src/data/pivotPlaybooks.js";
import { auditCommandRecord, createCommandRecord } from "../src/lib/commandContract.js";
import { deriveCommandNarrative } from "../src/lib/narrative.js";
import { buildSmbDownloadCommands } from "../src/lib/smbCommands.js";
import { buildSprayCommands } from "../src/lib/sprayCommands.js";
import { buildUsersFileCommand } from "../src/lib/userCommands.js";
import {
  classifyCommandResult,
  classifyItemResult,
  RESULT_CATEGORIES,
  RESULT_CATEGORY_VALUES,
  resultCategoryLabel,
  resultStateLabel,
  resultStateOptions,
} from "../src/lib/resultClassification.js";
import { RESULT_STATES } from "../src/lib/workspace.js";

const item = (id) => ALL_ITEMS.find((candidate) => candidate.id === id);
const command = (itemId, label) => item(itemId).commands.find((candidate) => candidate.label === label);

test("stable command metadata derives semantic result categories", () => {
  assert.equal(command("setup-workspace", "Create folders").resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(command("setup-workspace", "Start command log").resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(command("recon-tcp-all", "Full TCP").resultCategory, RESULT_CATEGORIES.DISCOVERY);
  assert.equal(command("access-remote", "Check remote-management ports").resultCategory, RESULT_CATEGORIES.ACCESS);
  assert.equal(command("proof-linux", "User-level proof block").resultCategory, RESULT_CATEGORIES.PROOF);
  assert.equal(command("proof-cleanup", "Stop terminal log").resultCategory, RESULT_CATEGORIES.CLEANUP);

  const change = createCommandRecord({ id: "ad-control", title: "Directory control" }, {
    label: "Grant one reviewed directory right",
    value: "tool --grant selected-right",
    stateChange: "directory-service",
  });
  assert.equal(change.resultCategory, RESULT_CATEGORIES.CHANGE);
});

test("explicit categories win while legacy records remain deterministically classifiable", () => {
  assert.equal(classifyCommandResult("setup-resources", { label: "Legacy resource check", command: "ls /usr/share" }), RESULT_CATEGORIES.PREPARATION);
  assert.equal(classifyCommandResult("recon-tcp-all", { label: "Legacy scan", command: "nmap host" }), RESULT_CATEGORIES.DISCOVERY);
  assert.equal(classifyCommandResult("recon-tcp-all", { label: "Special validation", resultCategory: RESULT_CATEGORIES.VALIDATION }), RESULT_CATEGORIES.VALIDATION);
});

test("item categories remain concise and expose genuinely mixed activity", () => {
  assert.equal(classifyItemResult(item("setup-workspace"), item("setup-workspace").commands), RESULT_CATEGORIES.PREPARATION);
  assert.equal(classifyItemResult(item("recon-tcp-all"), item("recon-tcp-all").commands), RESULT_CATEGORIES.DISCOVERY);
  assert.equal(classifyItemResult({ id: "custom", title: "Custom" }, [
    { resultCategory: RESULT_CATEGORIES.PREPARATION },
    { resultCategory: RESULT_CATEGORIES.ACCESS },
  ]), RESULT_CATEGORIES.MIXED);
});

test("every static and pivot command has one valid non-mixed category", () => {
  for (const entry of [...ALL_ITEMS.flatMap((candidate) => candidate.commands), ...PIVOT_STEPS]) {
    assert.ok(RESULT_CATEGORY_VALUES.includes(entry.resultCategory), entry.id);
    assert.notEqual(entry.resultCategory, RESULT_CATEGORIES.MIXED, entry.id);
  }
});

test("generated spray, SMB download, and pivot commands retain explicit semantic categories", () => {
  const workspace = {
    activeTargetId: "target-a",
    variables: { targetName: "Target A", user: "alice" },
    accounts: [],
    users: [{ targetId: "target-a", username: "alice" }],
    discoveries: [],
    parserSettings: {},
    ignoredDiscoveries: [],
  };
  const sprayRecords = buildSprayCommands(workspace, { id: "credential-a", secret: "Winter2026!" })
    .map((entry, index) => createCommandRecord(item("creds-spray"), entry, index));
  const hashSpray = buildSprayCommands(workspace, { id: "credential-hash", secret: "0123456789abcdef0123456789abcdef" })
    .map((entry, index) => createCommandRecord(item("creds-spray"), entry, index));
  const smbRecords = buildSmbDownloadCommands([], {})
    .map((entry, index) => createCommandRecord(item("svc-smb"), entry, index));
  const usersFile = createCommandRecord(item("creds-spray"), buildUsersFileCommand(workspace), 20);
  const pivotByKey = new Map(PIVOT_STEPS.map((entry) => [entry.key, entry]));

  assert.equal(usersFile.resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(sprayRecords.find((entry) => entry.key.startsWith("spray-output-directory-")).resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(sprayRecords.find((entry) => entry.key.startsWith("spray-one-password-")).resultCategory, RESULT_CATEGORIES.ACCESS);
  assert.equal(hashSpray.find((entry) => entry.key.startsWith("spray-one-hash-")).resultCategory, RESULT_CATEGORIES.ACCESS);
  assert.ok(smbRecords.every((entry) => entry.resultCategory === RESULT_CATEGORIES.DISCOVERY));
  assert.equal(command("creds-crack", "Prepare rockyou").resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(pivotByKey.get("pivot-ligolo-inventory").resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.equal(pivotByKey.get("pivot-direct-route").resultCategory, RESULT_CATEGORIES.DISCOVERY);
  assert.equal(pivotByKey.get("pivot-ligolo-route-verify").resultCategory, RESULT_CATEGORIES.VALIDATION);
  assert.equal(pivotByKey.get("pivot-ligolo-route-add").resultCategory, RESULT_CATEGORIES.CHANGE);
  assert.equal(pivotByKey.get("pivot-ligolo-route-delete").resultCategory, RESULT_CATEGORIES.CLEANUP);
});

test("the command audit rejects an unknown explicit result category", () => {
  const record = createCommandRecord({ id: "test", title: "Test" }, {
    label: "Bad category",
    value: "true",
    resultCategory: "invented-category",
  });
  assert.match(auditCommandRecord(record).errors.join("\n"), /invalid resultCategory invented-category/u);
});

test("friendly labels retain the existing persisted outcome values", () => {
  const options = resultStateOptions(RESULT_CATEGORIES.PREPARATION);
  assert.deepEqual(options.map((entry) => entry.value), [
    RESULT_STATES.REVIEW,
    RESULT_STATES.CONFIRMED,
    RESULT_STATES.NO_FINDING,
    RESULT_STATES.FAILED,
    RESULT_STATES.BLOCKED,
  ]);
  assert.equal(resultCategoryLabel(RESULT_CATEGORIES.PREPARATION), "Preparation");
  assert.equal(resultStateLabel(RESULT_STATES.CONFIRMED, RESULT_CATEGORIES.PREPARATION), "Preparation verified");
  assert.equal(resultStateLabel(RESULT_STATES.CONFIRMED, RESULT_CATEGORIES.ACCESS), "Access confirmed");
  assert.equal(resultStateLabel(RESULT_STATES.CONFIRMED, RESULT_CATEGORIES.CLEANUP), "Cleanup verified");
});

test("confirmed preparation prose does not claim a vulnerability finding", () => {
  const narrative = deriveCommandNarrative({
    command: {
      itemId: "setup-workspace",
      commandKey: "setup-workspace-0",
      label: "Create folders",
      command: "mkdir -p target/notes",
      exitCode: 0,
    },
    resultState: RESULT_STATES.CONFIRMED,
    evidence: [{ content: "notes", exitCode: 0 }],
  });
  assert.equal(narrative.resultCategory, RESULT_CATEGORIES.PREPARATION);
  assert.match(narrative.finding, /verified the preparation step/iu);
  assert.doesNotMatch(narrative.finding, /finding/iu);
});

test("exit zero never selects an outcome automatically", () => {
  const narrative = deriveCommandNarrative({
    command: { itemId: "setup-resources", label: "Resource links", command: "ls /usr/share", exitCode: 0 },
    evidence: [{ content: "resources", exitCode: 0 }],
  });
  assert.equal(narrative.resultState, RESULT_STATES.REVIEW);
  assert.equal(narrative.ready, false);
});

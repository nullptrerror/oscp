import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTargetNarrativeModel,
  commandNarrativeDraft,
  deriveCommandNarrative,
  deriveItemNarrative,
  isAutomaticNarrative,
  narrativeFromDiscoveries,
  rollupItemResultState,
} from "../src/lib/narrative.js";
import { createDefaultWorkspace, normalizeWorkspace, RESULT_STATES, WORKSPACE_VERSION } from "../src/lib/workspace.js";

test("commands receive editable generic narrative drafts", () => {
  const draft = commandNarrativeDraft("nmap -sCV 10.0.0.1", "Focused scan");
  assert.equal(isAutomaticNarrative(draft.finding), true);
  assert.match(draft.finding, /saved output/i);
  assert.match(draft.nextStep, /focused service enumeration/i);
});

test("generic undecided guidance remains available only before command classification", () => {
  const draft = commandNarrativeDraft("true", "Neutral check");
  const confirmedWithoutDiscoveries = deriveCommandNarrative({
    command: {
      label: "Neutral check",
      command: "true",
      reportContext: { resultCategory: "discovery" },
    },
    resultState: RESULT_STATES.CONFIRMED,
  });
  const confirmedWithUnsupportedDiscovery = deriveCommandNarrative({
    command: {
      label: "Neutral check",
      command: "true",
      reportContext: { resultCategory: "discovery" },
    },
    resultState: RESULT_STATES.CONFIRMED,
    discoveries: [{ type: "group", value: "Reviewed Operators", status: "confirmed" }],
  });

  assert.match(draft.nextStep, /decide whether this hypothesis was confirmed or ruled out/iu);
  for (const narrative of [confirmedWithoutDiscoveries, confirmedWithUnsupportedDiscovery]) {
    assert.match(narrative.nextStep, /preserve the confirmed evidence/iu);
    assert.doesNotMatch(narrative.nextStep, /decide whether|confirmed or ruled out/iu);
  }
});

test("confirmed commands retain specific tool guidance", () => {
  const narrative = deriveCommandNarrative({
    command: {
      label: "Focused scan",
      command: "nmap -sCV 192.0.2.10",
      reportContext: { resultCategory: "discovery" },
    },
    resultState: RESULT_STATES.CONFIRMED,
  });

  assert.match(narrative.nextStep, /focused service enumeration/iu);
  assert.doesNotMatch(narrative.nextStep, /preserve the confirmed evidence/iu);
});

test("parsed output produces concrete findings and next-step context", () => {
  const narrative = narrativeFromDiscoveries([
    { type: "port", value: "445", protocol: "tcp", service: "microsoft-ds", state: "open" },
    { type: "flag", value: "ed7471e27363eaa77b804cd997ac8fe2", kind: "user" },
  ], { exitCode: 0 });
  assert.match(narrative.finding, /445\/tcp/);
  assert.match(narrative.finding, /user-level proof/);
  assert.match(narrative.nextStep, /privilege-escalation/i);
});

test("unsupported discoveries defer item decisions while command-level guidance remains available", () => {
  const discoveries = [{ type: "group", value: "Reviewed Operators", status: "confirmed" }];
  const itemLevel = narrativeFromDiscoveries(discoveries);
  const commandLevel = narrativeFromDiscoveries(discoveries, {
    command: "getent group reviewed-operators",
    label: "Inspect one group",
  });

  assert.equal(itemLevel.nextStep, "");
  assert.match(commandLevel.nextStep, /decide whether this hypothesis was confirmed or ruled out/iu);
});

test("confirmed neutral discoveries cannot replace preparation or cleanup decisions with undecided prose", () => {
  const discoveries = [{ type: "group", value: "Reviewed Operators", status: "confirmed" }];
  const cases = [
    {
      item: { id: "recon-neutral", title: "Review a neutral discovery" },
      command: {
        itemId: "recon-neutral",
        label: "Neutral check",
        command: "true",
        reportContext: { resultCategory: "discovery" },
      },
      expected: /preserve the confirmed evidence/iu,
    },
    {
      item: { id: "setup-workspace", title: "Prepare the workspace" },
      command: {
        itemId: "setup-workspace",
        label: "Create folders",
        command: "mkdir -p target/notes",
        reportContext: { resultCategory: "preparation" },
      },
      expected: /first applicable machine-scoped check/iu,
    },
    {
      item: { id: "proof-cleanup", title: "Close the terminal log" },
      command: {
        itemId: "proof-cleanup",
        label: "Stop terminal log",
        command: "exit",
        reportContext: { resultCategory: "cleanup" },
      },
      expected: /cleanup verification output/iu,
    },
  ];

  for (const entry of cases) {
    const commandNarrative = deriveCommandNarrative({
      command: entry.command,
      resultState: RESULT_STATES.CONFIRMED,
    });
    const itemNarrative = deriveItemNarrative({
      item: entry.item,
      commands: [commandNarrative],
      discoveries,
    });

    assert.match(itemNarrative.nextStep, entry.expected);
    assert.doesNotMatch(itemNarrative.nextStep, /decide whether|confirmed or ruled out/iu);
  }
});

test("exit zero and unconfirmed parser candidates never become report findings", () => {
  const narrative = deriveCommandNarrative({
    command: { label: "Focused scan", command: "nmap -sCV 10.0.0.1", exitCode: 0 },
    resultState: RESULT_STATES.REVIEW,
    discoveries: [{ type: "port", value: "445", protocol: "tcp", service: "microsoft-ds", status: "candidate" }],
  });

  assert.equal(narrative.ready, false);
  assert.equal(narrative.resultState, RESULT_STATES.REVIEW);
  assert.match(narrative.finding, /unclassified/i);
  assert.doesNotMatch(narrative.finding, /445/);
});

test("operator-confirmed command states produce conservative deterministic prose", () => {
  const confirmed = deriveCommandNarrative({
    command: { label: "Focused scan", command: "nmap -sCV 10.0.0.1" },
    resultState: RESULT_STATES.CONFIRMED,
    discoveries: [{ type: "port", value: "445", protocol: "tcp", service: "microsoft-ds", status: "confirmed" }],
  });
  const absent = deriveCommandNarrative({
    command: { label: "Anonymous SMB", command: "smbclient -L //10.0.0.1 -N" },
    resultState: RESULT_STATES.NO_FINDING,
  });
  const failed = deriveCommandNarrative({
    command: { label: "Focused scan", command: "nmap -sCV 10.0.0.1", exitCode: 2 },
    resultState: RESULT_STATES.FAILED,
  });
  const blocked = deriveCommandNarrative({
    command: { label: "Remote login", command: "ssh user@10.0.0.1" },
    resultState: RESULT_STATES.BLOCKED,
  });

  assert.equal(confirmed.ready, true);
  assert.match(confirmed.finding, /445\/tcp/);
  assert.match(absent.finding, /no evidence/i);
  assert.match(failed.finding, /status 2/);
  assert.match(blocked.finding, /no finding is claimed/i);
});

test("failed cleanup is reported as unresolved instead of a completed rollback", () => {
  const narrative = deriveCommandNarrative({
    command: { commandKey: "acl-cleanup", label: "Restore DACL backup", command: "impacket-dacledit -action restore" },
    resultState: RESULT_STATES.FAILED,
  });

  assert.equal(narrative.role, "cleanup");
  assert.equal(narrative.cleanupResolved, false);
  assert.match(narrative.nextStep, /cleanup remains unresolved/i);
});

test("classified legacy branches cannot reopen review, including cleanup results", () => {
  const legacyPositive = "Save the exact output, mark the result needs review, then manually confirm or reject the finding before another card becomes applicable.";
  const legacyNegative = "Save the exact output and choose no finding, command failed, blocked, or needs review; use a listed fallback only after confirming why it applies.";
  const command = {
    label: "Restore DACL backup",
    command: "impacket-dacledit -action restore",
    reportContext: {
      resultCategory: "cleanup",
      positiveBranch: legacyPositive,
      negativeBranch: legacyNegative,
    },
  };
  const confirmed = deriveCommandNarrative({ command, resultState: RESULT_STATES.CONFIRMED });
  const absent = deriveCommandNarrative({ command, resultState: RESULT_STATES.NO_FINDING });

  assert.equal(confirmed.role, "cleanup");
  assert.equal(absent.role, "cleanup");
  assert.match(confirmed.nextStep, /cleanup verification output/iu);
  assert.doesNotMatch(`${confirmed.finding} ${confirmed.nextStep}`, /needs review/iu);
  assert.doesNotMatch(`${absent.finding} ${absent.nextStep}`, /needs review/iu);
});

test("classified narratives preserve genuine custom branches", () => {
  const command = {
    label: "Restore DACL backup",
    command: "impacket-dacledit -action restore",
    reportContext: {
      resultCategory: "cleanup",
      positiveBranch: "Retain the custom restoration evidence and close the change record.",
      negativeBranch: "Retain the custom absence evidence and document why no restoration was required.",
    },
  };

  assert.equal(
    deriveCommandNarrative({ command, resultState: RESULT_STATES.CONFIRMED }).nextStep,
    "Derived: Retain the custom restoration evidence and close the change record.",
  );
  assert.equal(
    deriveCommandNarrative({ command, resultState: RESULT_STATES.NO_FINDING }).nextStep,
    "Derived: Retain the custom absence evidence and document why no restoration was required.",
  );
});

test("item rollup requires every command classification and resolves only safe combinations", () => {
  assert.equal(rollupItemResultState([RESULT_STATES.CONFIRMED, RESULT_STATES.NO_FINDING]), RESULT_STATES.CONFIRMED);
  assert.equal(rollupItemResultState([RESULT_STATES.NO_FINDING, RESULT_STATES.NO_FINDING]), RESULT_STATES.NO_FINDING);
  assert.equal(rollupItemResultState([RESULT_STATES.FAILED, RESULT_STATES.FAILED]), RESULT_STATES.FAILED);
  assert.equal(rollupItemResultState([RESULT_STATES.BLOCKED, RESULT_STATES.BLOCKED]), RESULT_STATES.BLOCKED);
  assert.equal(rollupItemResultState([RESULT_STATES.CONFIRMED, RESULT_STATES.FAILED]), RESULT_STATES.REVIEW);
  assert.equal(rollupItemResultState([RESULT_STATES.CONFIRMED, RESULT_STATES.REVIEW]), RESULT_STATES.REVIEW);
  assert.equal(rollupItemResultState([RESULT_STATES.REVIEW], RESULT_STATES.NO_FINDING), RESULT_STATES.NO_FINDING);
});

test("derived item narratives preserve genuine manual overrides", () => {
  const narrative = deriveItemNarrative({
    item: { title: "Enumerate SMB" },
    commands: [{
      resultState: RESULT_STATES.CONFIRMED,
      ready: true,
      finding: "Derived: The server exposed a readable share.",
      nextStep: "Derived: Review the share contents.",
      cleanupResolved: true,
    }],
    storedFinding: "Manual finding retained exactly.",
    storedNextStep: "Attempt: old automatic text",
  });

  assert.equal(narrative.resultState, RESULT_STATES.CONFIRMED);
  assert.equal(narrative.finding, "Manual finding retained exactly.");
  assert.match(narrative.nextStep, /^Derived:/);
  assert.equal(narrative.manualFinding, true);
  assert.equal(narrative.manualNextStep, false);
});

test("target narrative model uses only linked confirmed discoveries and classified local runs", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-one";
  workspace.targets = [{ id: "target-one", name: "one", host: "10.0.0.1" }];
  workspace.commandHistory = [
    {
      id: "run-one",
      targetId: "target-one",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
    },
    {
      id: "orphan-run",
      targetId: "target-one",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "removed-fallback",
      label: "Removed fallback",
      command: "smbclient -L //10.0.0.1 -N",
    },
  ];
  workspace.evidence["target-one::svc-smb"] = [{ id: "evidence-one", commandRunId: "run-one", commandKey: "list-shares", content: "Sharename" }];
  workspace.commandResultStates["target-one::svc-smb::list-shares"] = RESULT_STATES.CONFIRMED;
  workspace.resultStates["target-one::svc-smb"] = RESULT_STATES.REVIEW;
  workspace.discoveries = [
    { id: "confirmed", targetId: "target-one", itemId: "svc-smb", evidenceId: "evidence-one", type: "share", value: "Public", status: "confirmed" },
    { id: "candidate", targetId: "target-one", itemId: "svc-smb", evidenceId: "evidence-one", type: "share", value: "Unreviewed", status: "candidate" },
  ];

  const model = buildTargetNarrativeModel(workspace, [{ id: "svc-smb", title: "SMB", phaseId: "services" }], "target-one");
  assert.deepEqual(model.activityItemIds, ["svc-smb"]);
  assert.equal(model.items["svc-smb"].resultState, RESULT_STATES.CONFIRMED);
  assert.equal(model.items["svc-smb"].ready, true);
  assert.equal(model.items["svc-smb"].commands.length, 1);
  assert.equal(model.commands["orphan-run"], undefined);
  assert.match(model.items["svc-smb"].finding, /Public/);
  assert.doesNotMatch(model.items["svc-smb"].finding, /Unreviewed/);
});

test("a confirmed rerun never relabels an earlier failed command run", () => {
  const workspace = createDefaultWorkspace();
  workspace.activeTargetId = "target-one";
  workspace.targets = [{ id: "target-one", name: "one", host: "10.0.0.1" }];
  workspace.commandHistory = [
    {
      id: "failed-run",
      targetId: "target-one",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
    },
    {
      id: "confirmed-rerun",
      targetId: "target-one",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
    },
  ];
  workspace.evidence["target-one::svc-smb"] = [
    { id: "failed-evidence", commandRunId: "failed-run", commandKey: "list-shares", content: "Connection refused" },
    { id: "confirmed-evidence", commandRunId: "confirmed-rerun", commandKey: "list-shares", content: "Sharename Public" },
  ];
  workspace.commandResultStates["target-one::svc-smb::list-shares::run:failed-run"] = RESULT_STATES.FAILED;
  workspace.commandResultStates["target-one::svc-smb::list-shares::run:confirmed-rerun"] = RESULT_STATES.CONFIRMED;

  const model = buildTargetNarrativeModel(workspace, [{ id: "svc-smb", title: "SMB", phaseId: "services" }], "target-one");

  assert.equal(model.commands["failed-run"].resultState, RESULT_STATES.FAILED);
  assert.match(model.commands["failed-run"].finding, /failed/i);
  assert.equal(model.commands["confirmed-rerun"].resultState, RESULT_STATES.CONFIRMED);
  assert.equal(model.items["svc-smb"].resultState, RESULT_STATES.REVIEW);
  assert.match(model.items["svc-smb"].finding, /unclassified activity/i);
});

test("a rerun keeps a normalized legacy classification on the run it originally described", () => {
  const workspace = normalizeWorkspace({
    version: WORKSPACE_VERSION,
    activeTargetId: "target-one",
    targets: [{ id: "target-one", name: "one", host: "10.0.0.1" }],
    commandHistory: [{
      id: "legacy-run",
      targetId: "target-one",
      source: "local runner",
      itemId: "svc-smb",
      commandKey: "list-shares",
      label: "List shares",
      command: "smbclient -L //10.0.0.1 -N",
    }],
    evidence: {
      "target-one::svc-smb": [{ id: "legacy-evidence", commandRunId: "legacy-run", commandKey: "list-shares", content: "Sharename Public" }],
    },
    commandResultStates: {
      "target-one::svc-smb::list-shares": RESULT_STATES.CONFIRMED,
    },
  });
  workspace.commandHistory.push({
    id: "new-rerun",
    targetId: "target-one",
    source: "local runner",
    itemId: "svc-smb",
    commandKey: "list-shares",
    label: "List shares",
    command: "smbclient -L //10.0.0.1 -N",
  });
  workspace.evidence["target-one::svc-smb"].push({ id: "new-evidence", commandRunId: "new-rerun", commandKey: "list-shares", content: "Connection refused" });
  workspace.commandResultStates["target-one::svc-smb::list-shares::run:new-rerun"] = RESULT_STATES.REVIEW;

  const model = buildTargetNarrativeModel(workspace, [{ id: "svc-smb", title: "SMB", phaseId: "services" }], "target-one");

  assert.equal(model.commands["legacy-run"].resultState, RESULT_STATES.CONFIRMED);
  assert.equal(model.commands["new-rerun"].resultState, RESULT_STATES.REVIEW);
  assert.equal(model.items["svc-smb"].resultState, RESULT_STATES.REVIEW);
});

import test from "node:test";
import assert from "node:assert/strict";
import { VARIABLE_DEFINITIONS } from "../src/data/variableDefinitions.js";
import { auditCommandRecord, extractCommandVariables } from "../src/lib/commandContract.js";
import {
  PIVOT_PLAYBOOKS,
  PIVOT_STEPS,
  PIVOT_STEP_BY_ID,
  pivotPlaybookById,
  stepsForPivotPlaybook,
} from "../src/data/pivotPlaybooks.js";

test("pivot playbook and step IDs are stable, unique, and fully resolved", () => {
  assert.equal(new Set(PIVOT_PLAYBOOKS.map((entry) => entry.id)).size, PIVOT_PLAYBOOKS.length);
  assert.equal(new Set(PIVOT_STEPS.map((entry) => entry.id)).size, PIVOT_STEPS.length);
  for (const playbook of PIVOT_PLAYBOOKS) {
    assert.ok(playbook.stepIds.length > 0, `${playbook.id} has no steps`);
    assert.ok(playbook.stepIds.every((id) => PIVOT_STEP_BY_ID[id]), `${playbook.id} has an unknown step`);
    assert.deepEqual(stepsForPivotPlaybook(playbook.id).map((entry) => entry.id), playbook.stepIds);
  }
  assert.equal(pivotPlaybookById("missing"), undefined);
});

test("every pivot step satisfies the structured command and policy contract", () => {
  for (const step of PIVOT_STEPS) {
    const audit = auditCommandRecord(step);
    assert.deepEqual(audit.errors, [], `${step.id}: ${audit.errors.join("; ")}`);
    assert.ok(["lhost", "pivot"].includes(step.runsOn), `${step.id} has an ambiguous RUN ON host`);
    assert.equal(step.policy, "exam-core");
    assert.ok(step.prerequisites.length > 0);
    assert.ok(step.expectedPositiveSignal);
    assert.ok(step.expectedNegativeSignal);
    assert.ok(step.verificationCommand);
    assert.ok(step.cleanup);
  }
});

test("all placeholders across commands, verification, and cleanup are typed", () => {
  for (const step of PIVOT_STEPS) {
    const text = [step.template, step.verificationCommand, step.cleanupCommand, step.cleanup?.command].filter(Boolean).join("\n");
    for (const variable of extractCommandVariables(text)) {
      assert.ok(VARIABLE_DEFINITIONS[variable], `${step.id} uses undeclared ${variable}`);
    }
  }
});

test("one-hop Ligolo sequences cover staging, selection, routing, DNS, callbacks, verification, and teardown", () => {
  for (const id of ["pivot-ligolo-one-hop-linux", "pivot-ligolo-one-hop-windows"]) {
    const steps = stepsForPivotPlaybook(id);
    const commands = steps.map((entry) => entry.template).join("\n");
    assert.match(commands, /ligolo-proxy/);
    assert.match(commands, /sha256sum|Get-FileHash/);
    assert.match(commands, /^session$/m);
    assert.match(commands, /route_add/);
    assert.match(commands, /tunnel_start/);
    assert.match(commands, /ip route show/);
    assert.match(commands, /dig @/);
    assert.match(commands, /listener_add/);
    assert.match(commands, /listener_stop/);
    assert.match(commands, /tunnel_stop/);
    assert.match(commands, /route_del/);
    assert.match(commands, /interface_delete/);
    assert.ok(steps.some((entry) => entry.stateChange === "target-file" && entry.cleanup.required));
  }
});

test("two-hop Ligolo keeps distinct route owners and tears down hop two first", () => {
  const playbook = pivotPlaybookById("pivot-ligolo-two-hop-linux");
  const steps = stepsForPivotPlaybook(playbook.id);
  const firstRoute = steps.find((entry) => entry.id === "pivot.ligolo-route-add");
  const secondRoute = steps.find((entry) => entry.id === "pivot.ligolo-second-route-add");
  assert.equal(firstRoute.routeOwner, "first-hop");
  assert.equal(secondRoute.routeOwner, "second-hop");
  assert.match(secondRoute.template, /\{\{pivotInterface\}\}-2/);
  assert.match(secondRoute.template, /\{\{internalSubnet\}\}/);
  assert.match(steps.map((entry) => entry.template).join("\n"), /11602/);

  const secondStop = playbook.teardownOrder.indexOf("pivot.ligolo-second-tunnel-stop");
  const firstStop = playbook.teardownOrder.indexOf("pivot.ligolo-tunnel-stop");
  assert.ok(secondStop >= 0 && firstStop > secondStop, "second tunnel must stop before the first tunnel");
  assert.ok(playbook.teardownOrder.indexOf("pivot.ligolo-second-route-delete") < playbook.teardownOrder.indexOf("pivot.ligolo-second-interface-delete"));
});

test("callback and relay directions are explicit", () => {
  const directional = PIVOT_STEPS.filter((entry) => entry.direction);
  assert.ok(directional.length >= 7);
  assert.ok(directional.every((entry) => /->/.test(entry.direction)));
  assert.match(PIVOT_STEP_BY_ID["pivot.ligolo-callback-listener"].direction, /internal target.*pivot.*LHOST/i);
  assert.match(PIVOT_STEP_BY_ID["pivot.ligolo-second-agent-start"].direction, /pivot two.*pivotHost.*LHOST/i);
});

test("SSH covers dynamic, local, remote, TCP-connect scanning, and DNS without leakage", () => {
  const commands = stepsForPivotPlaybook("pivot-ssh").map((entry) => entry.template).join("\n");
  assert.match(commands, / -D 127\.0\.0\.1:/);
  assert.match(commands, / -L 127\.0\.0\.1:/);
  assert.match(commands, / -R 0\.0\.0\.0:/);
  assert.match(commands, /proxychains4 -q nmap -sT -Pn -n/);
  assert.match(commands, /proxychains4 -q dig \+tcp/);
  assert.doesNotMatch(commands, /nmap\s+-sS/);
});

test("fallbacks remain bounded, manual, and removable", () => {
  const chisel = stepsForPivotPlaybook("pivot-chisel-fallback");
  const socat = stepsForPivotPlaybook("pivot-socat-fallback");
  assert.match(chisel.map((entry) => entry.template).join("\n"), /R:\{\{proxyPort\}\}:socks/);
  assert.ok(chisel.some((entry) => entry.id === "pivot.chisel-file-cleanup"));
  assert.equal(socat.filter((entry) => entry.stateChange === "listener" && entry.executionEnabled).length, 1);
  assert.match(socat[0].template, /TCP-LISTEN.*TCP:/);
  assert.ok(PIVOT_STEPS.every((entry) => !/\b(?:curl|wget)\b[^\n]*https?:\/\/(?!\{\{(?:lhost|pivotHost)\}\})/u.test(entry.template)), "no runtime internet downloads");
});

test("state-changing steps always warn, verify, and provide cleanup", () => {
  for (const step of PIVOT_STEPS.filter((entry) => entry.stateChange !== "none")) {
    assert.ok(step.warning, `${step.id} missing warning`);
    assert.ok(step.verificationCommand, `${step.id} missing verification`);
    assert.ok(step.cleanup.command || step.cleanup.note, `${step.id} missing cleanup`);
  }
});

test("the dataset contains no autonomous pivot chain or multi-target runner", () => {
  for (const step of PIVOT_STEPS) {
    assert.doesNotMatch(step.template, /(?:&&|;).*\b(?:route_add|tunnel_start|listener_add|ssh|chisel|socat)\b/u, `${step.id} chains an attack-relevant state change`);
    assert.doesNotMatch(step.template, /\bfor\s+\w+\s+in\b/u, `${step.id} loops across targets`);
    assert.equal(step.policy === "prohibited" && step.executionEnabled, false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateActions } from "../src/domain/constraint-engine.js";
import { solveWithBeam } from "../src/planning/beam-reconfiguration-solver.js";
import { buildReconfigurationProblem } from "../src/planning/reconfiguration-problem.js";
import {
  batchFixture,
  normalMigrationFixture,
  threeMoveFixture,
} from "./fixtures/reconfiguration-fixtures.js";

function migrationCount(candidate) {
  return candidate.actions.filter((action) => action.type === "move_device").length;
}

function assertUniqueResources(candidate) {
  const power = candidate.actions.flatMap((action) => action.power_connections ?? [])
    .map((item) => `${item.pdu_id}:${item.outlet}`);
  const network = candidate.actions.flatMap((action) => action.network_connections ?? [])
    .map((item) => `${item.switch_id}:${item.switch_port}`);
  assert.equal(new Set(power).size, power.length);
  assert.equal(new Set(network).size, network.length);
}

test("normal Beam compares zero, one, and two moves", () => {
  const { state, request } = normalMigrationFixture();
  const problem = buildReconfigurationProblem(state, request, { phase: "normal" });
  const result = solveWithBeam(state, problem, { validator: evaluateActions, maxBeams: 64 });
  const counts = new Set(result.candidates.map(migrationCount));

  assert.equal(result.outcome, "success");
  assert.equal(counts.has(0), true);
  assert.equal(counts.has(1), true);
  assert.equal(counts.has(2), true);
  assert.equal([...counts].every((count) => count <= 2), true);
  result.candidates.forEach(assertUniqueResources);
});

test("expanded Beam stops at the first feasible migration depth", () => {
  const { state, request } = threeMoveFixture();
  const problem = buildReconfigurationProblem(state, request, { phase: "expanded" });
  const result = solveWithBeam(state, problem, { validator: evaluateActions, maxBeams: 128 });

  assert.equal(result.outcome, "success");
  assert.equal(result.candidates.every((candidate) => migrationCount(candidate) === 3), true);
  assert.equal(result.solver.migration_depth, 3);
  result.candidates.forEach(assertUniqueResources);
});

test("Beam never emits a partial homogeneous batch", () => {
  const { state, request } = batchFixture({ count: 12 });
  const problem = buildReconfigurationProblem(state, request, { phase: "normal" });
  const result = solveWithBeam(state, problem, { validator: evaluateActions, maxBeams: 32 });

  assert.equal(result.outcome, "success");
  assert.equal(result.candidates.every((candidate) =>
    candidate.actions.filter((action) => action.type === "place_device").length === 12), true);
  result.candidates.forEach(assertUniqueResources);
});

test("Beam results are stable and never exceed four candidates", () => {
  const { state, request } = normalMigrationFixture();
  const problem = buildReconfigurationProblem(state, request, { phase: "normal" });
  const first = solveWithBeam(state, problem, { validator: evaluateActions, maxBeams: 64 });
  const second = solveWithBeam(state, problem, { validator: evaluateActions, maxBeams: 64 });

  assert.ok(first.candidates.length <= 4);
  assert.deepEqual(first.candidates.map((item) => item.id), second.candidates.map((item) => item.id));
});

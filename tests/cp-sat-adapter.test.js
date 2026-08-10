import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { evaluateActions } from "../src/domain/constraint-engine.js";
import { createCpSatAdapter } from "../src/planning/cp-sat-adapter.js";

function request(overrides = {}) {
  return {
    id: "ADAPTER-SRV",
    count: 1,
    u_size: 2,
    rated_power_w: 500,
    weight_kg: 20,
    network_ports: 2,
    preferred_rack_ids: [],
    ...overrides,
  };
}

function adapterReturning(payload, overrides = {}) {
  return createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    scriptPath: "solver/cp_sat_solver.py",
    runProcess: () => ({
      status: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
      ...overrides,
    }),
  });
}

test("adapter converts a valid Python placement and revalidates it", () => {
  const state = createDemoState();
  state.devices = [];
  const adapter = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 12,
    candidates: [{
      objective_value: 1,
      placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: 1 }],
    }],
  });

  const result = adapter.solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "success");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].validation.allowed, true);
  assert.equal(result.candidates[0].actions[0].device.id, "ADAPTER-SRV");
  assert.equal(result.solver.engine, "cp_sat");
});

test("adapter rejects unknown placements and maps process failures to safe codes", () => {
  const state = createDemoState();
  const invalid = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 1,
    candidates: [{
      objective_value: 1,
      placements: [{ device_index: 0, rack_id: "CAB-404", layer_id: "L01", start_u: 1 }],
    }],
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(invalid.outcome, "unavailable");
  assert.equal(invalid.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");

  const timedOut = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    runProcess: () => ({ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }),
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(timedOut.outcome, "unavailable");
  assert.equal(timedOut.solver.fallback_reason, "CP_SAT_TIMEOUT");
});

test("adapter enforces the four-candidate contract", () => {
  const state = createDemoState();
  state.devices = [];
  const candidates = [1, 3, 5, 7, 9].map((startU) => ({
    objective_value: startU,
    placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: startU }],
  }));
  const result = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 10,
    candidates,
  }).solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "unavailable");
  assert.equal(result.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");
});

test("adapter requires numeric integer device indexes and placement fields", () => {
  const state = createDemoState();
  state.devices = [];
  for (const placement of [
    { device_index: "0", rack_id: "CAB-01", layer_id: "L01", start_u: 1 },
    { device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: "1" },
  ]) {
    const result = adapterReturning({
      schema_version: 1,
      engine: "cp_sat",
      status: "optimal",
      duration_ms: 1,
      candidates: [{ objective_value: 1, placements: [placement] }],
    }).solve(state, request(), { strategyId: "balanced_optimal" });
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");
  }
});

test("adapter requires a finite numeric CP-SAT objective", () => {
  const state = createDemoState();
  state.devices = [];
  const stringObjective = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 1,
    candidates: [{
      objective_value: "1",
      placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: 1 }],
    }],
  }).solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(stringObjective.outcome, "unavailable");
  assert.equal(stringObjective.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");

  const nonFiniteObjective = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    runProcess: () => ({
      status: 0,
      stdout: '{"schema_version":1,"engine":"cp_sat","status":"optimal","duration_ms":1,"candidates":[{"objective_value":1e999,"placements":[{"device_index":0,"rack_id":"CAB-01","layer_id":"L01","start_u":1}]}]}',
      stderr: "",
    }),
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(nonFiniteObjective.outcome, "unavailable");
  assert.equal(nonFiniteObjective.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");
});

test("adapter rejects contradictory candidate-bearing infeasible responses", () => {
  const result = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "infeasible",
    duration_ms: 1,
    candidates: [{ objective_value: 1, placements: [] }],
  }).solve(createDemoState(), request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "unavailable");
  assert.equal(result.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");
});

test("adapter maps unknown runtime and validator codes to the stable process fallback", () => {
  const state = createDemoState();
  state.devices = [];
  const runtime = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    runProcess: () => { throw Object.assign(new Error("internal detail"), { code: "E_PRIVATE" }); },
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(runtime.solver.fallback_reason, "CP_SAT_PROCESS_FAILED");

  const validator = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: () => { throw Object.assign(new Error("internal detail"), { code: "E_PRIVATE" }); },
    runProcess: () => ({
      status: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        engine: "cp_sat",
        status: "optimal",
        duration_ms: 1,
        candidates: [{
          objective_value: 1,
          placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: 1 }],
        }],
      }),
      stderr: "",
    }),
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(validator.solver.fallback_reason, "CP_SAT_PROCESS_FAILED");
});

test("adapter measures an immediate process failure instead of reporting the timeout", () => {
  const result = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    runProcess: () => ({ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }),
  }).solve(createDemoState(), request(), { strategyId: "balanced_optimal" });

  assert.equal(result.solver.fallback_reason, "CP_SAT_TIMEOUT");
  assert.notEqual(result.solver.duration_ms, 2_500);
});

test("adapter rejects an oversized assignment model before starting Python", () => {
  const state = createDemoState();
  const template = state.racks.find((rack) => rack.id === "CAB-01");
  state.racks = Array.from({ length: 590 }, (_, index) => ({
    ...structuredClone(template),
    id: `MODEL-RACK-${String(index + 1).padStart(3, "0")}`,
    name: `Model rack ${index + 1}`,
    source_id: `MODEL-SOURCE-${index + 1}`,
    network_switch_id: `MODEL-SWITCH-${index + 1}`,
  }));
  state.devices = [];
  let processCalls = 0;
  const adapter = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    runProcess: () => {
      processCalls += 1;
      throw new Error("Python must not start for an oversized model");
    },
  });

  const result = adapter.solve(state, request({ u_size: 1 }), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "unavailable");
  assert.equal(result.solver.engine, "beam_search");
  assert.equal(result.solver.status, "fallback");
  assert.equal(result.solver.fallback_reason, "CP_SAT_MODEL_TOO_LARGE");
  assert.equal(processCalls, 0);
});

test("adapter keeps valid candidates and reports bounded rejection evidence for a mixed result", () => {
  const state = createDemoState();
  state.devices = [];
  const adapter = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    runProcess: () => {
      state.devices.push({
        id: "RACE-OCCUPANT",
        rack_id: "CAB-02",
        layer_id: "L01",
        start_u: 1,
        u_size: 2,
        rated_power_w: 100,
        real_power_w: null,
        weight_kg: 5,
        network_ports: 1,
        status: "running",
        data_source: "demo",
      });
      return {
        status: 0,
        stdout: JSON.stringify({
          schema_version: 1,
          engine: "cp_sat",
          status: "optimal",
          duration_ms: 9,
          candidates: [{
            objective_value: 1,
            placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: 1 }],
          }, {
            objective_value: 2,
            placements: [{ device_index: 0, rack_id: "CAB-02", layer_id: "L01", start_u: 1 }],
          }],
        }),
        stderr: "",
      };
    },
  });

  const result = adapter.solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "success");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].rack_id, "CAB-01");
  assert.equal(result.solver.candidate_count, 1);
  assert.equal(result.solver.validation_rejected_count, 1);
  assert.deepEqual(result.solver.validation_rejection_summary, [
    { code: "DEVICE_U_OVERLAP", count: 1 },
  ]);
});

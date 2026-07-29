import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { createPlanningEngine } from "../src/planning/planning-engine.js";

function request(overrides = {}) {
  return {
    id: "SRV-PLAN",
    count: 1,
    u_size: 4,
    rated_power_w: 1_800,
    weight_kg: 32,
    network_ports: 2,
    preferred_rack_ids: [],
    ...overrides,
  };
}

test("planner puts a 10U server in L01", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, request({
    id: "GPU-10U",
    u_size: 10,
    rated_power_w: 1_800,
    preferred_rack_ids: ["CAB-01"],
  }));

  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0].rack_id, "CAB-01");
  assert.equal(result.candidates[0].actions[0].layer_id, "L01");
  assert.equal(result.candidates[0].validation.allowed, true);
});

test("planner ranks an allowed preferred rack first", () => {
  const result = createPlanningEngine().recommend(createDemoState(), request({ preferred_rack_ids: ["CAB-03"] }));

  assert.equal(result.candidates[0].rack_id, "CAB-03");
  assert.ok(result.candidates[0].reasons.some((reason) => reason.includes("优选机柜")));
});

test("planner recommends movable dividers only when fixed layers cannot fit", () => {
  const state = createDemoState();
  state.devices = [{
    id: "FIXED-L01",
    rack_id: "CAB-01",
    layer_id: "L01",
    start_u: 1,
    u_size: 10,
    rated_power_w: 100,
    real_power_w: null,
    weight_kg: 10,
    network_ports: 1,
    movable: false,
    criticality: "normal",
    maintenance_window: null,
    status: "running",
    data_source: "demo",
  }];
  state.racks = state.racks.map((rack) => rack.id === "CAB-01" ? rack : { ...rack, role: "network" });
  const result = createPlanningEngine().recommend(state, request({ id: "DIVIDER-ONLY", u_size: 9, rated_power_w: 500 }));
  const dividerCandidate = result.candidates.find((candidate) => candidate.actions.some((action) => action.type === "set_dividers"));

  assert.ok(dividerCandidate);
  assert.equal(dividerCandidate.validation.allowed, true);
  assert.equal(dividerCandidate.actions.filter((action) => action.type === "place_device").length, 1);
});

test("planner marks cross-rack migration as warning risk when every L01 is occupied", () => {
  const state = createDemoState();
  state.devices = [];
  for (let number = 1; number <= 20; number += 1) {
    state.devices.push({
      id: `L01-FILLER-${number}`,
      rack_id: `CAB-${String(number).padStart(2, "0")}`,
      layer_id: "L01",
      start_u: 1,
      u_size: 2,
      rated_power_w: 100,
      real_power_w: null,
      weight_kg: 5,
      network_ports: 1,
      movable: number === 1,
      criticality: "normal",
      maintenance_window: number === 1 ? "Saturday 02:00-04:00" : null,
      status: "running",
      data_source: "demo",
    });
  }

  const result = createPlanningEngine().recommend(state, request({ id: "NEEDS-L01", u_size: 10, rated_power_w: 2_000 }));
  const migration = result.candidates.find((candidate) => candidate.actions.some((action) => action.type === "move_device"));

  assert.ok(migration);
  assert.equal(migration.risk, "warning");
  assert.equal(migration.validation.allowed, true);
});

test("planner rejects a device that cannot fit any layer", () => {
  const result = createPlanningEngine().recommend(createDemoState(), request({ id: "HUGE", u_size: 20, rated_power_w: 500 }));

  assert.equal(result.candidates.length, 0);
  assert.ok(result.rejected_count > 0);
});

test("planner uses real free intervals and records exact start U", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, request({ id: "FIXED-PLAN", u_size: 4 }), {
    strategyId: "balanced_optimal",
  });
  const action = result.candidates[0].actions.find((item) => item.type === "place_device");
  assert.ok(Number.isInteger(action.start_u));
  assert.equal(action.device.start_u, action.start_u);
  assert.ok(result.candidates[0].score_breakdown.fragmentation);
});

test("replica batch is distributed across power and switch domains", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, request({
    id: "DB-PAIR", count: 2, u_size: 2, replica_group: "RG-NEW-01", business_id: "database-platform",
  }), { strategyId: "balanced_optimal" });
  const placements = result.candidates[0].actions.filter((item) => item.type === "place_device");
  const racks = placements.map((item) => state.racks.find((rack) => rack.id === item.rack_id));
  assert.notEqual(racks[0].source_id, racks[1].source_id);
  assert.notEqual(racks[0].network_switch_id, racks[1].network_switch_id);
});

test("three strategies expose their selected strategy and stable scores", () => {
  const state = createDemoState();
  const ids = ["balanced_optimal", "consolidated", "load_balanced"];
  const results = ids.map((strategyId) => createPlanningEngine().recommend(state, request({ id: `S-${strategyId}` }), { strategyId }));
  assert.deepEqual(results.map((result) => result.strategy_id), ids);
  assert.equal(new Set(results.map((result) => result.candidates[0].rack_id)).size >= 2, true);
});

test("planner explains why no physical candidate exists", () => {
  const result = createPlanningEngine().recommend(createDemoState(), request({ id: "TOO-TALL", u_size: 20 }), {
    strategyId: "balanced_optimal",
  });
  assert.deepEqual(result.candidates, []);
  assert.ok(result.rejection_summary.some((item) => item.code === "DEVICE_U_UNSUPPORTED"));
});

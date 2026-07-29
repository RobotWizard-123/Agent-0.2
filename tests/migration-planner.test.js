import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { generateMigrationCandidates } from "../src/planning/migration-planner.js";

function migrationState() {
  const state = createDemoState();
  state.devices = state.devices.filter((device) => !["CAB-01", "CAB-02"].includes(device.rack_id));
  state.devices.push({
    id: "MOVABLE-10U", rack_id: "CAB-01", layer_id: "L01", start_u: 1, u_size: 10,
    rated_power_w: 1_000, real_power_w: null, weight_kg: 40, network_ports: 2,
    business_id: "batch-platform", replica_group: null, movable: true, criticality: "normal",
    maintenance_window: "Saturday 02:00-04:00", status: "running", data_source: "demo",
  });
  return state;
}

test("migration candidates include only eligible devices and a rollback", () => {
  const state = migrationState();
  const result = generateMigrationCandidates(state, {
    id: "NEEDS-SPACE", count: 1, u_size: 10, rated_power_w: 2_000, weight_kg: 60, network_ports: 2,
  }, { maxCandidates: 16 });
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    const move = candidate.actions.find((action) => action.type === "move_device");
    const original = state.devices.find((device) => device.id === move.device_id);
    assert.equal(original.movable, true);
    assert.notEqual(original.criticality, "critical");
    assert.ok(original.maintenance_window);
    assert.equal(candidate.risk, "warning");
    assert.ok(candidate.impact.rollback_actions.some((action) => action.device_id === original.id && action.start_u === original.start_u));
  }
});

test("missing maintenance data prevents a confirmable migration", () => {
  const state = migrationState();
  state.devices.forEach((device) => { device.maintenance_window = null; });
  const result = generateMigrationCandidates(state, {
    id: "NO-WINDOW", count: 1, u_size: 10, rated_power_w: 2_000, weight_kg: 60, network_ports: 2,
  });
  assert.deepEqual(result.candidates, []);
  assert.ok(result.assessments.some((item) => item.reason_code === "MAINTENANCE_WINDOW_REQUIRED"));
});

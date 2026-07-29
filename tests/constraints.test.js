import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { capacitySnapshot } from "../src/domain/capacity.js";
import { applyActions, evaluateActions } from "../src/domain/constraint-engine.js";

function device(overrides = {}) {
  return {
    id: "SRV-CONSTRAINT",
    u_size: 2,
    rated_power_w: 1_000,
    real_power_w: null,
    weight_kg: 20,
    network_ports: 2,
    status: "pending",
    data_source: "demo",
    ...overrides,
  };
}

function placement(deviceOverrides = {}, actionOverrides = {}) {
  const startU = actionOverrides.start_u ?? 13;
  return {
    type: "place_device",
    rack_id: "CAB-01",
    layer_id: "L02",
    start_u: startU,
    device: device({ ...deviceOverrides, start_u: startU }),
    ...actionOverrides,
  };
}

function emptyRackState(rackId = "CAB-01") {
  const state = createDemoState();
  state.devices = state.devices.filter((device) => device.rack_id !== rackId);
  state.power_connections = state.power_connections.filter((connection) => connection.rack_id !== rackId);
  state.network_connections = state.network_connections.filter((connection) => !connection.device_id.startsWith(`SRV-${rackId.slice(4)}-`));
  return state;
}

test("capacity uses the design ceiling and treats missing telemetry as unknown", () => {
  const snapshot = capacitySnapshot(createDemoState(), "CAB-01");

  assert.equal(snapshot.source, "rule");
  assert.equal(snapshot.design_power_w, 10_000);
  assert.equal(snapshot.rated_power_used_w, 2_400);
  assert.equal(snapshot.real_power_w, null);
  assert.equal(snapshot.real_power_source, "unknown");
  assert.equal(snapshot.usable_u, 34);
  assert.equal(snapshot.used_u, 2);
});

test("10U devices are blocked outside L01", () => {
  const result = evaluateActions(emptyRackState(), [placement(
    { id: "TEN-U", u_size: 10 },
    { layer_id: "L02", start_u: 13 },
  )]);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((issue) => issue.code === "TEN_U_REQUIRES_L01"));
});

test("10U devices fit L01 with its single 2U reserve", () => {
  const result = evaluateActions(emptyRackState(), [placement(
    { id: "TEN-U-VALID", u_size: 10 },
    { layer_id: "L01", start_u: 1 },
  )]);

  assert.equal(result.allowed, true);
  assert.equal(result.after["CAB-01"].used_u, 10);
});

test("devices larger than the supported 10U server size are blocked", () => {
  const result = evaluateActions(emptyRackState(), [placement({ id: "TOO-LARGE", u_size: 20 })]);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((issue) => issue.code === "DEVICE_U_UNSUPPORTED"));
});

test("power uses the 10kW rack design ceiling", () => {
  const result = evaluateActions(emptyRackState(), [placement(
    { id: "POWER-OVER", u_size: 10, rated_power_w: 10_001 },
    { layer_id: "L01", start_u: 1 },
  )]);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((issue) => issue.code === "RACK_POWER_EXCEEDED"));
});

test("warns at 80 percent design power without blocking", () => {
  const result = evaluateActions(emptyRackState(), [placement({ id: "POWER-HIGH", rated_power_w: 8_000 })]);

  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some((issue) => issue.code === "RACK_POWER_HIGH"));
});

test("blocks layer, weight, port, and network-rack violations", () => {
  const state = emptyRackState();
  const result = evaluateActions(state, [
    placement({ id: "U-A", u_size: 4 }, { start_u: 13 }),
    placement({ id: "U-B", u_size: 4 }, { start_u: 17 }),
    placement({ id: "U-C", u_size: 4 }, { start_u: 13 }),
    placement({ id: "WEIGHT", weight_kg: 421 }, { rack_id: "CAB-02" }),
    placement({ id: "PORTS", network_ports: 25 }, { rack_id: "CAB-03", start_u: 19 }),
    placement({ id: "NETWORK-RACK" }, { rack_id: "CAB-21" }),
  ]);

  const codes = new Set(result.blockers.map((issue) => issue.code));
  assert.equal(codes.has("DEVICE_U_OVERLAP"), true);
  assert.equal(codes.has("RACK_WEIGHT_EXCEEDED"), true);
  assert.equal(codes.has("RACK_PORTS_EXCEEDED"), true);
  assert.equal(codes.has("SERVER_RACK_REQUIRED"), true);
  assert.equal(state.devices.some((item) => item.id === "U-A"), false);
});

test("placement action preserves its exact start U", () => {
  const result = evaluateActions(emptyRackState(), [placement(
    { id: "FIXED-U", u_size: 2 },
    { rack_id: "CAB-01", layer_id: "L02", start_u: 17 },
  )]);
  assert.equal(result.allowed, true);
  assert.equal(result.projected_devices.find((item) => item.id === "FIXED-U").start_u, 17);
});

test("migration requires eligibility and a maintenance window", () => {
  const state = createDemoState();
  const locked = state.devices.find((device) => !device.movable);
  state.devices = state.devices.filter((device) => device.rack_id !== "CAB-02");
  const result = evaluateActions(state, [{
    type: "move_device",
    device_id: locked.id,
    rack_id: "CAB-02",
    layer_id: "L02",
    start_u: 13,
  }]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === "DEVICE_MOVE_NOT_ALLOWED"));
});

test("replicas cannot share a power source or access switch", () => {
  const state = createDemoState();
  const replica = state.devices.find((device) => device.replica_group === "RG-DEMO-01");
  const peer = state.devices.find((device) => device.replica_group === "RG-DEMO-01" && device.id !== replica.id);
  state.devices = state.devices.filter((device) => device.rack_id !== replica.rack_id || device.id === replica.id);
  peer.movable = true;
  peer.criticality = "normal";
  peer.maintenance_window = "Saturday 02:00-04:00";
  const result = evaluateActions(state, [{
    type: "move_device",
    device_id: peer.id,
    rack_id: replica.rack_id,
    layer_id: "L04",
    start_u: 33,
  }]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === "REPLICA_FAULT_DOMAIN_CONFLICT"));
});

test("eligible servers can be removed and release rack capacity and links", () => {
  const state = createDemoState();
  const removable = state.devices.find((item) => item.movable && item.criticality === "normal" && item.maintenance_window);
  const before = capacitySnapshot(state, removable.rack_id);
  const action = { type: "remove_device", device_id: removable.id, rack_id: removable.rack_id };
  const result = evaluateActions(state, [action]);

  assert.equal(result.allowed, true);
  assert.equal(result.projected_devices.some((item) => item.id === removable.id), false);
  assert.equal(result.after[removable.rack_id].used_u, before.used_u - removable.u_size);

  const projected = applyActions(state, [action]);
  assert.equal(projected.power_connections.some((item) => item.device_id === removable.id), false);
  assert.equal(projected.network_connections.some((item) => item.device_id === removable.id), false);
});

test("server removal is blocked without migration eligibility", () => {
  const state = createDemoState();
  const locked = state.devices.find((item) => !item.movable);
  const result = evaluateActions(state, [{ type: "remove_device", device_id: locked.id, rack_id: locked.rack_id }]);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === "DEVICE_REMOVAL_NOT_ALLOWED"));
});

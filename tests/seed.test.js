import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";

test("seed topology contains verified room, power, and network facts", () => {
  const state = createDemoState();

  assert.equal(state.room.id, "L5-A2-08");
  assert.deepEqual(state.power_sources.map((source) => source.id), ["JG1", "JG2", "KT1"]);
  assert.equal(state.topology.network.core.id, "CORE-01");
  assert.equal(state.topology.network.access_switches.length, 10);
  assert.equal(state.topology.redundancy.status, "unverified");
});

test("seed racks map all strong and weak topology identifiers", () => {
  const state = createDemoState();
  const ids = state.racks.map((rack) => rack.id);

  assert.equal(state.racks.length, 22);
  assert.ok(ids.includes("CAB-01"));
  assert.ok(ids.includes("CAB-20"));
  assert.ok(ids.includes("CAB-21"));
  assert.ok(ids.includes("CAB-22"));
  assert.equal(state.racks.find((rack) => rack.id === "CAB-01").source_id, "JG1");
  assert.equal(state.racks.find((rack) => rack.id === "CAB-20").network_switch_id, "ASW-10");
});

test("each access switch serves exactly two server racks with 24-port limits", () => {
  const state = createDemoState();
  const serverRacks = state.racks.filter((rack) => rack.role === "server");

  for (const accessSwitch of state.topology.network.access_switches) {
    const connected = serverRacks.filter((rack) => rack.network_switch_id === accessSwitch.id);
    assert.equal(connected.length, 2);
    assert.equal(connected.reduce((sum, rack) => sum + rack.network_port_limit, 0), 48);
  }
});

test("seed represents a reproducible mixed-occupancy room", () => {
  const state = createDemoState();
  const serverRacks = state.racks.filter((rack) => rack.role === "server");
  const usedByRack = serverRacks.map((rack) => state.devices
    .filter((device) => device.rack_id === rack.id && device.status !== "cancelled")
    .reduce((sum, device) => sum + device.u_size, 0));

  assert.equal(usedByRack.reduce((sum, used) => sum + used, 0), 404);
  assert.equal(usedByRack.filter((used) => used <= 4).length, 2);
  assert.ok(usedByRack.some((used) => used >= 30));
  assert.ok(state.devices.every((device) => Number.isInteger(device.start_u)));
  assert.ok(state.devices.every((device) => ["normal", "important", "critical"].includes(device.criticality)));
  assert.ok(state.devices.some((device) => device.replica_group));
  assert.ok(state.devices.some((device) => device.movable && device.maintenance_window));
  assert.equal(createDemoState().devices.length, state.devices.length);
});

test("seed keeps one direct 10U expansion bay in CAB-01 L01", () => {
  const state = createDemoState();
  const cab01L01 = state.devices.filter((device) => device.rack_id === "CAB-01" && device.layer_id === "L01");

  assert.deepEqual(cab01L01, []);
  assert.equal(state.devices.filter((device) => device.rack_id === "CAB-01").reduce((sum, device) => sum + device.u_size, 0), 2);
});

test("seed includes two racks immediately below the rated-power warning line", () => {
  const state = createDemoState();
  const ratios = state.racks.filter((rack) => rack.role === "server").map((rack) => {
    const used = state.devices.filter((device) => device.rack_id === rack.id)
      .reduce((sum, device) => sum + device.rated_power_w, 0);
    return used / rack.design_power_w;
  });
  assert.equal(ratios.filter((ratio) => ratio >= 0.78 && ratio < 0.8).length, 2);
});

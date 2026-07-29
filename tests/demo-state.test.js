import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";

test("demo state matches L5-A2-08 drawing facts", () => {
  const state = createDemoState();

  assert.equal(state.room.id, "L5-A2-08");
  assert.equal(state.racks.length, 22);
  assert.deepEqual(state.racks.slice(0, 8).map((rack) => rack.design_power_w), Array(8).fill(10_000));
  assert.deepEqual(state.racks.slice(8, 13).map((rack) => rack.design_power_w), Array(5).fill(20_000));
  assert.deepEqual(state.racks.slice(13, 20).map((rack) => rack.design_power_w), Array(7).fill(10_000));
  assert.deepEqual(state.racks.slice(20).map((rack) => rack.design_power_w), [5_000, 5_000]);
  assert.deepEqual(state.racks[0].dividers_u, [12, 22, 32]);
  assert.equal(state.racks.every((rack) => rack.height_u === 42), true);
  assert.equal(state.power_sources.find((source) => source.id === "JG1").calculated_load_w, 96_000);
  assert.equal(state.power_sources.find((source) => source.id === "JG2").calculated_load_w, 104_000);
});

test("demo state contains server details and explicit known links", () => {
  const state = createDemoState();
  const server = state.devices.find((device) => device.id === "SRV-DEMO-10U");

  assert.equal(server.rack_id, "CAB-09");
  assert.equal(server.layer_id, "L01");
  assert.equal(server.u_size, 10);
  assert.equal(server.real_power_w, null);
  assert.equal(server.data_source, "demo");
  assert.ok(state.power_connections.some((link) => link.device_id === server.id));
  assert.ok(state.network_connections.some((link) => link.device_id === server.id));
});

test("network cabinets keep drawing aliases without pretending to be server cabinets", () => {
  const state = createDemoState();
  const networkRacks = state.racks.filter((rack) => rack.role === "network");

  assert.deepEqual(networkRacks.map((rack) => rack.id), ["CAB-21", "CAB-22"]);
  assert.deepEqual(networkRacks.map((rack) => rack.alias), ["NET-01", "NET-02"]);
  assert.equal(networkRacks.every((rack) => rack.source_id === "KT1"), true);
});

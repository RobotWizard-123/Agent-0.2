import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { runPrecheck } from "../src/deploy-agent.js";

function legacyServer(overrides = {}) {
  return {
    id: "SRV-VALIDATOR",
    cabinet_id: "CAB-15",
    layer_id: "CAB-15-L03",
    u_size: 2,
    power_w: 600,
    weight_kg: 18,
    network_ports: 1,
    ...overrides,
  };
}

test("legacy precheck request passes a small valid placement", () => {
  const result = runPrecheck(createDemoState(), { servers: [legacyServer()] });

  assert.deepEqual(result.blockers, []);
  assert.equal(result.allowed, true);
  assert.equal(result.projected_devices.find((device) => device.id === "SRV-VALIDATOR").start_u, 27);
});

test("precheck blocks rack design-power overflow", () => {
  const result = runPrecheck(createDemoState(), {
    servers: [legacyServer({ id: "SRV-POWER-OVER", cabinet_id: "CAB-01", layer_id: "CAB-01-L02", power_w: 20_001 })],
  });

  assert.ok(result.blockers.some((issue) => issue.code === "RACK_POWER_EXCEEDED"));
  assert.equal(result.allowed, false);
});

test("precheck warns at 80 percent of rack design power", () => {
  const result = runPrecheck(createDemoState(), {
    servers: [legacyServer({ id: "SRV-POWER-HIGH", cabinet_id: "CAB-01", layer_id: "CAB-01-L02", power_w: 5_600 })],
  });

  assert.ok(result.warnings.some((issue) => issue.code === "RACK_POWER_HIGH"));
  assert.equal(result.allowed, true);
});

test("precheck requires 10U devices to use L01", () => {
  const result = runPrecheck(createDemoState(), {
    servers: [legacyServer({ id: "SRV-TEN-U", cabinet_id: "CAB-13", layer_id: "CAB-13-L02", u_size: 10 })],
  });

  assert.ok(result.blockers.some((issue) => issue.code === "TEN_U_REQUIRES_L01"));
  assert.equal(result.allowed, false);
});

test("precheck treats rack network-port capacity as a hard constraint", () => {
  const result = runPrecheck(createDemoState(), {
    servers: [legacyServer({ id: "SRV-NET-OVER", cabinet_id: "CAB-01", layer_id: "CAB-01-L02", network_ports: 25 })],
  });

  assert.ok(result.blockers.some((issue) => issue.code === "RACK_PORTS_EXCEEDED"));
  assert.equal(result.allowed, false);
});

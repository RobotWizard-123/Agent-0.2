import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { createDemoTelemetryProvider } from "../src/telemetry/demo-telemetry-provider.js";
import { createTopologyService } from "../src/topology/topology-service.js";

test("topology returns known power and network evidence for a linked device", () => {
  const path = createTopologyService().devicePath(createDemoState(), "SRV-DEMO-10U");

  assert.ok(path.power.some((node) => node.id === "JG1" && node.source === "design"));
  assert.ok(path.power.some((node) => node.id === "CAB-09-PDU" && node.source === "demo"));
  assert.ok(path.network.some((node) => node.id === "ASW-05" && node.source === "demo"));
  assert.equal(path.redundancy, "unverified");
});

test("topology returns unknown nodes instead of inventing missing links", () => {
  const state = createDemoState();
  state.devices.push({
    id: "NO-LINK",
    rack_id: "CAB-01",
    layer_id: "L02",
    u_size: 2,
    rated_power_w: 500,
    real_power_w: null,
    weight_kg: 10,
    network_ports: 1,
    status: "running",
    data_source: "demo",
  });

  const path = createTopologyService().devicePath(state, "NO-LINK");
  assert.equal(path.power.at(-1).source, "unknown");
  assert.equal(path.network.at(-1).source, "unknown");
  assert.equal(path.redundancy, "unverified");
  assert.deepEqual(path.missing_fields.sort(), ["network_connection", "power_connection"]);
});

test("telemetry absence is unknown rather than zero", async () => {
  const reading = await createDemoTelemetryProvider().rackPower("CAB-01");

  assert.deepEqual(reading, {
    value_w: null,
    source: "unknown",
    collected_at: null,
    status: "not_connected",
  });
});

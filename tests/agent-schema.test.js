import test from "node:test";
import assert from "node:assert/strict";
import { validateDeviceRequest, validatePlanAdjustment } from "../src/agent/agent-schema.js";

test("device extraction keeps missing capacity facts unknown instead of zero", () => {
  assert.throws(
    () => validateDeviceRequest({ id: "SRV-INCOMPLETE", count: 1, u_size: 2 }),
    (error) => error.code === "AGENT_RESPONSE_INVALID" && error.field === "rated_power_w",
  );
});

test("device extraction preserves a positive count above the former cap", () => {
  const result = validateDeviceRequest({
    id: "SRV-LARGE-BATCH",
    count: 101,
    u_size: 2,
    rated_power_w: 500,
    weight_kg: 10,
    network_ports: 1,
  });

  assert.equal(result.count, 101);
});

test("device extraction rejects an explicitly invalid count", () => {
  assert.throws(
    () => validateDeviceRequest({
      id: "SRV-BAD-BATCH",
      count: 0,
      u_size: 2,
      rated_power_w: 500,
      weight_kg: 10,
      network_ports: 1,
    }),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
});

test("accepts bounded weights and exact-position alternatives", () => {
  const value = validatePlanAdjustment({
    candidate_id: "DIRECT-1",
    reason: "Keep database nodes close while preserving fault domains",
    weight_multipliers: { business: 1.5, fragmentation: 1.2 },
    alternatives: [{
      id: "AGENT-ALT-1",
      reason: "Use a larger continuous interval",
      actions: [{
        type: "place_device", rack_id: "CAB-04", layer_id: "L02", start_u: 13,
        device: { id: "SRV-NEW", u_size: 4, start_u: 13, rated_power_w: 1_200, weight_kg: 30, network_ports: 2 },
      }],
    }],
  });
  assert.equal(value.weight_multipliers.business, 1.5);
  assert.equal(value.alternatives[0].actions[0].start_u, 13);
});

test("rejects more than three alternatives and out-of-range weights", () => {
  const alternative = { id: "A", reason: "x", actions: [] };
  assert.throws(() => validatePlanAdjustment({ candidate_id: null, reason: "x", alternatives: [alternative, alternative, alternative, alternative] }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validatePlanAdjustment({ candidate_id: null, reason: "x", weight_multipliers: { capacity: 2.5 } }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});

test("rejects unknown fields and positions omitted from actions", () => {
  assert.throws(() => validatePlanAdjustment({ candidate_id: null, reason: "x", hidden_override: true }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validatePlanAdjustment({
    candidate_id: null,
    reason: "x",
    alternatives: [{ id: "A", reason: "x", actions: [{ type: "move_device", device_id: "D", rack_id: "CAB-01", layer_id: "L02" }] }],
  }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});

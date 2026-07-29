import test from "node:test";
import assert from "node:assert/strict";
import { rackRisk } from "../public/js/rack-risk.js";

function rack(capacity = {}) {
  return {
    id: "CAB-TEST",
    capacity: {
      design_power_w: 10_000,
      rated_power_used_w: 2_000,
      usable_u: 34,
      used_u: 10,
      ...capacity,
    },
  };
}

test("rack risk uses the higher of U occupancy and rated power", () => {
  const result = rackRisk(rack({ rated_power_used_w: 4_000, used_u: 29 }), []);
  assert.equal(result.tone, "warning");
  assert.equal(result.basis, "U 位");
  assert.equal(result.ratio, 29 / 34);
});

test("rack risk turns blocker for a hard limit or active alarm", () => {
  assert.equal(rackRisk(rack({ rated_power_used_w: 10_001 }), []).tone, "blocker");
  assert.equal(rackRisk(rack(), [{ object_id: "CAB-TEST", status: "open" }]).tone, "blocker");
});

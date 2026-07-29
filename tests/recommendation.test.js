import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { recommendPlacement } from "../src/placement-recommender.js";

test("legacy recommender returns ranked placements with valid Chinese evidence", () => {
  const result = recommendPlacement(createDemoState(), {
    id: "SRV-REC-01",
    u_size: 4,
    power_w: 1_800,
    weight_kg: 32,
    network_ports: 2,
    count: 1,
  });

  assert.equal(result.input.u_size, 4);
  assert.deepEqual(result.ignored_constraints, []);
  assert.deepEqual(result.unavailable_constraints, ["REAL_POWER_TELEMETRY", "VERIFIED_REDUNDANCY"]);
  assert.ok(result.items.length > 0);

  const first = result.items[0];
  assert.match(first.cabinet_id, /^CAB-/);
  assert.match(first.layer_id, /^L0[1-4]$/);
  assert.equal(first.allowed, true);
  assert.equal(first.blockers.length, 0);
  assert.equal(typeof first.score, "number");
  assert.ok(first.remaining_u_after >= 0);
  assert.ok(first.power_margin_w >= 0);
  assert.ok(first.weight_margin_kg >= 0);
  assert.ok(first.reasons.some((reason) => reason.includes("输入参数")));
  assert.equal(first.reasons.some((reason) => /杈|鏈烘|璀︾ず/.test(reason)), false);
});

test("legacy recommender ranks a valid preferred cabinet first", () => {
  const result = recommendPlacement(createDemoState(), {
    id: "SRV-REC-PREFERRED",
    u_size: 2,
    power_w: 500,
    weight_kg: 10,
    network_ports: 1,
    count: 1,
    preferred_cabinet_ids: ["CAB-03"],
  });

  assert.equal(result.items[0].cabinet_id, "CAB-03");
});

test("legacy recommender rejects devices larger than 10U", () => {
  const result = recommendPlacement(createDemoState(), {
    id: "SRV-REC-HUGE",
    u_size: 20,
    power_w: 500,
    weight_kg: 10,
    network_ports: 1,
    count: 1,
  });

  assert.equal(result.items.length, 0);
  assert.ok(result.rejected_count > 0);
});

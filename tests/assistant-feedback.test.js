import test from "node:test";
import assert from "node:assert/strict";
import {
  captureFeedbackSnapshot,
  diffFeedbackSnapshots,
} from "../src/assistant/feedback-detector.js";

function context(version, overrides = {}) {
  return {
    state_version: version,
    site: {
      racks: [],
      alarms: [],
      plans: [],
      service_health: {},
      runtime: {},
      ...overrides,
    },
  };
}

test("initial feedback includes active alarms once", () => {
  const current = captureFeedbackSnapshot(context(4, {
    alarms: [{
      id: "ALARM-1",
      status: "open",
      severity: "critical",
      trigger_code: "RACK_POWER_HIGH",
      object_id: "CAB-01",
    }],
  }));
  const first = diffFeedbackSnapshots(null, current, () => "2026-07-22T00:00:00.000Z");
  const repeated = diffFeedbackSnapshots(current, current, () => "2026-07-22T00:00:08.000Z");

  assert.equal(first.length, 1);
  assert.equal(first[0].type, "alarm_opened");
  assert.equal(repeated.length, 0);
});

test("feedback detects capacity and execution transitions", () => {
  const before = captureFeedbackSnapshot(context(8));
  const after = captureFeedbackSnapshot(context(9, {
    racks: [{
      id: "CAB-09",
      capacity: {
        rated_power_used_w: 8_200,
        design_power_w: 10_000,
        used_u: 10,
        usable_u: 40,
        used_weight_kg: 100,
        max_weight_kg: 420,
        used_ports: 4,
        port_limit: 24,
      },
    }],
    plans: [{ id: "PLAN-1", status: "failed", validation: { blockers: [] } }],
  }));
  const events = diffFeedbackSnapshots(before, after, () => "2026-07-22T00:00:08.000Z");

  assert.deepEqual(events.map((item) => item.type).sort(), ["capacity_warning", "plan_failed"]);
  assert.equal(new Set(events.map((item) => item.id)).size, events.length);
});

test("initial feedback suppresses historical success but reports offline dependencies", () => {
  const current = captureFeedbackSnapshot(context(12, {
    plans: [{ id: "PLAN-OLD", status: "succeeded", validation: { blockers: [] } }],
    service_health: { collector: { status: "offline", checked_at: "2026-07-22T00:00:00.000Z" } },
  }));
  const events = diffFeedbackSnapshots(null, current, () => "2026-07-22T00:00:08.000Z");

  assert.deepEqual(events.map((item) => item.type), ["dependency_offline"]);
});

test("capacity remains deduplicated while usage stays above the threshold", () => {
  const rackAt = (used) => ({
    id: "CAB-09",
    capacity: {
      rated_power_used_w: used,
      design_power_w: 10_000,
      used_u: 0,
      usable_u: 40,
      used_weight_kg: 0,
      max_weight_kg: 420,
      used_ports: 0,
      port_limit: 24,
    },
  });
  const before = captureFeedbackSnapshot(context(20, { racks: [rackAt(8_200)] }));
  const after = captureFeedbackSnapshot(context(21, { racks: [rackAt(8_500)] }));

  assert.equal(diffFeedbackSnapshots(before, after).length, 0);
});

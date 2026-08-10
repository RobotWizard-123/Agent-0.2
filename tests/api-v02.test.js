import test from "node:test";
import assert from "node:assert/strict";
import { createPlanningEngine } from "../src/planning/planning-engine.js";
import { withAuthenticatedServer, withV02Server } from "./helpers.js";

function placementRequest() {
  return {
    kind: "placement",
    device: {
      id: "SRV-API-V02",
      count: 1,
      u_size: 4,
      rated_power_w: 1_200,
      real_power_w: null,
      weight_kg: 30,
      network_ports: 2,
      preferred_rack_ids: ["CAB-03"],
    },
  };
}

test("V0.2 API exposes room, capacity, rack layers, devices, and topology", async () => {
  await withV02Server(async ({ request }) => {
    const room = await request("/api/room");
    const capacity = await request("/api/capacity");
    const rack = await request("/api/racks/CAB-09");
    const device = await request("/api/devices/SRV-DEMO-10U");
    const topology = await request("/api/topology/devices/SRV-DEMO-10U");

    assert.equal(room.response.status, 200);
    assert.equal(room.body.id, "L5-A2-08");
    assert.equal(room.body.rack_count, 22);
    assert.equal(capacity.body.items.length, 22);
    assert.equal(capacity.body.items.find((item) => item.rack_id === "CAB-01").real_power_w, null);
    assert.equal(rack.body.layers[0].id, "L01");
    assert.equal(rack.body.layers[0].usable_u, 10);
    assert.equal(device.body.hostname, "gpu-demo-01");
    assert.equal(device.body.start_u, 1);
    const rackDevice = rack.body.devices.find((item) => item.id === "SRV-DEMO-10U");
    assert.equal(rackDevice.placement.start_u, rackDevice.start_u);
    assert.ok(rack.body.layers.every((layer) => Array.isArray(layer.free_intervals)));
    assert.ok(rack.body.layers.every((layer) => Number.isInteger(layer.reserve_start_u)));
    assert.equal(topology.body.redundancy, "unverified");
  });
});

test("V0.2 API creates and executes a plan through one confirmation", async () => {
  await withV02Server(async ({ request }) => {
    const created = await request("/api/plans", { method: "POST", body: placementRequest() });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, "awaiting_confirmation");
    assert.ok(["cp_sat", "beam_search"].includes(created.body.solver.engine));
    assert.ok(["optimal", "feasible", "disabled", "fallback", "infeasible"].includes(created.body.solver.status));
    assert.equal(Number.isInteger(created.body.solver.candidate_count), true);

    const before = await request("/api/racks/CAB-03");
    assert.equal(before.body.devices.some((device) => device.id === "SRV-API-V02"), false);

    const confirmed = await request(`/api/plans/${created.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.plan.status, "succeeded");

    const after = await request("/api/racks/CAB-03");
    assert.equal(after.body.devices.some((device) => device.id === "SRV-API-V02"), true);
    assert.ok(after.body.state_version > before.body.state_version);

    const repeated = await request(`/api/plans/${created.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.error, "PLAN_ALREADY_CONFIRMED");
  });
});

test("V0.2 API disables legacy batch mutation without final confirmation", async () => {
  await withV02Server(async ({ request }) => {
    const result = await request("/api/deploy/batch", { method: "POST", body: { servers: [] } });

    assert.equal(result.response.status, 410);
    assert.equal(result.body.error, "LEGACY_BATCH_DISABLED");
  });
});

test("V0.2 API returns stable errors for missing entities and invalid JSON", async () => {
  await withV02Server(async ({ request }) => {
    const missing = await request("/api/racks/CAB-99");
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, "RACK_NOT_FOUND");

    const invalid = await request("/api/plans", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error, "INVALID_JSON");
  });
});

test("V0.2 API completes alarm trigger, diagnosis, remediation, confirmation, and recovery", async () => {
  await withV02Server(async ({ request }) => {
    const triggered = await request("/api/demo/alarms", { method: "POST", body: { scenario: "power_high" } });
    assert.equal(triggered.response.status, 201);
    assert.equal(triggered.body.status, "open");

    const diagnosed = await request(`/api/alarms/${triggered.body.id}/diagnose`, { method: "POST", body: {} });
    assert.equal(diagnosed.body.root_cause_code, "RACK_POWER_HIGH");

    const remediation = await request(`/api/alarms/${triggered.body.id}/remediation`, { method: "POST", body: {} });
    assert.equal(remediation.response.status, 201);
    assert.equal(remediation.body.status, "awaiting_confirmation");

    const confirmed = await request(`/api/plans/${remediation.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(confirmed.body.plan.status, "succeeded");
    assert.equal(confirmed.body.alarm.status, "resolved");
    assert.equal(confirmed.body.alarm.recovery_verified, true);

    const alarms = await request("/api/alarms");
    assert.ok(alarms.body.items.some((alarm) => alarm.id === triggered.body.id && alarm.status === "resolved"));
  });
});

test("demo reset restores seed state and records an administrative audit", async () => {
  await withV02Server(async ({ request }) => {
    await request("/api/demo/alarms", { method: "POST", body: { scenario: "collector_offline" } });
    const reset = await request("/api/demo/reset", { method: "POST", body: {} });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.room.id, "L5-A2-08");
    assert.equal(reset.body.alarms.length, 0);

    const audit = await request("/api/audit");
    assert.ok(audit.body.items.some((entry) => entry.action === "demo_state_reset"));
  });
});

test("placement strategy settings are versioned and selected per plan", async () => {
  await withV02Server(async ({ request }) => {
    const initial = await request("/api/settings/placement-strategy");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.default_strategy_id, "balanced_optimal");

    const updated = await request("/api/settings/placement-strategy", {
      method: "POST",
      body: { strategy_id: "consolidated" },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.default_strategy_id, "consolidated");
    assert.ok(updated.body.state_version > initial.body.state_version);

    const invalid = await request("/api/settings/placement-strategy", {
      method: "POST",
      body: { strategy_id: "unsafe_override" },
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error, "PLACEMENT_STRATEGY_INVALID");

    const created = await request("/api/plans", {
      method: "POST",
      body: { ...placementRequest(), strategy_id: "load_balanced" },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.strategy_id, "load_balanced");
    assert.equal(created.body.snapshot_version, created.body.base_version);

    await request("/api/settings/placement-strategy", {
      method: "POST",
      body: { strategy_id: "balanced_optimal" },
    });
    const confirmed = await request(`/api/plans/${created.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.plan.status, "succeeded");
  });
});

test("viewer reads but cannot change the default placement strategy", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    const viewer = await login("viewer", "viewer-pass");
    const readable = await request("/api/settings/placement-strategy", { cookie: viewer.cookie });
    assert.equal(readable.response.status, 200);
    const forbidden = await request("/api/settings/placement-strategy", {
      method: "POST",
      cookie: viewer.cookie,
      body: { strategy_id: "load_balanced" },
    });
    assert.equal(forbidden.response.status, 403);
  });
});

test("structured placement requests reject invalid counts at the public boundary", async () => {
  await withV02Server(async ({ repository, request }) => {
    for (const count of [0, 1.5, 101]) {
      const result = await request("/api/plans", {
        method: "POST",
        body: {
          ...placementRequest(),
          device: { ...placementRequest().device, count },
        },
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error, "PLACEMENT_COUNT_INVALID");
    }
    assert.equal(repository.read().plans.length, 0);
  });
});

test("structured placement requests reject negative capacity facts", async () => {
  await withV02Server(async ({ repository, request }) => {
    for (const field of ["rated_power_w", "weight_kg", "network_ports"]) {
      const result = await request("/api/plans", {
        method: "POST",
        body: {
          ...placementRequest(),
          device: { ...placementRequest().device, id: `INVALID-${field}`, [field]: -1 },
        },
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error, "PLACEMENT_DEVICE_INVALID");
    }
    assert.equal(repository.read().plans.length, 0);
  });
});

test("plan API exposes server-owned mixed CP-SAT validation evidence", async () => {
  const beamPlanner = createPlanningEngine({
    cpSatAdapter: {
      solve: () => ({
        outcome: "unavailable",
        candidates: [],
        solver: {
          engine: "beam_search",
          status: "disabled",
          duration_ms: 0,
          candidate_count: 0,
          fallback_reason: null,
        },
      }),
    },
  });
  const planner = {
    recommend(...args) {
      return {
        ...beamPlanner.recommend(...args),
        solver: {
          engine: "cp_sat",
          status: "optimal",
          duration_ms: 11,
          candidate_count: 1,
          fallback_reason: null,
          validation_rejected_count: 1,
          validation_rejection_summary: [{ code: "DEVICE_U_OVERLAP", count: 1 }],
        },
      };
    },
  };

  await withV02Server(async ({ request }) => {
    const created = await request("/api/plans", {
      method: "POST",
      body: {
        ...placementRequest(),
        solver: {
          validation_rejected_count: 999,
          validation_rejection_summary: [{ code: "CLIENT_FORGED", count: 999 }],
        },
      },
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.solver.validation_rejected_count, 1);
    assert.deepEqual(created.body.solver.validation_rejection_summary, [
      { code: "DEVICE_U_OVERLAP", count: 1 },
    ]);
  }, { planner });
});

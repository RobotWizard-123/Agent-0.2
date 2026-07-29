import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { createPlanningEngine } from "../src/planning/planning-engine.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createPlanService } from "../src/workflows/plan-service.js";
import { createSimulatedExecutionAdapter } from "../src/workflows/simulated-execution-adapter.js";

function sampleDevice(overrides = {}) {
  return {
    id: "SRV-PLAN-SERVICE",
    u_size: 4,
    rated_power_w: 1_200,
    real_power_w: null,
    weight_kg: 30,
    network_ports: 2,
    preferred_rack_ids: ["CAB-03"],
    ...overrides,
  };
}

function fixture() {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
  });
  return { repository, service };
}

test("a valid plan executes after one confirmation and writes linked audit", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");

  assert.equal(plan.status, "awaiting_confirmation");
  assert.equal(repository.read().devices.some((device) => device.id === sampleDevice().id), false);

  const result = await service.confirm(plan.id, "admin");
  const state = repository.read();
  assert.equal(result.plan.status, "succeeded");
  assert.equal(state.devices.some((device) => device.id === sampleDevice().id && device.status === "running"), true);
  assert.ok(state.audit.some((entry) => entry.entity_id === plan.id && entry.action === "plan_succeeded"));
  assert.ok(state.changes.some((change) => change.plan_id === plan.id && change.status === "succeeded"));
  await assert.rejects(() => service.confirm(plan.id, "admin"), (error) => error.code === "PLAN_ALREADY_CONFIRMED");
});

test("confirmation rejects a stale state version", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");
  repository.mutate(repository.read().version, (draft) => {
    draft.audit.push({ id: "EXTERNAL", action: "external_change" });
  });

  await assert.rejects(
    () => service.confirm(plan.id, "admin"),
    (error) => error.code === "PLAN_STALE" && error.plan_version < error.state_version,
  );
});

test("a request with no valid candidate never becomes confirmable", async () => {
  const { service } = fixture();
  const plan = await service.create({ kind: "placement", device: sampleDevice({ id: "TOO-LARGE", u_size: 20 }) }, "planner");

  assert.equal(plan.status, "validated");
  assert.ok(plan.validation.blockers.some((issue) => issue.code === "NO_VALID_PLAN"));
  await assert.rejects(() => service.confirm(plan.id, "admin"), (error) => error.code === "PLAN_NOT_CONFIRMABLE");
});

test("warning plans still use exactly one final confirmation", async () => {
  const { service } = fixture();
  const plan = await service.create({
    kind: "placement",
    device: sampleDevice({ id: "POWER-WARNING", u_size: 2, rated_power_w: 8_000, preferred_rack_ids: ["CAB-01"] }),
  }, "planner");

  assert.equal(plan.status, "awaiting_confirmation");
  assert.ok(plan.validation.warnings.some((issue) => issue.code === "RACK_POWER_HIGH"));
  const result = await service.confirm(plan.id, "admin");
  assert.equal(result.plan.status, "succeeded");
  assert.equal(result.plan.confirmation_count, 1);
});

test("simulated execution failure rolls back inventory and records failure", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({
    kind: "placement",
    fail_at: "written",
    device: sampleDevice({ id: "FAIL-ROLLBACK" }),
  }, "planner");
  const deviceCount = repository.read().devices.length;

  const result = await service.confirm(plan.id, "admin");
  const state = repository.read();
  assert.equal(result.plan.status, "failed");
  assert.equal(result.execution.rolled_back, true);
  assert.equal(state.devices.length, deviceCount);
  assert.ok(state.audit.some((entry) => entry.entity_id === plan.id && entry.action === "plan_failed"));
});

test("request strategy overrides the stored default without mutating settings", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({ kind: "placement", strategy_id: "load_balanced", device: sampleDevice() }, "planner");
  assert.equal(plan.strategy_id, "load_balanced");
  assert.equal(repository.read().settings.placement.default_strategy_id, "balanced_optimal");
  assert.equal(plan.snapshot_version, plan.base_version);
});

test("invalid Agent alternative is audited and baseline remains confirmable", async () => {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
    agentGateway: { async adjustPlan() { return {
      candidate_id: null,
      reason: "Try an impossible position",
      weight_multipliers: { business: 1.5 },
      alternatives: [{ id: "BAD", reason: "overlap", actions: [{
        type: "place_device", rack_id: "CAB-02", layer_id: "L01", start_u: 1,
        device: { ...sampleDevice(), preferred_rack_ids: undefined, start_u: 1 },
      }] }],
    }; } },
  });
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");
  assert.equal(plan.status, "awaiting_confirmation");
  assert.ok(plan.agent_intervention.rejected_alternatives.some((item) => item.id === "BAD"));
  assert.ok(repository.read().audit.some((entry) => entry.entity_id === plan.id && entry.details.rejected_alternative_ids.includes("BAD")));
});

test("server removal uses one final confirmation and leaves an audit trail", async () => {
  const { repository, service } = fixture();
  const removable = repository.read().devices.find((item) => item.movable && item.criticality === "normal" && item.maintenance_window);
  const plan = await service.create({
    kind: "removal",
    device_id: removable.id,
    actions: [{ type: "remove_device", device_id: removable.id, rack_id: removable.rack_id }],
    reasons: ["设备符合取出维护约束"],
  }, "planner");

  assert.equal(plan.status, "awaiting_confirmation");
  assert.equal(plan.kind, "removal");
  assert.equal(plan.confirmation_count, 0);

  const result = await service.confirm(plan.id, "admin");
  const state = repository.read();
  assert.equal(result.plan.status, "succeeded");
  assert.equal(result.plan.confirmation_count, 1);
  assert.equal(state.devices.some((item) => item.id === removable.id), false);
  assert.equal(state.audit.some((entry) => entry.entity_id === plan.id && entry.action === "plan_succeeded" && entry.details.kind === "removal"), true);
  await assert.rejects(() => service.confirm(plan.id, "admin"), (error) => error.code === "PLAN_ALREADY_CONFIRMED");
});

test("server removal plan replaces client display facts with canonical inventory", async () => {
  const { repository, service } = fixture();
  const removable = repository.read().devices.find((item) => item.movable && item.criticality === "normal" && item.maintenance_window);
  const plan = await service.create({
    kind: "removal",
    device_id: removable.id,
    actions: [{
      type: "remove_device",
      device_id: removable.id,
      rack_id: removable.rack_id,
      device: { id: removable.id, hostname: "tampered", business_id: "tampered" },
    }],
  }, "planner");

  assert.equal(plan.actions[0].device.hostname, removable.hostname);
  assert.equal(plan.actions[0].device.business_id, removable.business_id);
  assert.equal(plan.actions[0].device.maintenance_window, removable.maintenance_window);
});

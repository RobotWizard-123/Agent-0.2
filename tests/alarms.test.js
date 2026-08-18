import test from "node:test";
import assert from "node:assert/strict";
import { createAlarmEngine } from "../src/alarms/alarm-engine.js";
import { createDiagnosisEngine } from "../src/alarms/diagnosis-engine.js";
import { createDemoState } from "../src/demo-state.js";
import { createPlanningEngine } from "../src/planning/planning-engine.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createTopologyService } from "../src/topology/topology-service.js";
import { createPlanService } from "../src/workflows/plan-service.js";
import { createSimulatedExecutionAdapter } from "../src/workflows/simulated-execution-adapter.js";

function alarmFixture() {
  const repository = createMemoryRepository(createDemoState());
  const planService = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
  });
  const alarmEngine = createAlarmEngine({ repository });
  const diagnosisEngine = createDiagnosisEngine({
    repository,
    alarmEngine,
    planService,
    topologyService: createTopologyService(),
  });
  return { repository, planService, alarmEngine, diagnosisEngine };
}

test("power-high demo alarm closes through diagnosis, one confirmation, and rule verification", async () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("power_high", "admin");
  assert.equal(alarm.status, "open");
  assert.equal(alarm.source, "demo");

  const diagnosis = fixture.diagnosisEngine.diagnose(alarm.id, "admin");
  assert.equal(diagnosis.root_cause_code, "RACK_POWER_HIGH");
  assert.ok(diagnosis.evidence.rated_power_used_w >= 8_000);

  const plan = await fixture.diagnosisEngine.createRemediation(alarm.id, "admin");
  assert.equal(plan.status, "awaiting_confirmation");
  assert.equal(plan.request.alarm_id, alarm.id);
  const move = plan.actions.find((action) => action.type === "move_device");
  assert.equal(move.to.rack_id, "CAB-19");
  assert.equal(move.power_connections.length, 1);
  assert.equal(move.network_connections.length, 1);

  const result = await fixture.diagnosisEngine.confirmRemediation(plan.id, "admin");
  assert.equal(result.plan.status, "succeeded");
  assert.equal(result.alarm.status, "resolved");
  assert.equal(result.alarm.recovery_verified, true);
  assert.equal(result.plan.confirmation_count, 1);
});

test("an alarm cannot be manually resolved while its trigger remains active", () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("collector_offline", "admin");

  assert.throws(
    () => fixture.alarmEngine.resolve(alarm.id, "admin"),
    (error) => error.code === "ALARM_STILL_ACTIVE",
  );
});

test("collector-offline remediation restores service health before resolving", async () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("collector_offline", "admin");
  fixture.diagnosisEngine.diagnose(alarm.id, "admin");
  const plan = await fixture.diagnosisEngine.createRemediation(alarm.id, "admin");

  const result = await fixture.diagnosisEngine.confirmRemediation(plan.id, "admin");
  assert.equal(fixture.repository.read().service_health.collector.status, "healthy");
  assert.equal(result.alarm.status, "resolved");
});

test("placement-conflict scenario clears its condition through an audited remediation", async () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("placement_conflict", "admin");
  fixture.diagnosisEngine.diagnose(alarm.id, "admin");
  const plan = await fixture.diagnosisEngine.createRemediation(alarm.id, "admin");
  const result = await fixture.diagnosisEngine.confirmRemediation(plan.id, "admin");

  assert.equal(result.alarm.status, "resolved");
  assert.equal(fixture.repository.read().demo_conditions.some((condition) => condition.id === alarm.condition_id), false);
  assert.ok(fixture.repository.read().audit.some((entry) => entry.entity_id === alarm.id && entry.action === "alarm_resolved"));
});

test("stale remediation confirmation returns the alarm to action pending", async () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("power_high", "admin");
  fixture.diagnosisEngine.diagnose(alarm.id, "admin");
  const plan = await fixture.diagnosisEngine.createRemediation(alarm.id, "admin");
  const move = plan.actions.find((action) => action.type === "move_device");
  fixture.repository.mutate(fixture.repository.read().version, (draft) => {
    draft.devices.push({
      id: "REMEDIATION-BLOCKER",
      rack_id: move.to.rack_id,
      layer_id: move.to.layer_id,
      start_u: move.to.start_u,
      u_size: 2,
      rated_power_w: 100,
      real_power_w: null,
      weight_kg: 1,
      network_ports: 1,
      movable: false,
      criticality: "normal",
      maintenance_window: null,
      status: "running",
      data_source: "demo",
    });
  });

  await assert.rejects(
    () => fixture.diagnosisEngine.confirmRemediation(plan.id, "admin"),
    (error) => error.code === "PLAN_STALE",
  );
  assert.equal(fixture.alarmEngine.get(alarm.id).status, "action_pending");
});

test("alarm acknowledgement and diagnosis follow explicit state transitions", () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("model_offline", "admin");
  const acknowledged = fixture.alarmEngine.acknowledge(alarm.id, "operator");
  const diagnosis = fixture.diagnosisEngine.diagnose(alarm.id, "operator");

  assert.equal(acknowledged.status, "acknowledged");
  assert.equal(fixture.alarmEngine.get(alarm.id).status, "diagnosing");
  assert.equal(diagnosis.root_cause_code, "MODEL_SERVICE_OFFLINE");
});

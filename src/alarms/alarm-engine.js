import { randomUUID } from "node:crypto";
import { capacitySnapshot } from "../domain/capacity.js";

const scenarios = {
  power_high: { severity: "warning", object_type: "rack", object_id: "CAB-01", trigger_code: "RACK_POWER_HIGH" },
  placement_conflict: { severity: "critical", object_type: "rack", object_id: "CAB-09", trigger_code: "PLACEMENT_CONFLICT" },
  collector_offline: { severity: "critical", object_type: "service", object_id: "collector", trigger_code: "COLLECTOR_OFFLINE" },
  model_offline: { severity: "warning", object_type: "service", object_id: "model", trigger_code: "MODEL_SERVICE_OFFLINE" },
  execution_failure: { severity: "critical", object_type: "service", object_id: "execution-adapter", trigger_code: "SIMULATED_EXECUTION_FAILED" },
};

function alarmError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

export function createAlarmEngine({ repository, idFactory = randomUUID, now = () => new Date().toISOString() }) {
  function get(id) {
    const alarm = repository.read().alarms.find((item) => item.id === id);
    if (!alarm) throw alarmError("ALARM_NOT_FOUND", `Alarm does not exist: ${id}`, { alarm_id: id });
    return clone(alarm);
  }

  function list() {
    return repository.read().alarms.map(clone).reverse();
  }

  function triggerDemo(scenario, actor) {
    const definition = scenarios[scenario];
    if (!definition) throw alarmError("DEMO_SCENARIO_INVALID", `Unsupported alarm scenario: ${scenario}`);
    const state = repository.read();
    const alarmId = `ALARM-${idFactory()}`;
    const conditionId = `CONDITION-${idFactory()}`;

    const changed = repository.mutate(state.version, (draft) => {
      const condition = { id: conditionId, type: scenario, target_id: definition.object_id, created_at: now(), data_source: "demo" };
      draft.demo_conditions.push(condition);

      if (scenario === "power_high") {
        draft.devices.push({
          id: "DEMO-ALARM-POWER",
          asset_id: "DEMO-ALARM-ASSET",
          hostname: "power-alarm-demo",
          model: "2U Power Alarm Demo",
          serial: "DEMO-ALARM-SN",
          rack_id: "CAB-01",
          layer_id: "L02",
          start_u: 15,
          u_size: 2,
          rated_power_w: 8_200,
          real_power_w: null,
          weight_kg: 20,
          network_ports: 1,
          business: "报警闭环演示",
          owner: "机房运维",
          movable: true,
          criticality: "normal",
          maintenance_window: "Saturday 02:00-04:00",
          status: "running",
          data_source: "demo",
        });
      }
      if (scenario === "collector_offline") {
        draft.service_health.collector = { status: "offline", checked_at: now() };
      }
      if (scenario === "model_offline") {
        draft.service_health.model = { status: "offline", checked_at: now() };
      }

      const evidence = scenario === "power_high"
        ? capacitySnapshot(draft, definition.object_id)
        : { condition_id: conditionId, service_status: draft.service_health[definition.object_id]?.status ?? "active" };
      draft.alarms.push({
        id: alarmId,
        scenario,
        source: "demo",
        severity: definition.severity,
        object_type: definition.object_type,
        object_id: definition.object_id,
        trigger_code: definition.trigger_code,
        condition_id: conditionId,
        evidence,
        status: "open",
        opened_at: now(),
        acknowledged_at: null,
        acknowledged_by: null,
        resolved_at: null,
        resolved_by: null,
        recovery_verified: false,
      });
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "alarm",
        entity_id: alarmId,
        action: "demo_alarm_triggered",
        actor,
        at: now(),
        details: { scenario, condition_id: conditionId },
      });
    });

    return clone(changed.alarms.find((alarm) => alarm.id === alarmId));
  }

  function updateStatus(id, allowedStatuses, status, actor, action) {
    const state = repository.read();
    const alarm = state.alarms.find((item) => item.id === id);
    if (!alarm) throw alarmError("ALARM_NOT_FOUND", `Alarm does not exist: ${id}`, { alarm_id: id });
    if (!allowedStatuses.includes(alarm.status)) {
      throw alarmError("ALARM_TRANSITION_INVALID", `Cannot move alarm ${id} from ${alarm.status} to ${status}`, { alarm_id: id });
    }
    const changed = repository.mutate(state.version, (draft) => {
      const stored = draft.alarms.find((item) => item.id === id);
      stored.status = status;
      if (status === "acknowledged") {
        stored.acknowledged_at = now();
        stored.acknowledged_by = actor;
      }
      draft.audit.push({ id: `AUDIT-${idFactory()}`, entity_type: "alarm", entity_id: id, action, actor, at: now(), details: { status } });
    });
    return clone(changed.alarms.find((item) => item.id === id));
  }

  function conditionActive(state, alarm) {
    if (alarm.scenario === "power_high") {
      const capacity = capacitySnapshot(state, alarm.object_id);
      return capacity.rated_power_used_w >= capacity.design_power_w * 0.8;
    }
    if (alarm.scenario === "collector_offline") return state.service_health.collector.status === "offline";
    if (alarm.scenario === "model_offline") return state.service_health.model.status === "offline";
    return state.demo_conditions.some((condition) => condition.id === alarm.condition_id);
  }

  function resolve(id, actor) {
    const state = repository.read();
    const alarm = state.alarms.find((item) => item.id === id);
    if (!alarm) throw alarmError("ALARM_NOT_FOUND", `Alarm does not exist: ${id}`, { alarm_id: id });
    if (conditionActive(state, alarm)) {
      throw alarmError("ALARM_STILL_ACTIVE", `Alarm trigger is still active: ${id}`, { alarm_id: id });
    }
    const changed = repository.mutate(state.version, (draft) => {
      const stored = draft.alarms.find((item) => item.id === id);
      stored.status = "resolved";
      stored.resolved_at = now();
      stored.resolved_by = actor;
      stored.recovery_verified = true;
      draft.demo_conditions = draft.demo_conditions.filter((condition) => condition.id !== stored.condition_id);
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "alarm",
        entity_id: id,
        action: "alarm_resolved",
        actor,
        at: now(),
        details: { recovery_verified: true },
      });
    });
    return clone(changed.alarms.find((item) => item.id === id));
  }

  return {
    get,
    list,
    triggerDemo,
    acknowledge: (id, actor) => updateStatus(id, ["open"], "acknowledged", actor, "alarm_acknowledged"),
    markDiagnosing: (id, actor) => updateStatus(id, ["open", "acknowledged"], "diagnosing", actor, "alarm_diagnosing"),
    markActionPending: (id, actor) => updateStatus(id, ["diagnosing"], "action_pending", actor, "alarm_action_pending"),
    markExecuting: (id, actor) => updateStatus(id, ["action_pending"], "executing", actor, "alarm_executing"),
    markActionPendingAfterFailure: (id, actor) => updateStatus(id, ["executing"], "action_pending", actor, "alarm_remediation_failed"),
    resolve,
  };
}

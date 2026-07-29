import { randomUUID } from "node:crypto";
import { capacitySnapshot } from "../domain/capacity.js";

const rootCauses = {
  power_high: { code: "RACK_POWER_HIGH", summary: "机柜额定功率达到设计容量预警线", confidence: 0.99 },
  placement_conflict: { code: "PLACEMENT_CONFLICT", summary: "待上架设备与现有层位或预留空间冲突", confidence: 0.96 },
  collector_offline: { code: "COLLECTOR_OFFLINE", summary: "数据采集服务离线，实时值不可用", confidence: 0.99 },
  model_offline: { code: "MODEL_SERVICE_OFFLINE", summary: "私有模型服务不可用，系统已降级到规则引擎", confidence: 0.99 },
  execution_failure: { code: "SIMULATED_EXECUTION_FAILED", summary: "模拟执行失败且已回滚到执行前状态", confidence: 0.99 },
};

function diagnosisError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

export function createDiagnosisEngine({
  repository,
  alarmEngine,
  planService,
  topologyService,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
}) {
  function evidenceFor(state, alarm) {
    if (alarm.scenario === "power_high") return capacitySnapshot(state, alarm.object_id);
    return {
      ...clone(alarm.evidence),
      service_health: alarm.object_type === "service" ? clone(state.service_health[alarm.object_id] ?? null) : null,
    };
  }

  function affectedChain(state, alarm) {
    if (alarm.object_type === "rack") {
      const rack = state.racks.find((item) => item.id === alarm.object_id);
      const source = state.power_sources.find((item) => item.id === rack?.source_id);
      return [
        { type: "room", id: state.room.id, label: state.room.name, source: state.room.data_source },
        { type: "power_source", id: source?.id ?? null, label: source?.name ?? "未知配电来源", source: source?.data_source ?? "unknown" },
        { type: "rack", id: rack?.id ?? alarm.object_id, label: rack?.name ?? alarm.object_id, source: rack?.data_source ?? "unknown" },
      ];
    }
    return [{ type: "service", id: alarm.object_id, label: alarm.object_id, source: alarm.source }];
  }

  function diagnose(alarmId, actor) {
    alarmEngine.markDiagnosing(alarmId, actor);
    const state = repository.read();
    const alarm = state.alarms.find((item) => item.id === alarmId);
    const root = rootCauses[alarm.scenario];
    if (!root) throw diagnosisError("DIAGNOSIS_SCENARIO_UNSUPPORTED", `No diagnosis mapping for ${alarm.scenario}`, { alarm_id: alarmId });
    const diagnosisId = `DIAGNOSIS-${idFactory()}`;
    const diagnosis = {
      id: diagnosisId,
      alarm_id: alarmId,
      root_cause_code: root.code,
      summary: root.summary,
      confidence: root.confidence,
      evidence: evidenceFor(state, alarm),
      affected_chain: affectedChain(state, alarm),
      recommended_actions: remediationActions(alarm),
      status: "completed",
      created_at: now(),
      created_by: actor,
      plan_id: null,
    };
    const changed = repository.mutate(state.version, (draft) => {
      draft.diagnoses.push(clone(diagnosis));
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "alarm",
        entity_id: alarmId,
        action: "alarm_diagnosed",
        actor,
        at: now(),
        details: { diagnosis_id: diagnosisId, root_cause_code: root.code },
      });
    });
    return clone(changed.diagnoses.find((item) => item.id === diagnosisId));
  }

  function remediationActions(alarm) {
    if (alarm.scenario === "power_high") {
      return [{
        type: "move_device",
        device_id: "DEMO-ALARM-POWER",
        rack_id: "CAB-12",
        layer_id: "L04",
        start_u: 33,
      }];
    }
    if (alarm.scenario === "collector_offline") {
      return [{ type: "set_service_health", service: "collector", status: "healthy" }];
    }
    if (alarm.scenario === "model_offline") {
      return [{ type: "set_service_health", service: "model", status: "healthy" }];
    }
    return [{ type: "clear_demo_condition", condition_id: alarm.condition_id }];
  }

  async function createRemediation(alarmId, actor) {
    const state = repository.read();
    const alarm = state.alarms.find((item) => item.id === alarmId);
    if (!alarm) throw diagnosisError("ALARM_NOT_FOUND", `Alarm does not exist: ${alarmId}`, { alarm_id: alarmId });
    if (alarm.status !== "diagnosing") throw diagnosisError("ALARM_NOT_DIAGNOSED", `Alarm ${alarmId} must be diagnosed first`, { alarm_id: alarmId });
    const diagnosis = [...state.diagnoses].reverse().find((item) => item.alarm_id === alarmId);
    if (!diagnosis) throw diagnosisError("DIAGNOSIS_NOT_FOUND", `Diagnosis does not exist for ${alarmId}`, { alarm_id: alarmId });

    const plan = await planService.create({
      kind: "alarm_remediation",
      alarm_id: alarmId,
      diagnosis_id: diagnosis.id,
      actions: remediationActions(alarm),
      reasons: [diagnosis.summary, "处置完成后必须重新验证告警触发条件"],
      risk: alarm.severity === "critical" ? "warning" : "safe",
    }, actor);

    const afterPlan = repository.read();
    const changed = repository.mutate(afterPlan.version, (draft) => {
      const storedAlarm = draft.alarms.find((item) => item.id === alarmId);
      storedAlarm.status = "action_pending";
      const storedDiagnosis = draft.diagnoses.find((item) => item.id === diagnosis.id);
      storedDiagnosis.plan_id = plan.id;
      const storedPlan = draft.plans.find((item) => item.id === plan.id);
      storedPlan.base_version = afterPlan.version + 1;
      storedPlan.snapshot_version = afterPlan.version + 1;
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "alarm",
        entity_id: alarmId,
        action: "alarm_remediation_planned",
        actor,
        at: now(),
        details: { plan_id: plan.id },
      });
    });
    return clone(changed.plans.find((item) => item.id === plan.id));
  }

  async function confirmRemediation(planId, actor) {
    const plan = planService.get(planId);
    const alarmId = plan.request.alarm_id;
    if (plan.kind !== "alarm_remediation" || !alarmId) {
      throw diagnosisError("REMEDIATION_PLAN_REQUIRED", `Plan ${planId} is not an alarm remediation`, { plan_id: planId });
    }

    const state = repository.read();
    repository.mutate(state.version, (draft) => {
      const alarm = draft.alarms.find((item) => item.id === alarmId);
      if (!alarm || alarm.status !== "action_pending") throw diagnosisError("ALARM_TRANSITION_INVALID", `Alarm ${alarmId} is not awaiting action`);
      alarm.status = "executing";
      const storedPlan = draft.plans.find((item) => item.id === planId);
      storedPlan.base_version = state.version + 1;
      storedPlan.snapshot_version = state.version + 1;
    });

    const result = await planService.confirm(planId, actor);
    if (result.plan.status === "succeeded") {
      return { ...result, alarm: alarmEngine.resolve(alarmId, actor) };
    }
    return { ...result, alarm: alarmEngine.markActionPendingAfterFailure(alarmId, actor) };
  }

  return { diagnose, createRemediation, confirmRemediation };
}

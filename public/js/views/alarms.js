import { emptyState, h, panel, showToast, sourceBadge, statusBadge } from "../components.js";
import {
  acknowledgeAlarm,
  createRemediation,
  diagnoseAlarm,
  selectAlarm,
  triggerDemoAlarm,
} from "../state.js";
import { openPlanConfirmation } from "./placement-plan.js";

const scenarios = [
  ["power_high", "模拟功率过高", "在 CAB-01 加入 8.2kW 演示负载"],
  ["placement_conflict", "模拟层位冲突", "生成不可共存的放置条件"],
  ["collector_offline", "模拟采集离线", "实时功率降级为设计/未知"],
  ["model_offline", "模拟模型离线", "Agent 降级至结构化规则引擎"],
  ["execution_failure", "模拟执行故障", "演示故障条件、处置和恢复验证"],
];

const statusLabels = {
  open: "待处理", acknowledged: "已确认", diagnosing: "诊断中", action_pending: "待确认处置",
  executing: "执行中", resolved: "已恢复",
};

function alarmTone(alarm) {
  if (alarm.status === "resolved") return "ok";
  return alarm.severity === "critical" ? "danger" : "warning";
}

function scenarioButtons(state) {
  return h("div", { className: "scenario-grid" }, scenarios.map(([id, label, detail]) => {
    const active = state.alarms.some((alarm) => alarm.scenario === id && alarm.status !== "resolved");
    return h("button", {
      type: "button",
      className: "scenario-button",
      disabled: state.session.role !== "admin" || active,
      onClick: async () => {
        try { await triggerDemoAlarm(id); showToast(`${label}已触发`, "warning"); }
        catch (error) { showToast(`${error.code ?? "SCENARIO_FAILED"} · ${error.message}`, "danger"); }
      },
    }, [h("strong", { text: active ? `${label} · 进行中` : label }), h("span", { text: detail })]);
  }));
}

function alarmList(state) {
  if (!state.alarms.length) return emptyState("暂无报警", "使用上方场景按钮触发一次可恢复、可审计的演示报警。");
  return h("div", { className: "alarm-list" }, state.alarms.map((alarm) => h("button", {
    type: "button",
    className: `alarm-row ${state.selectedAlarm?.id === alarm.id ? "is-selected" : ""}`,
    onClick: () => selectAlarm(alarm.id),
  }, [
    h("span", { className: `alarm-severity severity-${alarm.severity}` }),
    h("span", {}, [h("strong", { text: alarm.trigger_code }), h("small", { text: `${alarm.object_id} · ${new Date(alarm.opened_at).toLocaleString("zh-CN")}` })]),
    statusBadge(statusLabels[alarm.status] ?? alarm.status, alarmTone(alarm)),
  ])));
}

function evidenceBlock(diagnosis) {
  if (!diagnosis) return null;
  return h("section", { className: "diagnosis-block" }, [
    h("div", { className: "diagnosis-head" }, [
      h("div", {}, [h("p", { className: "section-kicker", text: diagnosis.root_cause_code }), h("h3", { text: diagnosis.summary })]),
      statusBadge(`置信度 ${Math.round(diagnosis.confidence * 100)}%`, "ok"),
    ]),
    h("h4", { text: "影响链" }),
    h("div", { className: "affected-chain" }, diagnosis.affected_chain.map((node, index) => [
      h("article", {}, [sourceBadge(node.source), h("strong", { text: node.label }), h("code", { text: node.id ?? "UNKNOWN" })]),
      index < diagnosis.affected_chain.length - 1 ? h("span", { text: "→" }) : null,
    ])),
    h("h4", { text: "诊断证据" }),
    h("pre", { className: "evidence-json", text: JSON.stringify(diagnosis.evidence, null, 2) }),
  ]);
}

function remediationPlan(plan, state) {
  if (!plan || plan.kind !== "alarm_remediation") return null;
  return h("section", { className: "remediation-plan" }, [
    h("div", { className: "plan-status-row" }, [h("div", {}, [h("p", { className: "section-kicker", text: plan.id }), h("h3", { text: "处置方案已通过硬约束复核" })]), statusBadge(plan.status, plan.status === "succeeded" ? "ok" : "warning")]),
    h("ol", { className: "action-list" }, plan.actions.map((action) => h("li", { text: action.type === "move_device" ? `迁移 ${action.device_id} → ${action.rack_id} / ${action.layer_id}` : `${action.type} · ${action.service ?? action.condition_id}` }))),
    plan.status === "awaiting_confirmation" && state.session.role === "admin" ? h("button", {
      type: "button", className: "primary-button", text: "进入最终确认", onClick: () => openPlanConfirmation(plan),
    }) : null,
  ]);
}

function alarmDetail(state) {
  const alarm = state.selectedAlarm;
  if (!alarm) return emptyState("选择一条报警", "报警详情会展示证据、根因、影响链、处置动作和恢复验证。");
  const canDiagnose = ["open", "acknowledged"].includes(alarm.status);
  return h("div", { className: "alarm-detail" }, [
    h("div", { className: "alarm-detail-head" }, [
      h("div", {}, [h("p", { className: "section-kicker", text: alarm.id }), h("h2", { text: alarm.trigger_code }), h("p", { text: `${alarm.object_type} / ${alarm.object_id}` })]),
      h("div", { className: "intro-badges" }, [sourceBadge(alarm.source), statusBadge(statusLabels[alarm.status] ?? alarm.status, alarmTone(alarm))]),
    ]),
    h("div", { className: "alarm-actions" }, [
      alarm.status === "open" ? h("button", { type: "button", className: "secondary-button", text: "确认收到报警", disabled: state.session.role !== "admin", onClick: async () => {
        try { await acknowledgeAlarm(alarm.id); } catch (error) { showToast(error.message, "danger"); }
      } }) : null,
      canDiagnose ? h("button", { type: "button", className: "primary-button", text: "Agent 诊断", disabled: state.session.role !== "admin", onClick: async () => {
        try { await diagnoseAlarm(alarm.id); showToast("诊断完成"); } catch (error) { showToast(error.message, "danger"); }
      } }) : null,
    ]),
    evidenceBlock(state.diagnosis?.alarm_id === alarm.id ? state.diagnosis : null),
    alarm.status === "diagnosing" && state.diagnosis?.alarm_id === alarm.id ? h("button", {
      type: "button", className: "primary-button", text: "生成处置方案", disabled: state.session.role !== "admin", onClick: async () => {
        try { await createRemediation(alarm.id); showToast("处置方案已生成，等待最终确认"); } catch (error) { showToast(error.message, "danger"); }
      },
    }) : null,
    remediationPlan(state.currentPlan, state),
    alarm.status === "resolved" ? h("div", { className: "recovery-card" }, [
      statusBadge("已恢复", "ok"),
      h("strong", { text: "恢复验证通过" }),
      h("p", { text: "触发条件已消失，处置动作、最终确认、执行结果和复核记录已写入审计。" }),
    ]) : null,
  ]);
}

export function renderAlarms(container, state) {
  const intro = h("section", { className: "view-intro" }, [
    h("div", {}, [h("p", { className: "section-kicker", text: "TRIGGER → DIAGNOSE → REMEDIATE → VERIFY" }), h("h2", { text: "报警诊断与恢复" }), h("p", { text: "报警不能被直接标记为恢复。只有处置执行后触发条件确实消失，系统才会关闭报警。" })]),
    statusBadge(state.session.role === "admin" ? "管理员演示模式" : "只读模式", state.session.role === "admin" ? "ok" : "neutral"),
  ]);
  const scenariosPanel = panel("可交互演示场景", scenarioButtons(state), { kicker: "DEMO TRIGGERS" });
  const listPanel = panel("报警队列", alarmList(state), { kicker: "ALARMS" });
  const detailPanel = panel("诊断工作区", alarmDetail(state), { kicker: "EVIDENCE & RECOVERY" });
  container.replaceChildren(intro, scenariosPanel, h("section", { className: "alarm-grid" }, [listPanel, detailPanel]));
}

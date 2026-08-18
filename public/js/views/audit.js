import { emptyState, h, openDialog, panel, showToast, statusBadge } from "../components.js";
import { resetDemoState } from "../state.js";

const actionNames = {
  plan_created: "方案创建",
  plan_succeeded: "方案执行成功",
  plan_failed: "方案执行失败并回滚",
  plan_candidate_selected: "候选方案切换",
  demo_alarm_triggered: "演示报警触发",
  alarm_acknowledged: "报警已确认",
  alarm_diagnosing: "开始诊断",
  alarm_diagnosed: "诊断完成",
  alarm_remediation_planned: "处置方案生成",
  alarm_resolved: "恢复验证通过",
  demo_state_reset: "演示数据重置",
  placement_strategy_updated: "放置策略更新",
};

const entityTypeNames = {
  plan: "方案",
  alarm: "报警",
  settings: "设置",
  system: "系统",
};

const evidenceLabels = {
  status: "状态",
  kind: "类型",
  device_ids: "涉及设备",
  schema_version: "方案版本",
  search_phase: "搜索阶段",
  migration_impact: "迁移影响",
  compaction_impact: "整理影响",
  stages: "执行阶段",
  rolled_back: "已回滚",
  risk: "风险等级",
  strategy_id: "策略",
  model_assignment_variables: "模型变量数",
  solver_engine: "求解引擎",
  solver_status: "求解状态",
  solver_duration_ms: "求解耗时",
  solver_candidate_count: "候选方案数",
  solver_fallback_reason: "回退原因",
  solver_validation_rejected_count: "校验拒绝数",
  solver_validation_rejection_summary: "校验拒绝摘要",
  scenario: "报警场景",
  condition_id: "触发条件",
  recovery_verified: "恢复已验证",
  diagnosis_id: "诊断编号",
  root_cause_code: "根因代码",
  plan_id: "方案编号",
  seed_version: "种子版本",
  previous_strategy_id: "原策略",
};

const kindLabels = {
  placement: "上架",
  removal: "下架",
  alarm_remediation: "报警处置",
  migration: "迁移",
};

const statusLabels = {
  awaiting_confirmation: "等待最终确认",
  succeeded: "成功",
  failed: "失败",
  open: "打开",
  acknowledged: "已确认",
  resolved: "已解决",
  diagnosing: "诊断中",
  action_pending: "待处置",
  validated: "已校验",
  planned: "已规划",
};

const riskLabels = {
  safe: "安全",
  warning: "警告",
  danger: "阻断",
};

const searchPhaseLabels = {
  normal: "常规搜索",
  expanded: "扩展搜索",
};

const scenarioLabels = {
  power_high: "功率过高",
  collector_offline: "采集离线",
  model_offline: "模型离线",
};

const stageLabels = {
  locked: "锁定",
  audited: "已审计",
  applied: "已应用",
  rolled_back: "已回滚",
};

const strategyLabels = {
  balanced_optimal: "均衡最优",
  consolidated: "集中部署",
  preferred: "优先机柜",
  homogeneous: "同构批次",
};

function deviceById(devices, id) {
  for (const device of devices) {
    if (device.id === id) return device;
  }
  return null;
}

function renderDeviceList(ids, devices) {
  const list = h("div", { className: "audit-device-list" });
  for (const id of ids) {
    const device = deviceById(devices, id);
    const color = device && device.color ? device.color : "var(--steel-300)";
    const itCode = device && device.it_code ? device.it_code : "—";
    list.append(h("div", { className: "audit-device-line", style: { color }, text: `${id} / IT-Code: ${itCode}` }));
  }
  return list;
}

function formatEvidenceValue(key, value, devices) {
  if (key === "device_ids") {
    return Array.isArray(value) ? renderDeviceList(value, devices) : h("span", { text: String(value) });
  }
  if (key === "stages" && Array.isArray(value)) {
    return h("span", { text: value.map((stage) => stageLabels[stage] ?? stage).join(" → ") });
  }
  if (["compaction_impact", "migration_impact", "solver_validation_rejection_summary"].includes(key)) {
    return h("pre", {}, [h("code", { text: JSON.stringify(value, null, 2) })]);
  }
  if (key === "status") return h("span", { text: statusLabels[value] ?? value });
  if (key === "kind") return h("span", { text: kindLabels[value] ?? value });
  if (key === "risk") return h("span", { text: riskLabels[value] ?? value });
  if (key === "search_phase") return h("span", { text: searchPhaseLabels[value] ?? value });
  if (key === "scenario") return h("span", { text: scenarioLabels[value] ?? value });
  if (key === "rolled_back" || key === "recovery_verified") return h("span", { text: value ? "是" : "否" });
  if (key === "solver_duration_ms" && typeof value === "number") return h("span", { text: `${value} ms` });
  if (key === "strategy_id" || key === "previous_strategy_id") return h("span", { text: strategyLabels[value] ?? value });
  return h("span", { text: value === null || value === undefined ? "—" : String(value) });
}

function evidencePanel(details, devices) {
  const rows = h("dl", { className: "audit-evidence-list" });
  for (const [key, value] of Object.entries(details ?? {})) {
    rows.append(h("div", {}, [
      h("dt", { text: evidenceLabels[key] ?? key }),
      h("dd", {}, [formatEvidenceValue(key, value, devices)]),
    ]));
  }
  return h("div", { className: "audit-evidence" }, [
    h("span", { text: "详细证据" }),
    rows,
  ]);
}

function auditTimeline(items, devices) {
  if (!items.length) return emptyState("暂无审计记录", "创建方案、触发报警或执行变更后，记录将按时间显示在这里。");
  return h("ol", { className: "audit-timeline" }, items.map((entry) => h("li", {}, [
    h("span", { className: "timeline-mark", "aria-hidden": "true" }),
    h("details", { className: "audit-entry" }, [
      h("summary", {}, [
        h("div", { className: "audit-entry-head" }, [
          h("strong", { text: actionNames[entry.action] ?? entry.action }),
          statusBadge(entityTypeNames[entry.entity_type] ?? entry.entity_type, entry.action.includes("failed") ? "danger" : entry.action.includes("resolved") || entry.action.includes("succeeded") ? "ok" : "neutral"),
        ]),
        h("p", { text: `${entry.entity_id} · 操作人 ${entry.actor}` }),
        h("time", { datetime: entry.at, text: new Date(entry.at).toLocaleString("zh-CN") }),
      ]),
      h("div", { className: "audit-entry-details" }, [
        h("dl", {}, [
          h("div", {}, [h("dt", { text: "记录编号" }), h("dd", { text: entry.id })]),
          h("div", {}, [h("dt", { text: "对象类型" }), h("dd", { text: entityTypeNames[entry.entity_type] ?? entry.entity_type })]),
          h("div", {}, [h("dt", { text: "对象编号" }), h("dd", { text: entry.entity_id })]),
          h("div", {}, [h("dt", { text: "动作代码" }), h("dd", { text: actionNames[entry.action] ?? entry.action })]),
          h("div", {}, [h("dt", { text: "操作人" }), h("dd", { text: entry.actor })]),
          h("div", {}, [h("dt", { text: "时间" }), h("dd", { text: new Date(entry.at).toLocaleString("zh-CN") })]),
        ]),
        evidencePanel(entry.details, devices),
      ]),
    ]),
  ])));
}

function openResetDialog() {
  const content = h("div", { className: "confirmation-content" }, [
    h("p", { className: "section-kicker", text: "管理确认" }),
    h("h2", { text: "重置全部演示数据？" }),
    h("p", { className: "confirmation-lead", text: "这会恢复 L5-A2-08 的 22 柜标准种子，清除当前方案、报警和变更记录，再写入一条新的重置审计。" }),
    h("div", { className: "confirmation-actions" }, [
      h("button", { type: "button", className: "secondary-button", text: "取消", onClick: () => close() }),
      h("button", {
        type: "button", className: "primary-button", text: "确认重置演示数据", onClick: async (event) => {
          event.currentTarget.disabled = true;
          try { await resetDemoState(); close(); showToast("演示数据已恢复为标准种子"); }
          catch (error) { event.currentTarget.disabled = false; showToast(`${error.code ?? "RESET_FAILED"} · ${error.message}`, "danger"); }
        }
      }),
    ]),
  ]);
  const close = openDialog(content, { label: "重置演示数据" });
}

export function renderAudit(container, state) {
  const filterId = state.route.id;
  const items = filterId ? state.audit.filter((entry) => entry.entity_id === filterId || JSON.stringify(entry.details).includes(filterId)) : state.audit;
  const intro = h("section", { className: "view-intro" }, [
    h("div", {}, [h("p", { className: "section-kicker", text: "谁 / 何时 / 什么 / 结果" }), h("h2", { text: "变更与诊断审计" }), h("p", { text: filterId ? `正在查看与 ${filterId} 相关的记录。` : "每一次方案创建、最终确认、执行、回滚和恢复验证都有可追溯记录。" })]),
    state.session.role === "admin" ? h("button", { type: "button", className: "secondary-button", text: "重置演示数据", onClick: openResetDialog }) : statusBadge("只读查看", "neutral"),
  ]);
  container.replaceChildren(intro, panel("审计时间线", auditTimeline(items, state.devices), { kicker: "不可变追溯" }));
}

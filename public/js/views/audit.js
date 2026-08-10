import { emptyState, h, openDialog, panel, showToast, statusBadge } from "../components.js";
import { resetDemoState } from "../state.js";

const actionNames = {
  plan_created: "方案创建",
  plan_succeeded: "方案执行成功",
  plan_failed: "方案执行失败并回滚",
  demo_alarm_triggered: "演示报警触发",
  alarm_acknowledged: "报警已确认",
  alarm_diagnosing: "开始诊断",
  alarm_diagnosed: "诊断完成",
  alarm_remediation_planned: "处置方案生成",
  alarm_resolved: "恢复验证通过",
  demo_state_reset: "演示数据重置",
};

function auditTimeline(items) {
  if (!items.length) return emptyState("暂无审计记录", "创建方案、触发报警或执行变更后，记录将按时间显示在这里。");
  return h("ol", { className: "audit-timeline" }, items.map((entry) => h("li", {}, [
    h("span", { className: "timeline-mark", "aria-hidden": "true" }),
    h("details", { className: "audit-entry" }, [
      h("summary", {}, [
        h("div", { className: "audit-entry-head" }, [
          h("strong", { text: actionNames[entry.action] ?? entry.action }),
          statusBadge(entry.entity_type, entry.action.includes("failed") ? "danger" : entry.action.includes("resolved") || entry.action.includes("succeeded") ? "ok" : "neutral"),
        ]),
        h("p", { text: `${entry.entity_id} · 操作人 ${entry.actor}` }),
        h("time", { datetime: entry.at, text: new Date(entry.at).toLocaleString("zh-CN") }),
      ]),
      h("div", { className: "audit-entry-details" }, [
        h("dl", {}, [
          h("div", {}, [h("dt", { text: "记录编号" }), h("dd", { text: entry.id })]),
          h("div", {}, [h("dt", { text: "对象类型" }), h("dd", { text: entry.entity_type })]),
          h("div", {}, [h("dt", { text: "对象编号" }), h("dd", { text: entry.entity_id })]),
          h("div", {}, [h("dt", { text: "动作代码" }), h("dd", { text: entry.action })]),
          h("div", {}, [h("dt", { text: "操作人" }), h("dd", { text: entry.actor })]),
          h("div", {}, [h("dt", { text: "时间" }), h("dd", { text: new Date(entry.at).toLocaleString("zh-CN") })]),
        ]),
        h("div", { className: "audit-evidence" }, [
          h("span", { text: "详细证据" }),
          h("pre", {}, [h("code", { text: JSON.stringify(entry.details ?? {}, null, 2) })]),
        ]),
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
      h("button", { type: "button", className: "primary-button", text: "确认重置演示数据", onClick: async (event) => {
        event.currentTarget.disabled = true;
        try { await resetDemoState(); close(); showToast("演示数据已恢复为标准种子"); }
        catch (error) { event.currentTarget.disabled = false; showToast(`${error.code ?? "RESET_FAILED"} · ${error.message}`, "danger"); }
      } }),
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
  container.replaceChildren(intro, panel("审计时间线", auditTimeline(items), { kicker: "不可变追溯" }));
}

import {
  emptyState,
  formatPower,
  h,
  openDialog,
  showToast,
  statusBadge,
} from "../components.js";
import { confirmPlan, selectPlanCandidate } from "../state.js";

const strategyLabels = {
  balanced_optimal: "综合最优",
  consolidated: "集中部署",
  load_balanced: "负载均衡",
};

const metricLabels = {
  preferred: "优选机柜",
  business: "业务邻近",
  fragmentation: "空间连续性",
  link: "链路邻近",
  capacity: "容量水位",
  growth: "扩容空间",
  activation: "新柜启用",
  source_imbalance: "电源均衡",
  migration: "迁移代价",
};

const actionLabels = {
  place_device: "上架设备",
  move_device: "迁移设备",
  remove_device: "取出设备",
  set_dividers: "调整层间隔板",
  set_service_health: "恢复服务",
  clear_demo_condition: "清除演示故障条件",
};

function intervalText(startU, size) {
  const start = Number(startU);
  const end = start + Math.max(1, Number(size) || 1) - 1;
  return Number.isFinite(start) ? `U${start}–U${end}` : "U 位待定";
}

function actionText(action) {
  if (action.type === "place_device") {
    return `${actionLabels[action.type]} ${action.device?.id ?? "设备"} → ${action.rack_id} / ${action.layer_id} / ${intervalText(action.start_u, action.device?.u_size)}`;
  }
  if (action.type === "move_device") {
    return `${actionLabels[action.type]} ${action.device_id} → ${action.rack_id} / ${action.layer_id} / ${intervalText(action.start_u, action.u_size)}`;
  }
  if (action.type === "remove_device") {
    return `${actionLabels[action.type]} ${action.device_id} ← ${action.rack_id}`;
  }
  if (action.type === "set_dividers") return `${actionLabels[action.type]} ${action.rack_id} → ${(action.dividers_u ?? []).join(" / ")}U`;
  if (action.type === "set_service_health") return `${actionLabels[action.type]} ${action.service} → ${action.status}`;
  return actionLabels[action.type] ?? action.type;
}

function issueList(title, items, tone) {
  if (!items?.length) return null;
  return h("section", { className: `issue-list issue-${tone}` }, [
    h("h4", { text: `${title} · ${items.length}` }),
    ...items.map((item) => h("div", { className: "issue-row" }, [
      statusBadge(item.code, tone === "blocker" ? "danger" : "warning"),
      h("span", { text: item.message }),
    ])),
  ]);
}

function scoreValue(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
}

function scoreBreakdown(candidate) {
  const entries = Object.entries(candidate.score_breakdown ?? {});
  if (!entries.length) return null;
  return h("details", { className: "score-breakdown" }, [
    h("summary", { text: "查看评分分解与权重" }),
    h("div", { className: "score-table" }, [
      h("div", { className: "score-row score-head" }, ["指标", "原值", "权重", "贡献"].map((text) => h("span", { text }))),
      ...entries.map(([metric, item]) => h("div", { className: "score-row" }, [
        h("strong", { text: metricLabels[metric] ?? metric }),
        h("span", { text: scoreValue(item.raw) }),
        h("span", { text: scoreValue(item.weight ?? candidate.weights?.[metric]) }),
        h("span", { text: scoreValue(item.contribution) }),
      ])),
    ]),
  ]);
}

function candidateCard(candidate, selected, ruleRank, onSelect) {
  const placement = candidate.actions?.find((action) => action.type === "place_device");
  const ratios = candidate.evidence?.projected_ratios ?? {};
  const chips = [
    ["功率", ratios.power],
    ["U 位", ratios.u],
    ["重量", ratios.weight],
    ["端口", ratios.ports],
  ];
  return h("article", {
    className: `candidate-card ${selected ? "is-selected" : ""} ${onSelect ? "is-selectable" : ""}`,
    onClick: onSelect ? () => onSelect(candidate.id) : undefined,
  }, [
    h("div", { className: "candidate-head" }, [
      h("div", {}, [
        h("strong", { text: `${candidate.rack_id} / ${candidate.layer_id}` }),
        h("span", { text: placement ? intervalText(placement.start_u, placement.device?.u_size) : candidate.id }),
      ]),
      statusBadge(candidate.risk === "safe" ? "可执行" : "有风险", candidate.risk === "safe" ? "ok" : "warning"),
    ]),
    h("div", { className: "candidate-ranks" }, [
      h("span", { text: `规则排序 #${ruleRank}` }),
      h("span", { text: selected ? "Agent 最终选择" : "Agent 未选择" }),
    ]),
    h("div", { className: "candidate-scores" }, [
      h("span", { text: `基线分 ${scoreValue(candidate.baseline_score ?? candidate.score)}` }),
      h("span", { text: selected ? `Agent 分 ${scoreValue(candidate.score)}` : `当前分 ${scoreValue(candidate.score)}` }),
    ]),
    h("div", { className: "candidate-metrics" }, chips.map(([label, ratio]) => h("span", { className: "metric-chip", text: `${label} ${Number.isFinite(Number(ratio)) ? `${Math.round(Number(ratio) * 100)}%` : "—"}` }))),
    h("p", { text: (candidate.reasons ?? []).join(" · ") || `${candidate.actions?.length ?? 0} 项动作` }),
    scoreBreakdown(candidate),
  ]);
}

function capacityComparison(plan) {
  const rackIds = [...new Set((plan.actions ?? []).map((action) => action.rack_id).filter(Boolean))];
  if (!rackIds.length) return null;
  return h("div", { className: "comparison-table" }, [
    h("div", { className: "comparison-row comparison-head" }, ["对象", "执行前", "执行后"].map((text) => h("span", { text }))),
    ...rackIds.map((rackId) => {
      const before = plan.validation?.before?.[rackId];
      const after = plan.validation?.after?.[rackId];
      return h("div", { className: "comparison-row" }, [
        h("strong", { text: rackId }),
        h("span", { text: before ? `${formatPower(before.rated_power_used_w)} · ${before.used_u}U · ${before.used_ports}口` : "—" }),
        h("span", { text: after ? `${formatPower(after.rated_power_used_w)} · ${after.used_u}U · ${after.used_ports}口` : "—" }),
      ]);
    }),
  ]);
}

function agentIntervention(plan) {
  const intervention = plan.agent_intervention;
  if (!intervention) return null;
  const accepted = intervention.accepted_alternatives ?? [];
  const rejected = intervention.rejected_alternatives ?? [];
  const multipliers = Object.entries(intervention.weight_multipliers ?? {});
  return h("section", { className: "agent-intervention" }, [
    h("div", { className: "decision-comparison" }, [
      h("div", {}, [h("span", { text: "规则基线" }), h("strong", { text: scoreValue(plan.baseline_score) })]),
      h("div", {}, [h("span", { text: "Agent 复核" }), h("strong", { text: scoreValue(plan.agent_score) })]),
      h("div", {}, [h("span", { text: "最终候选" }), h("strong", { text: intervention.final_candidate_id ?? plan.selected_candidate_id ?? "—" })]),
    ]),
    h("p", { text: `Agent 状态：${intervention.status ?? plan.agent_status ?? "未知"}${intervention.model ? ` · ${intervention.model}` : ""}` }),
    intervention.reason ? h("p", { text: `干预理由：${intervention.reason}` }) : null,
    multipliers.length ? h("p", { text: `权重调整：${multipliers.map(([key, value]) => `${metricLabels[key] ?? key} ×${value}`).join("，")}` }) : h("p", { text: "权重未调整，按所选策略执行规则排序。" }),
    accepted.length ? h("p", { text: `已接受替代：${accepted.map((item) => `${item.id} (${scoreValue(item.score)})`).join("，")}` }) : null,
    rejected.length ? h("p", { text: `已拒绝越界方案：${rejected.map((item) => `${item.id ?? "未知"} / ${item.reason_code}`).join("，")}` }) : null,
  ]);
}

function migrationImpact(impact) {
  if (!impact) return null;
  return h("section", { className: "migration-impact" }, [
    h("h4", { text: "迁移影响与回滚边界" }),
    h("p", { text: `影响设备：${(impact.devices ?? []).join("、") || "无"} · 业务：${(impact.businesses ?? []).join("、") || "未标记"}` }),
    h("p", { text: `维护窗口：${impact.maintenance_window ?? "未配置，禁止迁移"}` }),
    h("div", { className: "impact-columns" }, [
      h("div", {}, [h("strong", { text: "执行步骤" }), h("ol", {}, (impact.steps ?? []).map((step) => h("li", { text: step })))]),
      h("div", {}, [h("strong", { text: "回滚动作" }), h("ol", {}, (impact.rollback_actions ?? []).map((action) => h("li", { text: actionText(action) })))]),
    ]),
  ]);
}

function solverEvidence(solver) {
  if (!solver) return null;
  const engine = solver.engine === "cp_sat" ? "CP-SAT 求解器" : "Beam Search（束搜索）";
  const tone = solver.engine === "cp_sat" && ["optimal", "feasible"].includes(solver.status)
    ? "ok"
    : solver.fallback_reason
      ? "warning"
      : "neutral";
  const validationRejectedCount = Math.max(0, Number(solver.validation_rejected_count) || 0);
  const validationRejectionCodes = (solver.validation_rejection_summary ?? [])
    .map((item) => item?.code)
    .filter(Boolean)
    .slice(0, 4);
  const notes = [];
  if (solver.fallback_reason) {
    notes.push(h("p", { text: `求解器已安全回退：${solver.fallback_reason}` }));
  }
  if (validationRejectedCount > 0) {
    notes.push(h("p", {
      text: `已自动移除 ${validationRejectedCount} 个未通过确定性规则复核的求解器候选${validationRejectionCodes.length ? `：${validationRejectionCodes.join("、")}` : ""}。`,
    }));
  }
  if (notes.length === 0) {
    notes.push(h("p", { text: "所有候选均已通过确定性风险规则复核。" }));
  }
  return h("section", { className: "solver-evidence" }, [
    h("div", { className: "candidate-ranks" }, [
      statusBadge(`${engine} · ${solver.status}`, tone),
      h("span", { text: `${Number(solver.duration_ms) || 0}ms · ${Number(solver.candidate_count) || 0} 个候选` }),
    ]),
    ...notes,
  ]);
}

export function openPlanConfirmation(plan, onComplete) {
  const isRemoval = plan.kind === "removal";
  const body = h("div", { className: "confirmation-content" }, [
    h("p", { className: "section-kicker", text: "最终确认" }),
    h("h2", { text: isRemoval ? "最终确认：模拟执行服务器取出" : "最终确认：模拟执行变更" }),
    h("p", {
      className: "confirmation-lead",
      text: isRemoval
        ? "这是唯一一次确认。执行前将使用当前快照再次校验设备可移动性、维护窗口、业务副本和机柜归属。"
        : "这是唯一一次确认。执行前将使用当前快照再次校验功率、连续 U 位、重量、端口及迁移窗口。",
    }),
    h("div", { className: "confirmation-risk" }, [
      statusBadge(strategyLabels[plan.strategy_id] ?? plan.strategy_id ?? "规则策略", "neutral"),
      statusBadge(`快照 v${plan.snapshot_version ?? "—"}`, "neutral"),
      statusBadge(plan.agent_intervention?.status ?? plan.agent_status ?? "Agent 未介入", plan.agent_status === "healthy" ? "ok" : "warning"),
    ]),
    h("ol", { className: "action-list" }, (plan.actions ?? []).map((action) => h("li", { text: actionText(action) }))),
    capacityComparison(plan),
    issueList("风险提醒", plan.validation?.warnings, "warning"),
    migrationImpact(plan.migration_impact),
    h("p", {
      className: "immutable-note",
      text: isRemoval
        ? "取出会释放 U 位、额定功率、承重和端口，并同步解除已知 PDU 与交换机连接；审计记录不会删除。"
        : "设备尺寸、额定功率与机柜设计容量为不可修改事实；Agent 的建议无法越过硬约束。",
    }),
    h("div", { className: "confirmation-actions" }, [
      h("button", { type: "button", className: "primary-button", text: "确认并模拟执行", onClick: async (event) => {
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = "正在执行…";
        try {
          const result = await confirmPlan(plan.id);
          close();
          showToast(result.plan.status === "succeeded" ? "执行完成，验证已通过" : "执行失败，状态已回滚", result.plan.status === "succeeded" ? "ok" : "danger");
          onComplete?.(result);
        } catch (error) {
          event.currentTarget.disabled = false;
          event.currentTarget.textContent = "确认并模拟执行";
          showToast(`${error.code ?? "EXECUTION_FAILED"} · ${error.message}`, "danger");
        }
      } }),
    ]),
  ]);
  const close = openDialog(body, { label: "最终确认变更方案" });
}

export function renderPlacementPlan(plan, state) {
  if (!plan) return emptyState("还没有待审方案", "选择部署策略并输入设备参数，系统将给出真实 U 位、容量影响和 Agent 复核结果。");
  if (plan.status === "input_required") {
    return h("div", { className: "fallback-card" }, [
      statusBadge("规则降级", "warning"),
      h("strong", { text: "自然语言暂不可用，请使用结构化参数" }),
      h("p", { text: `原因：${plan.error_code}。确定性规则引擎仍可完成容量判断和位置推荐。` }),
    ]);
  }
  const selected = plan.selected_candidate_id;
  const isRemoval = plan.kind === "removal";
  const removalAction = isRemoval ? plan.actions?.find((action) => action.type === "remove_device") : null;
  return h("div", { className: "plan-result" }, [
    h("div", { className: "plan-status-row" }, [
      h("div", {}, [
        h("p", { className: "section-kicker", text: `${plan.id} · 快照 ${plan.snapshot_version ?? "—"}` }),
        h("h3", { text: isRemoval ? "服务器取出方案已完成风险复核" : `${strategyLabels[plan.strategy_id] ?? plan.strategy_id}方案已完成硬约束复核` }),
      ]),
      statusBadge(plan.status, plan.validation?.allowed ? "ok" : "danger"),
    ]),
    isRemoval ? null : solverEvidence(plan.solver),
    isRemoval ? h("section", { className: "removal-summary" }, [
      h("p", { className: "section-kicker", text: "取出 / 验证 / 审计" }),
      h("strong", { text: removalAction?.device?.hostname || removalAction?.device_id || "待取出设备" }),
      h("span", { text: `${removalAction?.device_id ?? "—"} · ${removalAction?.rack_id ?? "未知机柜"}` }),
      h("p", { text: `业务：${removalAction?.device?.business_id ?? "未标记"} · 副本组：${removalAction?.device?.replica_group ?? "未核实"} · 维护窗口：${removalAction?.device?.maintenance_window ?? "未配置"}` }),
    ]) : (plan.original_candidates ?? []).length > 0 ? h("div", { className: "candidate-grid" }, plan.original_candidates.slice(0, 4).map((candidate, index) => candidateCard(
      candidate,
      candidate.id === selected,
      index + 1,
      candidate.id === selected
        ? null
        : async (candidateId) => {
          try {
            await selectPlanCandidate(plan.id, candidateId);
          } catch (error) {
            const expired = ["PLAN_NOT_FOUND", "PLAN_STALE"].includes(error.code);
            showToast(expired ? "当前方案已失效，请重新生成推荐方案" : `${error.code ?? "SELECT_FAILED"} · ${error.message}`, expired ? "warning" : "danger");
          }
        },
    ))) : h("div", { className: "candidate-grid empty" }, [
      h("p", { className: "empty-candidates", text: "未生成可执行候选。请查看下方“硬阻断”说明，修改设备参数或编号后重试。" }),
    ]),
    isRemoval ? null : agentIntervention(plan),
    h("section", { className: "plan-section" }, [
      h("h4", { text: "拟执行动作与精确 U 位" }),
      h("ol", { className: "action-list" }, (plan.actions ?? []).map((action) => h("li", { text: actionText(action) }))),
    ]),
    capacityComparison(plan),
    issueList("硬阻断", plan.validation?.blockers, "blocker"),
    issueList("风险提醒", plan.validation?.warnings, "warning"),
    migrationImpact(plan.migration_impact),
    plan.status === "awaiting_confirmation" && plan.validation?.allowed && state.session.role === "admin"
      ? h("button", { type: "button", className: "primary-button", text: "进入最终确认", onClick: () => openPlanConfirmation(plan) })
      : null,
    state.session.role !== "admin" && plan.status === "awaiting_confirmation"
      ? h("p", { className: "readonly-note", text: "当前为只读账号，只有管理员可以确认执行。" })
      : null,
    state.lastExecution ? h("div", { className: `execution-result ${state.lastExecution.ok ? "is-ok" : "is-failed"}` }, [
      h("strong", { text: state.lastExecution.ok ? (isRemoval ? "取出并验证成功" : "执行并验证成功") : "执行失败，回滚完成" }),
      h("p", { text: `${state.lastExecution.code} · 阶段：${state.lastExecution.stages.join(" → ")}` }),
    ]) : null,
  ]);
}

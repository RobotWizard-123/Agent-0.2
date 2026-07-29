import { useState, type FormEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { currentPlanAtom, lastExecutionAtom, createPlanAction, confirmPlanAction, selectPlanCandidateAction } from "../atoms/plans";
import { racksAtom, alarmsAtom, configAtom } from "../atoms/room";
import { sessionAtom } from "../atoms/auth";
import { placementSettingsAtom, updatePlacementDefaultAction } from "../atoms/settings";
import { showToastAction, openDialogAction, closeDialogAction } from "../atoms/ui";
import { Panel, Button, SourceBadge, StatusBadge, EmptyState } from "../components/ui";
import { formatPower, scoreValue, intervalText } from "../utils/format";
import type { Plan, PlanCandidate, PlanAction as PlanActionType } from "../types/domain";

const strategies = [
  { id: "balanced_optimal", name: "综合最优", detail: "兼顾业务邻近、空间连续性与容量水位" },
  { id: "consolidated", name: "集中部署", detail: "优先复用已启用机柜，减少新柜启用" },
  { id: "load_balanced", name: "负载均衡", detail: "优先平衡机柜容量与上游电源负载" },
] as const;

const strategyLabels: Record<string, string> = {
  balanced_optimal: "综合最优",
  consolidated: "集中部署",
  load_balanced: "负载均衡",
};

const metricLabels: Record<string, string> = {
  preferred: "优选机柜", business: "业务邻近", fragmentation: "空间连续性",
  link: "链路邻近", capacity: "容量水位", growth: "扩容空间",
  activation: "新柜启用", source_imbalance: "电源均衡", migration: "迁移代价",
};

const actionLabels: Record<string, string> = {
  place_device: "上架设备", move_device: "迁移设备", remove_device: "取出设备",
  set_dividers: "调整层间隔板", set_service_health: "恢复服务", clear_demo_condition: "清除演示故障条件",
};

function actionText(action: PlanActionType): string {
  if (action.type === "place_device") return `${actionLabels[action.type]} ${action.device?.id ?? "设备"} → ${action.rack_id} / ${action.layer_id} / ${intervalText(action.start_u ?? 0, action.device?.u_size ?? 1)}`;
  if (action.type === "move_device") return `${actionLabels[action.type]} ${action.device_id} → ${action.rack_id} / ${action.layer_id} / ${intervalText(action.start_u ?? 0, 1)}`;
  if (action.type === "remove_device") return `${actionLabels[action.type]} ${action.device_id} ← ${action.rack_id}`;
  if (action.type === "set_dividers") return `${actionLabels[action.type]} ${action.rack_id} → ${(action.dividers_u ?? []).join(" / ")}U`;
  if (action.type === "set_service_health") return `${actionLabels[action.type]} ${action.service} → ${action.status}`;
  return actionLabels[action.type] ?? action.type;
}

function CandidateCard({ candidate, selected, ruleRank, onSelect }: {
  candidate: PlanCandidate;
  selected: boolean;
  ruleRank: number;
  onSelect?: (id: string) => Promise<void>;
}) {
  const placement = candidate.actions?.find((a) => a.type === "place_device");
  const ratios = candidate.evidence?.projected_ratios ?? {};
  const chips: Array<[string, number | undefined]> = [["功率", ratios.power], ["U 位", ratios.u], ["重量", ratios.weight], ["端口", ratios.ports]];
  const entries = Object.entries(candidate.score_breakdown ?? {});
  return (
    <article
      className={`candidate-card ${selected ? "is-selected" : ""} ${onSelect ? "is-clickable" : ""}`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      title={onSelect ? "点击切换为该候选" : undefined}
      onClick={onSelect && !selected ? () => onSelect(candidate.id) : undefined}
    >
      <div className="candidate-head">
        <div>
          <strong>{`${candidate.rack_id} / ${candidate.layer_id}`}</strong>
          <span>{placement ? intervalText(placement.start_u ?? 0, placement.device?.u_size ?? 1) : candidate.id}</span>
        </div>
        <StatusBadge label={candidate.risk === "safe" ? "可执行" : "有风险"} tone={candidate.risk === "safe" ? "ok" : "warning"} />
      </div>
      <div className="candidate-ranks">
        <span>{`规则排序 #${ruleRank}`}</span>
        <span>{selected ? "Agent 最终选择" : onSelect ? "点击设为最终候选" : "Agent 未选择"}</span>
      </div>
      <div className="candidate-scores">
        <span>{`基线分 ${scoreValue(candidate.baseline_score ?? candidate.score)}`}</span>
        <span>{selected ? `Agent 分 ${scoreValue(candidate.score)}` : `当前分 ${scoreValue(candidate.score)}`}</span>
      </div>
      <div className="candidate-metrics">
        {chips.map(([label, ratio]) => (
          <span key={label} className="metric-chip">{`${label} ${Number.isFinite(Number(ratio)) ? `${Math.round(Number(ratio) * 100)}%` : "—"}`}</span>
        ))}
      </div>
      <p>{(candidate.reasons ?? []).join(" · ") || `${candidate.actions?.length ?? 0} 项动作`}</p>
      {entries.length > 0 && (
        <details className="score-breakdown">
          <summary>查看评分分解与权重</summary>
          <div className="score-table">
            <div className="score-row score-head">
              <span>指标</span><span>原值</span><span>权重</span><span>贡献</span>
            </div>
            {entries.map(([metric, item]) => (
              <div key={metric} className="score-row">
                <strong>{metricLabels[metric] ?? metric}</strong>
                <span>{scoreValue(item.raw)}</span>
                <span>{scoreValue(item.weight ?? candidate.weights?.[metric])}</span>
                <span>{scoreValue(item.contribution)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function PlacementPlan({ plan, session, lastExecution, onConfirm }: {
  plan: Plan;
  session: { role: string | null };
  lastExecution: Plan["execution"] | null;
  onConfirm: () => void;
}) {
  if (plan.status === "input_required") {
    return (
      <div className="fallback-card">
        <StatusBadge label="规则降级" tone="warning" />
        <strong>自然语言暂不可用，请使用结构化参数</strong>
        <p>{`原因：${plan.error_code}。确定性规则引擎仍可完成容量判断和位置推荐。`}</p>
      </div>
    );
  }

  const selected = plan.selected_candidate_id;
  const isRemoval = plan.kind === "removal";
  const canSelect = session.role === "admin"
    && !["locked", "executing", "succeeded", "failed"].includes(plan.status)
    && (plan.original_candidates ?? []).length > 1;

  return (
    <div className="plan-result">
      <div className="plan-status-row">
        <div>
          <p className="section-kicker">{`${plan.id} · SNAPSHOT ${plan.snapshot_version ?? "—"}`}</p>
          <h3>{isRemoval ? "服务器取出方案已完成风险复核" : `${strategyLabels[plan.strategy_id ?? ""] ?? plan.strategy_id}方案已完成硬约束复核`}</h3>
        </div>
        <StatusBadge label={plan.status} tone={plan.validation?.allowed ? "ok" : "danger"} />
      </div>

      {!isRemoval && (
        <div className="candidate-grid">
          {(plan.original_candidates ?? []).slice(0, 4).map((candidate, index) => (
            <CandidateCard key={candidate.id} candidate={candidate} selected={candidate.id === selected} ruleRank={index + 1} />
          ))}
        </div>
      )}

      <section className="plan-section">
        <h4>拟执行动作与精确 U 位</h4>
        <ol className="action-list">
          {(plan.actions ?? []).map((action, i) => <li key={i}>{actionText(action)}</li>)}
        </ol>
      </section>

      {plan.status === "awaiting_confirmation" && plan.validation?.allowed && session.role === "admin" && (
        <Button variant="primary" onClick={onConfirm}>进入最终确认</Button>
      )}

      {session.role !== "admin" && plan.status === "awaiting_confirmation" && (
        <p className="readonly-note">当前为只读账号，只有管理员可以确认执行。</p>
      )}

      {lastExecution && (
        <div className={`execution-result ${lastExecution.ok ? "is-ok" : "is-failed"}`}>
          <strong>{lastExecution.ok ? (isRemoval ? "取出并验证成功" : "执行并验证成功") : "执行失败，回滚完成"}</strong>
          <p>{`${lastExecution.code} · 阶段：${lastExecution.stages.join(" → ")}`}</p>
        </div>
      )}
    </div>
  );
}

export function AgentConsoleView() {
  const plan = useAtomValue(currentPlanAtom);
  const lastExecution = useAtomValue(lastExecutionAtom);
  const racks = useAtomValue(racksAtom);
  const alarms = useAtomValue(alarmsAtom);
  const config = useAtomValue(configAtom);
  const session = useAtomValue(sessionAtom);
  const placementSettings = useAtomValue(placementSettingsAtom);
  const createPlan = useSetAtom(createPlanAction);
  const confirmPlan = useSetAtom(confirmPlanAction);
  const selectCandidate = useSetAtom(selectPlanCandidateAction);
  const updateDefault = useSetAtom(updatePlacementDefaultAction);
  const showToast = useSetAtom(showToastAction);
  const openDialog = useSetAtom(openDialogAction);
  const closeDialog = useSetAtom(closeDialogAction);

  const [strategyId, setStrategyId] = useState(plan?.strategy_id ?? placementSettings?.default_strategy_id ?? "balanced_optimal");
  const [nlText, setNlText] = useState("");
  const [deviceId, setDeviceId] = useState("SRV-LEADER-DEMO");
  const [count, setCount] = useState("1");
  const [uSize, setUSize] = useState("4");
  const [ratedPower, setRatedPower] = useState("1800");
  const [weight, setWeight] = useState("42");
  const [networkPorts, setNetworkPorts] = useState("2");
  const [preferredRack, setPreferredRack] = useState("");
  const [failAt, setFailAt] = useState("");

  const isAdmin = session.role === "admin";
  const modelOffline = alarms.some((a) => a.status !== "resolved" && a.scenario === "model_offline");
  const serverRacks = racks.filter((r) => r.role === "server");

  const handleStructured = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createPlan({
        kind: "placement",
        strategy_id: strategyId,
        fail_at: failAt || null,
        device: {
          id: deviceId,
          count: Number(count),
          u_size: Number(uSize),
          rated_power_w: Number(ratedPower),
          real_power_w: null,
          weight_kg: Number(weight),
          network_ports: Number(networkPorts),
          preferred_rack_ids: preferredRack ? [preferredRack] : [],
        },
      });
      showToast({ message: "方案已生成，等待最终确认" });
    } catch (error) {
      const er = error as { code?: string; message?: string };
      showToast({ message: `${er.code ?? "PLAN_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  const handleNatural = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createPlan({ kind: "natural_language", text: nlText, strategy_id: strategyId });
      showToast({ message: "Agent 已完成解析和硬约束复核" });
    } catch (error) {
      const er = error as { code?: string; message?: string };
      showToast({ message: `${er.code ?? "AGENT_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  const handleSetDefault = async () => {
    try {
      await updateDefault(strategyId as "balanced_optimal" | "consolidated" | "load_balanced");
      showToast({ message: "默认部署策略已更新" });
    } catch (error) {
      const er = error as { code?: string; message?: string };
      showToast({ message: `${er.code ?? "SETTING_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  const handleConfirm = () => {
    if (!plan) return;
    openDialog(
      <div className="confirmation-content">
        <p className="section-kicker">ONE FINAL CONFIRMATION</p>
        <h2>{plan.kind === "removal" ? "最终确认：模拟执行服务器取出" : "最终确认：模拟执行变更"}</h2>
        <p className="confirmation-lead">
          {plan.kind === "removal"
            ? "这是唯一一次确认。执行前将使用当前快照再次校验设备可移动性、维护窗口、业务副本和机柜归属。"
            : "这是唯一一次确认。执行前将使用当前快照再次校验功率、连续 U 位、重量、端口及迁移窗口。"}
        </p>
        <div className="confirmation-risk">
          <StatusBadge label={strategyLabels[plan.strategy_id ?? ""] ?? plan.strategy_id ?? "规则策略"} tone="neutral" />
          <StatusBadge label={`快照 v${plan.snapshot_version ?? "—"}`} tone="neutral" />
          <StatusBadge label={plan.agent_intervention?.status ?? plan.agent_status ?? "Agent 未介入"} tone={plan.agent_status === "healthy" ? "ok" : "warning"} />
        </div>
        <ol className="action-list">
          {(plan.actions ?? []).map((action, i) => <li key={i}>{actionText(action)}</li>)}
        </ol>
        <p className="immutable-note">
          {plan.kind === "removal"
            ? "取出会释放 U 位、额定功率、承重和端口，并同步解除已知 PDU 与交换机连接；审计记录不会删除。"
            : "设备尺寸、额定功率与机柜设计容量为不可修改事实；Agent 的建议无法越过硬约束。"}
        </p>
        <div className="confirmation-actions">
          <Button variant="primary" onClick={async () => {
            try {
              const result = await confirmPlan(plan.id);
              closeDialog();
              showToast({ message: result.plan.status === "succeeded" ? "执行完成，验证已通过" : "执行失败，状态已回滚", tone: result.plan.status === "succeeded" ? "ok" : "danger" });
            } catch (error) {
              const er = error as { code?: string; message?: string };
              showToast({ message: `${er.code ?? "EXECUTION_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
            }
          }}>确认并模拟执行</Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="view-intro">
        <div>
          <p className="section-kicker">PLAN → VALIDATE → AGENT REVIEW → CONFIRM → EXECUTE → VERIFY</p>
          <h2>约束优先的上架 Agent</h2>
          <p>管理者可自由选择三种部署策略；Agent 可重排安全候选，但不能改写设备功率、尺寸、真实 U 位或机柜设计容量。</p>
        </div>
        <div className="intro-badges">
          <SourceBadge source="rule" />
          <StatusBadge
            label={modelOffline || !config?.agent_configured ? "规则引擎接管" : "模型可用"}
            tone={modelOffline || !config?.agent_configured ? "warning" : "ok"}
          />
        </div>
      </section>

      <section className="agent-grid">
        <Panel title="描述上架需求" kicker="REQUEST">
          <div className="agent-input-stack">
            {modelOffline ? (
              <div className="degraded-banner">模型服务离线：自然语言入口已降级，结构化表单和全部硬约束仍然可用。</div>
            ) : (
              <form className="natural-form" onSubmit={handleNatural}>
                <div className="strategy-controls compact">
                  <label className="form-field strategy-option">
                    Agent 解析策略
                    <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
                      {strategies.map((s) => <option key={s.id} value={s.id}>{`${s.name} · ${s.detail}`}</option>)}
                    </select>
                  </label>
                </div>
                <label className="form-field">
                  用自然语言描述任务
                  <textarea
                    rows={3}
                    required
                    placeholder="例如：将一台 10U、3500W、120kg、4 网口的 GPU 服务器上架，优先 CAB-10。"
                    value={nlText}
                    onChange={(e) => setNlText(e.target.value)}
                  />
                </label>
                <Button variant="secondary" type="submit" disabled={!isAdmin}>让 Agent 解析</Button>
              </form>
            )}
            <div className="or-divider">结构化参数 / 可审计</div>
            <form className="agent-form" onSubmit={handleStructured}>
              <div className="strategy-controls">
                <label className="form-field strategy-option">
                  本次部署策略
                  <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
                    {strategies.map((s) => <option key={s.id} value={s.id}>{`${s.name} · ${s.detail}`}</option>)}
                  </select>
                </label>
                <div className="strategy-default">
                  <span>{`系统默认：${strategies.find((s) => s.id === (placementSettings?.default_strategy_id ?? "balanced_optimal"))?.name}`}</span>
                  <Button variant="secondary" disabled={!isAdmin} onClick={handleSetDefault}>设为系统默认</Button>
                </div>
                {!isAdmin && <p className="readonly-note">只读账号可查看策略，不能修改默认值或生成方案。</p>}
              </div>
              <div className="form-grid">
                <label className="form-field">设备编号<input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required /></label>
                <label className="form-field">数量<input type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} required /></label>
                <label className="form-field">设备高度（U）<input type="number" min={1} max={10} value={uSize} onChange={(e) => setUSize(e.target.value)} required /></label>
                <label className="form-field">额定功率（W）<input type="number" min={1} value={ratedPower} onChange={(e) => setRatedPower(e.target.value)} required /></label>
                <label className="form-field">重量（kg）<input type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} required /></label>
                <label className="form-field">网络端口<input type="number" min={0} value={networkPorts} onChange={(e) => setNetworkPorts(e.target.value)} required /></label>
                <label className="form-field">优选机柜
                  <select value={preferredRack} onChange={(e) => setPreferredRack(e.target.value)}>
                    <option value="">自动选择</option>
                    {serverRacks.map((r) => <option key={r.id} value={r.id}>{`${r.id} · ${formatPower(r.design_power_w)}`}</option>)}
                  </select>
                </label>
                <label className="form-field">执行演示
                  <select value={failAt} onChange={(e) => setFailAt(e.target.value)}>
                    <option value="">正常执行</option>
                    <option value="written">模拟执行中失败并回滚</option>
                  </select>
                </label>
              </div>
              <Button variant="primary" type="submit" disabled={!isAdmin}>生成上架方案</Button>
            </form>
          </div>
        </Panel>

        <Panel title="候选方案与风险" kicker="RULE + AGENT REVIEW">
          {plan ? (
            <PlacementPlan plan={plan} session={session} lastExecution={lastExecution} onConfirm={handleConfirm} />
          ) : (
            <EmptyState title="还没有待审方案" detail="选择部署策略并输入设备参数，系统将给出真实 U 位、容量影响和 Agent 复核结果。" />
          )}
        </Panel>
      </section>
    </>
  );
}

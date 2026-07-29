import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { alarmsAtom } from "../atoms/room";
import { selectedAlarmAtom, diagnosisAtom, triggerDemoAlarmAction, acknowledgeAlarmAction, diagnoseAlarmAction, createRemediationAction, selectAlarmAction } from "../atoms/alarms";
import { currentPlanAtom, lastExecutionAtom, confirmPlanAction } from "../atoms/plans";
import { sessionAtom } from "../atoms/auth";
import { routeAtom, showToastAction, openDialogAction, closeDialogAction } from "../atoms/ui";
import { Panel, Button, SourceBadge, StatusBadge, EmptyState } from "../components/ui";
import { intervalText } from "../utils/format";
import type { Alarm, Diagnosis, Plan } from "../types/domain";

const scenarios: Array<[string, string, string]> = [
  ["power_high", "模拟功率过高", "在 CAB-01 加入 8.2kW 演示负载"],
  ["placement_conflict", "模拟层位冲突", "生成不可共存的放置条件"],
  ["collector_offline", "模拟采集离线", "实时功率降级为设计/未知"],
  ["model_offline", "模拟模型离线", "Agent 降级至结构化规则引擎"],
  ["execution_failure", "模拟执行故障", "演示故障条件、处置和恢复验证"],
];

const statusLabels: Record<string, string> = {
  open: "待处理", acknowledged: "已确认", diagnosing: "诊断中",
  action_pending: "待确认处置", executing: "执行中", resolved: "已恢复",
};

function alarmTone(alarm: Alarm): "ok" | "warning" | "danger" {
  if (alarm.status === "resolved") return "ok";
  return alarm.severity === "critical" ? "danger" : "warning";
}

export function AlarmsView() {
  const alarms = useAtomValue(alarmsAtom);
  const selectedAlarm = useAtomValue(selectedAlarmAtom);
  const diagnosis = useAtomValue(diagnosisAtom);
  const currentPlan = useAtomValue(currentPlanAtom);
  const lastExecution = useAtomValue(lastExecutionAtom);
  const session = useAtomValue(sessionAtom);
  const route = useAtomValue(routeAtom);
  const triggerDemo = useSetAtom(triggerDemoAlarmAction);
  const acknowledge = useSetAtom(acknowledgeAlarmAction);
  const diagnose = useSetAtom(diagnoseAlarmAction);
  const createRemediation = useSetAtom(createRemediationAction);
  const selectAlarm = useSetAtom(selectAlarmAction);
  const confirmPlan = useSetAtom(confirmPlanAction);
  const showToast = useSetAtom(showToastAction);
  const openDialog = useSetAtom(openDialogAction);
  const closeDialog = useSetAtom(closeDialogAction);

  useEffect(() => {
    if (route.id && alarms.some((a) => a.id === route.id)) {
      selectAlarm(route.id);
    }
  }, [route.id, alarms, selectAlarm]);

  const isAdmin = session.role === "admin";

  const handleTrigger = async (scenario: string, label: string) => {
    try {
      await triggerDemo(scenario as "power_high" | "placement_conflict" | "collector_offline" | "model_offline" | "execution_failure");
      showToast({ message: `${label}已触发`, tone: "warning" });
    } catch (error) {
      const er = error as { code?: string; message?: string };
      showToast({ message: `${er.code ?? "SCENARIO_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
    }
  };

  const handleAcknowledge = async (id: string) => {
    try { await acknowledge(id); } catch (error) { showToast({ message: (error as Error).message, tone: "danger" }); }
  };

  const handleDiagnose = async (id: string) => {
    try { await diagnose(id); showToast({ message: "诊断完成" }); } catch (error) { showToast({ message: (error as Error).message, tone: "danger" }); }
  };

  const handleRemediation = async (id: string) => {
    try { await createRemediation(id); showToast({ message: "处置方案已生成，等待最终确认" }); } catch (error) { showToast({ message: (error as Error).message, tone: "danger" }); }
  };

  const handleConfirm = (plan: Plan) => {
    openDialog(
      <div className="confirmation-content">
        <p className="section-kicker">ONE FINAL CONFIRMATION</p>
        <h2>最终确认：模拟执行处置</h2>
        <p className="confirmation-lead">这是唯一一次确认。执行前将使用当前快照再次校验迁移约束。</p>
        <ol className="action-list">
          {plan.actions.map((action, i) => <li key={i}>{action.type === "move_device" ? `迁移 ${action.device_id} → ${action.rack_id} / ${action.layer_id}` : `${action.type} · ${action.service ?? action.condition_id}`}</li>)}
        </ol>
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
          <p className="section-kicker">TRIGGER → DIAGNOSE → REMEDIATE → VERIFY</p>
          <h2>报警诊断与恢复</h2>
          <p>报警不能被直接标记为恢复。只有处置执行后触发条件确实消失，系统才会关闭报警。</p>
        </div>
        <StatusBadge label={isAdmin ? "管理员演示模式" : "只读模式"} tone={isAdmin ? "ok" : "neutral"} />
      </section>

      <Panel title="可交互演示场景" kicker="DEMO TRIGGERS">
        <div className="scenario-grid">
          {scenarios.map(([id, label, detail]) => {
            const active = alarms.some((a) => a.scenario === id && a.status !== "resolved");
            return (
              <button key={id} type="button" className="scenario-button" disabled={!isAdmin || active} onClick={() => handleTrigger(id, label)}>
                <strong>{active ? `${label} · 进行中` : label}</strong>
                <span>{detail}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <section className="alarm-grid">
        <Panel title="报警队列" kicker="ALARMS">
          {alarms.length ? (
            <div className="alarm-list">
              {alarms.map((alarm) => (
                <button
                  key={alarm.id}
                  type="button"
                  className={`alarm-row ${selectedAlarm?.id === alarm.id ? "is-selected" : ""}`}
                  onClick={() => selectAlarm(alarm.id)}
                >
                  <span className={`alarm-severity severity-${alarm.severity}`} />
                  <span>
                    <strong>{alarm.trigger_code}</strong>
                    <small>{`${alarm.object_id} · ${new Date(alarm.opened_at).toLocaleString("zh-CN")}`}</small>
                  </span>
                  <StatusBadge label={statusLabels[alarm.status] ?? alarm.status} tone={alarmTone(alarm)} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无报警" detail="使用上方场景按钮触发一次可恢复、可审计的演示报警。" />
          )}
        </Panel>

        <Panel title="诊断工作区" kicker="EVIDENCE & RECOVERY">
          {!selectedAlarm ? (
            <EmptyState title="选择一条报警" detail="报警详情会展示证据、根因、影响链、处置动作和恢复验证。" />
          ) : (
            <div className="alarm-detail">
              <div className="alarm-detail-head">
                <div>
                  <p className="section-kicker">{selectedAlarm.id}</p>
                  <h2>{selectedAlarm.trigger_code}</h2>
                  <p>{`${selectedAlarm.object_type} / ${selectedAlarm.object_id}`}</p>
                </div>
                <div className="intro-badges">
                  <SourceBadge source={selectedAlarm.source as "design" | "rule" | "demo" | "telemetry" | "unknown"} />
                  <StatusBadge label={statusLabels[selectedAlarm.status] ?? selectedAlarm.status} tone={alarmTone(selectedAlarm)} />
                </div>
              </div>
              <div className="alarm-actions">
                {selectedAlarm.status === "open" && (
                  <Button variant="secondary" disabled={!isAdmin} onClick={() => handleAcknowledge(selectedAlarm.id)}>确认收到报警</Button>
                )}
                {["open", "acknowledged"].includes(selectedAlarm.status) && (
                  <Button variant="primary" disabled={!isAdmin} onClick={() => handleDiagnose(selectedAlarm.id)}>Agent 诊断</Button>
                )}
              </div>
              {diagnosis?.alarm_id === selectedAlarm.id && (
                <section className="diagnosis-block">
                  <div className="diagnosis-head">
                    <div>
                      <p className="section-kicker">{diagnosis.root_cause_code}</p>
                      <h3>{diagnosis.summary}</h3>
                    </div>
                    <StatusBadge label={`置信度 ${Math.round(diagnosis.confidence * 100)}%`} tone="ok" />
                  </div>
                  <h4>影响链</h4>
                  <div className="affected-chain">
                    {diagnosis.affected_chain.map((node, i) => (
                      <div key={i} style={{ display: "contents" }}>
                        <article>
                          <SourceBadge source={node.source} />
                          <strong>{node.label}</strong>
                          <code>{node.id ?? "UNKNOWN"}</code>
                        </article>
                        {i < diagnosis.affected_chain.length - 1 && <span>→</span>}
                      </div>
                    ))}
                  </div>
                  <h4>诊断证据</h4>
                  <pre className="evidence-json">{JSON.stringify(diagnosis.evidence, null, 2)}</pre>
                </section>
              )}
              {selectedAlarm.status === "diagnosing" && diagnosis?.alarm_id === selectedAlarm.id && (
                <Button variant="primary" disabled={!isAdmin} onClick={() => handleRemediation(selectedAlarm.id)}>生成处置方案</Button>
              )}
              {currentPlan && currentPlan.kind === "alarm_remediation" && (
                <section className="remediation-plan">
                  <div className="plan-status-row">
                    <div>
                      <p className="section-kicker">{currentPlan.id}</p>
                      <h3>处置方案已通过硬约束复核</h3>
                    </div>
                    <StatusBadge label={currentPlan.status} tone={currentPlan.status === "succeeded" ? "ok" : "warning"} />
                  </div>
                  <ol className="action-list">
                    {currentPlan.actions.map((action, i) => <li key={i}>{action.type === "move_device" ? `迁移 ${action.device_id} → ${action.rack_id} / ${action.layer_id}` : `${action.type} · ${action.service ?? action.condition_id}`}</li>)}
                  </ol>
                  {currentPlan.status === "awaiting_confirmation" && isAdmin && (
                    <Button variant="primary" onClick={() => handleConfirm(currentPlan)}>进入最终确认</Button>
                  )}
                </section>
              )}
              {selectedAlarm.status === "resolved" && (
                <div className="recovery-card">
                  <StatusBadge label="已恢复" tone="ok" />
                  <strong>恢复验证通过</strong>
                  <p>触发条件已消失，处置动作、最终确认、执行结果和复核记录已写入审计。</p>
                </div>
              )}
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}

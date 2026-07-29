import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { auditAtom, loadAuditAction, resetDemoStateAction } from "../atoms/audit";
import { sessionAtom } from "../atoms/auth";
import { routeAtom, showToastAction, openDialogAction, closeDialogAction } from "../atoms/ui";
import { refreshRoomAction } from "../atoms/room";
import { Panel, Button, StatusBadge, EmptyState } from "../components/ui";
import type { AuditEntry } from "../types/domain";

const actionNames: Record<string, string> = {
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

export function AuditView() {
  const audit = useAtomValue(auditAtom);
  const session = useAtomValue(sessionAtom);
  const route = useAtomValue(routeAtom);
  const loadAudit = useSetAtom(loadAuditAction);
  const resetDemoState = useSetAtom(resetDemoStateAction);
  const refreshRoom = useSetAtom(refreshRoomAction);
  const showToast = useSetAtom(showToastAction);
  const openDialog = useSetAtom(openDialogAction);
  const closeDialog = useSetAtom(closeDialogAction);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  const isAdmin = session.role === "admin";
  const filterId = route.id;
  const items = filterId
    ? audit.filter((e) => e.entity_id === filterId || JSON.stringify(e.details).includes(filterId))
    : audit;

  const handleReset = () => {
    openDialog(
      <div className="confirmation-content">
        <p className="section-kicker">ADMINISTRATIVE CONFIRMATION</p>
        <h2>重置全部演示数据？</h2>
        <p className="confirmation-lead">这会恢复 L5-A2-08 的 22 柜标准种子，清除当前方案、报警和变更记录，再写入一条新的重置审计。</p>
        <div className="confirmation-actions">
          <Button variant="secondary" onClick={closeDialog}>取消</Button>
          <Button variant="primary" onClick={async () => {
            try {
              await resetDemoState();
              await refreshRoom();
              await loadAudit();
              closeDialog();
              showToast({ message: "演示数据已恢复为标准种子" });
            } catch (error) {
              const er = error as { code?: string; message?: string };
              showToast({ message: `${er.code ?? "RESET_FAILED"} · ${er.message ?? "请求失败"}`, tone: "danger" });
            }
          }}>确认重置演示数据</Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="view-intro">
        <div>
          <p className="section-kicker">WHO / WHEN / WHAT / RESULT</p>
          <h2>变更与诊断审计</h2>
          <p>{filterId ? `正在查看与 ${filterId} 相关的记录。` : "每一次方案创建、最终确认、执行、回滚和恢复验证都有可追溯记录。"}</p>
        </div>
        {isAdmin ? (
          <Button variant="secondary" onClick={handleReset}>重置演示数据</Button>
        ) : (
          <StatusBadge label="只读查看" tone="neutral" />
        )}
      </section>

      <Panel title="审计时间线" kicker="IMMUTABLE TRAIL">
        {items.length ? (
          <ol className="audit-timeline">
            {items.map((entry) => (
              <li key={entry.id}>
                <span className="timeline-mark" aria-hidden="true" />
                <details className="audit-entry">
                  <summary>
                    <div className="audit-entry-head">
                      <strong>{actionNames[entry.action] ?? entry.action}</strong>
                      <StatusBadge
                        label={entry.entity_type}
                        tone={entry.action.includes("failed") ? "danger" : entry.action.includes("resolved") || entry.action.includes("succeeded") ? "ok" : "neutral"}
                      />
                    </div>
                    <p>{`${entry.entity_id} · 操作人 ${entry.actor}`}</p>
                    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString("zh-CN")}</time>
                  </summary>
                  <div className="audit-entry-details">
                    <dl>
                      <div><dt>记录编号</dt><dd>{entry.id}</dd></div>
                      <div><dt>对象类型</dt><dd>{entry.entity_type}</dd></div>
                      <div><dt>对象编号</dt><dd>{entry.entity_id}</dd></div>
                      <div><dt>动作代码</dt><dd>{entry.action}</dd></div>
                      <div><dt>操作人</dt><dd>{entry.actor}</dd></div>
                      <div><dt>时间</dt><dd>{new Date(entry.at).toLocaleString("zh-CN")}</dd></div>
                    </dl>
                    <div className="audit-evidence">
                      <span>详细证据</span>
                      <pre><code>{JSON.stringify(entry.details ?? {}, null, 2)}</code></pre>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="暂无审计记录" detail="创建方案、触发报警或执行变更后，记录将按时间显示在这里。" />
        )}
      </Panel>
    </>
  );
}

import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { sessionAtom } from "../atoms/auth";
import { routeAtom, setRouteAction, showToastAction } from "../atoms/ui";
import {
  assistantMessagesAtom, assistantFeedbackAtom, assistantOpenAtom, assistantSendingAtom,
  assistantSyncStatusAtom, assistantModelStatusAtom, assistantStateVersionAtom,
  assistantUnreadAtom, assistantErrorAtom,
  setAssistantOpenAction, sendAssistantMessageAction, acceptProposalAction,
} from "../atoms/assistant";
import type { AssistantMessage, AssistantFeedbackEvent } from "../types/domain";

const feedbackLabels: Record<string, string> = {
  alarm_opened: "新告警", capacity_warning: "容量预警", constraint_blocked: "约束阻断",
  dependency_offline: "依赖异常", plan_succeeded: "方案完成", plan_failed: "方案失败",
};

const entityLabels: Record<string, string> = {
  rack: "机柜", device: "设备", alarm: "告警", plan: "方案", audit: "审计记录", service: "服务",
};

function statusText(status: string): string {
  if (status === "syncing") return "同步中";
  if (status === "interrupted") return "同步中断";
  if (status === "ready") return "全站已同步";
  return "等待同步";
}

function modelText(status: string): string {
  if (status === "available") return "模型在线";
  if (status === "degraded") return "规则降级";
  if (status === "not_configured") return "规则模式";
  return "模型待命";
}

function formatTime(value?: string): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

interface TimelineEntry {
  kind: "feedback" | "message";
  item: AssistantFeedbackEvent | AssistantMessage;
  index: number;
  at?: string;
}

function EvidenceButton({ item, onNavigate }: { item: { type: string; id: string; label?: string }; onNavigate: (ref: { type: string; id: string }) => void }) {
  const label = item.label ?? `${entityLabels[item.type] ?? item.type} ${item.id}`;
  return (
    <button type="button" className="assistant-evidence" aria-label={`查看 ${label}`} onClick={() => onNavigate({ type: item.type, id: item.id })}>
      <span>{entityLabels[item.type] ?? item.type}</span>
      <strong>{item.id}</strong>
      <i aria-hidden="true">↗</i>
    </button>
  );
}

function ProposalCard({ proposal, role, onAccept }: {
  proposal: { id: string; type: string; payload: { device?: { id?: string }; alarm_id?: string }; used: boolean; plan_id?: string };
  role: string | null;
  onAccept: (id: string) => Promise<void>;
}) {
  const used = Boolean(proposal.used || proposal.plan_id);
  const placement = proposal.type === "placement";
  const title = placement ? "上架方案草案" : "告警处置草案";
  const detail = placement
    ? `${proposal.payload?.device?.id ?? "待解析设备"} · 风险约束计算后进入最终确认`
    : `${proposal.payload?.alarm_id ?? "当前告警"} · 生成后仍需最终确认`;
  return (
    <section className="assistant-proposal" aria-label={title}>
      <div className="assistant-proposal-head">
        <span>ACTION BRIDGE</span>
        <strong>{title}</strong>
      </div>
      <p>{detail}</p>
      <button
        type="button"
        className="assistant-proposal-action"
        disabled={used || role !== "admin"}
        onClick={() => onAccept(proposal.id)}
      >
        {used ? `已生成 ${proposal.plan_id ?? "待确认方案"}` : "生成待确认方案"}
      </button>
      {role !== "admin" && <small>当前为只读角色，仅管理员可生成待确认方案。</small>}
    </section>
  );
}

export function AssistantPanel() {
  const session = useAtomValue(sessionAtom);
  const route = useAtomValue(routeAtom);
  const messages = useAtomValue(assistantMessagesAtom);
  const feedback = useAtomValue(assistantFeedbackAtom);
  const open = useAtomValue(assistantOpenAtom);
  const sending = useAtomValue(assistantSendingAtom);
  const syncStatus = useAtomValue(assistantSyncStatusAtom);
  const modelStatus = useAtomValue(assistantModelStatusAtom);
  const stateVersion = useAtomValue(assistantStateVersionAtom);
  const unread = useAtomValue(assistantUnreadAtom);
  const error = useAtomValue(assistantErrorAtom);

  const setOpen = useSetAtom(setAssistantOpenAction);
  const sendMessage = useSetAtom(sendAssistantMessageAction);
  const acceptProposal = useSetAtom(acceptProposalAction);
  const setRoute = useSetAtom(setRouteAction);
  const showToast = useSetAtom(showToastAction);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, feedback, open]);

  if (!session.authenticated) return null;

  const handleNavigate = (ref: { type: string; id: string }) => {
    if (ref.type === "rack") setRoute({ name: "rack", id: ref.id });
    else if (ref.type === "device") setRoute({ name: "topology", id: ref.id });
    else if (ref.type === "alarm") setRoute({ name: "alarms", id: ref.id });
    else if (ref.type === "plan") setRoute({ name: "agent", id: null });
    else setRoute({ name: "audit", id: ref.id });
    setOpen(false);
  };

  const handleAccept = async (proposalId: string) => {
    try {
      const plan = await acceptProposal(proposalId);
      showToast({ message: `已生成 ${plan.id}，等待最终确认` });
    } catch (err) {
      showToast({ message: (err as Error).message ?? "方案生成失败", tone: "danger" });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value || sending) return;
    setDraft("");
    try {
      await sendMessage({ message: value, route: route.name, entityId: route.id });
    } catch (err) {
      setDraft(value);
      showToast({ message: (err as Error).message ?? "AI 助手暂时不可用", tone: "danger" });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const entries: TimelineEntry[] = [
    ...feedback.map((item, i) => ({ kind: "feedback" as const, item, index: i, at: item.occurred_at })),
    ...messages.map((item, i) => ({ kind: "message" as const, item, index: i, at: item.at })),
  ].sort((a, b) => {
    const byTime = String(a.at ?? "").localeCompare(String(b.at ?? ""));
    return byTime || a.index - b.index;
  });

  const syncTone = syncStatus === "interrupted" ? "is-danger" : syncStatus === "ready" ? "is-ready" : "";

  return (
    <>
      <button
        type="button"
        className="assistant-launcher"
        aria-label={open ? "AI 助手已展开" : "打开 AI 助手"}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        style={{ display: open ? "none" : "grid" }}
      >
        <span className="assistant-launcher-mark" aria-hidden="true">AI</span>
        <span>
          <strong>AI 助手</strong>
          <small>{statusText(syncStatus)}</small>
        </span>
        {unread > 0 && <b className="assistant-unread">{unread > 99 ? "99+" : String(unread)}</b>}
      </button>

      <section
        className={`assistant-panel${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label="全站 AI 助手"
        aria-hidden={!open}
      >
        <header className="assistant-header">
          <div className="assistant-title">
            <span className="assistant-channel" aria-hidden="true">AI / SITE BUS</span>
            <div>
              <h2>全站 AI 助手</h2>
              <p>容量 · 链路 · 告警 · 变更</p>
            </div>
          </div>
          <button type="button" className="assistant-close" aria-label="收起 AI 助手" onClick={() => setOpen(false)}>—</button>
          <div className="assistant-bus" aria-label="助手运行状态">
            <span className={syncTone}>{statusText(syncStatus)}</span>
            <span>{`V${stateVersion ?? "—"}`}</span>
            <span>{modelText(modelStatus)}</span>
            <span>{session.role === "admin" ? "管理员" : "只读"}</span>
          </div>
        </header>

        <div className="assistant-scroll" aria-live="polite" ref={scrollRef}>
          {entries.length ? (
            <div className="assistant-timeline">
              {entries.map((entry, i) => {
                if (entry.kind === "feedback") {
                  const event = entry.item as AssistantFeedbackEvent;
                  const label = feedbackLabels[event.type] ?? "站点事件";
                  const clickable = event.entity && event.entity.type !== "service";
                  return (
                    <button
                      key={`fb-${i}`}
                      type="button"
                      className={`assistant-feedback severity-${event.severity ?? "info"}`}
                      aria-label={clickable ? `查看 ${label} ${event.entity.id}` : undefined}
                      onClick={clickable ? () => handleNavigate(event.entity) : undefined}
                    >
                      <span className="assistant-feedback-signal" aria-hidden="true" />
                      <div>
                        <header>
                          <strong>{label}</strong>
                          <time>{formatTime(event.occurred_at)}</time>
                        </header>
                        <p>{event.message}</p>
                        {event.entity && <small>{`${entityLabels[event.entity.type] ?? event.entity.type} / ${event.entity.id}`}</small>}
                      </div>
                    </button>
                  );
                }
                const msg = entry.item as AssistantMessage;
                const isUser = msg.role === "user";
                return (
                  <article key={`msg-${i}`} className={`assistant-message ${isUser ? "is-user" : ""}`}>
                    <header>
                      <strong>{isUser ? "我" : "全站 AI"}</strong>
                      <time>{formatTime(msg.at)}</time>
                    </header>
                    <p>{msg.content}</p>
                    {!isUser && msg.evidence?.length ? (
                      <div className="assistant-evidence-list" aria-label="回答依据">
                        {msg.evidence.map((item, j) => <EvidenceButton key={j} item={item} onNavigate={handleNavigate} />)}
                      </div>
                    ) : null}
                    {!isUser && msg.proposal ? (
                      <ProposalCard proposal={msg.proposal} role={session.role} onAccept={handleAccept} />
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="assistant-empty">
              <span aria-hidden="true">JG1 ━━━ L5-A2-08 ━━━ JG2</span>
              <strong>全站上下文已就绪</strong>
              <p>可以查询机柜容量、服务器、链路、告警与变更，也可以描述待上架设备。</p>
            </div>
          )}
        </div>

        <form className="assistant-composer" onSubmit={handleSubmit}>
          <label htmlFor="assistant-prompt">向全站 AI 助手提问</label>
          <div>
            <textarea
              id="assistant-prompt"
              name="assistant-prompt"
              rows={2}
              maxLength={2000}
              placeholder="例如：CAB-09 还能上架一台 4U、1200W 的服务器吗？"
              disabled={sending}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" disabled={sending}>{sending ? "分析中…" : "发送"}</button>
          </div>
          {error && <p className="assistant-error" role="alert">{`连接提示：${error}`}</p>}
        </form>
      </section>
    </>
  );
}

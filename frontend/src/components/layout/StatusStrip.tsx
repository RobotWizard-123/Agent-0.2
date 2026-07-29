import type { AgentStatusResult } from "../../types/domain";
import { StatusBadge } from "../ui/Badge";

interface StatusStripProps {
  stateVersion: number | null;
  alarmCount: number;
  hasAlarms: boolean;
  agentStatus: AgentStatusResult | null;
  agentConfigured: boolean;
  agentModel: string | null;
}

export function StatusStrip({
  stateVersion,
  alarmCount,
  hasAlarms,
  agentStatus,
  agentConfigured,
  agentModel,
}: StatusStripProps) {
  const model = agentStatus?.model ?? agentModel ?? null;
  let agentBadge: React.ReactNode;
  if (!agentStatus) {
    agentBadge = agentConfigured
      ? <StatusBadge label={`Agent 探活中… (${agentModel ?? ""})`} tone="neutral" />
      : <StatusBadge label="Agent 未配置 · 规则降级" tone="warning" />;
  } else if (agentStatus.status === "available") {
    agentBadge = (
      <span
        className="status-badge tone-ok"
        title={`模型 ${model} 真实接入，探活耗时 ${agentStatus.probe_ms ?? "?"}ms`}
      >
        {model ? `Agent ${model} · 在线` : "Agent 在线"}
      </span>
    );
  } else if (agentStatus.status === "degraded") {
    const reason = agentStatus.error_code ? `（${agentStatus.error_code}）` : "";
    agentBadge = (
      <span
        className="status-badge tone-warning"
        title={`${model ?? "Agent"} 不可达：${agentStatus.error_message ?? "未知原因"}。系统已自动降级到规则引擎。`}
      >
        {model ? `Agent ${model} · 不可达 ${reason}` : "Agent 不可达 · 规则降级"}
      </span>
    );
  } else if (agentStatus.status === "unconfigured") {
    agentBadge = <StatusBadge label="Agent 未配置 · 规则降级" tone="warning" />;
  } else {
    agentBadge = <StatusBadge label="Agent 探活中…" tone="neutral" />;
  }

  return (
    <div className="system-strip">
      <StatusBadge label={`状态版本 ${stateVersion ?? "—"}`} tone="neutral" />
      <StatusBadge
        label={`报警 ${alarmCount}`}
        tone={hasAlarms ? "warning" : "ok"}
      />
      {agentBadge}
    </div>
  );
}

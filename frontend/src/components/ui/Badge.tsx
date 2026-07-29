import type { DataSource } from "../../types/domain";

interface StatusBadgeProps {
  label: string;
  tone?: "neutral" | "ok" | "warning" | "danger";
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`status-badge tone-${tone}`}>{label}</span>;
}

interface SourceBadgeProps {
  source: DataSource;
}

const sourceLabels: Record<DataSource, string> = {
  design: "设计",
  rule: "规则计算",
  demo: "演示",
  telemetry: "实时采集",
  unknown: "未接入",
};

export function SourceBadge({ source }: SourceBadgeProps) {
  return <span className={`source-badge source-${source}`}>{sourceLabels[source] ?? source}</span>;
}

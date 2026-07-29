import type { DataSource } from "../../types/domain";
import { SourceBadge } from "./Badge";

interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "ok" | "warning" | "danger";
  source?: DataSource;
}

export function MetricCard({ label, value, detail, tone = "neutral", source }: MetricCardProps) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-label">
        <span>{label}</span>
        {source ? <SourceBadge source={source} /> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  );
}

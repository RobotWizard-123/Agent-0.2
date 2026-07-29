import type { DataSource } from "../../types/domain";
import { SourceBadge } from "./Badge";
import { formatValue } from "../../utils/format";

interface DetailListProps {
  items: Array<[string, unknown, DataSource?]>;
}

export function DetailList({ items }: DetailListProps) {
  return (
    <dl className="detail-list">
      {items.map(([label, value, source], i) => (
        <div key={i}>
          <dt>{label}</dt>
          <dd>
            <span>{formatValue(value)}</span>
            {source ? <SourceBadge source={source} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

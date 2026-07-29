import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  kicker?: string;
  action?: ReactNode;
  className?: string;
  level?: "h2" | "h3";
  children: ReactNode;
}

export function Panel({ title, kicker, action, className, level = "h2", children }: PanelProps) {
  const Tag = level;
  return (
    <article className={`panel ${className ?? ""}`.trim()}>
      <div className="panel-heading">
        <div>
          {kicker ? <p className="section-kicker">{kicker}</p> : null}
          <Tag>{title}</Tag>
        </div>
        {action ?? null}
      </div>
      {children}
    </article>
  );
}

import type { DataSource } from "../types/domain";

export function formatPower(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未接入";
  return `${(value / 1_000).toFixed(value % 1_000 ? 1 : 0)} kW`;
}

export function formatValue(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "未接入";
  return `${value}${suffix}`;
}

export function sourceLabel(source: DataSource): string {
  const labels: Record<DataSource, string> = {
    design: "设计",
    rule: "规则计算",
    demo: "演示",
    telemetry: "实时采集",
    unknown: "未接入",
  };
  return labels[source] ?? source;
}

export function scoreValue(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
}

export function intervalText(startU: number, size: number): string {
  const start = Number(startU);
  const end = start + Math.max(1, Number(size) || 1) - 1;
  return Number.isFinite(start) ? `U${start}–U${end}` : "U 位待定";
}

export function formatTime(value: string): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

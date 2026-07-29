import type { Rack, Alarm } from "../types/domain";
import type { RackRisk } from "../types/common";

function ratio(used: number, limit: number): number {
  const denominator = Number(limit);
  return denominator > 0 ? Number(used || 0) / denominator : 0;
}

export function rackRisk(rack: Rack, alarms: Alarm[] = []): RackRisk {
  const activeAlarm = alarms.some(
    (alarm) => alarm.status !== "resolved" && alarm.object_id === rack.id,
  );
  const powerRatio = ratio(rack.capacity.rated_power_used_w, rack.capacity.design_power_w);
  const uRatio = ratio(rack.capacity.used_u, rack.capacity.usable_u);
  const basis = uRatio > powerRatio ? "U 位" : "功率";
  const highestRatio = Math.max(powerRatio, uRatio);

  return {
    tone: activeAlarm || highestRatio >= 1 ? "blocker" : highestRatio >= 0.8 ? "warning" : "normal",
    basis: activeAlarm ? "活动报警" : basis,
    ratio: activeAlarm ? 1 : highestRatio,
    power_ratio: powerRatio,
    u_ratio: uRatio,
  };
}

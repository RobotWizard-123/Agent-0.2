function ratio(used, limit) {
  const denominator = Number(limit);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(used || 0) / denominator;
}

function signal({
  type,
  entity,
  severity,
  message,
  stateVersion,
  fingerprint,
  initialVisible = true,
}) {
  return {
    key: `${type}:${entity.type}:${entity.id}`,
    type,
    entity,
    severity,
    message,
    state_version: stateVersion,
    fingerprint,
    initial_visible: initialVisible,
  };
}

function alarmSignals(context) {
  return context.site.alarms
    .filter((item) => item.status !== "resolved")
    .map((alarm) => signal({
      type: "alarm_opened",
      entity: { type: "alarm", id: alarm.id },
      severity: alarm.severity,
      message: alarm.trigger_code,
      stateVersion: context.state_version,
      fingerprint: "active",
    }));
}

function capacitySignals(context) {
  return context.site.racks.flatMap((rack) => {
    const capacity = rack.capacity;
    const metrics = [
      ratio(capacity.rated_power_used_w, capacity.design_power_w),
      ratio(capacity.used_u, capacity.usable_u),
      ratio(capacity.used_weight_kg, capacity.max_weight_kg),
      ratio(capacity.used_ports, capacity.port_limit),
    ];
    if (Math.max(...metrics) < 0.8) return [];
    return [signal({
      type: "capacity_warning",
      entity: { type: "rack", id: rack.id },
      severity: "warning",
      message: `${rack.id} 容量达到 80% 告警线`,
      stateVersion: context.state_version,
      fingerprint: "above_threshold",
    })];
  });
}

function planSignals(context) {
  return context.site.plans.flatMap((plan) => {
    const signals = [];
    if (plan.validation?.blockers?.length) {
      signals.push(signal({
        type: "constraint_blocked",
        entity: { type: "plan", id: plan.id },
        severity: "critical",
        message: `${plan.id} 被硬约束阻断`,
        stateVersion: context.state_version,
        fingerprint: "blocked",
      }));
    }
    if (["succeeded", "failed"].includes(plan.status)) {
      signals.push(signal({
        type: `plan_${plan.status}`,
        entity: { type: "plan", id: plan.id },
        severity: plan.status === "failed" ? "critical" : "info",
        message: `${plan.id} ${plan.status}`,
        stateVersion: context.state_version,
        fingerprint: plan.status,
        initialVisible: plan.status === "failed",
      }));
    }
    return signals;
  });
}

function dependencySignals(context) {
  return Object.entries(context.site.service_health ?? {}).flatMap(([name, health]) => {
    if (!["offline", "degraded"].includes(health.status)) return [];
    return [signal({
      type: "dependency_offline",
      entity: { type: "service", id: name },
      severity: "critical",
      message: `${name} ${health.status}`,
      stateVersion: context.state_version,
      fingerprint: health.status,
    })];
  });
}

export function captureFeedbackSnapshot(context) {
  const signals = [
    ...alarmSignals(context),
    ...capacitySignals(context),
    ...planSignals(context),
    ...dependencySignals(context),
  ];
  return {
    state_version: context.state_version,
    signals: Object.fromEntries(signals.map((item) => [item.key, item])),
  };
}

export function diffFeedbackSnapshots(
  previous,
  current,
  now = () => new Date().toISOString(),
) {
  return Object.values(current.signals)
    .filter((item) => previous
      ? !previous.signals[item.key]
        || previous.signals[item.key].fingerprint !== item.fingerprint
      : item.initial_visible)
    .map((item) => ({
      id: `${current.state_version}:${item.key}:${item.fingerprint}`,
      type: item.type,
      severity: item.severity,
      entity: structuredClone(item.entity),
      message: item.message,
      state_version: current.state_version,
      occurred_at: now(),
    }));
}

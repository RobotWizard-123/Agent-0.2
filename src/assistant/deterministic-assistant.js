function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function power(value) {
  return `${(number(value) / 1_000).toFixed(1)}kW`;
}

function labels(nodes = []) {
  return nodes.map((item) => item.label).filter(Boolean).join(" → ");
}

function rackAnswer(message, context) {
  const rackId = message.match(/CAB-\d{2}/i)?.[0]?.toUpperCase();
  if (!rackId) return null;
  const rack = context.site.racks.find((item) => item.id === rackId);
  if (!rack) {
    return { answer: `未找到机柜 ${rackId}。`, evidence: [], intent: { type: "answer" } };
  }
  const capacity = rack.capacity;
  return {
    answer: `${rackId} 当前额定功率 ${power(capacity.rated_power_used_w)} / 设计容量 ${power(capacity.design_power_w)}，U 位 ${number(capacity.used_u)} / ${number(capacity.usable_u)}，网络端口 ${number(capacity.used_ports)} / ${number(capacity.port_limit)}。`,
    evidence: [{ type: "rack", id: rackId }],
    intent: { type: "answer" },
  };
}

function deviceAnswer(message, context) {
  const deviceId = message.match(/SRV-[A-Z0-9-]+/i)?.[0]?.toUpperCase();
  if (!deviceId) return null;
  const device = context.site.devices.find((item) => item.id.toUpperCase() === deviceId);
  if (!device) {
    return { answer: `未找到设备 ${deviceId}。`, evidence: [], intent: { type: "answer" } };
  }
  const path = context.site.links[device.id];
  const powerPath = labels(path?.power) || "电源链路未知";
  const networkPath = labels(path?.network) || "网络链路未知";
  return {
    answer: `${device.id} 位于 ${device.rack_id ?? "未知机柜"}。电源：${powerPath}；网络：${networkPath}；冗余状态：${path?.redundancy ?? "unverified"}。`,
    evidence: [{ type: "device", id: device.id }],
    intent: { type: "answer" },
  };
}

function alarmAnswer(message, context) {
  if (!/告警|报警/.test(message)) return null;
  const alarms = context.site.alarms.filter((item) => item.status !== "resolved");
  return {
    answer: alarms.length
      ? `当前有 ${alarms.length} 条未恢复告警：${alarms.map((item) => `${item.id} ${item.trigger_code} ${item.status}`).join("；")}。`
      : "当前没有未恢复告警。",
    evidence: alarms.map((item) => ({ type: "alarm", id: item.id })),
    intent: { type: "answer" },
  };
}

function planAnswer(message, context) {
  if (!/方案|计划|执行/.test(message)) return null;
  const plans = context.site.plans.slice(-5).reverse();
  return {
    answer: plans.length
      ? `最近方案：${plans.map((item) => `${item.id} ${item.status}`).join("；")}。`
      : "当前没有已生成方案。",
    evidence: plans.map((item) => ({ type: "plan", id: item.id })),
    intent: { type: "answer" },
  };
}

export function createDeterministicAssistant() {
  return {
    answer({ message, context }) {
      const response = deviceAnswer(message, context)
        ?? rackAnswer(message, context)
        ?? alarmAnswer(message, context)
        ?? planAnswer(message, context);
      if (response) return response;
      const unresolved = context.site.alarms.filter((item) => item.status !== "resolved").length;
      return {
        answer: `${context.site.room.id} 当前纳管 ${context.site.racks.length} 个机柜，未恢复告警 ${unresolved} 条。模型当前不可用时仍可查询具体机柜、设备链路、告警和方案状态。`,
        evidence: [],
        intent: { type: "answer" },
      };
    },
  };
}

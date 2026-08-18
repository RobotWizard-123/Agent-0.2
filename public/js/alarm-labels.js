export const alarmTriggerLabels = {
  RACK_POWER_HIGH: "机柜功率过高",
  PLACEMENT_CONFLICT: "层位冲突",
  COLLECTOR_OFFLINE: "采集器离线",
  MODEL_SERVICE_OFFLINE: "模型服务离线",
  SIMULATED_EXECUTION_FAILED: "模拟执行失败",
};

export const alarmObjectTypeLabels = {
  rack: "机柜",
  service: "服务",
  plan: "方案",
  device: "设备",
};

export function alarmTriggerLabel(code) {
  return alarmTriggerLabels[code] ?? code;
}

export function alarmObjectTypeLabel(type) {
  return alarmObjectTypeLabels[type] ?? type;
}

export const severityLabels = {
  ok: "正常",
  info: "提示",
  warning: "警告",
  critical: "严重",
};

export function severityLabel(value) {
  return severityLabels[value] ?? value;
}

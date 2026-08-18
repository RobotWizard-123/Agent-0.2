import { capacitySnapshot } from "../domain/capacity.js";

const allowedFilters = ["query", "status", "severity", "source"];
const allowedRuntimeFields = [
  "agent_configured",
  "agent_model",
  "authentication_configured",
  "telemetry_status",
  "application_version",
];

function clone(value) {
  return structuredClone(value);
}

function safeUiContext(value = {}) {
  const filters = value.filters && typeof value.filters === "object" && !Array.isArray(value.filters)
    ? value.filters
    : {};
  return {
    route: typeof value.route === "string" ? value.route.slice(0, 80) : "overview",
    entity_id: typeof value.entity_id === "string" ? value.entity_id.slice(0, 160) : null,
    filters: Object.fromEntries(allowedFilters
      .filter((key) => typeof filters[key] === "string")
      .map((key) => [key, filters[key].slice(0, 200)])),
  };
}

function safeRuntime(value = {}) {
  return Object.fromEntries(allowedRuntimeFields
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, clone(value[key])]));
}

function safeDevice(device) {
  const allowed = [
    "id",
    "asset_id",
    "hostname",
    "model",
    "rack_id",
    "layer_id",
    "u_size",
    "rated_power_w",
    "real_power_w",
    "weight_kg",
    "network_ports",
    "ip",
    "vlan",
    "business",
    "owner",
    "status",
    "data_source",
  ];
  return Object.fromEntries(allowed
    .filter((key) => Object.hasOwn(device, key))
    .map((key) => [key, clone(device[key])]));
}

function usageRatio(used, limit) {
  const denominator = Number(limit);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(used || 0) / denominator;
}

function activeRisks(state, racks) {
  const alarms = state.alarms
    .filter((alarm) => alarm.status !== "resolved")
    .map((alarm) => ({
      type: "alarm",
      id: alarm.id,
      severity: alarm.severity,
      object_id: alarm.object_id,
      code: alarm.trigger_code,
    }));
  const capacities = racks
    .filter((rack) => {
      const value = rack.capacity;
      return [
        usageRatio(value.rated_power_used_w, value.design_power_w),
        usageRatio(value.used_u, value.usable_u),
        usageRatio(value.used_weight_kg, value.max_weight_kg),
        usageRatio(value.used_ports, value.port_limit),
      ].some((ratio) => ratio >= 0.8);
    })
    .map((rack) => ({
      type: "capacity",
      id: rack.id,
      severity: "warning",
      object_id: rack.id,
      code: "CAPACITY_WARNING",
    }));
  const blockers = state.plans
    .filter((plan) => plan.validation?.blockers?.length)
    .map((plan) => ({
      type: "constraint",
      id: plan.id,
      severity: "critical",
      object_id: plan.id,
      code: "CONSTRAINT_BLOCKED",
    }));
  const dependencies = Object.entries(state.service_health)
    .filter(([, value]) => ["offline", "degraded"].includes(value.status))
    .map(([id, value]) => ({
      type: "dependency",
      id,
      severity: "critical",
      object_id: id,
      code: value.status.toUpperCase(),
    }));
  return [...alarms, ...capacities, ...blockers, ...dependencies];
}

function safePath(topologyService, state, device) {
  try {
    return topologyService.devicePath(state, device.id);
  } catch {
    return {
      device: { id: device.id },
      power: [],
      network: [],
      redundancy: "unverified",
      missing_fields: ["topology"],
    };
  }
}

export function createAssistantContextService({
  repository,
  topologyService,
  runtimeStatus = () => ({}),
  now = () => new Date().toISOString(),
}) {
  return {
    build({ role, uiContext = {} }) {
      const state = repository.read();
      const normalizedUi = safeUiContext(uiContext);
      const racks = state.racks.map((rack) => ({
        ...clone(rack),
        capacity: capacitySnapshot(state, rack.id),
      }));
      const devices = state.devices
        .filter((item) => item.status !== "cancelled")
        .map(safeDevice);
      const links = Object.fromEntries(devices
        .map((device) => [device.id, safePath(topologyService, state, device)]));
      const recentAudit = state.audit.slice(-50);
      const entityIndex = [
        ...racks.map((rack) => ({ type: "rack", id: rack.id, label: rack.name })),
        ...devices.map((device) => ({ type: "device", id: device.id, label: device.hostname ?? device.id })),
        ...state.alarms.map((alarm) => ({ type: "alarm", id: alarm.id, label: alarm.trigger_code })),
        ...state.plans.map((plan) => ({ type: "plan", id: plan.id, label: plan.kind })),
        ...recentAudit.map((entry) => ({ type: "audit", id: entry.id, label: entry.action })),
      ];
      const currentEntity = entityIndex.find((item) => item.id === normalizedUi.entity_id) ?? null;

      return {
        state_version: state.version,
        generated_at: now(),
        role,
        ui_context: { ...normalizedUi, current_entity: currentEntity },
        site: {
          room: clone(state.room),
          power_sources: clone(state.power_sources),
          racks,
          devices,
          links,
          alarms: clone(state.alarms),
          diagnoses: clone(state.diagnoses),
          plans: clone(state.plans),
          changes: clone(state.changes),
          audit: clone(recentAudit),
          service_health: clone(state.service_health),
          runtime: safeRuntime(runtimeStatus()),
        },
        active_risks: activeRisks(state, racks),
        entity_index: entityIndex,
      };
    },
  };
}

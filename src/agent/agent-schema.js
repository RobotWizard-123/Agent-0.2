import { validateWeightMultipliers } from "../planning/strategy-profiles.js";

function invalid(message, details = {}) {
  return Object.assign(new Error(message), { code: "AGENT_RESPONSE_INVALID", ...details });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value;
}

function exactFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw invalid(`${label} contains unsupported fields`, { fields: unknown });
}

function positiveNumber(value, label, { integer = false, max = Number.POSITIVE_INFINITY } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max || (integer && !Number.isInteger(number))) {
    throw invalid(`${label} is invalid`);
  }
  return number;
}

function stringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw invalid(`${label} must be a string array`);
  return [...value];
}

export function validateDeviceRequest(value) {
  const input = object(value, "Device request");
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : "SRV-AGENT";
  return {
    id,
    count: positiveNumber(input.count ?? 1, "count", { integer: true, max: 100 }),
    u_size: positiveNumber(input.u_size, "u_size", { integer: true, max: 10 }),
    rated_power_w: positiveNumber(input.rated_power_w, "rated_power_w"),
    real_power_w: null,
    weight_kg: positiveNumber(input.weight_kg, "weight_kg"),
    network_ports: positiveNumber(input.network_ports, "network_ports", { integer: true }),
    preferred_rack_ids: stringArray(input.preferred_rack_ids, "preferred_rack_ids"),
    hostname: typeof input.hostname === "string" ? input.hostname : null,
    model: typeof input.model === "string" ? input.model : null,
    business: typeof input.business === "string" ? input.business : null,
    owner: typeof input.owner === "string" ? input.owner : null,
  };
}

function validatePlacementDevice(value, startU) {
  const device = object(value, "Placement device");
  const allowed = [
    "id", "u_size", "start_u", "rated_power_w", "real_power_w", "weight_kg", "network_ports",
    "business_id", "replica_group", "hostname", "model", "business", "owner",
  ];
  exactFields(device, allowed, "Placement device");
  if (typeof device.id !== "string" || !device.id.trim()) throw invalid("Placement device id is invalid");
  const normalized = {
    id: device.id.trim(),
    u_size: positiveNumber(device.u_size, "device.u_size", { integer: true, max: 10 }),
    start_u: positiveNumber(device.start_u, "device.start_u", { integer: true, max: 42 }),
    rated_power_w: positiveNumber(device.rated_power_w, "device.rated_power_w"),
    weight_kg: positiveNumber(device.weight_kg, "device.weight_kg"),
    network_ports: positiveNumber(device.network_ports, "device.network_ports", { integer: true }),
  };
  if (normalized.start_u !== startU) throw invalid("Placement start U values do not match");
  for (const field of ["real_power_w", "business_id", "replica_group", "hostname", "model", "business", "owner"]) {
    if (Object.hasOwn(device, field)) normalized[field] = structuredClone(device[field]);
  }
  return normalized;
}

function validateAction(value) {
  const action = object(value, "Plan action");
  if (action.type === "place_device") {
    exactFields(action, ["type", "rack_id", "layer_id", "start_u", "device"], "Placement action");
    if (typeof action.rack_id !== "string" || typeof action.layer_id !== "string") throw invalid("Placement target is invalid");
    const startU = positiveNumber(action.start_u, "start_u", { integer: true, max: 42 });
    return {
      type: "place_device",
      rack_id: action.rack_id,
      layer_id: action.layer_id,
      start_u: startU,
      device: validatePlacementDevice(action.device, startU),
    };
  }
  if (action.type === "move_device") {
    exactFields(action, ["type", "device_id", "rack_id", "layer_id", "start_u"], "Move action");
    if ([action.device_id, action.rack_id, action.layer_id].some((item) => typeof item !== "string")) throw invalid("Move action is invalid");
    return {
      type: "move_device",
      device_id: action.device_id,
      rack_id: action.rack_id,
      layer_id: action.layer_id,
      start_u: positiveNumber(action.start_u, "start_u", { integer: true, max: 42 }),
    };
  }
  if (action.type === "set_dividers") {
    exactFields(action, ["type", "rack_id", "dividers_u"], "Divider action");
    if (
      typeof action.rack_id !== "string"
      || !Array.isArray(action.dividers_u)
      || action.dividers_u.length !== 3
      || action.dividers_u.some((item) => !Number.isInteger(item))
      || action.dividers_u[0] !== 12
    ) {
      throw invalid("Divider action is invalid");
    }
    return { type: "set_dividers", rack_id: action.rack_id, dividers_u: [...action.dividers_u] };
  }
  throw invalid(`Unsupported Agent action: ${action.type}`);
}

export function validatePlanAdjustment(value) {
  const input = object(value, "Plan adjustment");
  exactFields(input, ["candidate_id", "reason", "weight_multipliers", "alternatives"], "Plan adjustment");
  if (input.candidate_id !== null && input.candidate_id !== undefined && typeof input.candidate_id !== "string") {
    throw invalid("candidate_id must be a string or null");
  }
  if (typeof input.reason !== "string" || !input.reason.trim()) throw invalid("Adjustment reason is required");
  if (input.alternatives !== undefined && !Array.isArray(input.alternatives)) throw invalid("alternatives must be an array");
  if ((input.alternatives?.length ?? 0) > 3) throw invalid("Agent alternatives cannot exceed three");
  const alternatives = (input.alternatives ?? []).map((raw) => {
    const alternative = object(raw, "Agent alternative");
    exactFields(alternative, ["id", "reason", "actions"], "Agent alternative");
    if (typeof alternative.id !== "string" || !alternative.id.trim()) throw invalid("Alternative id is required");
    if (typeof alternative.reason !== "string" || !alternative.reason.trim()) throw invalid("Alternative reason is required");
    if (!Array.isArray(alternative.actions)) throw invalid("Alternative actions must be an array");
    return {
      id: alternative.id.trim(),
      reason: alternative.reason.trim(),
      actions: alternative.actions.map(validateAction),
    };
  });
  if (new Set(alternatives.map((alternative) => alternative.id)).size !== alternatives.length) {
    throw invalid("Alternative ids must be unique");
  }
  return {
    candidate_id: typeof input.candidate_id === "string" ? input.candidate_id.trim() : null,
    reason: input.reason.trim(),
    weight_multipliers: validateWeightMultipliers(input.weight_multipliers ?? {}),
    alternatives,
  };
}

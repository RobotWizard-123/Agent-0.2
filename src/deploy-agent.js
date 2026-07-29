import { createDemoState } from "./demo-state.js";
import { evaluateActions } from "./domain/constraint-engine.js";
import { deriveLayers, freeIntervals } from "./domain/rack-layout.js";

function canonicalLayerId(layerId) {
  if (typeof layerId !== "string") return layerId;
  const match = layerId.match(/(L0[1-4])$/);
  return match ? match[1] : layerId;
}

function canonicalDevice(server) {
  return {
    ...structuredClone(server),
    rack_id: server.rack_id ?? server.cabinet_id,
    layer_id: canonicalLayerId(server.layer_id),
    rated_power_w: Number(server.rated_power_w ?? server.power_w ?? 0),
    real_power_w: server.real_power_w ?? null,
    weight_kg: Number(server.weight_kg ?? 0),
    network_ports: Number(server.network_ports ?? 0),
    u_size: Number(server.u_size ?? 0),
    start_u: server.start_u == null ? null : Number(server.start_u),
    data_source: server.data_source ?? "demo",
  };
}

function placementStartU(state, device) {
  if (Number.isInteger(device.start_u)) return device.start_u;

  const rack = state.racks.find((item) => item.id === device.rack_id);
  if (!rack) return Number.NaN;

  try {
    const interval = freeIntervals(
      rack,
      state.devices.filter((item) => item.rack_id === rack.id),
    ).find((item) => item.layer_id === device.layer_id && item.size_u >= device.u_size);
    if (interval) return interval.start_u;
  } catch {
    // Preserve invalid input for the constraint engine to report below.
  }

  try {
    return deriveLayers(rack).find((layer) => layer.id === device.layer_id)?.start_u ?? Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function appendPlacedDevice(state, server) {
  const device = canonicalDevice(server);
  const startU = placementStartU(state, device);
  state.devices.push({ ...device, start_u: startU });
  return { device, startU };
}

function canonicalState(data) {
  if (Array.isArray(data?.racks)) {
    return structuredClone(data);
  }

  const state = createDemoState();
  state.devices = [];
  for (const server of Array.isArray(data?.servers) ? data.servers : []) {
    appendPlacedDevice(state, server);
  }
  return state;
}

export function runPrecheck(data, request = {}) {
  const state = canonicalState(data);
  const placementState = structuredClone(state);
  const actions = [];
  for (const server of Array.isArray(request.servers) ? request.servers : []) {
    const { device, startU } = appendPlacedDevice(placementState, server);
    actions.push({
      type: "place_device",
      rack_id: device.rack_id,
      layer_id: device.layer_id,
      start_u: startU,
      device: { ...device, start_u: startU },
    });
  }

  return evaluateActions(state, actions);
}

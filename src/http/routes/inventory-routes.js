import { capacitySnapshot } from "../../domain/capacity.js";
import { deriveLayers, freeIntervals, packDevices } from "../../domain/rack-layout.js";
import { getRuntimeConfig } from "../../config.js";

function notFound(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

async function rackDetail(state, rack, telemetryProvider) {
  const devices = state.devices.filter((device) => device.rack_id === rack.id && device.status !== "cancelled");
  const placements = packDevices(rack, devices);
  const placementByDevice = new Map(placements.map((placement) => [placement.device_id, placement]));
  const enrichedDevices = devices.map((device) => ({ ...device, placement: placementByDevice.get(device.id) ?? null }));
  const capacity = capacitySnapshot(state, rack.id);
  const telemetry = await telemetryProvider.rackPower(rack.id);
  const intervals = freeIntervals(rack, devices);
  const layers = deriveLayers(rack).map((layer) => ({
    ...layer,
    used_u: capacity.layers.find((item) => item.id === layer.id).used_u,
    free_intervals: intervals.filter((interval) => interval.layer_id === layer.id),
    devices: enrichedDevices.filter((device) => device.layer_id === layer.id),
  }));

  return {
    ...rack,
    layers,
    devices: enrichedDevices,
    capacity: { ...capacity, real_power_w: telemetry.value_w, real_power_source: telemetry.source },
    telemetry,
    state_version: state.version,
  };
}

export function registerInventoryRoutes(router, { repository, telemetryProvider }) {
  router.add("GET", "/api/room", () => {
    const state = repository.read();
    return { ...state.room, state_version: state.version };
  });

  router.add("GET", "/api/racks", () => {
    const state = repository.read();
    return {
      state_version: state.version,
      items: state.racks.map((rack) => ({ ...rack, capacity: capacitySnapshot(state, rack.id) })),
    };
  });

  router.add("GET", "/api/racks/:id", async ({ params }) => {
    const state = repository.read();
    const rack = state.racks.find((item) => item.id === params.id);
    if (!rack) throw notFound("RACK_NOT_FOUND", `Rack does not exist: ${params.id}`, { rack_id: params.id });
    return rackDetail(state, rack, telemetryProvider);
  });

  router.add("GET", "/api/devices/:id", ({ params }) => {
    const state = repository.read();
    const device = state.devices.find((item) => item.id === params.id);
    if (!device) throw notFound("DEVICE_NOT_FOUND", `Device does not exist: ${params.id}`, { device_id: params.id });
    return { ...device, state_version: state.version };
  });

  router.add("GET", "/api/capacity", () => {
    const state = repository.read();
    return { state_version: state.version, items: state.racks.map((rack) => capacitySnapshot(state, rack.id)) };
  });

  router.add("GET", "/api/config/status", () => getRuntimeConfig());

  router.add("GET", "/api/cabinets", () => {
    const state = repository.read();
    return { items: state.racks, state_version: state.version };
  });

  router.add("GET", "/api/servers", () => {
    const state = repository.read();
    return { items: state.devices, state_version: state.version };
  });
}

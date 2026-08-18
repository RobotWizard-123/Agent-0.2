import { deriveLayers, freeIntervals } from "./rack-layout.js";

function sum(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

export function capacitySnapshot(state, rackId) {
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) {
    throw Object.assign(new Error(`Rack does not exist: ${rackId}`), { code: "RACK_NOT_FOUND", rack_id: rackId });
  }

  const devices = state.devices.filter((device) => device.rack_id === rackId && device.status !== "cancelled");
  const layers = deriveLayers(rack);
  const intervals = freeIntervals(rack, devices);
  const hasCompleteRealPower = devices.length > 0
    && devices.every((device) => Number.isFinite(device.real_power_w));

  return {
    rack_id: rackId,
    source: "rule",
    design_power_w: rack.design_power_w,
    rated_power_used_w: sum(devices, "rated_power_w"),
    real_power_w: hasCompleteRealPower ? sum(devices, "real_power_w") : null,
    real_power_source: hasCompleteRealPower ? "telemetry" : "unknown",
    used_u: sum(devices, "u_size"),
    usable_u: sum(layers, "usable_u"),
    used_weight_kg: sum(devices, "weight_kg"),
    max_weight_kg: rack.max_weight_kg,
    used_ports: sum(devices, "network_ports"),
    port_limit: rack.network_port_limit,
    largest_contiguous_u: Math.max(0, ...intervals.map((interval) => interval.size_u)),
    layers: layers.map((layer) => {
      const layerIntervals = intervals.filter((interval) => interval.layer_id === layer.id);
      return {
        ...layer,
        used_u: sum(devices.filter((device) => device.layer_id === layer.id), "u_size"),
        free_intervals: layerIntervals,
        largest_contiguous_u: Math.max(0, ...layerIntervals.map((interval) => interval.size_u)),
      };
    }),
  };
}

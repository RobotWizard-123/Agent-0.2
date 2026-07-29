function layoutError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function deriveLayers(rack) {
  const dividers = rack?.dividers_u;
  const heightU = Number(rack?.height_u);
  const reserveU = Number(rack?.reserve_u_per_layer ?? 2);

  if (
    heightU !== 42
    || !Array.isArray(dividers)
    || dividers.length !== 3
    || dividers.some((value) => !Number.isInteger(value))
    || dividers[0] !== 12
    || !(12 < dividers[1] && dividers[1] < dividers[2] && dividers[2] < heightU)
  ) {
    throw layoutError("DIVIDER_LAYOUT_INVALID", `${rack?.id ?? "Rack"} divider layout is invalid`, {
      rack_id: rack?.id ?? null,
      dividers_u: dividers,
    });
  }

  const ranges = [
    [1, dividers[0]],
    [dividers[0] + 1, dividers[1]],
    [dividers[1] + 1, dividers[2]],
    [dividers[2] + 1, heightU],
  ];

  return ranges.map(([startU, endU], index) => {
    const capacityU = endU - startU + 1;
    return {
      id: `L0${index + 1}`,
      start_u: startU,
      end_u: endU,
      capacity_u: capacityU,
      reserve_u: reserveU,
      reserve_start_u: endU - reserveU + 1,
      reserve_end_u: endU,
      usable_end_u: endU - reserveU,
      usable_u: Math.max(0, capacityU - reserveU),
    };
  });
}

export function packDevices(rack, devices) {
  const layers = deriveLayers(rack);
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const placements = devices
    .filter((device) => device.status !== "cancelled")
    .map((device) => {
      const layer = layerById.get(device.layer_id);
      if (!layer) {
        throw layoutError("LAYER_NOT_FOUND", `${device.layer_id} does not exist in ${rack.id}`, {
          rack_id: rack.id,
          layer_id: device.layer_id,
          device_id: device.id,
        });
      }
      const startU = Number(device.start_u);
      const sizeU = Number(device.u_size);
      if (!Number.isInteger(startU) || !Number.isInteger(sizeU) || sizeU <= 0) {
        throw layoutError("DEVICE_U_INVALID", `${device.id} has an invalid U range`, { device_id: device.id });
      }
      const endU = startU + sizeU - 1;
      if (startU < layer.start_u || endU > layer.end_u) {
        throw layoutError("DEVICE_LAYER_RANGE_INVALID", `${device.id} crosses ${layer.id}`, {
          rack_id: rack.id,
          layer_id: layer.id,
          device_id: device.id,
        });
      }
      if (endU >= layer.reserve_start_u) {
        throw layoutError("LAYER_RESERVE_OCCUPIED", `${device.id} occupies the reserved U interval`, {
          rack_id: rack.id,
          layer_id: layer.id,
          device_id: device.id,
        });
      }
      return {
        device_id: device.id,
        rack_id: rack.id,
        layer_id: layer.id,
        start_u: startU,
        end_u: endU,
      };
    })
    .sort((left, right) => left.start_u - right.start_u || left.device_id.localeCompare(right.device_id));

  for (let index = 1; index < placements.length; index += 1) {
    const previous = placements[index - 1];
    const current = placements[index];
    if (previous.end_u >= current.start_u) {
      throw layoutError("DEVICE_U_OVERLAP", `${previous.device_id} overlaps ${current.device_id}`, {
        rack_id: rack.id,
        layer_id: current.layer_id,
        device_id: current.device_id,
      });
    }
  }
  return placements;
}

export function freeIntervals(rack, devices) {
  const placements = packDevices(rack, devices);
  return deriveLayers(rack).flatMap((layer) => {
    const occupied = placements.filter((placement) => placement.layer_id === layer.id);
    const intervals = [];
    let cursor = layer.start_u;

    for (const placement of occupied) {
      if (cursor < placement.start_u) {
        intervals.push({
          rack_id: rack.id,
          layer_id: layer.id,
          start_u: cursor,
          end_u: placement.start_u - 1,
          size_u: placement.start_u - cursor,
        });
      }
      cursor = placement.end_u + 1;
    }

    if (cursor <= layer.usable_end_u) {
      intervals.push({
        rack_id: rack.id,
        layer_id: layer.id,
        start_u: cursor,
        end_u: layer.usable_end_u,
        size_u: layer.usable_end_u - cursor + 1,
      });
    }
    return intervals;
  });
}

import { capacitySnapshot } from "./capacity.js";
import { deriveLayers, packDevices } from "./rack-layout.js";

function issue(code, targetId, message, severity = "blocker", evidence = {}) {
  return { code, target_id: targetId, message, severity, evidence };
}

function actionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function findRack(state, rackId) {
  const rack = state.racks.find((item) => item.id === rackId);
  if (!rack) throw actionError("RACK_NOT_FOUND", `Rack does not exist: ${rackId}`, { rack_id: rackId });
  return rack;
}

export function applyActions(state, actions) {
  const projected = structuredClone(state);

  for (const action of actions) {
    if (action.type === "place_device") {
      findRack(projected, action.rack_id);
      if (projected.devices.some((device) => device.id === action.device?.id)) {
        throw actionError("DEVICE_ALREADY_EXISTS", `Device already exists: ${action.device.id}`, { device_id: action.device.id });
      }
      projected.devices.push({
        status: "pending",
        data_source: "demo",
        ...structuredClone(action.device),
        rack_id: action.rack_id,
        layer_id: action.layer_id,
        start_u: Number(action.start_u ?? action.device?.start_u),
      });
      continue;
    }

    if (action.type === "move_device") {
      findRack(projected, action.rack_id);
      const device = projected.devices.find((item) => item.id === action.device_id);
      if (!device) throw actionError("DEVICE_NOT_FOUND", `Device does not exist: ${action.device_id}`, { device_id: action.device_id });
      device.rack_id = action.rack_id;
      device.layer_id = action.layer_id;
      device.start_u = Number(action.start_u);
      continue;
    }

    if (action.type === "remove_device") {
      const index = projected.devices.findIndex((item) => item.id === action.device_id);
      if (index < 0) throw actionError("DEVICE_NOT_FOUND", `Device does not exist: ${action.device_id}`, { device_id: action.device_id });
      const device = projected.devices[index];
      if (action.rack_id && action.rack_id !== device.rack_id) {
        throw actionError("DEVICE_RACK_MISMATCH", `${device.id} is not installed in ${action.rack_id}`, {
          device_id: device.id,
          rack_id: action.rack_id,
        });
      }
      projected.devices.splice(index, 1);
      projected.power_connections = projected.power_connections.filter((item) => item.device_id !== device.id);
      projected.network_connections = projected.network_connections.filter((item) => item.device_id !== device.id);
      continue;
    }

    if (action.type === "set_dividers") {
      const rack = findRack(projected, action.rack_id);
      rack.dividers_u = structuredClone(action.dividers_u);
      continue;
    }

    if (action.type === "set_service_health") {
      const service = projected.service_health[action.service];
      if (!service) throw actionError("SERVICE_NOT_FOUND", `Service does not exist: ${action.service}`, { service: action.service });
      service.status = action.status;
      service.checked_at = new Date().toISOString();
      continue;
    }

    if (action.type === "clear_demo_condition") {
      const index = projected.demo_conditions.findIndex((condition) => condition.id === action.condition_id);
      if (index < 0) throw actionError("DEMO_CONDITION_NOT_FOUND", `Demo condition does not exist: ${action.condition_id}`, { condition_id: action.condition_id });
      projected.demo_conditions.splice(index, 1);
      continue;
    }

    throw actionError("ACTION_TYPE_INVALID", `Unsupported action: ${action.type}`, { action_type: action.type });
  }

  return projected;
}

function affectedRackIds(state, actions) {
  const ids = new Set();
  for (const action of actions) {
    if (action.rack_id) ids.add(action.rack_id);
    if (["move_device", "remove_device"].includes(action.type)) {
      const current = state.devices.find((device) => device.id === action.device_id);
      if (current?.rack_id) ids.add(current.rack_id);
    }
  }
  return [...ids];
}

function snapshots(state, rackIds) {
  return Object.fromEntries(
    rackIds
      .filter((rackId) => state.racks.some((rack) => rack.id === rackId))
      .map((rackId) => {
        try {
          return [rackId, capacitySnapshot(state, rackId)];
        } catch (error) {
          return [rackId, {
            rack_id: rackId,
            invalid: true,
            error_code: error.code ?? "LAYOUT_INVALID",
          }];
        }
      }),
  );
}

function validateRack(state, rack, blockers, warnings) {
  const devices = state.devices.filter((device) => device.rack_id === rack.id && device.status !== "cancelled");
  let layoutValid = true;

  try {
    deriveLayers(rack);
    packDevices(rack, devices);
  } catch (error) {
    layoutValid = false;
    blockers.push(issue(error.code ?? "LAYOUT_INVALID", error.layer_id ?? rack.id, error.message, "blocker", {
      rack_id: rack.id,
      layer_id: error.layer_id ?? null,
    }));
  }

  for (const device of devices) {
    if (rack.role === "network") {
      blockers.push(issue("SERVER_RACK_REQUIRED", device.id, `${device.id} cannot be placed in network rack ${rack.id}`, "blocker", {
        rack_id: rack.id,
      }));
    }
    if (Number(device.u_size) === 10 && device.layer_id !== "L01") {
      blockers.push(issue("TEN_U_REQUIRES_L01", device.id, `${device.id} is 10U and must be placed in L01`, "blocker", {
        rack_id: rack.id,
        layer_id: device.layer_id,
      }));
    }
    if (Number(device.u_size) > 10) {
      blockers.push(issue("DEVICE_U_UNSUPPORTED", device.id, `${device.id} exceeds the supported 10U server size`, "blocker", {
        rack_id: rack.id,
        u_size: Number(device.u_size),
      }));
    }
  }

  if (!layoutValid) return;

  const capacity = capacitySnapshot(state, rack.id);
  if (capacity.rated_power_used_w > capacity.design_power_w) {
    blockers.push(issue("RACK_POWER_EXCEEDED", rack.id, `${rack.id} rated power exceeds its design limit`, "blocker", capacity));
  } else if (capacity.rated_power_used_w >= capacity.design_power_w * 0.8) {
    warnings.push(issue("RACK_POWER_HIGH", rack.id, `${rack.id} rated power reached 80% of its design limit`, "warning", capacity));
  }

  if (capacity.used_weight_kg > capacity.max_weight_kg) {
    blockers.push(issue("RACK_WEIGHT_EXCEEDED", rack.id, `${rack.id} weight exceeds its configured limit`, "blocker", capacity));
  } else if (capacity.used_weight_kg >= capacity.max_weight_kg * 0.8) {
    warnings.push(issue("RACK_WEIGHT_HIGH", rack.id, `${rack.id} weight reached 80% of its configured limit`, "warning", capacity));
  }

  if (capacity.used_ports > capacity.port_limit) {
    blockers.push(issue("RACK_PORTS_EXCEEDED", rack.id, `${rack.id} network ports exceed its configured limit`, "blocker", capacity));
  } else if (capacity.used_ports >= capacity.port_limit * 0.8) {
    warnings.push(issue("RACK_PORTS_HIGH", rack.id, `${rack.id} network ports reached 80% of its configured limit`, "warning", capacity));
  }
}

function validateMoveEligibility(state, actions, blockers) {
  for (const action of actions.filter((item) => item.type === "move_device")) {
    const device = state.devices.find((item) => item.id === action.device_id);
    if (!device) continue;
    if (!device.movable) {
      blockers.push(issue("DEVICE_MOVE_NOT_ALLOWED", device.id, `${device.id} is not eligible for migration`, "blocker", {
        device_id: device.id,
      }));
    }
    if (device.criticality === "critical") {
      blockers.push(issue("DEVICE_CRITICAL", device.id, `${device.id} is critical and cannot be migrated`, "blocker", {
        device_id: device.id,
      }));
    }
    if (!device.maintenance_window) {
      blockers.push(issue("MAINTENANCE_WINDOW_REQUIRED", device.id, `${device.id} has no migration maintenance window`, "blocker", {
        device_id: device.id,
      }));
    }
  }
}

function validateRemovalEligibility(state, actions, blockers, warnings) {
  for (const action of actions.filter((item) => item.type === "remove_device")) {
    const device = state.devices.find((item) => item.id === action.device_id);
    if (!device) continue;
    if (!device.movable) {
      blockers.push(issue("DEVICE_REMOVAL_NOT_ALLOWED", device.id, `${device.id} is not eligible for removal`, "blocker", {
        device_id: device.id,
        business_id: device.business_id ?? null,
      }));
    }
    if (device.criticality === "critical") {
      blockers.push(issue("DEVICE_CRITICAL", device.id, `${device.id} is critical and cannot be removed`, "blocker", {
        device_id: device.id,
        business_id: device.business_id ?? null,
      }));
    }
    if (!device.maintenance_window) {
      blockers.push(issue("MAINTENANCE_WINDOW_REQUIRED", device.id, `${device.id} has no removal maintenance window`, "blocker", {
        device_id: device.id,
      }));
    }

    const replicaPeers = device.replica_group
      ? state.devices.filter((item) => item.id !== device.id && item.status !== "cancelled" && item.replica_group === device.replica_group)
      : [];
    if (device.replica_group && replicaPeers.length === 0) {
      blockers.push(issue("REPLICA_LAST_MEMBER", device.id, `${device.id} is the last active member of ${device.replica_group}`, "blocker", {
        device_id: device.id,
        replica_group: device.replica_group,
      }));
    } else if (device.replica_group) {
      warnings.push(issue("REPLICA_CAPACITY_REVIEW", device.id, `${device.replica_group} will continue with ${replicaPeers.length} active member(s)`, "warning", {
        device_id: device.id,
        replica_group: device.replica_group,
        remaining_device_ids: replicaPeers.map((item) => item.id),
      }));
    } else {
      warnings.push(issue("BUSINESS_REDUNDANCY_UNVERIFIED", device.id, `${device.id} has no verified replica group; confirm business impact before removal`, "warning", {
        device_id: device.id,
        business_id: device.business_id ?? null,
      }));
    }
  }
}

function validateReplicaDomains(state, blockers) {
  const groups = new Map();
  for (const device of state.devices.filter((item) => item.status !== "cancelled" && item.replica_group)) {
    groups.set(device.replica_group, [...(groups.get(device.replica_group) ?? []), device]);
  }
  for (const [group, devices] of groups) {
    for (let left = 0; left < devices.length; left += 1) {
      for (let right = left + 1; right < devices.length; right += 1) {
        const leftRack = state.racks.find((rack) => rack.id === devices[left].rack_id);
        const rightRack = state.racks.find((rack) => rack.id === devices[right].rack_id);
        if (!leftRack || !rightRack) continue;
        if (leftRack.source_id === rightRack.source_id || leftRack.network_switch_id === rightRack.network_switch_id) {
          blockers.push(issue("REPLICA_FAULT_DOMAIN_CONFLICT", group, `${group} shares a power or network fault domain`, "blocker", {
            device_ids: [devices[left].id, devices[right].id],
            source_ids: [leftRack.source_id, rightRack.source_id],
            switch_ids: [leftRack.network_switch_id, rightRack.network_switch_id],
          }));
        }
      }
    }
  }
}

export function evaluateActions(state, actions = []) {
  const blockers = [];
  const warnings = [];
  const rackIds = affectedRackIds(state, actions);
  const before = snapshots(state, rackIds);
  let projectedState;

  validateMoveEligibility(state, actions, blockers);
  validateRemovalEligibility(state, actions, blockers, warnings);
  if (blockers.length > 0) {
    return {
      allowed: false,
      blockers,
      warnings,
      before,
      after: before,
      projected_devices: structuredClone(state.devices),
    };
  }

  try {
    projectedState = applyActions(state, actions);
  } catch (error) {
    blockers.push(issue(error.code ?? "ACTION_INVALID", error.rack_id ?? error.device_id ?? "request", error.message));
    return {
      allowed: false,
      blockers,
      warnings,
      before,
      after: before,
      projected_devices: structuredClone(state.devices),
    };
  }

  for (const rack of projectedState.racks) {
    validateRack(projectedState, rack, blockers, warnings);
  }
  validateReplicaDomains(projectedState, blockers);

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    before,
    after: snapshots(projectedState, rackIds),
    projected_devices: structuredClone(projectedState.devices),
  };
}

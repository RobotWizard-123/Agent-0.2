import { applyActions, evaluateActions } from "../domain/constraint-engine.js";
import { freeIntervals } from "../domain/rack-layout.js";

function requestDevice(request, startU) {
  return {
    ...structuredClone(request),
    count: undefined,
    preferred_rack_ids: undefined,
    start_u: startU,
    status: "pending",
    data_source: "demo",
  };
}

function intervalsFor(state, rack, sizeU) {
  try {
    return freeIntervals(
      rack,
      state.devices.filter((device) => device.rack_id === rack.id && device.status !== "cancelled"),
    )
      .filter((interval) => interval.size_u >= sizeU && (sizeU !== 10 || interval.layer_id === "L01"))
      .sort((left, right) => left.layer_id.localeCompare(right.layer_id) || left.start_u - right.start_u);
  } catch {
    return [];
  }
}

function eligibilityReason(device) {
  if (!device.movable) return "DEVICE_MOVE_NOT_ALLOWED";
  if (device.criticality === "critical") return "DEVICE_CRITICAL";
  if (!device.maintenance_window) return "MAINTENANCE_WINDOW_REQUIRED";
  return null;
}

function impactSummary(device) {
  return {
    devices: [device.id],
    businesses: [device.business_id].filter(Boolean),
    maintenance_window: device.maintenance_window ?? null,
  };
}

function migrationImpact(device, destination, target, request) {
  return {
    ...impactSummary(device),
    steps: [
      `Precheck ${device.id}`,
      `Move ${device.id} to ${destination.rack_id} U${destination.start_u}`,
      `Place ${request.id} in ${target.rack_id} U${target.start_u}`,
      "Verify power, network, and service health",
    ],
    rollback_actions: [{
      type: "move_device",
      device_id: device.id,
      rack_id: device.rack_id,
      layer_id: device.layer_id,
      start_u: device.start_u,
    }],
  };
}

export function generateMigrationCandidates(state, request, options = {}) {
  const validator = options.validator ?? evaluateActions;
  const maxCandidates = Math.max(1, Math.min(64, Number(options.maxCandidates) || 32));
  const candidates = [];
  const assessments = [];
  if (Number(request.count ?? 1) !== 1) return { candidates, assessments };

  const serverRacks = state.racks.filter((rack) => rack.role === "server");
  const devices = state.devices
    .filter((device) => device.status !== "cancelled")
    .sort((left, right) => left.rack_id.localeCompare(right.rack_id)
      || Number(left.start_u) - Number(right.start_u)
      || left.id.localeCompare(right.id));

  for (const device of devices) {
    const targetRack = serverRacks.find((rack) => rack.id === device.rack_id);
    if (!targetRack) continue;
    const withoutDevice = structuredClone(state);
    withoutDevice.devices = withoutDevice.devices.filter((item) => item.id !== device.id);
    const targets = intervalsFor(withoutDevice, targetRack, Number(request.u_size));
    if (targets.length === 0) continue;

    const reasonCode = eligibilityReason(device);
    if (reasonCode) {
      assessments.push({
        device_id: device.id,
        reason_code: reasonCode,
        impact: impactSummary(device),
      });
      continue;
    }

    let foundDestination = false;
    for (const destinationRack of serverRacks.filter((rack) => rack.id !== device.rack_id)) {
      for (const destination of intervalsFor(state, destinationRack, Number(device.u_size))) {
        foundDestination = true;
        const moveAction = {
          type: "move_device",
          device_id: device.id,
          rack_id: destination.rack_id,
          layer_id: destination.layer_id,
          start_u: destination.start_u,
        };
        let movedState;
        try {
          movedState = applyActions(state, [moveAction]);
        } catch {
          continue;
        }
        const target = intervalsFor(movedState, targetRack, Number(request.u_size))[0];
        if (!target) continue;
        const placeAction = {
          type: "place_device",
          rack_id: target.rack_id,
          layer_id: target.layer_id,
          start_u: target.start_u,
          device: requestDevice(request, target.start_u),
        };
        const actions = [moveAction, placeAction];
        const validation = validator(state, actions);
        if (!validation.allowed) continue;
        candidates.push({
          id: `MIGRATE-${device.id}-${destination.rack_id}-${destination.layer_id}-${destination.start_u}`,
          rack_id: target.rack_id,
          layer_id: target.layer_id,
          actions,
          validation,
          risk: "warning",
          impact: migrationImpact(device, destination, target, request),
        });
        if (candidates.length >= maxCandidates) return { candidates, assessments };
      }
    }
    if (!foundDestination) {
      assessments.push({
        device_id: device.id,
        reason_code: "NO_MIGRATION_DESTINATION",
        impact: impactSummary(device),
      });
    }
  }
  return { candidates, assessments };
}

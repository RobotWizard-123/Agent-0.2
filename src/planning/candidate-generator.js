import { applyActions, evaluateActions } from "../domain/constraint-engine.js";
import { freeIntervals } from "../domain/rack-layout.js";

function deviceFor(request, index, startU) {
  const suffix = request.count > 1 ? `-${index + 1}` : "";
  return {
    ...structuredClone(request),
    id: `${request.id}${suffix}`,
    count: undefined,
    preferred_rack_ids: undefined,
    start_u: startU,
    status: "pending",
    data_source: "demo",
  };
}

function availableIntervals(state, request) {
  return state.racks
    .filter((rack) => rack.role === "server")
    .flatMap((rack) => {
      try {
        return freeIntervals(
          rack,
          state.devices.filter((device) => device.rack_id === rack.id && device.status !== "cancelled"),
        );
      } catch {
        return [];
      }
    })
    .filter((interval) => interval.size_u >= request.u_size)
    .filter((interval) => request.u_size !== 10 || interval.layer_id === "L01")
    .sort((left, right) => left.rack_id.localeCompare(right.rack_id)
      || left.layer_id.localeCompare(right.layer_id)
      || left.start_u - right.start_u);
}

function replicaDomainAvailable(state, request, actions, rackId) {
  if (!request.replica_group) return true;
  const rack = state.racks.find((item) => item.id === rackId);
  const priorRacks = actions
    .filter((action) => action.type === "place_device")
    .map((action) => state.racks.find((item) => item.id === action.rack_id))
    .filter(Boolean);
  return priorRacks.every((prior) => prior.source_id !== rack.source_id
    && prior.network_switch_id !== rack.network_switch_id);
}

function actionKey(actions) {
  return actions.map((action) => {
    if (action.type === "set_dividers") return `0-${action.rack_id}-${action.dividers_u.join("-")}`;
    return `1-${action.rack_id}-${action.layer_id}-${String(action.start_u).padStart(2, "0")}`;
  }).join("--");
}

function boundedAllowedExpansions(baseState, expansions, maxBeams, validator) {
  const rackCount = Math.max(1, baseState.racks.filter((rack) => rack.role === "server").length);
  const perFirstRack = Math.max(1, Math.floor(maxBeams / rackCount));
  const counts = new Map();
  const accepted = [];

  for (const expansion of expansions.sort((left, right) => actionKey(left.actions).localeCompare(actionKey(right.actions)))) {
    const firstRack = expansion.actions.find((action) => action.type === "place_device")?.rack_id ?? "none";
    if ((counts.get(firstRack) ?? 0) >= perFirstRack) continue;
    const validation = validator(baseState, expansion.actions);
    if (!validation.allowed) continue;
    accepted.push({ ...expansion, validation });
    counts.set(firstRack, (counts.get(firstRack) ?? 0) + 1);
    if (accepted.length >= maxBeams) break;
  }
  return accepted;
}

function expandPlacementBeams(baseState, request, { maxBeams, validator, initialBeam }) {
  let beams = [initialBeam ?? { actions: [], projected: structuredClone(baseState), validation: null }];

  for (let index = 0; index < request.count; index += 1) {
    const expansions = [];
    for (const beam of beams) {
      for (const interval of availableIntervals(beam.projected, request)) {
        if (!replicaDomainAvailable(baseState, request, beam.actions, interval.rack_id)) continue;
        const device = deviceFor(request, index, interval.start_u);
        const action = {
          type: "place_device",
          rack_id: interval.rack_id,
          layer_id: interval.layer_id,
          start_u: interval.start_u,
          device,
        };
        expansions.push({
          actions: [...beam.actions, action],
          projected: applyActions(beam.projected, [action]),
        });
      }
    }
    beams = boundedAllowedExpansions(baseState, expansions, maxBeams, validator);
    if (beams.length === 0) break;
  }
  return beams;
}

function dividerLayoutFor(layerId, requiredCapacityU) {
  if (layerId === "L01" || requiredCapacityU <= 10 || requiredCapacityU > 26) return null;
  const targetIndex = Number(layerId.slice(-1)) - 2;
  const sizes = [0, 0, 0];
  sizes[targetIndex] = requiredCapacityU;
  const remaining = 30 - requiredCapacityU;
  const otherIndexes = [0, 1, 2].filter((index) => index !== targetIndex);
  sizes[otherIndexes[0]] = Math.floor(remaining / 2);
  sizes[otherIndexes[1]] = Math.ceil(remaining / 2);
  if (sizes.some((size) => size < 2)) return null;
  return [12, 12 + sizes[0], 12 + sizes[0] + sizes[1]];
}

function toCandidate(beam) {
  const placements = beam.actions.filter((action) => action.type === "place_device");
  const divider = beam.actions.find((action) => action.type === "set_dividers");
  const prefix = divider ? `DIVIDER-${divider.rack_id}-${divider.dividers_u.join("-")}` : "DIRECT";
  return {
    id: `${prefix}-${actionKey(placements)}`,
    rack_id: placements[0]?.rack_id ?? divider?.rack_id,
    layer_id: placements[0]?.layer_id ?? null,
    actions: beam.actions,
    validation: beam.validation,
  };
}

export function generatePlacementCandidates(state, request, { maxBeams = 64, validator = evaluateActions } = {}) {
  const beamLimit = Math.max(1, Math.min(256, Number(maxBeams) || 64));
  const direct = expandPlacementBeams(state, request, { maxBeams: beamLimit, validator });
  if (direct.length > 0) return direct.map(toCandidate);
  if (request.u_size === 10) return [];

  const dividerBeams = [];
  for (const rack of state.racks.filter((item) => item.role === "server")) {
    for (const layerId of ["L02", "L03", "L04"]) {
      const dividersU = dividerLayoutFor(layerId, request.u_size + 2);
      if (!dividersU || dividersU.every((value, index) => value === rack.dividers_u[index])) continue;
      const dividerAction = { type: "set_dividers", rack_id: rack.id, dividers_u: dividersU };
      const dividerValidation = validator(state, [dividerAction]);
      if (!dividerValidation.allowed) continue;
      const projected = applyActions(state, [dividerAction]);
      const beams = expandPlacementBeams(state, request, {
        maxBeams: beamLimit,
        validator,
        initialBeam: { actions: [dividerAction], projected, validation: dividerValidation },
      }).filter((beam) => beam.actions.some((action) => action.type === "place_device"
        && action.rack_id === rack.id && action.layer_id === layerId));
      dividerBeams.push(...beams);
      if (dividerBeams.length >= beamLimit) break;
    }
    if (dividerBeams.length >= beamLimit) break;
  }

  return dividerBeams
    .sort((left, right) => actionKey(left.actions).localeCompare(actionKey(right.actions)))
    .slice(0, beamLimit)
    .map(toCandidate);
}

import { createDemoState } from "./demo-state.js";
import { createPlanningEngine } from "./planning/planning-engine.js";

function canonicalLayerId(layerId) {
  const match = typeof layerId === "string" ? layerId.match(/(L0[1-4])$/) : null;
  return match ? match[1] : layerId;
}

function canonicalState(data) {
  if (Array.isArray(data?.racks)) return structuredClone(data);

  const state = createDemoState();
  state.devices = (data?.servers ?? []).map((server) => ({
    ...structuredClone(server),
    rack_id: server.rack_id ?? server.cabinet_id,
    layer_id: canonicalLayerId(server.layer_id),
    rated_power_w: Number(server.rated_power_w ?? server.power_w ?? 0),
    real_power_w: server.real_power_w ?? null,
    status: server.status ?? "running",
    data_source: server.data_source ?? "demo",
  }));
  return state;
}

function legacyItem(state, candidate) {
  const rack = state.racks.find((item) => item.id === candidate.rack_id);
  const snapshot = candidate.validation.after[candidate.rack_id];
  return {
    ...candidate,
    cabinet_id: candidate.rack_id,
    cabinet_role: rack?.role ?? "unknown",
    allowed: candidate.validation.allowed,
    remaining_u_after: snapshot ? snapshot.usable_u - snapshot.used_u : 0,
    power_margin_w: snapshot ? snapshot.design_power_w - snapshot.rated_power_used_w : 0,
    weight_margin_kg: snapshot ? snapshot.max_weight_kg - snapshot.used_weight_kg : 0,
    blockers: candidate.validation.blockers,
    warnings: candidate.validation.warnings,
  };
}

export function recommendPlacement(data, rawSpec, options = {}) {
  const state = canonicalState(data);
  const request = {
    ...structuredClone(rawSpec),
    rated_power_w: Number(rawSpec.rated_power_w ?? rawSpec.power_w ?? 0),
    preferred_rack_ids: rawSpec.preferred_rack_ids ?? rawSpec.preferred_cabinet_ids ?? [],
  };
  const result = createPlanningEngine().recommend(state, request, {
    limit: options.limit ?? rawSpec.limit ?? 8,
    strategyId: options.strategyId ?? rawSpec.strategy_id,
    weightMultipliers: options.weightMultipliers,
  });
  const items = result.candidates.map((candidate) => legacyItem(state, candidate));

  return {
    input: result.request,
    ignored_constraints: [],
    unavailable_constraints: ["REAL_POWER_TELEMETRY", "VERIFIED_REDUNDANCY"],
    candidates: result.candidates,
    items,
    strategy_id: result.strategy_id,
    strategy_weights: result.strategy_weights,
    rejection_summary: result.rejection_summary,
    rejected_count: result.rejected_count,
  };
}

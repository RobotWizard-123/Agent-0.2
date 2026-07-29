import {
  DEFAULT_STRATEGY_ID,
  strategyProfile,
  validateWeightMultipliers,
} from "./strategy-profiles.js";

function clampPenalty(value) {
  return Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function distancePenalty(value) {
  const raw = Number(value ?? 0);
  return clampPenalty(raw <= 1 ? raw * 100 : raw);
}

function projectedRatios(candidate) {
  const ratios = candidate.evidence?.projected_ratios ?? {};
  return {
    power: Number(ratios.power ?? 0),
    u: Number(ratios.u ?? 0),
    weight: Number(ratios.weight ?? 0),
    ports: Number(ratios.ports ?? 0),
  };
}

function metricInputs(request, candidate, weights) {
  const evidence = candidate.evidence ?? {};
  const inputs = {};

  if (weights.preferred !== 0) {
    const preferredRackIds = Array.isArray(request?.preferred_rack_ids) ? request.preferred_rack_ids : [];
    const preferredMiss = preferredRackIds.length > 0 && !preferredRackIds.includes(candidate.rack_id);
    inputs.preferred = { raw: preferredMiss ? 1 : 0, normalized: preferredMiss ? 100 : 0 };
  }
  if (weights.business !== 0) {
    inputs.business = { raw: Number(evidence.business_distance ?? 0), normalized: distancePenalty(evidence.business_distance) };
  }
  if (weights.fragmentation !== 0 || weights.growth !== 0) {
    const largestContiguousU = Number(evidence.largest_contiguous_u_after ?? 0);
    if (weights.fragmentation !== 0) {
      inputs.fragmentation = { raw: largestContiguousU, normalized: clampPenalty(largestContiguousU * 10) };
    }
    if (weights.growth !== 0) {
      inputs.growth = { raw: largestContiguousU, normalized: clampPenalty(100 - largestContiguousU * 10) };
    }
  }
  if (weights.link !== 0) {
    inputs.link = { raw: Number(evidence.link_distance ?? 0), normalized: distancePenalty(evidence.link_distance) };
  }
  if (weights.capacity !== 0) {
    const ratios = projectedRatios(candidate);
    const capacityRatio = Math.max(...Object.values(ratios));
    inputs.capacity = { raw: capacityRatio, normalized: clampPenalty(capacityRatio * 100) };
  }
  if (weights.activation !== 0) {
    inputs.activation = { raw: evidence.activated_empty_rack ? 1 : 0, normalized: evidence.activated_empty_rack ? 100 : 0 };
  }
  if (weights.source_imbalance !== 0) {
    inputs.source_imbalance = { raw: Number(evidence.source_imbalance ?? 0), normalized: distancePenalty(evidence.source_imbalance) };
  }
  if (weights.migration !== 0) {
    inputs.migration = { raw: Number(evidence.migration_count ?? 0), normalized: Number(evidence.migration_count ?? 0) > 0 ? 100 : 0 };
  }

  return inputs;
}

export function scoreCandidate(state, request, candidate, options = {}) {
  void state;
  const strategyId = options.strategyId ?? DEFAULT_STRATEGY_ID;
  const profile = strategyProfile(strategyId);
  const multipliers = validateWeightMultipliers(options.weightMultipliers ?? {});
  const weights = Object.fromEntries(Object.entries(profile.weights).map(([metric, weight]) => [
    metric,
    weight * (multipliers[metric] ?? 1),
  ]));
  const ratios = projectedRatios(candidate);

  if (candidate.validation?.allowed === false) {
    return { eligible: false, reason_code: "HARD_CONSTRAINT_BLOCKED", score: null, breakdown: {}, weights };
  }
  if (strategyId === "consolidated" && Object.values(ratios).some((ratio) => ratio >= 0.8)) {
    return { eligible: false, reason_code: "CONSOLIDATED_WARNING_LINE", score: null, breakdown: {}, weights };
  }

  const inputs = metricInputs(request, candidate, weights);
  const breakdown = Object.fromEntries(Object.entries(weights).map(([metric, weight]) => {
    const input = inputs[metric] ?? { raw: 0, normalized: 0 };
    return [metric, {
      raw: input.raw,
      normalized: input.normalized,
      weight,
      contribution: input.normalized * weight,
    }];
  }));
  const weightTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const contributionTotal = Object.values(breakdown).reduce((sum, item) => sum + item.contribution, 0);

  return {
    eligible: true,
    score: Number((contributionTotal / weightTotal).toFixed(4)),
    breakdown,
    weights,
  };
}

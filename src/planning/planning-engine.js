import { evaluateActions } from "../domain/constraint-engine.js";
import { generatePlacementCandidates } from "./candidate-generator.js";
import { generateMigrationCandidates } from "./migration-planner.js";
import { scoreCandidate } from "./strategy-scorer.js";
import { DEFAULT_STRATEGY_ID, strategyProfile, validateWeightMultipliers } from "./strategy-profiles.js";

function normalizeRequest(request = {}) {
  return {
    ...structuredClone(request),
    id: request.id || "SRV-RECOMMEND",
    count: Math.max(1, Number(request.count || 1)),
    u_size: Number(request.u_size || 0),
    rated_power_w: Number(request.rated_power_w ?? request.power_w ?? 0),
    real_power_w: request.real_power_w ?? null,
    weight_kg: Number(request.weight_kg || 0),
    network_ports: Number(request.network_ports || 0),
    business_id: request.business_id ?? request.business ?? null,
    replica_group: request.replica_group ?? null,
    preferred_rack_ids: Array.isArray(request.preferred_rack_ids) ? request.preferred_rack_ids : [],
  };
}

function uniquePlacementRacks(actions) {
  return [...new Set(actions.filter((action) => action.type === "place_device").map((action) => action.rack_id))];
}

function sourceImbalance(state, projectedDevices) {
  const sources = new Map();
  for (const rack of state.racks.filter((item) => item.role === "server")) {
    const current = sources.get(rack.source_id) ?? { used: 0, capacity: 0 };
    current.capacity += Number(rack.design_power_w);
    current.used += projectedDevices
      .filter((device) => device.rack_id === rack.id && device.status !== "cancelled")
      .reduce((sum, device) => sum + Number(device.rated_power_w ?? 0), 0);
    sources.set(rack.source_id, current);
  }
  const ratios = [...sources.values()].map((source) => source.capacity > 0 ? source.used / source.capacity : 0);
  return ratios.length > 0 ? Math.max(...ratios) - Math.min(...ratios) : 0;
}

function candidateEvidence(state, request, candidate, options = {}) {
  const rackIds = uniquePlacementRacks(candidate.actions);
  const snapshots = rackIds.map((rackId) => candidate.validation.after[rackId]).filter((item) => item && !item.invalid);
  const ratio = (usedKey, capacityKey) => snapshots.length > 0
    ? Math.max(...snapshots.map((snapshot) => Number(snapshot[capacityKey]) > 0
      ? Number(snapshot[usedKey]) / Number(snapshot[capacityKey])
      : 0))
    : 1;
  const skipBusiness = options.skipBusiness ?? false;
  const existingBusinessRacks = skipBusiness ? new Set() : new Set(state.devices
    .filter((device) => request.business_id && device.business_id === request.business_id && device.status !== "cancelled")
    .map((device) => device.rack_id));
  const existingBusinessSwitches = skipBusiness ? new Set() : new Set(state.racks
    .filter((rack) => existingBusinessRacks.has(rack.id))
    .map((rack) => rack.network_switch_id));
  const businessMisses = !skipBusiness && request.business_id && existingBusinessRacks.size > 0
    ? rackIds.filter((rackId) => !existingBusinessRacks.has(rackId)).length / Math.max(1, rackIds.length)
    : 0;
  const linkMisses = !skipBusiness && request.business_id && existingBusinessSwitches.size > 0
    ? rackIds.filter((rackId) => {
      const rack = state.racks.find((item) => item.id === rackId);
      return !existingBusinessSwitches.has(rack?.network_switch_id);
    }).length / Math.max(1, rackIds.length)
    : 0;

  return {
    projected_ratios: {
      power: ratio("rated_power_used_w", "design_power_w"),
      u: ratio("used_u", "usable_u"),
      weight: ratio("used_weight_kg", "max_weight_kg"),
      ports: ratio("used_ports", "port_limit"),
    },
    largest_contiguous_u_after: snapshots.length > 0
      ? Math.min(...snapshots.map((snapshot) => Number(snapshot.largest_contiguous_u ?? 0)))
      : 0,
    activated_empty_rack: rackIds.some((rackId) => !state.devices.some((device) => device.rack_id === rackId && device.status !== "cancelled")),
    business_distance: businessMisses,
    link_distance: linkMisses,
    source_imbalance: options.skipSourceImbalance ? 0 : sourceImbalance(state, candidate.validation.projected_devices ?? state.devices),
    migration_count: candidate.actions.filter((action) => action.type === "move_device").length,
  };
}

function candidateReasons(request, candidate) {
  const hasDivider = candidate.actions.some((action) => action.type === "set_dividers");
  const hasMigration = candidate.actions.some((action) => action.type === "move_device");
  const reasons = [
    `输入参数：${request.u_size}U / ${request.rated_power_w}W / ${request.weight_kg}KG / ${request.network_ports}端口 × ${request.count}`,
    `使用 ${candidate.rack_id} ${candidate.layer_id} 的真实连续空闲 U 位`,
  ];
  if (request.preferred_rack_ids.includes(candidate.rack_id)) reasons.push(`命中优选机柜 ${candidate.rack_id}`);
  if (hasDivider) reasons.push("调整可移动隔板后重新验证现有固定设备与预留区");
  if (hasMigration) reasons.push("容量紧张，需要跨机柜迁移一台符合维护条件的设备");
  return reasons;
}

export function scorePlanningCandidate(state, request, candidate, { strategyId = DEFAULT_STRATEGY_ID, weightMultipliers = {} } = {}) {
  const profile = strategyProfile(strategyId);
  const multipliers = validateWeightMultipliers(weightMultipliers);
  const effectiveWeights = Object.fromEntries(Object.entries(profile.weights).map(([metric, weight]) => [
    metric, weight * (multipliers[metric] ?? 1),
  ]));
  const evidence = candidateEvidence(state, request, candidate, {
    skipSourceImbalance: effectiveWeights.source_imbalance === 0,
    skipBusiness: effectiveWeights.business === 0 && effectiveWeights.link === 0,
  });
  const scored = scoreCandidate(state, request, { ...candidate, evidence }, { strategyId, weightMultipliers });
  return {
    ...candidate,
    evidence,
    eligible: scored.eligible,
    reason_code: scored.reason_code,
    score: scored.score,
    baseline_score: candidate.baseline_score ?? scored.score,
    score_breakdown: scored.breakdown,
    weights: scored.weights,
    risk: candidate.actions.some((action) => action.type === "move_device") || candidate.validation.warnings.length > 0 ? "warning" : "safe",
    reasons: candidate.reasons ?? candidateReasons(request, candidate),
  };
}

function scoreCandidates(state, request, candidates, options) {
  return candidates.map((candidate) => scorePlanningCandidate(state, request, candidate, options));
}

export function createPlanningEngine({ validator = evaluateActions } = {}) {
  return {
    recommend(state, rawRequest, options = {}) {
      const request = normalizeRequest(rawRequest);
      const strategyId = options.strategyId ?? DEFAULT_STRATEGY_ID;
      const limit = Math.max(1, Number(options.limit) || 8);
      strategyProfile(strategyId);

      if (!Number.isInteger(request.u_size) || request.u_size <= 0 || request.u_size > 10) {
        return {
          request,
          strategy_id: strategyId,
          strategy_weights: strategyProfile(strategyId).weights,
          candidates: [],
          rejected_count: 1,
          rejection_summary: [{ code: "DEVICE_U_UNSUPPORTED", count: 1 }],
          migration_assessments: [],
        };
      }

      const generated = generatePlacementCandidates(state, request, { maxBeams: 64, validator });
      const migration = generated.length > 0
        ? { candidates: [], assessments: [] }
        : generateMigrationCandidates(state, request, { maxCandidates: 32, validator });
      const withMigration = generated.length > 0 ? generated : migration.candidates;
      const scored = scoreCandidates(state, request, withMigration, {
        strategyId,
        weightMultipliers: options.weightMultipliers ?? {},
      });
      const accepted = scored
        .filter((candidate) => candidate.eligible)
        .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
      const rejectionSummary = accepted.length === 0
        ? [{ code: withMigration.length > 0 ? "STRATEGY_INELIGIBLE" : "NO_CONTIGUOUS_INTERVAL", count: Math.max(1, withMigration.length) }]
        : [];

      return {
        request,
        strategy_id: strategyId,
        strategy_weights: accepted[0]?.weights ?? strategyProfile(strategyId).weights,
        candidates: accepted.slice(0, limit),
        rejected_count: scored.length - accepted.length + (scored.length === 0 ? 1 : 0),
        rejection_summary: rejectionSummary,
        migration_assessments: migration.assessments,
      };
    },
  };
}

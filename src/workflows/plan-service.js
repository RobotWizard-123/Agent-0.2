import { randomUUID } from "node:crypto";
import { evaluateActions } from "../domain/constraint-engine.js";
import { scorePlanningCandidate } from "../planning/planning-engine.js";
import { extractDeviceFromText } from "../agent/rule-extractor.js";
import { validateDeviceRequest } from "../agent/agent-schema.js";

const transitions = {
  draft: ["planned"],
  planned: ["validated"],
  validated: ["awaiting_confirmation"],
  awaiting_confirmation: ["locked"],
  locked: ["executing"],
  executing: ["succeeded", "failed"],
};

function workflowError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function transition(plan, next, now) {
  if (!transitions[plan.status]?.includes(next)) {
    throw workflowError("PLAN_TRANSITION_INVALID", `Cannot move plan ${plan.id} from ${plan.status} to ${next}`);
  }
  plan.status = next;
  plan.timeline.push({ status: next, at: now() });
}

function clone(value) {
  return structuredClone(value);
}

function selectedCandidate(planning, candidateId) {
  if (!candidateId) return planning.candidates[0] ?? null;
  return planning.candidates.find((candidate) => candidate.id === candidateId) ?? null;
}

const immutableDeviceFields = [
  "id", "u_size", "rated_power_w", "real_power_w", "weight_kg", "network_ports", "business_id", "replica_group",
];

function expectedPlacedDevices(requestDevice) {
  const count = Math.max(1, Number(requestDevice.count || 1));
  return Array.from({ length: count }, (_, index) => ({
    ...requestDevice,
    id: count > 1 ? `${requestDevice.id}-${index + 1}` : requestDevice.id,
  }));
}

function preservesFacts(actions, requestDevice) {
  const expected = expectedPlacedDevices(requestDevice);
  const placements = actions.filter((action) => action.type === "place_device");
  if (placements.length !== expected.length) return false;

  return expected.every((device) => {
    const placement = placements.find((action) => action.device?.id === device.id);
    return placement && immutableDeviceFields.every((field) => {
      if (field === "real_power_w") return (placement.device[field] ?? null) === (device[field] ?? null);
      if (["u_size", "rated_power_w", "weight_kg", "network_ports"].includes(field)) {
        return Number(placement.device[field]) === Number(device[field]);
      }
      return placement.device[field] === device[field];
    });
  });
}

function agentContext(requestDevice, planning) {
  return {
    request: clone(requestDevice),
    strategy_id: planning.strategy_id,
    strategy_weights: clone(planning.strategy_weights),
    candidates: planning.candidates.map((candidate) => ({
      id: candidate.id,
      rack_id: candidate.rack_id,
      layer_id: candidate.layer_id,
      risk: candidate.risk,
      reasons: clone(candidate.reasons),
      actions: clone(candidate.actions),
      warnings: clone(candidate.validation.warnings),
      score: candidate.score,
      score_breakdown: clone(candidate.score_breakdown),
    })),
  };
}

function actionEntityIssue(state, actions) {
  for (const action of actions) {
    if (!["place_device", "move_device", "set_dividers"].includes(action.type)) return "AGENT_RESPONSE_INVALID";
    if (!state.racks.some((rack) => rack.id === action.rack_id)) return "AGENT_ENTITY_UNKNOWN";
    if (action.type === "move_device" && !state.devices.some((device) => device.id === action.device_id)) return "AGENT_ENTITY_UNKNOWN";
  }
  return null;
}

function migrationImpact(state, actions, requestDevice) {
  const moves = actions.filter((action) => action.type === "move_device");
  if (moves.length === 0) return null;
  const originals = moves.map((move) => state.devices.find((device) => device.id === move.device_id)).filter(Boolean);
  const placement = actions.find((action) => action.type === "place_device");
  return {
    devices: originals.map((device) => device.id),
    businesses: [...new Set(originals.map((device) => device.business_id).filter(Boolean))],
    maintenance_window: originals.map((device) => device.maintenance_window).filter(Boolean).join("; ") || null,
    steps: [
      ...moves.map((move) => `Move ${move.device_id} to ${move.rack_id} U${move.start_u}`),
      ...(placement ? [`Place ${requestDevice.id} in ${placement.rack_id} U${placement.start_u}`] : []),
      "Verify power, network, and service health",
    ],
    rollback_actions: originals.map((device) => ({
      type: "move_device",
      device_id: device.id,
      rack_id: device.rack_id,
      layer_id: device.layer_id,
      start_u: device.start_u,
    })),
  };
}

function interventionBase(agentGateway, status) {
  let model = null;
  try {
    model = agentGateway?.describe?.().model ?? null;
  } catch {
    model = null;
  }
  return { status, model };
}

async function applyBoundedAgentIntervention({ state, requestDevice, planning, strategyId, agentGateway }) {
  const original = planning.candidates[0] ?? null;
  if (!original || typeof agentGateway?.adjustPlan !== "function") {
    const status = agentGateway ? "available" : "not_configured";
    return {
      chosen: original,
      agent_status: status,
      agent_adjustment: null,
      agent_intervention: {
        ...interventionBase(agentGateway, status),
        baseline_candidate_id: original?.id ?? null,
        final_candidate_id: original?.id ?? null,
        requested_candidate_id: null,
        weight_multipliers: {},
        accepted_alternatives: [],
        rejected_alternatives: [],
      },
    };
  }

  let adjustment;
  try {
    adjustment = await agentGateway.adjustPlan(agentContext(requestDevice, planning));
  } catch (error) {
    return {
      chosen: original,
      agent_status: "degraded",
      agent_adjustment: { accepted: false, reason_code: error.code ?? "AGENT_UNAVAILABLE", reason: error.message },
      agent_intervention: {
        ...interventionBase(agentGateway, "degraded"),
        baseline_candidate_id: original.id,
        final_candidate_id: original.id,
        requested_candidate_id: null,
        weight_multipliers: {},
        accepted_alternatives: [],
        rejected_alternatives: [],
        reason_code: error.code ?? "AGENT_UNAVAILABLE",
      },
    };
  }

  const multipliers = adjustment.weight_multipliers ?? {};
  const rescored = planning.candidates
    .map((candidate) => scorePlanningCandidate(state, planning.request, candidate, {
      strategyId,
      weightMultipliers: multipliers,
    }))
    .filter((candidate) => candidate.eligible);
  const requestedKnown = adjustment.candidate_id === null || adjustment.candidate_id === undefined
    || planning.candidates.some((candidate) => candidate.id === adjustment.candidate_id);
  const rejectedAlternatives = [];
  if (!requestedKnown) rejectedAlternatives.push({ id: adjustment.candidate_id, reason_code: "AGENT_ENTITY_UNKNOWN" });
  const acceptedAlternatives = [];

  for (const alternative of adjustment.alternatives ?? []) {
    const actions = alternative.actions ?? [];
    const entityIssue = actionEntityIssue(state, actions);
    if (entityIssue) {
      rejectedAlternatives.push({ id: alternative.id, reason_code: entityIssue });
      continue;
    }
    if (!preservesFacts(actions, requestDevice)) {
      rejectedAlternatives.push({ id: alternative.id, reason_code: "AGENT_FACT_MUTATION" });
      continue;
    }
    const validation = evaluateActions(state, actions);
    if (!validation.allowed) {
      rejectedAlternatives.push({
        id: alternative.id,
        reason_code: "AGENT_HARD_CONSTRAINT_BLOCKED",
        blockers: clone(validation.blockers),
      });
      continue;
    }
    const placement = actions.find((action) => action.type === "place_device");
    const candidate = scorePlanningCandidate(state, planning.request, {
      id: alternative.id,
      rack_id: placement?.rack_id ?? actions.find((action) => action.rack_id)?.rack_id ?? null,
      layer_id: placement?.layer_id ?? actions.find((action) => action.layer_id)?.layer_id ?? null,
      actions: clone(actions),
      validation,
      reasons: [`Agent 调整：${alternative.reason}`],
      impact: migrationImpact(state, actions, requestDevice),
    }, { strategyId, weightMultipliers: multipliers });
    if (!candidate.eligible) {
      rejectedAlternatives.push({ id: alternative.id, reason_code: "AGENT_HARD_CONSTRAINT_BLOCKED" });
      continue;
    }
    acceptedAlternatives.push(candidate);
  }

  const chosen = [...rescored, ...acceptedAlternatives]
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id))[0] ?? original;
  const accepted = requestedKnown
    && (Object.keys(multipliers).length > 0 || acceptedAlternatives.length > 0 || Boolean(adjustment.candidate_id));
  const firstRejection = rejectedAlternatives[0] ?? null;
  return {
    chosen,
    agent_status: "healthy",
    agent_adjustment: {
      accepted,
      reason_code: accepted ? null : firstRejection?.reason_code ?? null,
      reason: adjustment.reason,
      proposed_actions: acceptedAlternatives[0] ? clone(acceptedAlternatives[0].actions) : undefined,
    },
    agent_intervention: {
      ...interventionBase(agentGateway, "healthy"),
      reason: adjustment.reason,
      baseline_candidate_id: original.id,
      final_candidate_id: chosen.id,
      requested_candidate_id: adjustment.candidate_id ?? null,
      weight_multipliers: clone(multipliers),
      accepted_alternatives: acceptedAlternatives.map((candidate) => ({ id: candidate.id, score: candidate.score })),
      rejected_alternatives: rejectedAlternatives,
    },
  };
}

function blockedValidation(message) {
  return {
    allowed: false,
    blockers: [{
      code: "NO_VALID_PLAN",
      target_id: "request",
      message,
      severity: "blocker",
      evidence: {},
    }],
    warnings: [],
    before: {},
    after: {},
  };
}

function canonicalizeRemovalRequest(state, request) {
  if (request.kind !== "removal" || !Array.isArray(request.actions)) return request;
  return {
    ...request,
    actions: request.actions.map((action) => {
      if (action.type !== "remove_device") return action;
      const device = state.devices.find((item) => item.id === action.device_id);
      return device ? { ...action, device: clone(device) } : action;
    }),
  };
}

function replaceInventory(draft, executedState) {
  draft.racks = clone(executedState.racks);
  draft.devices = clone(executedState.devices);
  draft.power_connections = clone(executedState.power_connections);
  draft.network_connections = clone(executedState.network_connections);
  draft.demo_conditions = clone(executedState.demo_conditions);
  draft.service_health = clone(executedState.service_health);
}

export function createPlanService({
  repository,
  planner,
  executor,
  agentGateway = null,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
}) {
  async function create(request, actor) {
    let effectiveRequest = clone(request);
    let extractionStatus = null;
    if (request.kind === "natural_language") {
      if (typeof agentGateway?.extractRequest !== "function") {
        // No agent at all — try the rule-based extractor first; only if it
        // cannot pull the required facts do we ask the user to fill the form.
        const rule = extractDeviceFromText(request.text);
        if (rule.device && rule.missing.length === 0) {
          effectiveRequest = { kind: "placement", device: validateDeviceRequest(rule.device), natural_language: request.text, strategy_id: request.strategy_id };
          extractionStatus = "rule_fallback";
        } else {
          return {
            status: "input_required",
            fallback: "structured_form",
            agent_status: "not_configured",
            error_code: "AGENT_NOT_CONFIGURED",
            missing_fields: rule.missing,
          };
        }
      } else {
        try {
          const device = await agentGateway.extractRequest(request.text);
          effectiveRequest = { kind: "placement", device, natural_language: request.text, strategy_id: request.strategy_id };
          extractionStatus = "healthy";
        } catch (error) {
          // Model failed (unreachable / bad response) — try the rule-based
          // extractor before forcing the user to fill a structured form.
          const rule = extractDeviceFromText(request.text);
          if (rule.device && rule.missing.length === 0) {
            effectiveRequest = { kind: "placement", device: validateDeviceRequest(rule.device), natural_language: request.text, strategy_id: request.strategy_id };
            extractionStatus = "rule_fallback";
          } else {
            return {
              status: "input_required",
              fallback: "structured_form",
              agent_status: "degraded",
              error_code: error.code ?? "AGENT_UNAVAILABLE",
              missing_fields: rule.missing,
            };
          }
        }
      }
    }

    const state = repository.read();
    effectiveRequest = canonicalizeRemovalRequest(state, effectiveRequest);
    const strategyId = effectiveRequest.kind === "placement"
      ? effectiveRequest.strategy_id ?? state.settings?.placement?.default_strategy_id ?? "balanced_optimal"
      : null;
    let planning;
    if (effectiveRequest.kind === "placement") {
      planning = planner.recommend(state, effectiveRequest.device ?? {}, {
        limit: effectiveRequest.limit ?? 8,
        strategyId,
      });
    } else if (["alarm_remediation", "change", "removal"].includes(effectiveRequest.kind) && Array.isArray(effectiveRequest.actions)) {
      const validation = evaluateActions(state, effectiveRequest.actions);
      planning = {
        request: effectiveRequest,
        candidates: [{
          id: `${effectiveRequest.kind.toUpperCase()}-ACTIONS`,
          rack_id: effectiveRequest.actions.find((action) => action.rack_id)?.rack_id ?? null,
          layer_id: effectiveRequest.actions.find((action) => action.layer_id)?.layer_id ?? null,
          score: 0,
          risk: effectiveRequest.risk ?? (validation.warnings.length ? "warning" : "safe"),
          reasons: clone(effectiveRequest.reasons ?? []),
          actions: clone(effectiveRequest.actions),
          validation,
        }],
        rejected_count: validation.allowed ? 0 : 1,
      };
    } else {
      planning = { request: effectiveRequest, candidates: [], rejected_count: 1 };
    }
    const preferred = selectedCandidate(planning, effectiveRequest.candidate_id);
    if (preferred && effectiveRequest.candidate_id) {
      planning.candidates = [preferred, ...planning.candidates.filter((candidate) => candidate.id !== preferred.id)];
    }
    const agentResult = effectiveRequest.kind === "placement"
      ? await applyBoundedAgentIntervention({
        state,
        requestDevice: effectiveRequest.device ?? {},
        planning,
        strategyId,
        agentGateway,
      })
      : {
        chosen: planning.candidates[0] ?? null,
        agent_status: "not_used",
        agent_adjustment: null,
        agent_intervention: { status: "not_used", model: null, accepted_alternatives: [], rejected_alternatives: [] },
      };
    const chosen = agentResult.chosen;
    const createdAt = now();
    const plan = {
      id: `PLAN-${idFactory()}`,
      kind: effectiveRequest.kind,
      request: clone(effectiveRequest),
      status: "draft",
      timeline: [{ status: "draft", at: createdAt }],
      created_at: createdAt,
      created_by: actor,
      base_version: state.version + 1,
      snapshot_version: state.version + 1,
      strategy_id: strategyId,
      baseline_candidate_id: planning.candidates[0]?.id ?? null,
      original_candidates: clone(planning.candidates),
      selected_candidate_id: chosen?.id ?? null,
      baseline_score: planning.candidates[0]?.score ?? null,
      agent_score: chosen?.score ?? null,
      actions: clone(chosen?.actions ?? []),
      reasons: clone(chosen?.reasons ?? []),
      risk: chosen?.risk ?? "blocked",
      validation: clone(chosen?.validation ?? blockedValidation("No candidate satisfies every hard constraint")),
      confirmation_count: 0,
      confirmed_at: null,
      confirmed_by: null,
      execution: null,
      agent_status: extractionStatus ?? agentResult.agent_status,
      agent_adjustment: clone(agentResult.agent_adjustment),
      agent_intervention: clone(agentResult.agent_intervention),
      migration_impact: clone(chosen?.impact ?? null),
    };

    transition(plan, "planned", now);
    transition(plan, "validated", now);
    if (plan.validation.allowed) transition(plan, "awaiting_confirmation", now);

    const saved = repository.mutate(state.version, (draft) => {
      draft.plans.push(clone(plan));
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "plan",
        entity_id: plan.id,
        action: "plan_created",
        actor,
        at: now(),
        details: {
          status: plan.status,
          kind: plan.kind,
          device_ids: plan.actions.map((action) => action.device_id ?? action.device?.id).filter(Boolean),
          risk: plan.risk,
          strategy_id: plan.strategy_id,
          baseline_candidate_id: plan.baseline_candidate_id,
          final_candidate_id: plan.selected_candidate_id,
          agent_model: plan.agent_intervention?.model ?? null,
          agent_status: plan.agent_intervention?.status ?? plan.agent_status,
          weight_multipliers: clone(plan.agent_intervention?.weight_multipliers ?? {}),
          accepted_alternative_ids: (plan.agent_intervention?.accepted_alternatives ?? []).map((item) => item.id),
          rejected_alternative_ids: (plan.agent_intervention?.rejected_alternatives ?? []).map((item) => item.id),
        },
      });
    });

    return clone(saved.plans.find((item) => item.id === plan.id));
  }

  function get(id) {
    const plan = repository.read().plans.find((item) => item.id === id);
    if (!plan) throw workflowError("PLAN_NOT_FOUND", `Plan does not exist: ${id}`, { plan_id: id });
    return clone(plan);
  }

  function selectCandidate(planId, candidateId, actor) {
    const state = repository.read();
    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) throw workflowError("PLAN_NOT_FOUND", `Plan does not exist: ${planId}`, { plan_id: planId });
    if (["locked", "executing", "succeeded", "failed"].includes(plan.status)) {
      throw workflowError("PLAN_NOT_CONFIRMABLE", `Plan ${planId} has already moved past selection`, {
        plan_id: planId,
        status: plan.status,
      });
    }
    const candidate = (plan.original_candidates ?? []).find((item) => item.id === candidateId);
    if (!candidate) {
      throw workflowError("PLAN_CANDIDATE_UNKNOWN", `Candidate does not belong to plan: ${candidateId}`, {
        plan_id: planId,
        candidate_id: candidateId,
      });
    }
    // Re-run hard-constraint evaluation against the current snapshot so the
    // user can never pick a candidate that would now violate capacity.
    const latestValidation = evaluateActions(state, candidate.actions ?? []);
    const latestAgentScore = (() => {
      const intervention = plan.agent_intervention ?? null;
      if (!intervention || intervention.status !== "healthy") return candidate.score ?? null;
      const multipliers = intervention.weight_multipliers ?? {};
      const rescored = scorePlanningCandidate(state, plan.request, candidate, {
        strategyId: plan.strategy_id,
        weightMultipliers: multipliers,
      });
      return rescored.eligible ? rescored.score : candidate.score ?? null;
    })();
    const updated = repository.mutate(state.version, (draft) => {
      const stored = draft.plans.find((item) => item.id === planId);
      if (!stored) {
        throw workflowError("PLAN_NOT_FOUND", `Plan disappeared during update: ${planId}`, { plan_id: planId });
      }
      stored.selected_candidate_id = candidate.id;
      stored.actions = clone(candidate.actions ?? []);
      stored.reasons = clone(candidate.reasons ?? []);
      stored.risk = candidate.risk ?? stored.risk;
      stored.validation = clone(latestValidation);
      stored.agent_score = latestAgentScore;
      stored.migration_impact = clone(candidate.impact ?? null);
      // Reset confirmation so a freshly-picked candidate needs to be confirmed again.
      stored.confirmation_count = 0;
      stored.confirmed_at = null;
      stored.confirmed_by = null;
      if (latestValidation.allowed && stored.status === "draft") {
        stored.status = "awaiting_confirmation";
        stored.timeline.push({ status: "awaiting_confirmation", at: now() });
      } else if (!latestValidation.allowed && stored.status === "awaiting_confirmation") {
        stored.status = "draft";
        stored.timeline.push({ status: "draft", at: now() });
      }
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "plan",
        entity_id: planId,
        action: "plan_candidate_selected",
        actor,
        at: now(),
        details: {
          candidate_id: candidate.id,
          previous_candidate_id: plan.selected_candidate_id,
          validation_allowed: latestValidation.allowed,
          blockers: latestValidation.blockers ?? [],
        },
      });
    });
    return clone(updated.plans.find((item) => item.id === planId));
  }

  async function confirm(id, actor) {
    const state = repository.read();
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) throw workflowError("PLAN_NOT_FOUND", `Plan does not exist: ${id}`, { plan_id: id });
    if (plan.confirmation_count > 0 || ["locked", "executing", "succeeded", "failed"].includes(plan.status)) {
      throw workflowError("PLAN_ALREADY_CONFIRMED", `Plan ${id} has already used its final confirmation`, { plan_id: id });
    }
    if (plan.status !== "awaiting_confirmation") {
      throw workflowError("PLAN_NOT_CONFIRMABLE", `Plan ${id} is not confirmable`, { plan_id: id, status: plan.status });
    }
    const snapshotVersion = plan.snapshot_version ?? plan.base_version;
    if (state.version !== snapshotVersion) {
      throw workflowError("PLAN_STALE", `Plan ${id} was calculated from an older state`, {
        plan_id: id,
        plan_version: snapshotVersion,
        state_version: state.version,
      });
    }

    const latestValidation = evaluateActions(state, plan.actions);
    if (!latestValidation.allowed) {
      throw workflowError("PLAN_BLOCKED", `Plan ${id} no longer satisfies hard constraints`, {
        plan_id: id,
        blockers: latestValidation.blockers,
      });
    }

    const execution = await executor.execute(state, plan.actions, { failAt: plan.request.fail_at ?? null });
    const confirmedAt = now();
    const changed = repository.mutate(state.version, (draft) => {
      const storedPlan = draft.plans.find((item) => item.id === id);
      storedPlan.confirmation_count = 1;
      storedPlan.confirmed_at = confirmedAt;
      storedPlan.confirmed_by = actor;
      storedPlan.validation = clone(latestValidation);
      transition(storedPlan, "locked", now);
      transition(storedPlan, "executing", now);

      if (execution.ok) {
        replaceInventory(draft, execution.state);
        transition(storedPlan, "succeeded", now);
      } else {
        transition(storedPlan, "failed", now);
        draft.alarms.push({
          id: `ALARM-${idFactory()}`,
          source: "demo",
          severity: "critical",
          object_type: "plan",
          object_id: id,
          trigger_code: execution.code,
          evidence: { stages: execution.stages, rolled_back: execution.rolled_back },
          status: "open",
          opened_at: now(),
          acknowledged_at: null,
          resolved_at: null,
        });
      }

      storedPlan.execution = {
        ok: execution.ok,
        code: execution.code,
        message: execution.message,
        stages: [...execution.stages, "audited"],
        rolled_back: execution.rolled_back,
      };
      draft.changes.push({
        id: `CHANGE-${idFactory()}`,
        plan_id: id,
        status: storedPlan.status,
        actor,
        confirmed_at: confirmedAt,
        actions: clone(storedPlan.actions),
        rolled_back: execution.rolled_back,
      });
      draft.audit.push({
        id: `AUDIT-${idFactory()}`,
        entity_type: "plan",
        entity_id: id,
        action: execution.ok ? "plan_succeeded" : "plan_failed",
        actor,
        at: now(),
        details: {
          kind: storedPlan.kind,
          device_ids: storedPlan.actions.map((action) => action.device_id ?? action.device?.id).filter(Boolean),
          stages: storedPlan.execution.stages,
          rolled_back: execution.rolled_back,
        },
      });
    });

    return {
      plan: clone(changed.plans.find((item) => item.id === id)),
      execution: clone(changed.plans.find((item) => item.id === id).execution),
      state_version: changed.version,
    };
  }

  return { create, get, confirm, selectCandidate };
}

import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { scoreCandidate } from "../src/planning/strategy-scorer.js";
import { validateWeightMultipliers } from "../src/planning/strategy-profiles.js";

function candidate(rackId, overrides = {}) {
  return {
    id: `C-${rackId}`,
    rack_id: rackId,
    actions: [],
    validation: { warnings: [], after: {}, allowed: true },
    evidence: {
      projected_ratios: { power: 0.5, u: 0.5, weight: 0.3, ports: 0.4 },
      largest_contiguous_u_after: 6,
      activated_empty_rack: false,
      business_distance: 0,
      link_distance: 0,
      source_imbalance: 0.2,
      migration_count: 0,
      ...overrides,
    },
  };
}

test("strategies produce different preferences from the same valid candidates", () => {
  const state = createDemoState();
  const dense = candidate("CAB-03", { projected_ratios: { power: 0.72, u: 0.76, weight: 0.5, ports: 0.6 } });
  const empty = candidate("CAB-01", { activated_empty_rack: true, projected_ratios: { power: 0.2, u: 0.2, weight: 0.2, ports: 0.2 } });
  assert.ok(scoreCandidate(state, {}, dense, { strategyId: "consolidated" }).score < scoreCandidate(state, {}, empty, { strategyId: "consolidated" }).score);
  assert.ok(scoreCandidate(state, {}, empty, { strategyId: "load_balanced" }).score < scoreCandidate(state, {}, dense, { strategyId: "load_balanced" }).score);
});

test("consolidated strategy rejects a projection at the warning line", () => {
  const result = scoreCandidate(createDemoState(), {}, candidate("CAB-03", {
    projected_ratios: { power: 0.8, u: 0.6, weight: 0.4, ports: 0.4 },
  }), { strategyId: "consolidated" });
  assert.equal(result.eligible, false);
  assert.equal(result.reason_code, "CONSOLIDATED_WARNING_LINE");
});

test("Agent weight multipliers stay between one half and two", () => {
  assert.deepEqual(validateWeightMultipliers({ fragmentation: 1.5 }), { fragmentation: 1.5 });
  assert.throws(() => validateWeightMultipliers({ fragmentation: 2.1 }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validateWeightMultipliers({ hard_power_limit: 0.5 }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});

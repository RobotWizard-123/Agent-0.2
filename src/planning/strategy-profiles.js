export const STRATEGY_IDS = Object.freeze(["balanced_optimal", "consolidated", "load_balanced"]);
export const DEFAULT_STRATEGY_ID = "balanced_optimal";
export const ADJUSTABLE_METRICS = Object.freeze([
  "preferred",
  "business",
  "fragmentation",
  "link",
  "capacity",
  "growth",
  "activation",
  "source_imbalance",
  "migration",
]);

const PROFILES = Object.freeze({
  balanced_optimal: Object.freeze({ preferred: 25, business: 20, fragmentation: 15, link: 10, capacity: 15, growth: 5, activation: 0, source_imbalance: 0, migration: 10 }),
  consolidated: Object.freeze({ preferred: 15, business: 5, fragmentation: 15, link: 0, capacity: 10, growth: 0, activation: 30, source_imbalance: 0, migration: 10 }),
  load_balanced: Object.freeze({ preferred: 10, business: 5, fragmentation: 10, link: 5, capacity: 35, growth: 0, activation: 0, source_imbalance: 25, migration: 10 }),
});

function strategyError(message) {
  return Object.assign(new Error(message), { code: "PLACEMENT_STRATEGY_INVALID" });
}

function agentResponseError(message) {
  return Object.assign(new Error(message), { code: "AGENT_RESPONSE_INVALID" });
}

export function strategyProfile(id) {
  if (!STRATEGY_IDS.includes(id)) throw strategyError(`Unknown placement strategy: ${id}`);
  return { id, weights: { ...PROFILES[id] } };
}

export function validateWeightMultipliers(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw agentResponseError("Weight multipliers must be an object");
  }

  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    const multiplier = Number(raw);
    if (!ADJUSTABLE_METRICS.includes(key) || !Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2) {
      throw agentResponseError(`Invalid weight multiplier: ${key}`);
    }
    return [key, multiplier];
  }));
}

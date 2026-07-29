import { randomUUID } from "node:crypto";
import { strategyProfile } from "../planning/strategy-profiles.js";

function clone(value) {
  return structuredClone(value);
}

export function createPlacementSettingsService({
  repository,
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
}) {
  function response(state) {
    return {
      default_strategy_id: state.settings?.placement?.default_strategy_id ?? "balanced_optimal",
      state_version: state.version,
    };
  }

  return {
    get() {
      return response(repository.read());
    },
    update(strategyId, actor) {
      strategyProfile(strategyId);
      const state = repository.read();
      const previous = state.settings?.placement?.default_strategy_id ?? "balanced_optimal";
      const changed = repository.mutate(state.version, (draft) => {
        draft.settings ??= {};
        draft.settings.placement = { default_strategy_id: strategyId };
        draft.audit.push({
          id: `AUDIT-${idFactory()}`,
          entity_type: "settings",
          entity_id: "placement-strategy",
          action: "placement_strategy_updated",
          actor,
          at: now(),
          details: clone({ previous_strategy_id: previous, strategy_id: strategyId }),
        });
      });
      return response(changed);
    },
  };
}

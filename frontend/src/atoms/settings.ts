import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { PlacementSettings, StrategyId } from "../types/domain";

export const placementSettingsAtom = atom<PlacementSettings | null>(null);

export const loadPlacementSettingsAction = atom(null, async (get, set) => {
  const settings = await api.settings.placement();
  set(placementSettingsAtom, settings);
  return settings;
});

export const updatePlacementDefaultAction = atom(null, async (get, set, strategyId: StrategyId) => {
  const settings = await api.settings.updatePlacement(strategyId);
  set(placementSettingsAtom, settings);
  return settings;
});

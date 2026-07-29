import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { AgentStatusResult } from "../types/domain";

export const agentStatusAtom = atom<AgentStatusResult | null>(null);

export const refreshAgentStatusAction = atom(null, async (get, set, force = false) => {
  try {
    const status = await api.agent.status(force);
    set(agentStatusAtom, status);
    return status;
  } catch {
    return get(agentStatusAtom);
  }
});

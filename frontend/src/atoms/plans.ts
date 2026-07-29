import { atom } from "jotai";
import { api } from "../api/endpoints";
import type { Plan, PlanConfirmResult, PlanCreateInput } from "../types/domain";
import type { PlanCreateInput as ApiPlanCreateInput } from "../types/api";

export const currentPlanAtom = atom<Plan | null>(null);
export const lastExecutionAtom = atom<Plan["execution"] | null>(null);

export const createPlanAction = atom(null, async (get, set, input: ApiPlanCreateInput) => {
  const plan = await api.plans.create(input);
  set(currentPlanAtom, plan);
  set(lastExecutionAtom, null);
  return plan;
});

export const confirmPlanAction = atom(null, async (get, set, planId: string) => {
  const result: PlanConfirmResult = await api.plans.confirm(planId);
  set(currentPlanAtom, result.plan);
  set(lastExecutionAtom, result.execution);
  return result;
});

export const selectPlanCandidateAction = atom(
  null,
  async (get, set, { planId, candidateId }: { planId: string; candidateId: string }) => {
    const updated = await api.plans.selectCandidate(planId, { candidate_id: candidateId });
    set(currentPlanAtom, updated);
    set(lastExecutionAtom, null);
    return updated;
  },
);

export const createRemovalPlanAction = atom(
  null,
  async (get, set, device: { id: string; rack_id: string; hostname?: string; business_id?: string; replica_group?: string | null; maintenance_window?: string | null }) => {
    const plan = await api.plans.create({
      kind: "removal",
      device_id: device.id,
      actions: [
        {
          type: "remove_device",
          device_id: device.id,
          rack_id: device.rack_id,
          device: {
            id: device.id,
            hostname: device.hostname,
            business_id: device.business_id,
            replica_group: device.replica_group,
            maintenance_window: device.maintenance_window,
          },
        },
      ],
      reasons: ["执行前校验可移动性、维护窗口、业务归属与副本风险"],
    });
    set(currentPlanAtom, plan);
    set(lastExecutionAtom, null);
    return plan;
  },
);

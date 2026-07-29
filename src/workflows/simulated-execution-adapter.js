import { applyActions, evaluateActions } from "../domain/constraint-engine.js";

function failedExecution(state, stages, code, message) {
  return {
    ok: false,
    code,
    message,
    state: structuredClone(state),
    stages,
    rolled_back: true,
  };
}

export function createSimulatedExecutionAdapter() {
  return {
    async execute(state, actions, { failAt = null } = {}) {
      const stages = ["locked"];
      if (failAt === "locked") {
        return failedExecution(state, stages, "SIMULATED_EXECUTION_FAILED", "Execution failed after locking resources");
      }

      const precheck = evaluateActions(state, actions);
      if (!precheck.allowed) {
        return failedExecution(state, stages, "EXECUTION_REVALIDATION_FAILED", "Hard constraints failed before execution");
      }

      const projected = applyActions(state, actions);
      const placedIds = new Set(actions.filter((action) => action.type === "place_device").map((action) => action.device.id));
      for (const device of projected.devices) {
        if (placedIds.has(device.id)) device.status = "running";
      }
      stages.push("written");
      if (failAt === "written") {
        return failedExecution(state, stages, "SIMULATED_EXECUTION_FAILED", "Execution failed after simulated write");
      }

      const verification = evaluateActions(projected, []);
      if (!verification.allowed || failAt === "verified") {
        return failedExecution(state, [...stages, "verified"], "SIMULATED_VERIFICATION_FAILED", "Post-execution verification failed");
      }

      stages.push("verified");
      return {
        ok: true,
        code: null,
        message: "Simulated execution and verification succeeded",
        state: projected,
        stages,
        rolled_back: false,
        verification,
      };
    },
  };
}

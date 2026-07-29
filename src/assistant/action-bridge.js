function bridgeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function createAssistantActionBridge({
  repository,
  planService,
  diagnosisEngine,
}) {
  return {
    async createPlan(proposal, actor) {
      if (proposal.type === "placement") {
        return planService.create({
          kind: "placement",
          device: structuredClone(proposal.payload.device),
        }, actor);
      }
      if (proposal.type === "remediation") {
        const alarm = repository.read().alarms
          .find((item) => item.id === proposal.payload.alarm_id);
        if (!alarm) {
          throw bridgeError(
            "ALARM_NOT_FOUND",
            `Alarm does not exist: ${proposal.payload.alarm_id}`,
          );
        }
        if (["open", "acknowledged"].includes(alarm.status)) {
          diagnosisEngine.diagnose(alarm.id, actor);
        } else if (alarm.status !== "diagnosing") {
          throw bridgeError(
            "ASSISTANT_PROPOSAL_INVALID",
            `Alarm ${alarm.id} cannot create a remediation from ${alarm.status}`,
          );
        }
        return diagnosisEngine.createRemediation(alarm.id, actor);
      }
      throw bridgeError(
        "ASSISTANT_PROPOSAL_INVALID",
        `Unsupported assistant proposal type: ${proposal.type}`,
      );
    },
  };
}

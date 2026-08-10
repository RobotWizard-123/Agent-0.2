import { randomUUID } from "node:crypto";
import {
  captureFeedbackSnapshot,
  diffFeedbackSnapshots,
} from "./feedback-detector.js";
import { createDeterministicAssistant } from "./deterministic-assistant.js";

function assistantError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

function enrichEvidence(evidence, context) {
  const labels = new Map(context.entity_index.map((item) => [item.id, item.label]));
  return evidence.map((item) => ({
    ...clone(item),
    label: labels.get(item.id) ?? item.id,
  }));
}

function validMessage(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2_000) {
    throw assistantError(
      "ASSISTANT_INPUT_INVALID",
      "Assistant message must contain 1 to 2000 characters",
    );
  }
  return value.trim();
}

export function createAssistantOrchestrator({
  contextService,
  sessionStore,
  agentGateway = null,
  fallbackAssistant = createDeterministicAssistant(),
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
}) {
  async function modelAnswer({ message, context, history }) {
    if (!agentGateway) {
      return {
        result: fallbackAssistant.answer({ message, context }),
        modelStatus: "not_configured",
      };
    }
    try {
      return {
        result: await agentGateway.answerAssistant({ message, context, history }),
        modelStatus: "available",
      };
    } catch (error) {
      if (!["AGENT_UNAVAILABLE", "AGENT_RESPONSE_INVALID"].includes(error.code)) throw error;
      return {
        result: fallbackAssistant.answer({ message, context }),
        modelStatus: "degraded",
      };
    }
  }

  async function proposalFor({ result, context, message, actor, role, sessionId }) {
    if (!["propose_placement", "propose_remediation"].includes(result.intent.type)) {
      return { result, proposal: null, modelStatus: null };
    }
    if (role !== "admin") {
      return {
        result: {
          ...result,
          answer: `${result.answer} 当前账号为只读角色，不能生成待确认方案。`,
          intent: { type: "answer" },
        },
        proposal: null,
        modelStatus: null,
      };
    }

    let type;
    let payload;
    if (result.intent.type === "propose_placement") {
      const aiDevice = result.intent.device_request;
      const preferredRackIds = result.evidence
        .filter((e) => e.type === "rack")
        .map((e) => e.id);
      if (aiDevice && aiDevice.u_size) {
        type = "placement";
        payload = {
          device: {
            id: "SRV-AGENT",
            count: aiDevice.quantity ?? 1,
            u_size: aiDevice.u_size,
            rated_power_w: aiDevice.rated_power_w ?? 0,
            real_power_w: null,
            weight_kg: aiDevice.weight_kg ?? 0,
            network_ports: aiDevice.port_count ?? 2,
            preferred_rack_ids: preferredRackIds,
            hostname: null,
            model: null,
            business: null,
            owner: null,
          },
        };
      } else {
        try {
          const device = await agentGateway.extractRequest(message);
          type = "placement";
          payload = { device };
        } catch (error) {
          if (!["AGENT_UNAVAILABLE", "AGENT_RESPONSE_INVALID", "AGENT_INPUT_INVALID"].includes(error.code)) throw error;
          return {
            result: {
              ...result,
              answer: `${result.answer} 未能从本次输入提取完整且可信的设备事实，请补充设备编号、U位、额定功率、重量和端口数。`,
              intent: { type: "answer" },
            },
            proposal: null,
            modelStatus: "degraded",
          };
        }
      }
    } else {
      const alarm = context.site.alarms.find((item) => item.id === result.intent.alarm_id);
      if (!alarm || alarm.status === "resolved") {
        throw assistantError(
          "ASSISTANT_PROPOSAL_INVALID",
          "Remediation proposal requires an unresolved alarm",
        );
      }
      type = "remediation";
      payload = { alarm_id: alarm.id };
    }

    const proposal = {
      id: `PROPOSAL-${idFactory()}`,
      type,
      payload: clone(payload),
      state_version: context.state_version,
      created_at: now(),
      created_by: actor,
      used: false,
    };
    sessionStore.saveProposal(sessionId, proposal);
    return { result, proposal, modelStatus: null };
  }

  return {
    async send({ sessionId, actor, role, message, uiContext = {} }) {
      const normalizedMessage = validMessage(message);
      sessionStore.beginRequest(sessionId);
      try {
        const context = contextService.build({ role, uiContext });
        const history = sessionStore.session(sessionId).messages;
        const answered = await modelAnswer({
          message: normalizedMessage,
          context,
          history,
        });
        const proposed = await proposalFor({
          result: answered.result,
          context,
          message: normalizedMessage,
          actor,
          role,
          sessionId,
        });
        const modelStatus = proposed.modelStatus ?? answered.modelStatus;
        const evidence = enrichEvidence(proposed.result.evidence, context);
        const createdAt = now();
        const userMessage = {
          id: `MSG-${idFactory()}`,
          content: normalizedMessage,
          at: createdAt,
        };
        const assistantMessage = {
          id: `MSG-${idFactory()}`,
          content: proposed.result.answer,
          evidence,
          proposal: proposed.proposal ? clone(proposed.proposal) : null,
          intent: clone(proposed.result.intent),
          model_status: modelStatus,
          state_version: context.state_version,
          at: createdAt,
        };
        sessionStore.appendTurn(sessionId, userMessage, assistantMessage);
        return {
          message_id: assistantMessage.id,
          answer: assistantMessage.content,
          evidence,
          proposal: assistantMessage.proposal,
          intent: assistantMessage.intent,
          model_status: modelStatus,
          state_version: context.state_version,
        };
      } finally {
        sessionStore.endRequest(sessionId);
      }
    },
    session(sessionId) {
      return sessionStore.session(sessionId);
    },
    feedback({ sessionId, role, cursor = 0, uiContext = {} }) {
      const context = contextService.build({ role, uiContext });
      const current = captureFeedbackSnapshot(context);
      const previous = sessionStore.feedbackSnapshot(sessionId);
      const events = diffFeedbackSnapshots(previous, current, now);
      sessionStore.syncFeedback(sessionId, current, events);
      return {
        ...sessionStore.feedback(sessionId, cursor),
        synced_at: now(),
      };
    },
    getProposal(sessionId, proposalId) {
      return sessionStore.getProposal(sessionId, proposalId);
    },
    markProposalUsed(sessionId, proposalId) {
      return sessionStore.markProposalUsed(sessionId, proposalId);
    },
    clear(sessionId) {
      sessionStore.clear(sessionId);
    },
  };
}

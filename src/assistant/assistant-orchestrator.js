import { randomUUID } from "node:crypto";
import {
  captureFeedbackSnapshot,
  diffFeedbackSnapshots,
} from "./feedback-detector.js";
import { createDeterministicAssistant } from "./deterministic-assistant.js";
import { extractDeviceFromText } from "../agent/rule-extractor.js";
import { validateDeviceRequest } from "../agent/agent-schema.js";

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
  // Hard ceiling on how long a single model call can block the chat. If the
  // model is unreachable or unusually slow we fall back to the deterministic
  // assistant instead of leaving the user staring at a frozen spinner.
  modelTimeoutMs = 12_000,
}) {
  function withTimeout(promiseFactory, ms, code = "AGENT_TIMEOUT") {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("Agent call exceeded the chat timeout"), { code })), ms);
      Promise.resolve().then(promiseFactory).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  async function modelAnswer({ message, context, history }) {
    if (!agentGateway) {
      return {
        result: fallbackAssistant.answer({ message, context }),
        modelStatus: "not_configured",
      };
    }
    try {
      return {
        result: await withTimeout(
          () => agentGateway.answerAssistant({ message, context, history }),
          modelTimeoutMs,
          "AGENT_TIMEOUT",
        ),
        modelStatus: "available",
      };
    } catch (error) {
      if (!["AGENT_UNAVAILABLE", "AGENT_RESPONSE_INVALID", "AGENT_TIMEOUT"].includes(error.code)) throw error;
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
      let device = null;
      let modelError = null;
      if (typeof agentGateway?.extractRequest === "function") {
        try {
          device = await agentGateway.extractRequest(message);
        } catch (error) {
          if (!["AGENT_UNAVAILABLE", "AGENT_RESPONSE_INVALID", "AGENT_INPUT_INVALID"].includes(error.code)) throw error;
          modelError = error;
        }
      }
      if (!device) {
        // Soft fallback: try rule-based extraction. If the natural-language
        // text contains enough structured facts (U位/功率/重量/端口), we can
        // still build a proposal without forcing the user to fill the form.
        const rule = extractDeviceFromText(message);
        if (rule.device && rule.missing.length === 0) {
          device = validateDeviceRequest(rule.device);
        } else if (rule.device && rule.missing.length > 0) {
          return {
            result: {
              ...result,
              answer: `${result.answer} 已从输入中识别到部分设备事实（${[
                rule.device.u_size ? `${rule.device.u_size}U` : null,
                rule.device.rated_power_w ? `${rule.device.rated_power_w}W` : null,
                rule.device.weight_kg ? `${rule.device.weight_kg}kg` : null,
                rule.device.network_ports ? `${rule.device.network_ports}端口` : null,
              ].filter(Boolean).join("、") || "无"}），仍缺少：${rule.missing.map((field) => ({
                u_size: "U位",
                rated_power_w: "额定功率",
                weight_kg: "重量",
                network_ports: "端口数",
              })[field]).join("、")}，请补充完整。`,
              intent: { type: "answer" },
            },
            proposal: null,
            modelStatus: modelError ? "degraded" : "not_configured",
          };
        } else {
          return {
            result: {
              ...result,
              answer: `${result.answer} 未能从本次输入提取完整且可信的设备事实，请补充设备编号、U位、额定功率、重量和端口数。`,
              intent: { type: "answer" },
            },
            proposal: null,
            modelStatus: modelError ? "degraded" : "not_configured",
          };
        }
      }
      type = "placement";
      payload = { device };
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

import { validateDeviceRequest, validatePlanAdjustment } from "./agent-schema.js";
import { validateAssistantResponse } from "../assistant/assistant-schema.js";
import { createDnsAwareFetch } from "./dns-aware-fetch.js";

const defaultFetch = createDnsAwareFetch();

function agentError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function parseJsonContent(content) {
  if (typeof content !== "string") throw agentError("AGENT_RESPONSE_INVALID", "Agent response content is missing");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw agentError("AGENT_RESPONSE_INVALID", "Agent response is not valid JSON");
  }
}

function extractionMessages(text) {
  return [
    {
      role: "system",
      content: "你是机房上架请求抽取器。只输出JSON对象，字段为id,count,u_size,rated_power_w,weight_kg,network_ports,preferred_rack_ids,hostname,model,business,owner。不得猜测缺失的测量值。",
    },
    { role: "user", content: text },
  ];
}

function adjustmentMessages(context) {
  return [
    {
      role: "system",
      content: [
        "你是机房部署规划 Agent，只输出 JSON 对象。",
        "字段只能是 candidate_id、reason、weight_multipliers、alternatives。",
        "candidate_id 只能选择输入中的已知候选或 null；alternatives 最多 3 个。",
        "备选动作只允许 place_device、move_device、set_dividers，并必须包含精确 start_u。",
        "不得修改设备实测/额定事实、机柜设计容量、状态版本、硬约束结果或动作类型。",
        "软权重倍率只能处于 0.5 到 2.0。",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(context) },
  ];
}

function assistantMessages({ message, context, history = [] }) {
  const safeHistory = history
    .filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string")
    .slice(-40)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4_000) }));
  return [
    {
      role: "system",
      content: "你是机房全站助手。只输出JSON对象，字段为answer,evidence,intent。只能引用context.entity_index中的实体；只能使用answer、navigate、propose_placement、propose_remediation意图；不得执行计划、修改设备事实、修改机柜设计容量或改写规则结果。信息不足时用answer说明缺少字段。",
    },
    ...safeHistory,
    { role: "user", content: JSON.stringify({ message, context }) },
  ];
}

export function createAgentGateway({ baseUrl, apiKey, model, fetchImpl = defaultFetch, timeoutMs = 8_000 }) {
  if (!baseUrl || !apiKey || !model) throw agentError("AGENT_CONFIG_INVALID", "Agent configuration is incomplete");
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const inferenceUrl = /\/v1$/i.test(normalizedBaseUrl)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1/chat/completions`;

  // Fast-fail memo: once we know the model is unreachable we should not
  // block the request thread for the full inference timeout on every
  // subsequent call. The memo TTL is short so transient blips recover.
  const FAIL_FAST_TTL_MS = Math.max(2_000, Number(timeoutMs) || 8_000);
  const failFast = { at: 0, code: null, message: null };

  async function complete(messages, { timeoutMs: callTimeoutMs } = {}) {
    if (failFast.at && Date.now() - failFast.at < FAIL_FAST_TTL_MS) {
      throw agentError(failFast.code ?? "AGENT_UNAVAILABLE", failFast.message ?? "Agent is in fail-fast window", { fail_fast: true });
    }
    let response;
    try {
      response = await fetchImpl(inferenceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, temperature: 0, messages }),
        signal: AbortSignal.timeout(callTimeoutMs ?? timeoutMs),
      });
    } catch (error) {
      if (error?.code === "AGENT_RESPONSE_INVALID") throw error;
      failFast.at = Date.now();
      failFast.code = "AGENT_UNAVAILABLE";
      failFast.message = "Agent service is unavailable";
      throw agentError("AGENT_UNAVAILABLE", "Agent service is unavailable", { cause: error });
    }

    if (!response.ok) {
      failFast.at = Date.now();
      failFast.code = "AGENT_UNAVAILABLE";
      failFast.message = `Agent service returned HTTP ${response.status}`;
      throw agentError("AGENT_UNAVAILABLE", `Agent service returned HTTP ${response.status}`, { http_status: response.status });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw agentError("AGENT_RESPONSE_INVALID", "Agent service returned invalid JSON");
    }
    return parseJsonContent(payload?.choices?.[0]?.message?.content);
  }

  async function probe({ timeoutMs: probeTimeoutMs = 4_000, resetFailFast = true } = {}) {
    // Trivial call; we only care about reachability + a valid JSON envelope.
    // We bypass the strict "must contain a parseable JSON object" requirement
    // by checking reachability first via a tiny message; if the response is
    // any text, the probe still counts as successful connectivity.
    const url = /\/v1$/i.test(normalizedBaseUrl)
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1/chat/completions`;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (!res.ok) {
        failFast.at = Date.now();
        failFast.code = "AGENT_UNAVAILABLE";
        failFast.message = `Agent probe returned HTTP ${res.status}`;
        throw agentError("AGENT_UNAVAILABLE", `Agent probe returned HTTP ${res.status}`, { http_status: res.status });
      }
      if (resetFailFast) failFast.at = 0; // probe success clears the memo
    } catch (error) {
      if (!error?.code) {
        failFast.at = Date.now();
        failFast.code = "AGENT_UNAVAILABLE";
        failFast.message = "Agent probe failed";
      }
      throw error;
    }
  }

  return {
    describe() {
      return { model };
    },
    baseUrl: normalizedBaseUrl,
    async extractRequest(text) {
      if (typeof text !== "string" || !text.trim()) throw agentError("AGENT_INPUT_INVALID", "Natural-language request is empty");
      return validateDeviceRequest(await complete(extractionMessages(text.trim())));
    },
    async adjustPlan(context) {
      return validatePlanAdjustment(await complete(adjustmentMessages(context)));
    },
    async answerAssistant(input) {
      const entityIndex = Array.isArray(input?.context?.entity_index)
        ? input.context.entity_index
        : [];
      const entityIds = new Set(entityIndex.map((item) => item.id));
      const entityTypes = new Map(entityIndex.map((item) => [item.id, item.type]));
      return validateAssistantResponse(
        await complete(assistantMessages(input)),
        { entityIds, entityTypes },
      );
    },
    async health({ timeoutMs: healthTimeoutMs } = {}) {
      try {
        await probe({ timeoutMs: healthTimeoutMs ?? 4_000 });
        return { status: "healthy" };
      } catch (error) {
        return { status: "degraded", error_code: error.code ?? "AGENT_UNAVAILABLE", message: error.message };
      }
    },
  };
}

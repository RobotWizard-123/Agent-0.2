import { validateDeviceRequest, validatePlanAdjustment } from "./agent-schema.js";
import { validateAssistantResponse } from "../assistant/assistant-schema.js";
import { createDnsAwareFetch } from "./dns-aware-fetch.js";

const defaultFetch = createDnsAwareFetch();

function agentError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function parseJsonContent(content) {
  if (typeof content !== "string") throw agentError("AGENT_RESPONSE_INVALID", "Agent response content is missing");
  let text = content.trim();
  text = text.replace(/^```(?:json)?\s*/i, "");
  text = text.replace(/\s*```\s*$/i, "");
  text = text.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw agentError("AGENT_RESPONSE_INVALID", "Agent response is not valid JSON");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw agentError("AGENT_RESPONSE_INVALID", "Agent response is not valid JSON");
  }
}

function extractionMessages(text) {
  return [
    {
      role: "system",
      content: [
        "你是L5-A2-08数据中心机房上架请求抽取器。",
        "你必须严格只输出一个json对象，禁止输出任何解释、注释、markdown代码块或前后缀文字。",
        "",
        "字段说明：",
        "- id: 字符串，设备编号，未提及则用\"SRV-AGENT\"",
        "- it_code: 字符串或null，IT-Code，未提及为null",
        "- count: 整数，设备数量，默认1，不超过10",
        "- u_size: 整数，设备U位高度，范围1-10，必须从用户文本提取",
        "- rated_power_w: 非负数字，额定功率(W)，必须从用户文本提取；未提及填0",
        "- weight_kg: 非负数字，重量(kg)，必须从用户文本提取；未提及填0",
        "- network_ports: 非负整数，网口数量，必须从用户文本提取；未提及填0",
        "- preferred_rack_ids: 字符串数组，优选机柜代号，未提及为空数组[]。机柜代号格式为CAB-01至CAB-20，也接受别名POD01-L/R至POD10-L/R",
        "- hostname: 字符串或null，主机名，未提及为null",
        "- model: 字符串或null，设备型号，未提及为null",
        "- business: 字符串或null，业务归属，未提及为null",
        "- owner: 字符串或null，负责人，未提及为null",
        "",
        "示例输出：",
        '{"id":"SRV-AGENT","it_code":null,"count":1,"u_size":10,"rated_power_w":3500,"weight_kg":120,"network_ports":4,"preferred_rack_ids":[],"hostname":null,"model":null,"business":null,"owner":null}',
      ].join("\n"),
    },
    { role: "user", content: text },
  ];
}

function adjustmentMessages(context) {
  return [
    {
      role: "system",
      content: [
        "你是机房部署规划Agent，只输出json对象。",
        "字段只能是 candidate_id、reason、weight_multipliers、alternatives。",
        "candidate_id 只能选择输入中的已知候选或null；alternatives必须为空数组。",
        "U位、PDU插口和交换机端口均由服务器分配，Agent不得编写部署或迁移动作。",
        "不得修改设备实测/额定事实、机柜设计容量、状态版本、硬约束结果或动作类型。",
        "软权重倍率只能处于0.5到2.0。",
        "evidence字段不需要，不输出。",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(context) },
  ];
}

function compactAssistantContext(ctx) {
  if (!ctx || typeof ctx !== "object") return ctx;
  const site = ctx.site ?? {};
  return {
    state_version: ctx.state_version ?? null,
    role: ctx.role ?? null,
    ui_context: ctx.ui_context ?? null,
    site: {
      room: site.room ? { name: site.room.name, room_code: site.room.room_code } : null,
      rack_count: Array.isArray(site.racks) ? site.racks.length : 0,
      device_count: Array.isArray(site.devices) ? site.devices.length : 0,
      racks: Array.isArray(site.racks) ? site.racks.map((r) => ({
        id: r.id,
        name: r.name,
        used_u: r.capacity?.used_u ?? null,
        usable_u: r.capacity?.usable_u ?? null,
        rated_power_used_w: r.capacity?.rated_power_used_w ?? null,
        design_power_w: r.capacity?.design_power_w ?? null,
        port_used: r.capacity?.used_ports ?? null,
        port_limit: r.capacity?.port_limit ?? null,
      })) : [],
      devices: Array.isArray(site.devices) ? site.devices.map((d) => ({
        id: d.id,
        model: d.model ?? null,
        rack_id: d.rack_id ?? null,
        layer_id: d.layer_id ?? null,
        u_size: d.u_size ?? null,
        rated_power_w: d.rated_power_w ?? null,
        status: d.status ?? null,
      })) : [],
      alarms: Array.isArray(site.alarms) ? site.alarms
        .filter((a) => a.status !== "resolved")
        .map((a) => ({
          id: a.id,
          severity: a.severity,
          trigger_code: a.trigger_code,
          object_id: a.object_id,
          status: a.status,
        })) : [],
      service_health: site.service_health ?? {},
    },
    active_risks: Array.isArray(ctx.active_risks) ? ctx.active_risks : [],
    entity_index: Array.isArray(ctx.entity_index) ? ctx.entity_index : [],
  };
}

function assistantMessages({ message, context, history = [] }) {
  const safeHistory = history
    .filter((item) => ["user", "assistant"].includes(item?.role) && typeof item.content === "string")
    .slice(-10)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 500) }));
  const slimContext = compactAssistantContext(context);
  return [
    {
      role: "system",
      content: [
        "你是L5-A2-08数据中心全站助手。你可以回答容量、链路、告警、方案状态、规则原因相关问题。",
        "",
        "你必须严格只输出一个json对象，禁止输出任何解释或markdown。",
        "",
        "字段说明：",
        "- answer: 字符串，中文回答，简洁专业，不超过500字",
        "- evidence: 数组，每个元素是{\"type\":\"类型\",\"id\":\"ID\"}对象，type只能是rack/device/alarm/plan/audit之一，id必须来自context.entity_index；无引用时为空数组[]",
        "- intent: 对象，格式为{\"type\":\"意图类型\"}，type只能是以下之一：answer（普通回答）、navigate（导航到实体）、propose_placement（建议上架）、propose_remediation（建议告警处置）",
        "  - navigate意图需额外target字段：{\"type\":\"navigate\",\"target\":{\"type\":\"rack\",\"id\":\"CAB-01\"}}",
        "  - propose_remediation意图需额外alarm_id字段：{\"type\":\"propose_remediation\",\"alarm_id\":\"ALM-xxx\"}",
        "  - propose_placement意图需额外device_request字段，从用户消息中解析出设备参数：{\"type\":\"propose_placement\",\"device_request\":{\"quantity\":数量,\"u_size\":U数,\"rated_power_w\":功率瓦,\"weight_kg\":重量公斤,\"port_count\":网口数}}；用户未提到的参数填null；quantity默认1",
        "",
        "规则：",
        "1. 只能引用context.entity_index中存在的实体，禁止捏造机柜或设备ID",
        "2. 不得执行计划、修改设备事实、修改机柜设计容量或改写规则结果",
        "3. 信息不足时在answer中说明需要补充什么信息",
        "4. 如果用户只是问候（如你好），返回answer为问候语，evidence为空数组，intent为{\"type\":\"answer\"}",
        "5. context.site中包含所有机柜的容量摘要和设备列表，回答具体机柜问题时基于这些数据",
        "",
        "示例（问候）：",
        '{"answer":"您好，我是L5-A2-08数据中心助手，可以查询机柜容量、链路状态、告警和方案信息。请问有什么可以帮您？","evidence":[],"intent":{"type":"answer"}}',
      ].join("\n"),
    },
    ...safeHistory,
    { role: "user", content: JSON.stringify({ message, context: slimContext }) },
  ];
}

export function createAgentGateway({ baseUrl, apiKey, model, fetchImpl = defaultFetch, timeoutMs = 30_000 }) {
  if (!baseUrl || !apiKey || !model) throw agentError("AGENT_CONFIG_INVALID", "Agent configuration is incomplete");
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const inferenceUrl = /\/v1$/i.test(normalizedBaseUrl)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1/chat/completions`;

  async function complete(messages) {
    let response;
    try {
      response = await fetchImpl(inferenceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.code === "AGENT_RESPONSE_INVALID") throw error;
      throw agentError("AGENT_UNAVAILABLE", "Agent service is unavailable", { cause: error });
    }

    if (!response.ok) {
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

  return {
    describe() {
      return { model };
    },
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
    async health() {
      try {
        await complete([
          { role: "system", content: "只输出JSON对象{\"status\":\"ok\"}，不输出其他内容。" },
          { role: "user", content: "ping" },
        ]);
        return { status: "healthy" };
      } catch (error) {
        return { status: "degraded", error_code: error.code ?? "AGENT_UNAVAILABLE" };
      }
    },
  };
}

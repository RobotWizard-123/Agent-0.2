import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numberFrom(text, pattern, fallback) {
  const matched = text.match(pattern);
  return matched ? Number(matched[1]) : fallback;
}

function extraction(text) {
  const id = text.match(/SRV-[A-Z0-9-]+/i)?.[0]?.toUpperCase() ?? "SRV-ASSIST-E2E";
  const rack = text.match(/CAB-\d{2}/i)?.[0]?.toUpperCase();
  return {
    id,
    count: 1,
    u_size: numberFrom(text, /(\d+)\s*U/i, 4),
    rated_power_w: numberFrom(text, /(\d+)\s*W/i, 1_200),
    weight_kg: numberFrom(text, /(\d+)\s*(?:kg|公斤)/i, 30),
    network_ports: numberFrom(text, /(\d+)\s*(?:端口|ports?)/i, 2),
    preferred_rack_ids: rack ? [rack] : [],
    hostname: null,
    model: null,
    business: "E2E 演示",
    owner: "自动化测试",
  };
}

function assistantAnswer(input) {
  const message = String(input.message ?? "");
  const entityIndex = input.context?.entity_index ?? [];
  const racks = input.context?.site?.racks ?? [];
  const explicitRackId = message.match(/CAB-\d{2}/i)?.[0]?.toUpperCase() ?? null;
  const currentRackId = input.context?.ui_context?.current_entity?.type === "rack"
    ? input.context.ui_context.current_entity.id
    : null;
  const rackId = explicitRackId ?? currentRackId ?? "CAB-09";
  const rack = racks.find((item) => item.id === rackId);

  if (/什么模型|你是谁|模型名称|model/i.test(message)) {
    return {
      answer: "我是仅用于本地浏览器验收的 e2e-agent-model，不是真实生产模型。正式站点会显示配置的模型名称，并在模型不可用时明确标记规则降级。",
      evidence: [],
      intent: { type: "answer" },
    };
  }

  if (/SRV-ASSIST-E2E|上架|部署/i.test(message)) {
    return {
      answer: `已识别 ${rackId} 上架意图。可以先生成受功率、U 位、重量和端口硬约束复核的待确认方案。`,
      evidence: [{ type: "rack", id: rackId }],
      intent: { type: "propose_placement" },
    };
  }

  if (!explicitRackId && !currentRackId) {
    const knownEntities = entityIndex.length;
    return {
      answer: `本地验收模型已读取全站上下文（${knownEntities} 个可引用实体）。请指定机柜、设备、告警或方案编号进行查询。`,
      evidence: [],
      intent: { type: "answer" },
    };
  }

  const used = rack?.capacity?.rated_power_used_w;
  const limit = rack?.capacity?.design_power_w;
  const capacity = Number.isFinite(used) && Number.isFinite(limit)
    ? `额定功率 ${used}W / ${limit}W`
    : "容量数据已从当前站点上下文读取";
  return {
    answer: `${rackId}：${capacity}。点击下方依据可进入机柜核对具体服务器与链路。`,
    evidence: [{ type: "rack", id: rackId }],
    intent: { type: "answer" },
  };
}

export function createMockCompletion(payload) {
  const last = payload?.messages?.at(-1)?.content;
  const parsed = typeof last === "string" ? parseJson(last) : null;
  let result;
  if (parsed?.message && parsed?.context) {
    result = assistantAnswer(parsed);
  } else if (Array.isArray(parsed?.candidates)) {
    result = {
      candidate_id: parsed.candidates[0]?.id ?? null,
      reason: "选择规则引擎已验证的首个候选，不改写设备事实或硬约束结果",
      weight_multipliers: {},
      alternatives: [],
    };
  } else if (typeof last === "string" && /SRV-|上架|部署/i.test(last)) {
    result = extraction(last);
  } else {
    result = { ok: true };
  }

  return {
    id: "chatcmpl-e2e-local",
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: "stop", message: {
      role: "assistant",
      content: JSON.stringify(result),
    } }],
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function startMockAgentServer({
  host = "127.0.0.1",
  port = Number(process.env.MOCK_AGENT_PORT || 3_200),
  apiKey = process.env.MOCK_AGENT_API_KEY ?? "e2e-only-agent-key",
} = {}) {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    try {
      json(response, 200, createMockCompletion(await readBody(request)));
    } catch {
      json(response, 400, { error: "invalid_request" });
    }
  });
  server.listen(port, host, () => {
    process.stdout.write(`Mock Agent ready at http://${host}:${port}\n`);
  });
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startMockAgentServer();
}

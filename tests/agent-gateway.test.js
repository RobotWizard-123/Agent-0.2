import test from "node:test";
import assert from "node:assert/strict";
import { createAgentGateway } from "../src/agent/agent-gateway.js";
import { getAgentConfig, getRuntimeConfig } from "../src/config.js";
import { createDemoState } from "../src/demo-state.js";
import { createPlanningEngine } from "../src/planning/planning-engine.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createPlanService } from "../src/workflows/plan-service.js";
import { createSimulatedExecutionAdapter } from "../src/workflows/simulated-execution-adapter.js";

const testConfig = {
  baseUrl: "http://model.test",
  apiKey: "unit-test-key",
  model: "unit-test-model",
  timeoutMs: 100,
};

function fakeChatCompletion(content, status = 200) {
  return async (url, options) => {
    assert.equal(url, "http://model.test/v1/chat/completions");
    assert.equal(options.headers.authorization, "Bearer unit-test-key");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

test("runtime status exposes only safe configuration metadata", () => {
  const env = {
    AGENT_BASE_URL: "http://private-model",
    AGENT_API_KEY: "secret-value",
    AGENT_MODEL: "glm-demo",
    SESSION_SECRET: "session-secret",
    APP_ADMIN_PASSWORD: "admin-secret",
    APP_VIEWER_PASSWORD: "viewer-secret",
  };
  const status = getRuntimeConfig(env);
  const internal = getAgentConfig(env);

  assert.deepEqual(status, {
    agent_configured: true,
    agent_model: "glm-demo",
    authentication_configured: true,
    telemetry_status: "not_connected",
    application_version: "0.2.0",
  });
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
  assert.equal(JSON.stringify(status).includes("private-model"), false);
  assert.equal(JSON.stringify(status).includes("session-secret"), false);
  assert.equal(internal.apiKey, "secret-value");
});

test("Agent extracts a validated structured placement request", async () => {
  const gateway = createAgentGateway({
    ...testConfig,
    fetchImpl: fakeChatCompletion({
      id: "SRV-NL-01",
      count: 1,
      u_size: 4,
      rated_power_w: 1_800,
      weight_kg: 32,
      network_ports: 2,
      preferred_rack_ids: ["CAB-03"],
    }),
  });

  const extracted = await gateway.extractRequest("上架一台4U服务器");
  assert.equal(extracted.id, "SRV-NL-01");
  assert.equal(extracted.u_size, 4);
  assert.deepEqual(extracted.preferred_rack_ids, ["CAB-03"]);
});

test("Agent treats a Base URL ending in v1 as the complete inference endpoint", async () => {
  let requestedUrl;
  const gateway = createAgentGateway({
    ...testConfig,
    baseUrl: "https://model.test/v1/",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        answer: "ok",
        evidence: [],
        intent: { type: "answer" },
      }) } }] }));
    },
  });

  await gateway.answerAssistant({
    message: "status",
    history: [],
    context: { entity_index: [], site: {} },
  });
  assert.equal(requestedUrl, "https://model.test/v1");
});

test("Agent rejects unsupported actions in adjusted plans", async () => {
  const gateway = createAgentGateway({
    ...testConfig,
    fetchImpl: fakeChatCompletion({
      candidate_id: "DIRECT-CAB-03-L02",
      reason: "降低机柜功率上限",
      actions: [{ type: "set_rack_capacity", rack_id: "CAB-03", design_power_w: 99_999 }],
    }),
  });

  await assert.rejects(
    () => gateway.adjustPlan({ request: {}, candidates: [] }),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
});

test("Agent accepts bounded planning weights and alternatives", async () => {
  let requestBody;
  const gateway = createAgentGateway({
    ...testConfig,
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://model.test/v1/chat/completions");
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        candidate_id: "DIRECT-1",
        reason: "Preserve database locality",
        weight_multipliers: { business: 1.5 },
        alternatives: [],
      }) } }] }));
    },
  });

  const result = await gateway.adjustPlan({ request: {}, candidates: [{ id: "DIRECT-1" }] });
  assert.equal(result.weight_multipliers.business, 1.5);
  assert.deepEqual(result.alternatives, []);
  assert.match(requestBody.messages[0].content, /weight_multipliers/);
  assert.deepEqual(gateway.describe(), { model: "unit-test-model" });
  assert.equal(JSON.stringify(gateway.describe()).includes("unit-test-key"), false);
  assert.equal(JSON.stringify(gateway.describe()).includes("model.test"), false);
});

test("Agent maps transport failures to a degradable unavailable error", async () => {
  const gateway = createAgentGateway({
    ...testConfig,
    fetchImpl: async () => {
      throw new DOMException("timed out", "AbortError");
    },
  });

  await assert.rejects(
    () => gateway.extractRequest("上架服务器"),
    (error) => error.code === "AGENT_UNAVAILABLE",
  );
});

test("Agent returns a validated whole-site assistant answer", async () => {
  const gateway = createAgentGateway({
    ...testConfig,
    fetchImpl: fakeChatCompletion({
      answer: "CAB-09 额定功率仍在设计容量内。",
      evidence: [{ type: "rack", id: "CAB-09" }],
      intent: { type: "answer" },
    }),
  });
  const result = await gateway.answerAssistant({
    message: "CAB-09 容量如何？",
    history: [],
    context: {
      entity_index: [{ type: "rack", id: "CAB-09" }],
      site: { racks: [] },
    },
  });

  assert.equal(result.evidence[0].id, "CAB-09");
  assert.equal(result.intent.type, "answer");
});

test("plan service rejects Agent attempts to change measured device facts", async () => {
  const repository = createMemoryRepository(createDemoState());
  const agentGateway = {
    async adjustPlan() {
      return {
        candidate_id: null,
        reason: "降低功率以通过校验",
        weight_multipliers: {},
        alternatives: [{
          id: "FACT-MUTATION",
          reason: "mutate measured power",
          actions: [{
            type: "place_device",
            rack_id: "CAB-01",
            layer_id: "L02",
            start_u: 13,
            device: {
              id: "FACT-GUARD",
              u_size: 2,
              start_u: 13,
              rated_power_w: 100,
              real_power_w: null,
              weight_kg: 20,
              network_ports: 2,
            },
          }],
        }],
      };
    },
  };
  const service = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
    agentGateway,
  });
  const plan = await service.create({
    kind: "placement",
    natural_language: "请部署一台测试服务器",
    device: {
      id: "FACT-GUARD",
      count: 1,
      u_size: 2,
      rated_power_w: 8_000,
      real_power_w: null,
      weight_kg: 20,
      network_ports: 2,
      preferred_rack_ids: ["CAB-01"],
    },
  }, "planner");

  assert.equal(plan.agent_adjustment.accepted, false);
  assert.equal(plan.agent_adjustment.reason_code, "AGENT_FACT_MUTATION");
  assert.equal(plan.actions.find((action) => action.type === "place_device").device.rated_power_w, 8_000);
  assert.equal(plan.validation.allowed, true);
});

test("natural-language failure requests the structured form without fabricating a plan", async () => {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
    agentGateway: { async extractRequest() { throw Object.assign(new Error("offline"), { code: "AGENT_UNAVAILABLE" }); } },
  });

  const result = await service.create({ kind: "natural_language", text: "帮我上架" }, "planner");
  assert.deepEqual(result, {
    status: "input_required",
    fallback: "structured_form",
    agent_status: "degraded",
    error_code: "AGENT_UNAVAILABLE",
  });
  assert.equal(repository.read().plans.length, 0);
});

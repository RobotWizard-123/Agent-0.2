import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantOrchestrator } from "../src/assistant/assistant-orchestrator.js";
import { createDeterministicAssistant } from "../src/assistant/deterministic-assistant.js";
import { createAssistantSessionStore } from "../src/assistant/session-store.js";

function siteContext(overrides = {}) {
  return {
    state_version: 7,
    generated_at: "2026-07-22T00:00:00.000Z",
    entity_index: [
      { type: "rack", id: "CAB-09", label: "服务器机柜 09" },
      { type: "device", id: "SRV-DEMO", label: "demo-host" },
    ],
    site: {
      room: { id: "L5-A2-08" },
      racks: [{
        id: "CAB-09",
        capacity: {
          rated_power_used_w: 3_500,
          design_power_w: 20_000,
          used_u: 10,
          usable_u: 40,
          used_weight_kg: 120,
          max_weight_kg: 420,
          used_ports: 4,
          port_limit: 24,
        },
      }],
      devices: [{ id: "SRV-DEMO", hostname: "demo-host" }],
      links: {
        "SRV-DEMO": {
          power: [{ label: "CAB-09-PDU / P01" }],
          network: [{ label: "ASW-05 / GE0/0/01" }],
          redundancy: "unverified",
          missing_fields: [],
        },
      },
      alarms: [],
      plans: [],
      service_health: {},
      runtime: {},
      ...overrides,
    },
  };
}

function contextService(overrides = {}) {
  return { build: () => siteContext(overrides) };
}

test("orchestrator stores cited model answers", async () => {
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: {
      async answerAssistant() {
        return {
          answer: "容量正常",
          evidence: [{ type: "rack", id: "CAB-09" }],
          intent: { type: "answer" },
        };
      },
    },
  });
  const result = await service.send({
    sessionId: "S1",
    actor: "admin",
    role: "admin",
    message: "CAB-09 容量",
    uiContext: {},
  });

  assert.equal(result.answer, "容量正常");
  assert.equal(result.evidence[0].label, "服务器机柜 09");
  assert.equal(service.session("S1").messages.length, 2);
});

test("orchestrator degrades deterministically when the model is offline", async () => {
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: {
      async answerAssistant() {
        throw Object.assign(new Error("offline"), { code: "AGENT_UNAVAILABLE" });
      },
    },
  });
  const result = await service.send({
    sessionId: "S1",
    actor: "viewer",
    role: "viewer",
    message: "CAB-09 容量",
    uiContext: {},
  });

  assert.equal(result.model_status, "degraded");
  assert.match(result.answer, /CAB-09/);
  assert.equal(result.proposal, null);
});

test("administrator receives a stored placement proposal without creating a plan", async () => {
  const store = createAssistantSessionStore();
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: store,
    idFactory: () => "P1",
    now: () => "2026-07-22T00:00:00.000Z",
    agentGateway: {
      async answerAssistant() {
        return {
          answer: "可以生成方案",
          evidence: [{ type: "rack", id: "CAB-09" }],
          intent: { type: "propose_placement" },
        };
      },
      async extractRequest() {
        return {
          id: "SRV-NEW",
          count: 1,
          u_size: 4,
          rated_power_w: 1_200,
          real_power_w: null,
          weight_kg: 30,
          network_ports: 2,
          preferred_rack_ids: ["CAB-09"],
        };
      },
    },
  });
  const result = await service.send({
    sessionId: "S1",
    actor: "admin",
    role: "admin",
    message: "上架 SRV-NEW 4U 1200W 30kg 2端口到 CAB-09",
    uiContext: {},
  });

  assert.equal(result.proposal.id, "PROPOSAL-P1");
  assert.equal(store.getProposal("S1", "PROPOSAL-P1").used, false);
  assert.equal(store.getProposal("S1", "PROPOSAL-P1").payload.device.id, "SRV-NEW");
});

test("viewer never receives an actionable model proposal", async () => {
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: {
      async answerAssistant() {
        return {
          answer: "生成方案",
          evidence: [{ type: "rack", id: "CAB-09" }],
          intent: { type: "propose_placement" },
        };
      },
      async extractRequest() {
        throw new Error("viewer extraction must not run");
      },
    },
  });
  const result = await service.send({
    sessionId: "S1",
    actor: "viewer",
    role: "viewer",
    message: "生成上架方案",
    uiContext: {},
  });

  assert.equal(result.proposal, null);
  assert.match(result.answer, /只读/);
});

test("feedback polling does not call the model and deduplicates events", async () => {
  let modelCalls = 0;
  const alarm = {
    id: "ALARM-1",
    status: "open",
    severity: "critical",
    trigger_code: "RACK_POWER_HIGH",
    object_id: "CAB-09",
  };
  const service = createAssistantOrchestrator({
    contextService: contextService({ alarms: [alarm] }),
    sessionStore: createAssistantSessionStore(),
    agentGateway: { async answerAssistant() { modelCalls += 1; } },
    now: () => "2026-07-22T00:00:00.000Z",
  });

  const first = service.feedback({ sessionId: "S1", role: "admin", cursor: 0, uiContext: {} });
  const second = service.feedback({ sessionId: "S1", role: "admin", cursor: first.next_cursor, uiContext: {} });

  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 0);
  assert.equal(modelCalls, 0);
});

test("deterministic assistant explains known device links", () => {
  const result = createDeterministicAssistant().answer({
    message: "查询 SRV-DEMO 链路",
    context: siteContext(),
  });

  assert.match(result.answer, /CAB-09-PDU/);
  assert.match(result.answer, /ASW-05/);
  assert.deepEqual(result.evidence, [{ type: "device", id: "SRV-DEMO" }]);
});

test("orchestrator never sends its internal session ID to the model", async () => {
  let modelContext;
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: {
      async answerAssistant({ context }) {
        modelContext = context;
        return { answer: "安全回答", evidence: [], intent: { type: "answer" } };
      },
    },
  });

  await service.send({
    sessionId: "SECRET-SESSION-ID",
    actor: "admin",
    role: "admin",
    message: "全站状态",
    uiContext: {},
  });

  assert.equal(JSON.stringify(modelContext).includes("SECRET-SESSION-ID"), false);
  assert.equal(Object.hasOwn(modelContext, "session_id"), false);
});

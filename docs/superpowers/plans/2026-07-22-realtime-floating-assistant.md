# Realtime Floating Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 L5-A2-08 机房网站增加一个自动读取全站上下文、每 8 秒主动反馈风险、可通过私有模型生成受约束方案的悬浮 AI 助手。

**Architecture:** 服务端从版本化状态仓库构建语义完整且脱敏的全站上下文，使用确定性反馈检测器产生主动提醒，并通过现有兼容 OpenAI 的 Agent 网关完成结构化问答。浏览器仅发送当前路由和选中对象；任何模型提案都必须转换成现有计划并继续通过规则校验、唯一一次最终确认、执行、验证和审计闭环。

**Tech Stack:** Node.js 22、ES modules、原生 `node:http`、原生 Web API、版本化 JSON 仓库、Vanilla JavaScript/CSS、Node Test Runner、Playwright 1.61.1。

## Global Constraints

- 浏览器默认每 8 秒轮询一次；允许范围为 5–10 秒，不引入 WebSocket 或 SSE。
- API Key 只能从 `AGENT_API_KEY` 读取；模型地址和名称只能从 `AGENT_BASE_URL`、`AGENT_MODEL` 读取。
- 源码、Git 差异、HTTP 响应、浏览器状态和日志不得包含 API Key 或私有模型地址。
- 服务端会话最多保存最近 20 轮用户—助手对话，即最多 40 条聊天消息；退出登录立即清除。
- 每个会话每分钟最多 10 次模型聊天请求，同一会话最多一个在途模型请求。
- 管理员可生成待确认方案；只读用户只能查询、解释和诊断。
- 模型只允许返回 `answer`、`navigate`、`propose_placement`、`propose_remediation` 四种意图。
- 模型不得修改设备事实、机柜设计容量、规则结果、状态版本、确认次数或执行状态。
- 所有状态变更继续使用现有唯一一次最终确认；悬浮助手不能直接执行计划。
- 模型不可用时，容量、告警、链路和方案状态查询必须通过确定性降级继续可用。
- 当前截图中暴露过的 API Key 只用于本地演示，远程部署前必须轮换。
- 不引入新 npm 运行时依赖。

---

## File Structure

### New server files

- `src/assistant/context-service.js`：构建脱敏的全站语义上下文和证据索引。
- `src/assistant/feedback-detector.js`：把状态快照转换为稳定风险信号并计算差异事件。
- `src/assistant/session-store.js`：保存会话消息、反馈游标、提案、忙碌状态和限流窗口。
- `src/assistant/assistant-schema.js`：校验模型回答、证据和四类允许意图。
- `src/assistant/deterministic-assistant.js`：模型不可用时回答容量、链路、告警和计划状态问题。
- `src/assistant/assistant-orchestrator.js`：编排上下文、模型、降级、会话和提案。
- `src/assistant/action-bridge.js`：把已验证提案转换成现有 placement 或 alarm remediation 计划。
- `src/http/routes/assistant-routes.js`：暴露聊天、会话、反馈和提案转计划 API。

### New browser files

- `public/js/assistant-client.js`：管理悬浮助手状态、消息、8 秒轮询和 API 调用。
- `public/js/assistant-panel.js`：安全渲染面板、证据、提醒和提案卡片。
- `public/css/assistant.css`：悬浮按钮、420×640 面板、角标和移动端抽屉样式。

### New tests and tools

- `tests/assistant-context.test.js`
- `tests/assistant-feedback.test.js`
- `tests/assistant-session.test.js`
- `tests/assistant-schema.test.js`
- `tests/assistant-orchestrator.test.js`
- `tests/assistant-api.test.js`
- `tests/assistant-client.test.js`
- `tests/e2e/assistant.spec.js`
- `scripts/mock-agent-server.js`

### Existing files to modify

- `src/agent/agent-gateway.js`
- `src/http-app.js`
- `src/http/routes/auth-routes.js`
- `tests/helpers.js`
- `tests/agent-gateway.test.js`
- `tests/frontend-contract.test.js`
- `public/js/state.js`
- `public/js/app.js`
- `public/index.html`
- `public/css/style.css`
- `scripts/run-e2e.js`
- `README.md`

---

### Task 1: Build the full-site assistant context

**Files:**
- Create: `src/assistant/context-service.js`
- Create: `tests/assistant-context.test.js`

**Interfaces:**
- Consumes: `repository.read()`, `capacitySnapshot(state, rackId)`, `topologyService.devicePath(state, deviceId)`, `runtimeStatus()`.
- Produces: `createAssistantContextService({ repository, topologyService, runtimeStatus, now }).build({ role, uiContext })`.
- Return shape: `{ state_version, generated_at, role, ui_context, site, active_risks, entity_index }`.

- [ ] **Step 1: Write the failing context coverage and redaction tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantContextService } from "../src/assistant/context-service.js";
import { createDemoState } from "../src/demo-state.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createTopologyService } from "../src/topology/topology-service.js";

test("assistant context covers the whole site and resolves the selected rack", () => {
  const service = createAssistantContextService({
    repository: createMemoryRepository(createDemoState()),
    topologyService: createTopologyService(),
    runtimeStatus: () => ({ agent_configured: true, agent_model: "glm-demo", telemetry_status: "not_connected" }),
    now: () => "2026-07-22T00:00:00.000Z",
  });
  const context = service.build({ role: "admin", uiContext: { route: "rack", entity_id: "CAB-09", filters: {} } });

  assert.equal(context.state_version, 1);
  assert.equal(context.site.room.id, "L5-A2-08");
  assert.equal(context.site.racks.length, 22);
  assert.equal(context.site.devices.length, 3);
  assert.equal(context.ui_context.current_entity.id, "CAB-09");
  assert.ok(context.entity_index.some((item) => item.type === "device" && item.id === "SRV-DEMO-10U"));
  assert.ok(context.site.links["SRV-DEMO-10U"].power.length > 0);
});

test("assistant context never exposes secrets or session material", () => {
  const service = createAssistantContextService({
    repository: createMemoryRepository(createDemoState()),
    topologyService: createTopologyService(),
    runtimeStatus: () => ({ agent_configured: true, agent_model: "glm-demo" }),
  });
  const serialized = JSON.stringify(service.build({
    role: "viewer",
    uiContext: { route: "overview", cookie: "dc_session=secret", api_key: "secret-key" },
  }));

  assert.equal(serialized.includes("dc_session"), false);
  assert.equal(serialized.includes("secret-key"), false);
  assert.equal(serialized.includes("AGENT_BASE_URL"), false);
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test tests/assistant-context.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/assistant/context-service.js`.

- [ ] **Step 3: Implement the context service**

Implement these exact helpers and public factory:

```js
import { capacitySnapshot } from "../domain/capacity.js";

function safeUiContext(value = {}) {
  const filters = value.filters && typeof value.filters === "object" && !Array.isArray(value.filters) ? value.filters : {};
  const allowedFilters = ["query", "status", "severity", "source"];
  return {
    route: typeof value.route === "string" ? value.route : "overview",
    entity_id: typeof value.entity_id === "string" ? value.entity_id : null,
    filters: Object.fromEntries(allowedFilters.filter((key) => typeof filters[key] === "string").map((key) => [key, filters[key].slice(0, 200)])),
  };
}

function safeDevice(device) {
  const allowed = ["id", "asset_id", "hostname", "model", "rack_id", "layer_id", "u_size", "rated_power_w", "real_power_w", "weight_kg", "network_ports", "ip", "vlan", "business", "owner", "status", "data_source"];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(device, key)).map((key) => [key, structuredClone(device[key])]));
}

function activeRisks(state, racks) {
  const alarms = state.alarms.filter((alarm) => alarm.status !== "resolved").map((alarm) => ({ type: "alarm", id: alarm.id, severity: alarm.severity, object_id: alarm.object_id, code: alarm.trigger_code }));
  const capacities = racks.filter((rack) => {
    const value = rack.capacity;
    return [
      value.rated_power_used_w / value.design_power_w,
      value.used_u / value.usable_u,
      value.used_weight_kg / value.max_weight_kg,
      value.used_ports / value.port_limit,
    ].some((ratio) => Number.isFinite(ratio) && ratio >= 0.8);
  }).map((rack) => ({ type: "capacity", id: rack.id, severity: "warning", object_id: rack.id, code: "CAPACITY_WARNING" }));
  const blockers = state.plans.filter((plan) => plan.validation?.blockers?.length).map((plan) => ({ type: "constraint", id: plan.id, severity: "critical", object_id: plan.id, code: "CONSTRAINT_BLOCKED" }));
  const dependencies = Object.entries(state.service_health).filter(([, value]) => ["offline", "degraded"].includes(value.status)).map(([id, value]) => ({ type: "dependency", id, severity: "critical", object_id: id, code: value.status.toUpperCase() }));
  return [...alarms, ...capacities, ...blockers, ...dependencies];
}

export function createAssistantContextService({
  repository,
  topologyService,
  runtimeStatus = () => ({}),
  now = () => new Date().toISOString(),
}) {
  return {
    build({ role, uiContext = {} }) {
      const state = repository.read();
      const normalizedUi = safeUiContext(uiContext);
      const racks = state.racks.map((rack) => ({ ...structuredClone(rack), capacity: capacitySnapshot(state, rack.id) }));
      const devices = state.devices.filter((item) => item.status !== "cancelled").map(safeDevice);
      const links = Object.fromEntries(devices.map((device) => {
        try {
          return [device.id, topologyService.devicePath(state, device.id)];
        } catch {
          return [device.id, { device: { id: device.id }, power: [], network: [], redundancy: "unverified", missing_fields: ["topology"] }];
        }
      }));
      const entityIndex = [
        ...racks.map((rack) => ({ type: "rack", id: rack.id, label: rack.name })),
        ...devices.map((device) => ({ type: "device", id: device.id, label: device.hostname ?? device.id })),
        ...state.alarms.map((alarm) => ({ type: "alarm", id: alarm.id, label: alarm.trigger_code })),
        ...state.plans.map((plan) => ({ type: "plan", id: plan.id, label: plan.kind })),
        ...state.audit.slice(-50).map((entry) => ({ type: "audit", id: entry.id, label: entry.action })),
      ];
      const currentEntity = entityIndex.find((item) => item.id === normalizedUi.entity_id) ?? null;

      return {
        state_version: state.version,
        generated_at: now(),
        role,
        ui_context: { ...normalizedUi, current_entity: currentEntity },
        site: {
          room: structuredClone(state.room),
          power_sources: structuredClone(state.power_sources),
          racks,
          devices,
          links,
          alarms: structuredClone(state.alarms),
          diagnoses: structuredClone(state.diagnoses),
          plans: structuredClone(state.plans),
          changes: structuredClone(state.changes),
          audit: structuredClone(state.audit.slice(-50)),
          service_health: structuredClone(state.service_health),
          runtime: structuredClone(runtimeStatus()),
        },
        active_risks: activeRisks(state, racks),
        entity_index: entityIndex,
      };
    },
  };
}
```

- [ ] **Step 4: Run the context tests**

Run: `node --test tests/assistant-context.test.js`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the context service**

```powershell
git add src/assistant/context-service.js tests/assistant-context.test.js
git commit -m "feat: build assistant site context"
```

---

### Task 2: Detect and deduplicate proactive feedback

**Files:**
- Create: `src/assistant/feedback-detector.js`
- Create: `tests/assistant-feedback.test.js`

**Interfaces:**
- Consumes: the context returned by Task 1.
- Produces: `captureFeedbackSnapshot(context)` and `diffFeedbackSnapshots(previous, current, now)`.
- Event shape: `{ id, type, severity, entity, message, state_version, occurred_at }`.

- [ ] **Step 1: Write failing tests for initial risks, transitions and stable IDs**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { captureFeedbackSnapshot, diffFeedbackSnapshots } from "../src/assistant/feedback-detector.js";

function context(version, overrides = {}) {
  return {
    state_version: version,
    site: { racks: [], alarms: [], plans: [], service_health: {}, runtime: {}, ...overrides },
  };
}

test("initial feedback includes active alarms once", () => {
  const current = captureFeedbackSnapshot(context(4, {
    alarms: [{ id: "ALARM-1", status: "open", severity: "critical", trigger_code: "RACK_POWER_HIGH", object_id: "CAB-01" }],
  }));
  const first = diffFeedbackSnapshots(null, current, () => "2026-07-22T00:00:00.000Z");
  const repeated = diffFeedbackSnapshots(current, current, () => "2026-07-22T00:00:08.000Z");

  assert.equal(first.length, 1);
  assert.equal(first[0].type, "alarm_opened");
  assert.equal(repeated.length, 0);
});

test("feedback detects capacity and execution transitions", () => {
  const before = captureFeedbackSnapshot(context(8));
  const after = captureFeedbackSnapshot(context(9, {
    racks: [{ id: "CAB-09", capacity: { rated_power_used_w: 8_200, design_power_w: 10_000, used_u: 10, usable_u: 40, used_weight_kg: 100, max_weight_kg: 420, used_ports: 4, port_limit: 24 } }],
    plans: [{ id: "PLAN-1", status: "failed", validation: { blockers: [] } }],
  }));
  const events = diffFeedbackSnapshots(before, after, () => "2026-07-22T00:00:08.000Z");

  assert.deepEqual(events.map((item) => item.type).sort(), ["capacity_warning", "plan_failed"]);
  assert.equal(new Set(events.map((item) => item.id)).size, events.length);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/assistant-feedback.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement feedback snapshot and diff functions**

Use a `Map` keyed by `<type>:<entity-id>` and include these signals:

```js
function ratio(used, limit) {
  return Number(limit) > 0 ? Number(used) / Number(limit) : 0;
}

function signal(type, entity, severity, message, stateVersion, fingerprint, initialVisible = true) {
  return { key: `${type}:${entity.type}:${entity.id}`, type, entity, severity, message, state_version: stateVersion, fingerprint, initial_visible: initialVisible };
}

export function captureFeedbackSnapshot(context) {
  const signals = [];
  for (const alarm of context.site.alarms.filter((item) => item.status !== "resolved")) {
    signals.push(signal("alarm_opened", { type: "alarm", id: alarm.id }, alarm.severity, alarm.trigger_code, context.state_version, alarm.status));
  }
  for (const rack of context.site.racks) {
    const capacity = rack.capacity;
    const metrics = [
      ratio(capacity.rated_power_used_w, capacity.design_power_w),
      ratio(capacity.used_u, capacity.usable_u),
      ratio(capacity.used_weight_kg, capacity.max_weight_kg),
      ratio(capacity.used_ports, capacity.port_limit),
    ];
    if (Math.max(...metrics) >= 0.8) {
      signals.push(signal("capacity_warning", { type: "rack", id: rack.id }, "warning", `${rack.id} 容量达到 80% 告警线`, context.state_version, metrics.map((item) => item.toFixed(3)).join("/")));
    }
  }
  for (const plan of context.site.plans) {
    if (plan.validation?.blockers?.length) signals.push(signal("constraint_blocked", { type: "plan", id: plan.id }, "critical", `${plan.id} 被硬约束阻断`, context.state_version, String(plan.validation.blockers.length)));
    if (["succeeded", "failed"].includes(plan.status)) signals.push(signal(`plan_${plan.status}`, { type: "plan", id: plan.id }, plan.status === "failed" ? "critical" : "info", `${plan.id} ${plan.status}`, context.state_version, plan.status, plan.status === "failed"));
  }
  for (const [name, health] of Object.entries(context.site.service_health ?? {})) {
    if (["offline", "degraded"].includes(health.status)) signals.push(signal("dependency_offline", { type: "service", id: name }, "critical", `${name} ${health.status}`, context.state_version, `${health.status}:${health.checked_at ?? ""}`));
  }
  return { state_version: context.state_version, signals: Object.fromEntries(signals.map((item) => [item.key, item])) };
}

export function diffFeedbackSnapshots(previous, current, now = () => new Date().toISOString()) {
  return Object.values(current.signals).filter((item) => previous ? !previous.signals[item.key] || previous.signals[item.key].fingerprint !== item.fingerprint : item.initial_visible).map((item) => ({
    id: `${current.state_version}:${item.key}:${item.fingerprint}`,
    type: item.type,
    severity: item.severity,
    entity: item.entity,
    message: item.message,
    state_version: current.state_version,
    occurred_at: now(),
  }));
}
```

- [ ] **Step 4: Run the feedback tests**

Run: `node --test tests/assistant-feedback.test.js`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the feedback detector**

```powershell
git add src/assistant/feedback-detector.js tests/assistant-feedback.test.js
git commit -m "feat: detect assistant feedback events"
```

---

### Task 3: Add bounded assistant sessions, cursors and rate limits

**Files:**
- Create: `src/assistant/session-store.js`
- Create: `tests/assistant-session.test.js`

**Interfaces:**
- Consumes: feedback snapshots and events from Task 2.
- Produces: `createAssistantSessionStore({ now, maxTurns, requestsPerMinute })`.
- Public methods: `session`, `appendTurn`, `beginRequest`, `endRequest`, `syncFeedback`, `feedback`, `saveProposal`, `getProposal`, `markProposalUsed`, `clear`.

- [ ] **Step 1: Write failing tests for bounds, polling cursors and request guards**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantSessionStore } from "../src/assistant/session-store.js";

test("session keeps only twenty user-assistant turns", () => {
  const store = createAssistantSessionStore();
  for (let index = 0; index < 21; index += 1) store.appendTurn("S1", { content: `u${index}` }, { content: `a${index}` });
  assert.equal(store.session("S1").messages.length, 40);
  assert.equal(store.session("S1").messages[0].content, "u1");
});

test("feedback cursor returns each event once and clear removes the session", () => {
  const store = createAssistantSessionStore();
  store.syncFeedback("S1", { state_version: 2, signals: {} }, [{ id: "E1", message: "risk" }]);
  const first = store.feedback("S1", 0);
  const second = store.feedback("S1", first.next_cursor);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 0);
  store.clear("S1");
  assert.equal(store.session("S1").messages.length, 0);
});

test("session rejects concurrent and eleventh requests in one minute", () => {
  let clock = 1_000;
  const store = createAssistantSessionStore({ now: () => clock });
  store.beginRequest("S1");
  assert.throws(() => store.beginRequest("S1"), (error) => error.code === "ASSISTANT_BUSY");
  store.endRequest("S1");
  for (let index = 1; index < 10; index += 1) { store.beginRequest("S1"); store.endRequest("S1"); }
  assert.throws(() => store.beginRequest("S1"), (error) => error.code === "ASSISTANT_RATE_LIMITED" && error.retry_after_ms > 0);
  clock += 60_001;
  assert.doesNotThrow(() => store.beginRequest("S1"));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/assistant-session.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the in-memory session store**

Each session record must use this shape:

```js
{
  messages: [],
  feedback_snapshot: null,
  feedback_events: [],
  next_cursor: 0,
  proposals: new Map(),
  request_started_at: [],
  busy: false
}
```

Implement `appendTurn` by pushing `{ role: "user", ...user }` and `{ role: "assistant", ...assistant }`, then slicing to the latest `maxTurns * 2` messages. Implement `beginRequest` by removing timestamps older than 60,000 ms, rejecting `busy`, rejecting a full window with `ASSISTANT_RATE_LIMITED`, and setting `retry_after_ms` to `oldest + 60_000 - now()`. Implement feedback cursors as monotonically increasing integers stored on each event. `markProposalUsed` must reject a second use with `ASSISTANT_PROPOSAL_USED`.

- [ ] **Step 4: Run the session tests**

Run: `node --test tests/assistant-session.test.js`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the session store**

```powershell
git add src/assistant/session-store.js tests/assistant-session.test.js
git commit -m "feat: add bounded assistant sessions"
```

---

### Task 4: Extend the private model gateway with safe assistant responses

**Files:**
- Create: `src/assistant/assistant-schema.js`
- Create: `tests/assistant-schema.test.js`
- Modify: `src/agent/agent-gateway.js`
- Modify: `tests/agent-gateway.test.js`

**Interfaces:**
- Consumes: the full-site context, user message and previous session messages.
- Produces: `validateAssistantResponse(value, { entityIds })` and `agentGateway.answerAssistant({ message, context, history })`.
- Structured result: `{ answer, evidence, intent }`.

- [ ] **Step 1: Write failing schema tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateAssistantResponse } from "../src/assistant/assistant-schema.js";

test("assistant accepts cited answers and placement intents", () => {
  const result = validateAssistantResponse({
    answer: "CAB-09 当前仍需经过容量复核。",
    evidence: [{ type: "rack", id: "CAB-09" }],
    intent: { type: "propose_placement" },
  }, { entityIds: new Set(["CAB-09"]) });
  assert.equal(result.intent.type, "propose_placement");
});

test("assistant rejects invented evidence and unsupported actions", () => {
  assert.throws(() => validateAssistantResponse({ answer: "x", evidence: [{ type: "rack", id: "CAB-99" }], intent: { type: "answer" } }, { entityIds: new Set(["CAB-09"]) }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validateAssistantResponse({ answer: "x", evidence: [], intent: { type: "execute_plan", plan_id: "P1" } }, { entityIds: new Set() }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});
```

- [ ] **Step 2: Add a failing gateway test for `/v1/chat/completions` assistant calls**

Append to `tests/agent-gateway.test.js`:

```js
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
    context: { entity_index: [{ type: "rack", id: "CAB-09" }], site: { racks: [] } },
  });
  assert.equal(result.evidence[0].id, "CAB-09");
});
```

- [ ] **Step 3: Run both tests and verify the missing exports**

Run: `node --test tests/assistant-schema.test.js tests/agent-gateway.test.js`

Expected: FAIL because `assistant-schema.js` and `answerAssistant` do not exist.

- [ ] **Step 4: Implement the schema and gateway method**

`validateAssistantResponse` must trim and cap `answer` at 4,000 characters, validate every evidence ID against `entityIds`, and accept only these exact intent shapes:

```js
{ type: "answer" }
{ type: "navigate", target: { type: "rack" | "device" | "alarm" | "plan" | "audit", id: string } }
{ type: "propose_placement" }
{ type: "propose_remediation", alarm_id: string }
```

Add this message builder and method to `src/agent/agent-gateway.js`:

```js
import { validateAssistantResponse } from "../assistant/assistant-schema.js";

function assistantMessages({ message, context, history }) {
  return [
    {
      role: "system",
      content: "你是机房全站助手。只输出JSON对象，字段为answer,evidence,intent。只能引用context.entity_index中的实体；只能使用answer、navigate、propose_placement、propose_remediation意图；不得执行计划、修改设备事实、修改机柜设计容量或改写规则结果。信息不足时用answer说明缺少字段。",
    },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: JSON.stringify({ message, context }) },
  ];
}

async function answerAssistant(input) {
  const entityIds = new Set(input.context.entity_index.map((item) => item.id));
  return validateAssistantResponse(await complete(assistantMessages(input)), { entityIds });
}
```

Expose `answerAssistant` alongside `extractRequest`, `adjustPlan` and `health`.

- [ ] **Step 5: Run the schema and gateway tests**

Run: `node --test tests/assistant-schema.test.js tests/agent-gateway.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit the model contract**

```powershell
git add src/assistant/assistant-schema.js src/agent/agent-gateway.js tests/assistant-schema.test.js tests/agent-gateway.test.js
git commit -m "feat: validate assistant model responses"
```

---

### Task 5: Orchestrate model chat, deterministic fallback and proposals

**Files:**
- Create: `src/assistant/deterministic-assistant.js`
- Create: `src/assistant/assistant-orchestrator.js`
- Create: `tests/assistant-orchestrator.test.js`

**Interfaces:**
- Consumes: context service, session store, feedback detector and optional Agent gateway.
- Produces: `createAssistantOrchestrator(dependencies)` with `send`, `session`, `feedback`, `getProposal`, `markProposalUsed`, `clear`.
- Proposal shape: `{ id, type, payload, state_version, created_at, created_by, used }`.

- [ ] **Step 1: Write failing orchestration tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantOrchestrator } from "../src/assistant/assistant-orchestrator.js";
import { createAssistantSessionStore } from "../src/assistant/session-store.js";

function contextService() {
  return { build: () => ({
    state_version: 7,
    entity_index: [{ type: "rack", id: "CAB-09" }],
    site: { room: { id: "L5-A2-08" }, racks: [{ id: "CAB-09", capacity: { rated_power_used_w: 3_500, design_power_w: 20_000, used_u: 10, usable_u: 40 } }], devices: [], links: {}, alarms: [], plans: [], service_health: {}, runtime: {} },
  }) };
}

test("orchestrator stores cited model answers", async () => {
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: { async answerAssistant() { return { answer: "容量正常", evidence: [{ type: "rack", id: "CAB-09" }], intent: { type: "answer" } }; } },
  });
  const result = await service.send({ sessionId: "S1", actor: "admin", role: "admin", message: "CAB-09 容量", uiContext: {} });
  assert.equal(result.answer, "容量正常");
  assert.equal(service.session("S1").messages.length, 2);
});

test("orchestrator degrades deterministically when the model is offline", async () => {
  const service = createAssistantOrchestrator({
    contextService: contextService(),
    sessionStore: createAssistantSessionStore(),
    agentGateway: { async answerAssistant() { throw Object.assign(new Error("offline"), { code: "AGENT_UNAVAILABLE" }); } },
  });
  const result = await service.send({ sessionId: "S1", actor: "viewer", role: "viewer", message: "CAB-09 容量", uiContext: {} });
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
    agentGateway: {
      async answerAssistant() { return { answer: "可以生成方案", evidence: [{ type: "rack", id: "CAB-09" }], intent: { type: "propose_placement" } }; },
      async extractRequest() { return { id: "SRV-NEW", count: 1, u_size: 4, rated_power_w: 1200, real_power_w: null, weight_kg: 30, network_ports: 2, preferred_rack_ids: ["CAB-09"] }; },
    },
  });
  const result = await service.send({ sessionId: "S1", actor: "admin", role: "admin", message: "上架 SRV-NEW 4U 1200W 30kg 2端口到 CAB-09", uiContext: {} });
  assert.equal(result.proposal.id, "PROPOSAL-P1");
  assert.equal(store.getProposal("S1", "PROPOSAL-P1").used, false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/assistant-orchestrator.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement deterministic answers**

`createDeterministicAssistant().answer({ message, context })` must:

- match `CAB-\d{2}` and report rated power, design power, used U and usable U;
- match `SRV-[A-Z0-9-]+` and report the known power/network path or explicitly say the link is unknown;
- answer alarm questions with all unresolved alarms;
- answer plan questions with the latest five plan IDs and statuses;
- otherwise return the room ID, rack count and unresolved alarm count;
- always return `{ answer, evidence, intent: { type: "answer" } }`.

- [ ] **Step 4: Implement the orchestrator**

`send` must validate a non-empty message of at most 2,000 characters, call `sessionStore.beginRequest`, build context, try `agentGateway.answerAssistant`, catch `AGENT_UNAVAILABLE`/`AGENT_RESPONSE_INVALID` and call the deterministic assistant, enforce viewer read-only behavior, and append one turn in `finally`-safe code. For `propose_placement`, call the existing `agentGateway.extractRequest(message)` and save the validated result as a proposal; for `propose_remediation`, verify `alarm_id` exists in `context.site.alarms` before saving. Stamp proposal IDs, state version, actor and timestamp on the server.

`feedback` must build fresh context, call `captureFeedbackSnapshot`, compare with the session's previous snapshot, store new events, and return events after the supplied numeric cursor. It must never call the Agent gateway.

- [ ] **Step 5: Run orchestration and dependency tests**

Run: `node --test tests/assistant-orchestrator.test.js tests/assistant-context.test.js tests/assistant-feedback.test.js tests/assistant-session.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit the orchestrator**

```powershell
git add src/assistant/deterministic-assistant.js src/assistant/assistant-orchestrator.js tests/assistant-orchestrator.test.js
git commit -m "feat: orchestrate contextual assistant chat"
```

---

### Task 6: Bridge proposals into guarded plans and expose assistant APIs

**Files:**
- Create: `src/assistant/action-bridge.js`
- Create: `src/http/routes/assistant-routes.js`
- Create: `tests/assistant-api.test.js`
- Modify: `src/http-app.js`
- Modify: `src/http/routes/auth-routes.js`
- Modify: `tests/helpers.js`

**Interfaces:**
- Consumes: assistant orchestrator, plan service, diagnosis engine, alarm engine and session context.
- Produces: four authenticated endpoints from the design spec.
- The proposal endpoint returns a normal existing plan and never confirms it.

- [ ] **Step 1: Write failing authenticated API tests**

Create tests that use `withAuthenticatedServer` and a fake `agentGateway`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { withAuthenticatedServer } from "./helpers.js";

function fakeAssistantGateway() {
  return {
    async answerAssistant({ message }) {
      return message.includes("SRV-CHAT")
        ? { answer: "可以生成受约束方案", evidence: [{ type: "rack", id: "CAB-09" }], intent: { type: "propose_placement" } }
        : { answer: "CAB-09 容量可查询", evidence: [{ type: "rack", id: "CAB-09" }], intent: { type: "answer" } };
    },
    async extractRequest() {
      return { id: "SRV-CHAT", count: 1, u_size: 4, rated_power_w: 1_200, real_power_w: null, weight_kg: 30, network_ports: 2, preferred_rack_ids: ["CAB-09"] };
    },
    async adjustPlan(context) {
      const candidate = context.candidates[0];
      return { candidate_id: candidate?.id ?? null, reason: "保持规则引擎首选方案", actions: candidate?.actions ?? [] };
    },
  };
}

test("admin chats, polls feedback, and converts a proposal into an unconfirmed plan", async () => {
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("admin", "admin-pass");
    const chat = await request("/api/assistant/messages", {
      method: "POST",
      cookie: signedIn.cookie,
      body: { message: "上架 SRV-CHAT 4U 1200W 30kg 2端口到 CAB-09", ui_context: { route: "rack", entity_id: "CAB-09", filters: {} } },
    });
    assert.equal(chat.response.status, 200);
    assert.equal(chat.body.proposal.type, "placement");

    const created = await request(`/api/assistant/proposals/${chat.body.proposal.id}/plans`, { method: "POST", cookie: signedIn.cookie, body: {} });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, "awaiting_confirmation");
    assert.equal(created.body.confirmation_count, 0);

    const feedback = await request("/api/assistant/feedback?cursor=0", { cookie: signedIn.cookie });
    assert.equal(feedback.response.status, 200);
    assert.ok(Number.isInteger(feedback.body.next_cursor));
  }, { agentGateway: fakeAssistantGateway() });
});

test("viewer can chat but cannot convert proposals", async () => {
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("viewer", "viewer-pass");
    const chat = await request("/api/assistant/messages", { method: "POST", cookie: signedIn.cookie, body: { message: "CAB-09 容量", ui_context: {} } });
    assert.equal(chat.response.status, 200);
    const forbidden = await request("/api/assistant/proposals/P1/plans", { method: "POST", cookie: signedIn.cookie, body: {} });
    assert.equal(forbidden.response.status, 403);
  });
});

test("logout clears assistant session messages", async () => {
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("admin", "admin-pass");
    await request("/api/assistant/messages", { method: "POST", cookie: signedIn.cookie, body: { message: "全站状态", ui_context: {} } });
    await request("/api/auth/logout", { method: "POST", cookie: signedIn.cookie, body: {} });
    const expired = await request("/api/assistant/session", { cookie: signedIn.cookie });
    assert.equal(expired.response.status, 401);
  });
});
```

- [ ] **Step 2: Run the API test and verify 404 failures**

Run: `node --test tests/assistant-api.test.js`

Expected: FAIL because `/api/assistant/*` routes do not exist.

- [ ] **Step 3: Implement the action bridge**

```js
export function createAssistantActionBridge({ repository, planService, diagnosisEngine }) {
  return {
    async createPlan(proposal, actor) {
      if (proposal.type === "placement") {
        return planService.create({ kind: "placement", device: structuredClone(proposal.payload.device) }, actor);
      }
      if (proposal.type === "remediation") {
        const alarm = repository.read().alarms.find((item) => item.id === proposal.payload.alarm_id);
        if (!alarm) throw Object.assign(new Error("Alarm does not exist"), { code: "ALARM_NOT_FOUND" });
        if (["open", "acknowledged"].includes(alarm.status)) diagnosisEngine.diagnose(alarm.id, actor);
        return diagnosisEngine.createRemediation(alarm.id, actor);
      }
      throw Object.assign(new Error("Proposal type is unsupported"), { code: "ASSISTANT_PROPOSAL_INVALID" });
    },
  };
}
```

- [ ] **Step 4: Register the assistant routes**

`registerAssistantRoutes(router, { orchestrator, actionBridge })` must add:

```js
router.add("GET", "/api/assistant/session", ({ context }) => orchestrator.session(context.sessionId));
router.add("GET", "/api/assistant/feedback", ({ context, url }) => orchestrator.feedback({ sessionId: context.sessionId, actor: context.actor, role: context.role, cursor: Number(url.searchParams.get("cursor") || 0), uiContext: { route: url.searchParams.get("route"), entity_id: url.searchParams.get("entity_id") } }));
router.add("POST", "/api/assistant/messages", async ({ request, context, readJsonBody }) => {
  const body = await readJsonBody(request);
  return orchestrator.send({ sessionId: context.sessionId, actor: context.actor, role: context.role, message: body.message, uiContext: body.ui_context });
});
router.add("POST", "/api/assistant/proposals/:id/plans", async ({ request, params, context, readJsonBody }) => {
  await readJsonBody(request);
  const proposal = orchestrator.getProposal(context.sessionId, params.id);
  const plan = await actionBridge.createPlan(proposal, context.actor);
  orchestrator.markProposalUsed(context.sessionId, params.id);
  return { status: 201, body: plan };
});
```

Wire all Task 1–6 services in `createServerApp`. Extend `requiresAdmin` for `^/api/assistant/proposals/[^/]+/plans$`. Extend `errorStatus` with `ASSISTANT_INPUT_INVALID → 400`, `ASSISTANT_BUSY → 409`, `ASSISTANT_RATE_LIMITED → 429`, `ASSISTANT_PROPOSAL_USED → 409`, and `ASSISTANT_PROPOSAL_INVALID → 422`. Include `retry_after_ms` in safe error details.

Modify `registerAuthRoutes` to accept `onLogout = () => {}` and call `onLogout(context.sessionId)` before `auth.logout(context)`. Pass `orchestrator.clear` from `createServerApp`.

Add an optional `assistantSessionStore` dependency to `createServerApp`, defaulting to a new Task 3 store, so logout cleanup can be asserted without exposing sessions through HTTP. Modify `withAuthenticatedServer(assertions, overrides = {})` so it forwards `agentGateway`, `state`, `repository`, `telemetryProvider` and `assistantSessionStore` to `withV02Server` while retaining its test auth. Parse the session ID from the test cookie before logout and assert `assistantSessionStore.session(sessionId).messages.length === 0` after logout.

- [ ] **Step 5: Run API and regression tests**

Run: `node --test tests/assistant-api.test.js tests/auth.test.js tests/api-v02.test.js tests/agent-gateway.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit the guarded API bridge**

```powershell
git add src/assistant/action-bridge.js src/http/routes/assistant-routes.js src/http-app.js src/http/routes/auth-routes.js tests/helpers.js tests/assistant-api.test.js
git commit -m "feat: expose guarded assistant APIs"
```

---

### Task 7: Add the browser assistant client and 8-second polling

**Files:**
- Create: `public/js/assistant-client.js`
- Create: `tests/assistant-client.test.js`
- Modify: `public/js/state.js`

**Interfaces:**
- Consumes: `get`/`post` from `public/js/api.js` and a `getUiContext` callback.
- Produces: `createAssistantClient(dependencies)` with `subscribe`, `snapshot`, `setSession`, `setOpen`, `send`, `poll`, `acceptProposal`, `start`, `stop`.
- Calls `onPlanCreated(plan)` after proposal conversion; it does not confirm the plan.

- [ ] **Step 1: Write failing client tests with injected timers and HTTP functions**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantClient } from "../public/js/assistant-client.js";

test("assistant client polls every eight seconds and advances its cursor", async () => {
  let scheduled;
  const calls = [];
  const client = createAssistantClient({
    getImpl: async (path) => { calls.push(path); return path.startsWith("/api/assistant/feedback") ? { events: [{ id: "E1", message: "risk" }], next_cursor: 1, state_version: 2, synced_at: "now" } : { messages: [] }; },
    postImpl: async () => ({}),
    getUiContext: () => ({ route: "overview", entity_id: null, filters: {} }),
    setIntervalImpl: (callback, delay) => { scheduled = { callback, delay }; return 1; },
    clearIntervalImpl: () => {},
  });
  await client.setSession({ authenticated: true, role: "admin" });
  assert.equal(scheduled.delay, 8_000);
  await scheduled.callback();
  assert.equal(client.snapshot().cursor, 1);
  assert.equal(client.snapshot().unread, 1);
});

test("assistant client sends current UI context and adopts but never confirms a plan", async () => {
  const posts = [];
  let adopted = null;
  const client = createAssistantClient({
    getImpl: async () => ({ messages: [] }),
    postImpl: async (path, body) => { posts.push({ path, body }); return path.endsWith("/plans") ? { id: "PLAN-1", status: "awaiting_confirmation" } : { answer: "ok", evidence: [], proposal: { id: "P1" } }; },
    getUiContext: () => ({ route: "rack", entity_id: "CAB-09", filters: {} }),
    onPlanCreated: (plan) => { adopted = plan; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  await client.send("容量如何");
  await client.acceptProposal("P1");
  assert.equal(posts[0].body.ui_context.entity_id, "CAB-09");
  assert.equal(adopted.status, "awaiting_confirmation");
  assert.equal(posts.some((item) => item.path.includes("/confirm")), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/assistant-client.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the client state machine**

Use this initial state:

```js
{
  authenticated: false,
  role: null,
  open: false,
  loading: false,
  sending: false,
  sync_status: "idle",
  model_status: "unknown",
  state_version: null,
  cursor: 0,
  unread: 0,
  messages: [],
  feedback: [],
  error: null
}
```

`setSession` must start polling only after authentication and must stop, reset and clear messages after logout. `poll` must encode `cursor`, `route` and `entity_id`, append only unseen event IDs, set `unread` only while the panel is closed, and mark `sync_status` as `interrupted` on failure. `send` must reject blank text locally and append both user and assistant messages. `acceptProposal` posts only to `/api/assistant/proposals/:id/plans` and calls `onPlanCreated`.

Add `getAssistantUiContext()` and `adoptAssistantPlan(plan)` to `public/js/state.js`. The latter assigns `currentPlan`, clears `lastExecution`, and routes alarm remediation plans to `alarms` and placement plans to `agent` without confirming either plan.

- [ ] **Step 4: Run client and frontend contract tests**

Run: `node --test tests/assistant-client.test.js tests/frontend-contract.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit the browser client**

```powershell
git add public/js/assistant-client.js public/js/state.js tests/assistant-client.test.js
git commit -m "feat: poll assistant feedback in browser"
```

---

### Task 8: Build the floating assistant panel

**Files:**
- Create: `public/js/assistant-panel.js`
- Create: `public/css/assistant.css`
- Modify: `public/index.html`
- Modify: `public/css/style.css`
- Modify: `public/js/app.js`
- Modify: `tests/frontend-contract.test.js`

**Interfaces:**
- Consumes: the Task 7 client, `h`/`clear` helpers, `setRoute`, `adoptAssistantPlan` and `getAssistantUiContext`.
- Produces: `mountAssistantPanel({ root, client, onNavigate })`.
- All model text is rendered through the existing `h(..., { text })` helper.

- [ ] **Step 1: Add failing frontend contract assertions**

Append assertions that require:

```js
assert.match(index, /id="assistant-root"/);
assert.match(app, /createAssistantClient/);
assert.match(app, /mountAssistantPanel/);
assert.match(style, /assistant\.css/);
assert.match(panel, /AI 助手/);
assert.match(panel, /生成待确认方案/);
assert.doesNotMatch(panel, /innerHTML/);
```

Read `public/js/assistant-panel.js` and `public/css/assistant.css` in the test setup.

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test tests/frontend-contract.test.js`

Expected: FAIL because the root, panel and stylesheet do not exist.

- [ ] **Step 3: Implement safe panel rendering**

`mountAssistantPanel` must render:

- a fixed button with text `AI 助手` and an unread badge;
- a panel with `role="dialog"`, `aria-label="全站 AI 助手"`, sync status, model status, role and state version;
- a chronological transcript of feedback, user messages and assistant messages;
- evidence buttons carrying `data-type` and `data-id` and invoking `onNavigate`;
- proposal cards that show type, state version and evidence;
- an enabled `生成待确认方案` button only for administrators;
- a text form with submit label `发送` and a busy label `正在分析全站状态…`.

Never call `innerHTML`. Use `h`, `clear`, `textContent` and event listeners only.

- [ ] **Step 4: Add the panel to the application shell**

Add `<div id="assistant-root"></div>` before `#dialog-root`. Import `assistant.css` in `public/css/style.css`. In `public/js/app.js`, create one client and one panel after existing DOM references:

```js
const assistantClient = createAssistantClient({
  getUiContext: getAssistantUiContext,
  onPlanCreated: adoptAssistantPlan,
});

mountAssistantPanel({
  root: document.querySelector("#assistant-root"),
  client: assistantClient,
  onNavigate: ({ type, id }) => {
    if (type === "rack") setRoute("rack", id);
    else if (type === "device") setRoute("topology", id);
    else if (type === "alarm") setRoute("alarms", id);
    else if (type === "plan") setRoute("agent");
    else setRoute("audit");
  },
});
```

Call `assistantClient.setSession(state.session)` only when authentication state or role changes, not on every render.

- [ ] **Step 5: Implement the visual system**

`public/css/assistant.css` must define `.assistant-launcher`, `.assistant-unread`, `.assistant-panel`, `.assistant-head`, `.assistant-status`, `.assistant-transcript`, `.assistant-message`, `.assistant-feedback`, `.assistant-evidence`, `.assistant-proposal`, `.assistant-composer` and focus-visible states. Use `position: fixed; right: 24px; bottom: 24px; width: min(420px, calc(100vw - 32px)); height: min(640px, calc(100vh - 48px)); z-index: 40`. At `max-width: 650px`, set the panel to the viewport edges with full width and height.

- [ ] **Step 6: Run contract and all browser-independent tests**

Run: `node --test tests/frontend-contract.test.js tests/assistant-client.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit the floating interface**

```powershell
git add public/js/assistant-panel.js public/css/assistant.css public/index.html public/css/style.css public/js/app.js tests/frontend-contract.test.js
git commit -m "feat: add floating site assistant"
```

---

### Task 9: Close the browser loops, document configuration and verify secrets

**Files:**
- Create: `scripts/mock-agent-server.js`
- Create: `tests/e2e/assistant.spec.js`
- Modify: `scripts/run-e2e.js`
- Modify: `README.md`

**Interfaces:**
- The mock server implements only OpenAI-compatible `POST /v1/chat/completions` for deterministic E2E tests.
- Production and local runtime continue to use the user-supplied `AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL` and `AGENT_TIMEOUT_MS`.

- [ ] **Step 1: Write failing end-to-end scenarios**

Create Playwright tests for these exact loops:

```js
import { test, expect } from "playwright/test";

async function login(page, username = "admin", password = "demo-admin-pass") {
  await page.goto("/");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator("#app-shell")).not.toHaveClass(/is-locked/);
}

async function resetDemo(page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/demo/reset", { headers: { origin }, data: {} });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(".rack-card")).toHaveCount(22);
}

test("floating assistant reads site context and links to rack evidence", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByLabel("向全站 AI 助手提问").fill("CAB-09 当前容量如何？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".assistant-message-assistant")).toContainText("CAB-09");
  await page.getByRole("button", { name: /查看 CAB-09/ }).click();
  await expect(page.getByRole("heading", { name: /CAB-09/ })).toBeVisible();
});

test("new alarm appears as proactive feedback within one poll cycle", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  const origin = new URL(page.url()).origin;
  await page.request.post("/api/demo/alarms", { headers: { origin }, data: { scenario: "power_high" } });
  await expect(page.locator(".assistant-unread")).toHaveText("1", { timeout: 10_000 });
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByRole("button", { name: /查看 ALARM-/ }).click();
  await expect(page.getByRole("heading", { name: "报警诊断" })).toBeVisible();
});

test("admin creates a proposal but still uses the only final confirmation", async ({ page }) => {
  await login(page);
  await resetDemo(page);
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByLabel("向全站 AI 助手提问").fill("上架 SRV-ASSIST-E2E，4U，1200W，30kg，2端口，优选 CAB-03");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "生成待确认方案" }).click();
  await expect(page.getByText("方案已完成硬约束复核")).toBeVisible();
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await expect(page.getByRole("dialog")).toContainText("只有这一次最终确认");
});
```

Also add a viewer scenario that confirms chat works while `生成待确认方案` is absent or disabled, and a logout/login scenario that confirms the old transcript is empty.

- [ ] **Step 2: Run the E2E file and verify it fails before the mock model exists**

Run: `npm.cmd run test:e2e -- tests/e2e/assistant.spec.js`

Expected: FAIL because the test server has no configured model response for proposal generation.

- [ ] **Step 3: Implement the E2E-only model server**

The server must listen on `127.0.0.1:3200`, accept only `POST /v1/chat/completions`, inspect the system message, and return Chat Completions JSON. If the system text contains `answer,evidence,intent`, return either a cited CAB-09 answer or `propose_placement` for messages containing `SRV-ASSIST-E2E`. If the system text contains `id,count,u_size`, return the exact `SRV-ASSIST-E2E` device facts from the test. Return `{ candidate_id: null, reason: "保持规则引擎首选方案", actions: [] }` for plan adjustment prompts.

Do not accept or record authorization headers and do not print request bodies.

- [ ] **Step 4: Start and stop the mock model with the E2E server**

Modify `scripts/run-e2e.js` to spawn `scripts/mock-agent-server.js`, wait for `http://127.0.0.1:3200/health`, and give the application these test-only values:

```js
AGENT_BASE_URL: "http://127.0.0.1:3200",
AGENT_API_KEY: "e2e-only-agent-key",
AGENT_MODEL: "e2e-agent-model",
AGENT_TIMEOUT_MS: "2000",
```

Terminate both child processes in `finally`.

- [ ] **Step 5: Run the assistant E2E loops**

Run: `npm.cmd run test:e2e -- tests/e2e/assistant.spec.js`

Expected: all assistant E2E tests PASS.

- [ ] **Step 6: Update the runbook**

Add a `悬浮 AI 助手` section to `README.md` that documents:

- server-only environment variables;
- 8-second feedback polling;
- admin/viewer behavior;
- session-only history;
- deterministic fallback;
- the unique final-confirmation boundary;
- API Key rotation before remote deployment;
- a leadership demo sequence covering query, proactive alarm, proposal and final confirmation.

- [ ] **Step 7: Run the complete verification suite**

Run: `npm.cmd run test:all`

Expected: all Node and Playwright tests PASS with zero failures.

Run: `git diff --check`

Expected: no output and exit code 0.

Run this tracked-source secret scan from the repository root:

```powershell
$tracked = git ls-files
$hits = $tracked | Select-String -Pattern '10\.245\.100\.107|sk-[A-Za-z0-9_-]{12,}|AGENT_API_KEY\s*=\s*[^\s]+'
if ($hits) { $hits; exit 1 }
```

Expected: no output and exit code 0. The ignored local `.env` is intentionally excluded from the tracked-source scan.

- [ ] **Step 8: Perform the real private-model smoke test without exposing the key**

With the ignored `.env` populated from the user-provided API configuration, restart the local server, log in as administrator, ask `CAB-09 当前容量如何？`, and verify:

- `/api/config/status` reports `agent_configured: true` and only the model display name;
- `/api/assistant/messages` reports `model_status: "available"`;
- the answer contains at least one validated site evidence item;
- browser Network responses and server console output do not contain the API Key or private base URL.

Do not print `.env`, authorization headers or the API Key during this step.

- [ ] **Step 9: Commit the closed-loop assistant**

```powershell
git add scripts/mock-agent-server.js scripts/run-e2e.js tests/e2e/assistant.spec.js README.md
git commit -m "feat: complete floating assistant loops"
```

---

## Final Review Checklist

- [ ] The assistant reads all current website domains from server state and never scrapes DOM.
- [ ] Feedback polling uses 8 seconds, does not call the model, and deduplicates events.
- [ ] Active risks appear once on initial sync and new transitions appear within one poll cycle.
- [ ] Admin proposals create only `awaiting_confirmation` plans.
- [ ] Viewer proposals are rejected server-side even if the UI is manipulated.
- [ ] Existing plan confirmation remains the only execution entry point.
- [ ] Model failures degrade to deterministic queries without breaking other pages.
- [ ] Logout clears server and browser assistant sessions.
- [ ] All model text uses safe text rendering and every evidence ID is validated.
- [ ] Complete tests, diff checks and tracked-source secret scans pass.

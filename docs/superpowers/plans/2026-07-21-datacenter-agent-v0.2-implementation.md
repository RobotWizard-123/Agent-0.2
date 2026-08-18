# Datacenter Agent V0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a remotely accessible, fully interactive V0.2 datacenter-management demo covering rack placement, capacity, topology, change confirmation, alarm diagnosis, recovery, and audit.

**Architecture:** Keep the existing dependency-light Node.js ESM application, but separate canonical demo state, deterministic domain rules, planning/change workflows, adapters, HTTP routes, and browser views. JSON remains the V0.2 repository; private-model, telemetry, and execution behavior sit behind replaceable interfaces so NetBox and real collectors can be added without rewriting the domain.

**Tech Stack:** Node.js ESM, built-in `node:http`, built-in `node:test`, browser JavaScript/CSS/HTML, JSON persistence, OpenAI-compatible Chat Completions API, Playwright 1.54.2 for final browser tests, Docker with Node 22 Alpine, Nginx reverse proxy.

## Global Constraints

- The room is L5-A2-08 with exactly 22 racks: 20 server racks and 2 network racks.
- CAB-01 through CAB-08 are 10 kW on JG1; CAB-09 through CAB-10 are 20 kW on JG1.
- CAB-11 through CAB-13 are 20 kW on JG2; CAB-14 through CAB-20 are 10 kW on JG2.
- CAB-21 and CAB-22 are 5 kW network racks on KT1 and retain `NET-01`/`NET-02` as aliases.
- Every rack is 42U with dividers `[12, x, y]`; L01 is fixed at U01-U12 and L02+L03+L04 total 30U.
- Reserve exactly 2U once per layer, not once per server.
- A 10U server must be placed in L01; larger-U devices are packed lower than smaller-U devices.
- Server-rack capacity uses the 10/20 kW design limit until real telemetry exists; missing telemetry is `unknown`, never zero.
- Hard constraints cannot be overridden by the Agent. Every Agent-adjusted plan is deterministically revalidated.
- Read-only queries require no confirmation. Every state-changing plan has exactly one final confirmation.
- Multiple drawing branches must not be presented as verified A/B redundancy.
- All demo scenarios must complete a trigger/plan-or-diagnose/confirm/execute/verify/audit loop.
- Secrets come only from `AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `SESSION_SECRET`, `APP_ADMIN_PASSWORD`, and `APP_VIEWER_PASSWORD`; no secret is committed or returned to the browser.
- Preserve unrelated user changes. Add exact files to each commit instead of using broad staging commands.

---

## File Structure

### Domain and data

- `src/demo-state.js`: builds the canonical L5-A2-08 seed state.
- `src/repositories/state-repository.js`: memory and atomic JSON repositories with optimistic version checks and reset.
- `src/domain/rack-layout.js`: derives four layers and packs devices into U positions.
- `src/domain/capacity.js`: calculates design-power, U, weight, and port snapshots.
- `src/domain/constraint-engine.js`: evaluates hard blockers and yellow warnings.
- `src/planning/planning-engine.js`: ranks direct placements, divider changes, and cross-rack rebalances.
- `src/workflows/plan-service.js`: owns plan state transitions and final confirmation.
- `src/workflows/simulated-execution-adapter.js`: applies actions to a cloned state and verifies the result.
- `src/agent/agent-gateway.js`: calls the private OpenAI-compatible endpoint.
- `src/agent/agent-schema.js`: validates extracted requests and adjusted plans.
- `src/topology/topology-service.js`: returns partial power/network paths without inventing links.
- `src/telemetry/demo-telemetry-provider.js`: returns demo, offline, or unknown telemetry with source labels.
- `src/alarms/alarm-engine.js`: creates and transitions rule/demo/service alarms.
- `src/alarms/diagnosis-engine.js`: correlates evidence and creates remediation requests.
- `src/auth/session-auth.js`: login, signed sessions, role checks, and mutation-origin checks.
- `src/http/router.js`: small route matcher and JSON response helpers.
- `src/http/routes/*.js`: focused auth, inventory, plans, topology, alarms, demo, audit, and health routes.
- `src/http-app.js`: composes dependencies and route modules; serves static assets.

### Browser application

- `public/index.html`: application shell, navigation, login panel, dialog root, toast root.
- `public/js/api.js`: authenticated fetch wrapper and typed API error.
- `public/js/state.js`: browser state, navigation, refresh, and event subscription.
- `public/js/components.js`: DOM-only cards, tables, badges, dialog, loading, and empty states.
- `public/js/views/overview.js`: room plan and capacity cards.
- `public/js/views/rack-detail.js`: 42U/four-layer rack and server drill-down.
- `public/js/views/agent-console.js`: request, candidate comparison, risk, and final confirmation.
- `public/js/views/topology.js`: power/network path and change/audit navigation.
- `public/js/views/alarms.js`: alarm trigger, diagnosis, remediation, recovery, and history.
- `public/js/views/audit.js`: change timeline and entity links.
- `public/js/app.js`: view registration and startup only.
- `public/css/tokens.css`, `layout.css`, `components.css`, `views.css`: visual tokens and focused style groups.

### Tests and deployment

- `tests/helpers.js`: memory-state and HTTP test helpers.
- `tests/demo-state.test.js`, `repository.test.js`, `rack-layout.test.js`, `constraints.test.js`, `planning.test.js`, `plan-service.test.js`, `agent-gateway.test.js`, `topology.test.js`, `alarms.test.js`, `auth.test.js`, `api-v02.test.js`: unit/integration coverage.
- `tests/e2e/closed-loops.spec.js`: browser verification of all demo loops.
- `playwright.config.js`: local test server and Chromium configuration.
- `scripts/reset-demo-data.js`: CLI reset using the same repository method as the UI.
- `Dockerfile`, `.dockerignore`, `compose.yaml`, `deploy/nginx.conf`: remote demo packaging.

---

### Task 1: Preserve the verified MVP baseline

**Files:**
- Add unchanged: `.env.example`, `package.json`, `server.js`, `src/*.js`, `public/**`, `data/*.json`, `tests/*.test.js`

**Interfaces:**
- Consumes: the current untracked MVP and its 20 passing tests.
- Produces: a Git-tracked baseline that later tasks can modify and review safely.

- [ ] **Step 1: Verify the current MVP before staging it**

Run: `npm.cmd test`

Expected: 20 tests pass and the process exits 0.

- [ ] **Step 2: Scan the baseline for the exposed credential and generic key patterns**

Run: `rg -n "10\\.245\\.100\\.107|sk-[A-Za-z0-9]{12,}|AGENT_API_KEY=.*[^=[:space:]]" . --glob "!docs/**" --glob "!.git/**"`

Expected: no matches. If a match appears, stop and remove the secret from the affected source before staging.

- [ ] **Step 3: Stage only the baseline files**

Run:

```powershell
git add -- .env.example package.json server.js src public data tests
git diff --cached --name-only
```

Expected: only the listed MVP paths; no design/plan files and no external files.

- [ ] **Step 4: Commit the baseline**

```powershell
git commit -m "chore: preserve datacenter mvp baseline"
```

Expected: one commit containing the previously untracked MVP.

---

### Task 2: Create the canonical L5-A2-08 demo state

**Files:**
- Create: `src/demo-state.js`
- Create: `scripts/reset-demo-data.js`
- Create: `data/seed/state.json`
- Create: `tests/demo-state.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: no application state; constants are copied from the approved specification.
- Produces: `createDemoState(): DemoState` and a generated `data/seed/state.json` with `version: 1`.

- [ ] **Step 1: Write the failing seed-fact test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";

test("demo state matches L5-A2-08 drawing facts", () => {
  const state = createDemoState();
  assert.equal(state.room.id, "L5-A2-08");
  assert.equal(state.racks.length, 22);
  assert.deepEqual(state.racks.slice(0, 8).map((r) => r.design_power_w), Array(8).fill(10_000));
  assert.deepEqual(state.racks.slice(8, 13).map((r) => r.design_power_w), Array(5).fill(20_000));
  assert.deepEqual(state.racks.slice(13, 20).map((r) => r.design_power_w), Array(7).fill(10_000));
  assert.deepEqual(state.racks.slice(20).map((r) => r.design_power_w), [5_000, 5_000]);
  assert.deepEqual(state.racks[0].dividers_u, [12, 22, 32]);
  assert.equal(state.racks.every((r) => r.height_u === 42), true);
  assert.equal(state.power_sources.find((p) => p.id === "JG1").calculated_load_w, 96_000);
  assert.equal(state.power_sources.find((p) => p.id === "JG2").calculated_load_w, 104_000);
});
```

- [ ] **Step 2: Run the new test and verify the missing module failure**

Run: `node --test tests/demo-state.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/demo-state.js`.

- [ ] **Step 3: Implement the seed builder with exact rack mappings**

```js
const powerForRack = (number) => {
  if (number <= 8) return { source_id: "JG1", design_power_w: 10_000, breaker: "C40/2P", cable: "3×10" };
  if (number <= 10) return { source_id: "JG1", design_power_w: 20_000, breaker: "C63/2P", cable: "3×16" };
  if (number <= 13) return { source_id: "JG2", design_power_w: 20_000, breaker: "C63/2P", cable: "3×16" };
  return { source_id: "JG2", design_power_w: 10_000, breaker: "C40/2P", cable: "3×10" };
};

const serverRack = (number) => ({
  id: `CAB-${String(number).padStart(2, "0")}`,
  name: `服务器机柜 ${String(number).padStart(2, "0")}`,
  role: "server",
  height_u: 42,
  dividers_u: [12, 22, 32],
  reserve_u_per_layer: 2,
  max_weight_kg: 420,
  network_port_limit: 24,
  data_source: "design",
  ...powerForRack(number),
});

const networkRack = (number, alias) => ({
  id: `CAB-${number}`,
  alias,
  name: `网络机柜 ${number}`,
  role: "network",
  height_u: 42,
  dividers_u: [12, 22, 32],
  reserve_u_per_layer: 2,
  max_weight_kg: 420,
  network_port_limit: 48,
  source_id: "KT1",
  design_power_w: 5_000,
  breaker: "C40/2P",
  cable: "3×10",
  data_source: "design",
});

export function createDemoState() {
  return structuredClone({
    version: 1,
    room: { id: "L5-A2-08", name: "L5-A2-08 机房", data_source: "design" },
    power_sources: [
      { id: "JG1", calculated_load_w: 96_000, data_source: "design" },
      { id: "JG2", calculated_load_w: 104_000, data_source: "design" },
      { id: "KT1", calculated_load_w: null, data_source: "unknown" },
    ],
    racks: [...Array.from({ length: 20 }, (_, i) => serverRack(i + 1)), networkRack(21, "NET-01"), networkRack(22, "NET-02")],
    devices: [
      { id: "SRV-DEMO-10U", asset_id: "ASSET-1001", hostname: "gpu-demo-01", model: "10U GPU Demo", serial: "DEMO-SN-1001", rack_id: "CAB-09", layer_id: "L01", u_size: 10, rated_power_w: 3500, real_power_w: null, weight_kg: 120, network_ports: 4, ip: "10.0.9.11", vlan: "VLAN-109", business: "AI算力演示", owner: "机房运维", status: "running", data_source: "demo" },
      { id: "SRV-DEMO-4U", asset_id: "ASSET-1002", hostname: "compute-demo-01", model: "4U Compute Demo", serial: "DEMO-SN-1002", rack_id: "CAB-11", layer_id: "L02", u_size: 4, rated_power_w: 1800, real_power_w: null, weight_kg: 42, network_ports: 2, ip: "10.0.11.21", vlan: "VLAN-111", business: "计算平台演示", owner: "平台组", status: "running", data_source: "demo" },
      { id: "SRV-DEMO-2U", asset_id: "ASSET-1003", hostname: "storage-demo-01", model: "2U Storage Demo", serial: "DEMO-SN-1003", rack_id: "CAB-14", layer_id: "L03", u_size: 2, rated_power_w: 900, real_power_w: null, weight_kg: 28, network_ports: 2, ip: "10.0.14.31", vlan: "VLAN-114", business: "存储演示", owner: "存储组", status: "running", data_source: "demo" },
    ],
    power_connections: [
      { device_id: "SRV-DEMO-10U", source_id: "JG1", rack_id: "CAB-09", pdu_id: "CAB-09-PDU", outlet: "P01", data_source: "demo" },
      { device_id: "SRV-DEMO-4U", source_id: "JG2", rack_id: "CAB-11", pdu_id: "CAB-11-PDU", outlet: "P03", data_source: "demo" },
    ],
    network_connections: [
      { device_id: "SRV-DEMO-10U", device_port: "eth0", switch_id: "ASW-05", switch_port: "GE0/0/01", vlan: "VLAN-109", data_source: "demo" },
      { device_id: "SRV-DEMO-4U", device_port: "eth0", switch_id: "ASW-06", switch_port: "GE0/0/01", vlan: "VLAN-111", data_source: "demo" },
    ],
    plans: [], alarms: [], diagnoses: [], changes: [], audit: [],
    service_health: { model: "unknown", collector: "not_connected" },
  });
}
```

- [ ] **Step 4: Generate the committed seed and add a reset script**

`scripts/reset-demo-data.js` must call `createDemoState()`, ensure `data/seed` and `data/runtime` exist, and write both `data/seed/state.json` and `data/runtime/state.json` as UTF-8 JSON. Add `"reset:demo": "node scripts/reset-demo-data.js"` to `package.json`; add `data/runtime/*.json` to `.gitignore`.

Run: `npm.cmd run reset:demo`

Expected: `data/seed/state.json` and ignored `data/runtime/state.json` contain `L5-A2-08`, 22 racks, and no garbled Chinese.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/demo-state.test.js && npm.cmd test`

Expected: the seed test and the unchanged baseline tests pass.

```powershell
git add -- .gitignore package.json src/demo-state.js scripts/reset-demo-data.js data/seed/state.json tests/demo-state.test.js
git commit -m "feat: add canonical L5-A2-08 demo state"
```

---

### Task 3: Add versioned JSON and memory repositories

**Files:**
- Create: `src/repositories/state-repository.js`
- Create: `tests/repository.test.js`

**Interfaces:**
- Consumes: `DemoState` from `createDemoState()` or `data/seed/state.json`.
- Produces: `createMemoryRepository(initialState)` and `createJsonRepository({ seedPath, statePath })`, each exposing `read()`, `mutate(expectedVersion, fn)`, and `reset()`.

- [ ] **Step 1: Write repository conflict, persistence, and reset tests**

```js
test("repository increments versions and rejects stale mutation", () => {
  const repository = createMemoryRepository(createDemoState());
  const changed = repository.mutate(1, (draft) => { draft.audit.push({ id: "A-1" }); });
  assert.equal(changed.version, 2);
  assert.throws(() => repository.mutate(1, () => {}), (error) => error.code === "STATE_VERSION_CONFLICT");
});

test("repository reset restores a fresh canonical state", () => {
  const repository = createMemoryRepository(createDemoState());
  repository.mutate(1, (draft) => { draft.service_health.model = "offline"; });
  const reset = repository.reset();
  assert.equal(reset.version, 1);
  assert.equal(reset.service_health.model, "unknown");
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `node --test tests/repository.test.js`

Expected: FAIL because `state-repository.js` does not exist.

- [ ] **Step 3: Implement clone-on-read, optimistic mutation, and atomic JSON writes**

```js
export function createMemoryRepository(initialState) {
  let state = structuredClone(initialState);
  return {
    read: () => structuredClone(state),
    mutate(expectedVersion, mutator) {
      if (state.version !== expectedVersion) throw Object.assign(new Error("State version changed"), { code: "STATE_VERSION_CONFLICT" });
      const draft = structuredClone(state);
      mutator(draft);
      draft.version = state.version + 1;
      state = draft;
      return structuredClone(state);
    },
    reset() {
      state = structuredClone(initialState);
      return structuredClone(state);
    },
  };
}
```

The JSON implementation must use the same contract, create the parent directory, write to `${statePath}.tmp`, then `renameSync` it to `statePath`. It reads the seed when the runtime file does not exist. Keep the current `src/data-store.js` and `server.js` wiring unchanged until Task 8 so the tracked MVP remains green.

- [ ] **Step 4: Run repository and regression tests**

Run: `node --test tests/repository.test.js && npm.cmd test`

Expected: repository tests and every baseline test pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/repositories/state-repository.js tests/repository.test.js
git commit -m "feat: add versioned demo state repository"
```

---

### Task 4: Implement 42U layout, capacity, and hard constraints

**Files:**
- Create: `src/domain/rack-layout.js`
- Create: `src/domain/capacity.js`
- Create: `src/domain/constraint-engine.js`
- Create: `tests/rack-layout.test.js`
- Create: `tests/constraints.test.js`
- Modify: `src/deploy-agent.js`
- Replace assertions: `tests/validators.test.js`, `tests/seed.test.js`

**Interfaces:**
- Consumes: `state`, plus actions shaped as `{ type: "place_device"|"move_device"|"set_dividers", ... }`.
- Produces: `deriveLayers(rack)`, `packDevices(rack, devices)`, `capacitySnapshot(state, rackId)`, and `evaluateActions(state, actions)`.

- [ ] **Step 1: Write failing layout tests for the approved layer rules**

```js
test("derives four layers and reserves 2U once per layer", () => {
  const rack = createDemoState().racks[0];
  const layers = deriveLayers(rack);
  assert.deepEqual(layers.map((l) => [l.id, l.start_u, l.end_u, l.capacity_u, l.usable_u]), [
    ["L01", 1, 12, 12, 10], ["L02", 13, 22, 10, 8],
    ["L03", 23, 32, 10, 8], ["L04", 33, 42, 10, 8],
  ]);
});

test("packs larger devices below smaller devices", () => {
  const packed = packDevices(createDemoState().racks[0], [
    { id: "SMALL", layer_id: "L02", u_size: 2 },
    { id: "LARGE", layer_id: "L02", u_size: 4 },
  ]);
  assert.deepEqual(packed.map((p) => [p.device_id, p.start_u, p.end_u]), [["LARGE", 13, 16], ["SMALL", 17, 18]]);
});
```

- [ ] **Step 2: Write failing hard-constraint tests**

```js
test("10U devices are blocked outside L01", () => {
  const result = evaluateActions(createDemoState(), [{
    type: "place_device", rack_id: "CAB-01", layer_id: "L02",
    device: { id: "TEN-U", u_size: 10, rated_power_w: 1000, weight_kg: 50, network_ports: 2 },
  }]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((i) => i.code === "TEN_U_REQUIRES_L01"));
});

test("power uses the 10kW cabinet design ceiling", () => {
  const result = evaluateActions(createDemoState(), [{
    type: "place_device", rack_id: "CAB-01", layer_id: "L01",
    device: { id: "OVER", u_size: 10, rated_power_w: 10_001, weight_kg: 50, network_ports: 2 },
  }]);
  assert.ok(result.blockers.some((i) => i.code === "RACK_POWER_EXCEEDED"));
});
```

- [ ] **Step 3: Verify both test files fail**

Run: `node --test tests/rack-layout.test.js tests/constraints.test.js`

Expected: FAIL for missing domain modules.

- [ ] **Step 4: Implement layer derivation and deterministic packing**

`deriveLayers` validates exactly three ascending divider values, requires the first to equal 12 and the last not to exceed 41, and derives absolute ranges. `packDevices` sorts by `u_size` descending then `id`, starts at the bottom U of each layer, and never enters the top 2U reserve.

```js
export function deriveLayers({ dividers_u, reserve_u_per_layer = 2 }) {
  const [first, second, third] = dividers_u;
  if (first !== 12 || !(12 < second && second < third && third < 42)) {
    throw Object.assign(new Error("Invalid divider layout"), { code: "DIVIDER_LAYOUT_INVALID" });
  }
  return [[1, first], [first + 1, second], [second + 1, third], [third + 1, 42]].map(([start_u, end_u], index) => ({
    id: `L0${index + 1}`, start_u, end_u,
    capacity_u: end_u - start_u + 1,
    usable_u: Math.max(0, end_u - start_u + 1 - reserve_u_per_layer),
  }));
}
```

- [ ] **Step 5: Implement capacity snapshots and constraint evidence**

`capacitySnapshot` returns `{ source:"rule", design_power_w, rated_power_used_w, real_power_w:null, real_power_source:"unknown", used_u, usable_u, used_weight_kg, max_weight_kg, used_ports, port_limit }`. `evaluateActions` clones state, applies actions, collects blockers and 80% warnings, and returns before/after snapshots without mutating input.

- [ ] **Step 6: Keep a compatibility `runPrecheck` and correct old tests**

`src/deploy-agent.js` maps the legacy `{servers:[...]}` request to `place_device` actions and calls `evaluateActions`. Replace old expectations that L01 is forbidden, branch capacity is ignored, and network port fullness is ignored. The new expectations are: 10U requires L01, smaller servers may use any fitting layer, rack port limits are hard constraints, and current power uses rack design limits.

- [ ] **Step 7: Run all domain and regression tests**

Run: `npm.cmd test`

Expected: all tests pass with no old 6U-bottom-layer or ignored-port behavior remaining.

- [ ] **Step 8: Commit**

```powershell
git add -- src/domain src/deploy-agent.js tests/rack-layout.test.js tests/constraints.test.js tests/validators.test.js tests/seed.test.js
git commit -m "feat: enforce approved rack capacity rules"
```

---

### Task 5: Build placement, divider, and rebalance planning

**Files:**
- Create: `src/planning/planning-engine.js`
- Create: `tests/planning.test.js`
- Modify: `src/placement-recommender.js`
- Modify: `tests/recommendation.test.js`

**Interfaces:**
- Consumes: `evaluateActions(state, actions)` and device request `{ id, count, u_size, rated_power_w, weight_kg, network_ports, preferred_rack_ids }`.
- Produces: `createPlanningEngine().recommend(state, request, { limit }) -> { request, candidates, rejected_count }`.

- [ ] **Step 1: Write failing direct-placement and 10U tests**

```js
test("planner puts a 10U server in L01", () => {
  const result = createPlanningEngine().recommend(createDemoState(), {
    id: "GPU-10U", count: 1, u_size: 10, rated_power_w: 3500, weight_kg: 100, network_ports: 2,
  });
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0].actions[0].layer_id, "L01");
  assert.equal(result.candidates[0].validation.allowed, true);
});

test("planner can recommend dividers and marks migrations as warning risk", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, {
    id: "DENSE", count: 3, u_size: 6, rated_power_w: 1000, weight_kg: 30, network_ports: 1,
  });
  assert.ok(result.candidates.some((c) => c.actions.some((a) => a.type === "set_dividers")));
  assert.ok(result.candidates.filter((c) => c.actions.some((a) => a.type === "move_device")).every((c) => c.risk === "warning"));
});
```

- [ ] **Step 2: Run and verify the missing planner failure**

Run: `node --test tests/planning.test.js`

Expected: FAIL for missing `planning-engine.js`.

- [ ] **Step 3: Implement three planning passes**

The engine executes passes in this order: direct placement with existing dividers; same-rack divider layouts; cross-rack migration only if the first two passes produce no allowed candidate. Divider layouts enumerate integer `[12,x,y]` values, retain only layouts in which each occupied layer fits devices plus its single 2U reserve, and limit output to the best 8 candidates.

```js
export function createPlanningEngine({ validator = evaluateActions } = {}) {
  return {
    recommend(state, request, { limit = 8 } = {}) {
      const normalized = normalizeRequest(request);
      const direct = directCandidates(state, normalized, validator);
      const divider = dividerCandidates(state, normalized, validator);
      const firstPass = [...direct, ...divider];
      const migration = firstPass.some((candidate) => candidate.validation.allowed)
        ? [] : migrationCandidates(state, normalized, validator);
      const generated = [...firstPass, ...migration];
      const accepted = generated.filter((candidate) => candidate.validation.allowed);
      const candidates = accepted
        .filter((candidate) => candidate.validation.allowed)
        .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
        .slice(0, limit);
      return { request: normalized, candidates, rejected_count: generated.length - accepted.length };
    },
  };
}
```

Implement the same-file helpers with these exact signatures: `normalizeRequest(request)`, `directCandidates(state, request, validator)`, `dividerCandidates(state, request, validator)`, and `migrationCandidates(state, request, validator)`. Every helper returns complete candidate objects `{ id, score, risk, reasons, actions, validation }`; no helper mutates `state`.

Candidate score includes preference, post-plan power percentage, remaining U, warning count, divider movement, and migration count. Each candidate stores Chinese reasons, exact before/after capacity, actions, validation evidence, and `risk: "safe"|"warning"`.

- [ ] **Step 4: Convert the legacy recommender into a wrapper**

`recommendPlacement(data, rawSpec, options)` maps `power_w` to `rated_power_w`, `preferred_cabinet_ids` to `preferred_rack_ids`, invokes the new engine, and returns the new candidate data without garbled reason strings.

- [ ] **Step 5: Run planner and full tests**

Run: `node --test tests/planning.test.js tests/recommendation.test.js && npm.cmd test`

Expected: all planning tests pass; reason strings contain valid Chinese.

- [ ] **Step 6: Commit**

```powershell
git add -- src/planning/planning-engine.js src/placement-recommender.js tests/planning.test.js tests/recommendation.test.js
git commit -m "feat: plan rack placement and rebalancing"
```

---

### Task 6: Add plan lifecycle, single confirmation, execution, and audit

**Files:**
- Create: `src/workflows/plan-service.js`
- Create: `src/workflows/simulated-execution-adapter.js`
- Create: `tests/plan-service.test.js`
- Modify: `src/batch-engine.js`
- Modify: `src/adopt-placement.js`
- Modify: `tests/batch-engine.test.js`

**Interfaces:**
- Consumes: repository, planning engine, constraint engine, optional Agent adjuster.
- Produces: `planService.create(request, actor)`, `planService.get(id)`, and `planService.confirm(id, actor)`; confirmation is the sole state-changing execution entry point.

- [ ] **Step 1: Write failing lifecycle tests**

```js
const sampleDevice = () => ({ id: "SRV-PLAN-01", u_size: 4, rated_power_w: 1200, weight_kg: 30, network_ports: 2 });

function fixture() {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({ repository, planner: createPlanningEngine(), executor: createSimulatedExecutionAdapter() });
  return { repository, service };
}

test("a valid plan executes after one confirmation and writes audit", async () => {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({ repository, planner: createPlanningEngine(), executor: createSimulatedExecutionAdapter() });
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");
  assert.equal(plan.status, "awaiting_confirmation");
  const result = await service.confirm(plan.id, "admin");
  assert.equal(result.plan.status, "succeeded");
  assert.equal(repository.read().devices.some((d) => d.id === sampleDevice().id), true);
  assert.ok(repository.read().audit.some((e) => e.entity_id === plan.id && e.action === "plan_succeeded"));
  await assert.rejects(() => service.confirm(plan.id, "admin"), (error) => error.code === "PLAN_ALREADY_CONFIRMED");
});

test("confirmation rejects a stale state version", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");
  repository.mutate(repository.read().version, (draft) => draft.audit.push({ id: "EXTERNAL" }));
  await assert.rejects(() => service.confirm(plan.id, "admin"), (error) => error.code === "PLAN_STALE");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/plan-service.test.js`

Expected: FAIL for missing workflow modules.

- [ ] **Step 3: Implement explicit state transitions**

```js
const transitions = {
  draft: ["planned"], planned: ["validated"], validated: ["awaiting_confirmation"],
  awaiting_confirmation: ["locked"], locked: ["executing"], executing: ["succeeded", "failed"],
};

function transition(plan, next) {
  if (!transitions[plan.status]?.includes(next)) throw Object.assign(new Error("Invalid plan transition"), { code: "PLAN_TRANSITION_INVALID" });
  plan.status = next;
  plan.timeline.push({ status: next, at: new Date().toISOString() });
}
```

`create` saves original candidates, optional Agent adjustments, final validation, `base_version`, risk, and reasons. It enters `awaiting_confirmation` only when blockers are empty. `confirm` rejects repeated confirmation, checks `base_version`, reruns validation, records confirmation, applies the chosen actions once, verifies post-state, and appends audit entries.

- [ ] **Step 4: Implement snapshot rollback in the execution adapter**

`execute(state, actions, { failAt })` returns `{ state, stages:["locked","written","verified","audited"] }`. It applies to a clone; if a requested demo failure occurs or post-validation fails, it returns the original clone and `{ code:"SIMULATED_EXECUTION_FAILED", rolled_back:true }`.

- [ ] **Step 5: Retire extra warning confirmation in legacy batches**

Map legacy batch/adopt routes to plan creation. A warning remains visible but does not introduce an intermediate confirmation; `confirm_warnings` is ignored by the new path and tests assert that only `planService.confirm` changes inventory.

- [ ] **Step 6: Run workflow and regression tests**

Run: `node --test tests/plan-service.test.js tests/batch-engine.test.js && npm.cmd test`

Expected: lifecycle, rollback, stale-version, and single-confirmation cases pass.

- [ ] **Step 7: Commit**

```powershell
git add -- src/workflows src/batch-engine.js src/adopt-placement.js tests/plan-service.test.js tests/batch-engine.test.js
git commit -m "feat: add confirmed simulated change workflow"
```

---

### Task 7: Integrate the private Agent with safe fallback and revalidation

**Files:**
- Create: `src/agent/agent-schema.js`
- Create: `src/agent/agent-gateway.js`
- Create: `tests/agent-gateway.test.js`
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `src/workflows/plan-service.js`

**Interfaces:**
- Consumes: private Chat Completions configuration, natural-language text, deterministic candidate plan.
- Produces: `createAgentGateway(config).extractRequest(text)`, `.adjustPlan(context)`, `.health()`; all failures use `AGENT_UNAVAILABLE` or `AGENT_RESPONSE_INVALID`.

- [ ] **Step 1: Write tests for secret-safe config, valid extraction, timeout fallback, and malicious adjustment**

```js
const testConfig = { baseUrl: "http://model.test", apiKey: "unit-test-key", model: "unit-test-model" };
const powerOverflowAction = () => ({ type: "place_device", rack_id: "CAB-01", layer_id: "L01", device: { id: "OVER", u_size: 10, rated_power_w: 20_001, weight_kg: 10, network_ports: 1 } });
const fakeChatCompletion = (content) => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });

test("runtime config never exposes the API key", () => {
  const config = getRuntimeConfig({ AGENT_BASE_URL: "http://model.local", AGENT_API_KEY: "secret", AGENT_MODEL: "glm" });
  assert.deepEqual(config.public, { agent_configured: true, model: "glm" });
  assert.equal(JSON.stringify(config.public).includes("secret"), false);
});

test("Agent adjustment is rejected when deterministic validation blocks it", async () => {
  const gateway = createAgentGateway({ fetchImpl: fakeChatCompletion({ actions: [powerOverflowAction()] }), ...testConfig });
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({ repository, planner: createPlanningEngine(), executor: createSimulatedExecutionAdapter(), agentGateway: gateway });
  const plan = await service.create({ kind: "natural_language", text: "上架一台服务器" }, "planner");
  assert.notEqual(plan.agent_adjustment?.accepted, true);
  assert.ok(plan.validation.blockers.every((b) => b.code !== "AGENT_OVERRIDE_ACCEPTED"));
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/agent-gateway.test.js`

Expected: FAIL for missing Agent modules or old config shape.

- [ ] **Step 3: Implement strict schemas without adding a validation dependency**

`validateDeviceRequest(value)` accepts only known fields, finite positive numbers, count 1-100, and string arrays. `validatePlanAdjustment(value)` accepts only `candidate_id`, supported action objects, and `reason`; it cannot alter facts such as rack design power, device measurements, repository version, or validator output.

- [ ] **Step 4: Implement the Chat Completions gateway**

```js
export function createAgentGateway({ baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 8000 }) {
  async function complete(messages) {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw agentError("AGENT_UNAVAILABLE", response.status);
    const payload = await response.json();
    return parseJsonContent(payload?.choices?.[0]?.message?.content);
  }
  return { extractRequest: (text) => complete(extractionMessages(text)), adjustPlan: (context) => complete(adjustmentMessages(context)), health: async () => Boolean(await complete(healthMessages())) };
}
```

Prompts require JSON only, state that facts/hard constraints are immutable, and omit unnecessary server inventory and all credentials.

- [ ] **Step 5: Add fallback and post-Agent validation to the plan service**

If extraction fails, return `{ fallback:"structured_form", error_code }` without a fabricated plan. If adjustment fails, preserve deterministic candidates and set `agent_status:"degraded"`. If an adjusted plan fails deterministic validation, record it as rejected and keep the best original candidate.

- [ ] **Step 6: Run tests and credential scan**

Run: `node --test tests/agent-gateway.test.js tests/plan-service.test.js && npm.cmd test`

Run: `rg -n "10\\.245\\.100\\.107|sk-[A-Za-z0-9]{12,}" . --glob "!.git/**"`

Expected: tests pass; scan returns no credentials.

- [ ] **Step 7: Commit**

```powershell
git add -- .env.example src/config.js src/agent src/workflows/plan-service.js tests/agent-gateway.test.js
git commit -m "feat: integrate guarded planning agent"
```

---

### Task 8: Add telemetry, topology, capacity, and read APIs

**Files:**
- Create: `src/telemetry/demo-telemetry-provider.js`
- Create: `src/topology/topology-service.js`
- Create: `src/http/router.js`
- Create: `src/http/routes/inventory-routes.js`
- Create: `src/http/routes/topology-routes.js`
- Create: `src/http/routes/plan-routes.js`
- Create: `src/http/routes/audit-routes.js`
- Create: `tests/topology.test.js`
- Create: `tests/api-v02.test.js`
- Create: `tests/helpers.js`
- Modify: `src/http-app.js`
- Modify: `src/data-store.js`
- Modify: `server.js`
- Modify: `tests/api.test.js`

**Interfaces:**
- Consumes: repository, telemetry provider, topology service, plan service.
- Produces: versioned APIs for room summary, racks, devices, capacity, topology, plans, confirmation, and audit.

- [ ] **Step 1: Write partial-link and unknown-telemetry tests**

```js
test("topology returns an unknown node instead of inventing a power link", () => {
  const state = createDemoState();
  state.devices.push({ id: "NO-LINK", rack_id: "CAB-01", layer_id: "L02", u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1 });
  const path = createTopologyService().devicePath(state, "NO-LINK");
  assert.equal(path.power.at(-1).source, "unknown");
  assert.equal(path.redundancy, "unverified");
});

test("telemetry absence is unknown rather than zero", async () => {
  const reading = await createDemoTelemetryProvider().rackPower("CAB-01");
  assert.deepEqual(reading, { value_w: null, source: "unknown", collected_at: null, status: "not_connected" });
});
```

- [ ] **Step 2: Write API contract tests**

Create `tests/helpers.js` with `withV02Server(assertions, overrides = {})`. It builds a memory repository from `createDemoState()`, injects fake healthy Agent/auth dependencies, listens on `127.0.0.1` port 0, and passes `{ repository, request }` to the callback. `request(path, options)` JSON-encodes `options.body`, supplies the trusted test origin, parses JSON, and returns `{ response, body }`.

```js
const placementRequest = () => ({ kind: "placement", device: { id: "SRV-API-01", u_size: 4, rated_power_w: 1200, weight_kg: 30, network_ports: 2 } });

test("V0.2 API exposes room, rack detail, plan creation and one confirmation", async () => {
  await withV02Server(async ({ request }) => {
    assert.equal((await request("/api/room")).body.id, "L5-A2-08");
    assert.equal((await request("/api/racks/CAB-09")).body.layers[0].usable_u, 10);
    const plan = await request("/api/plans", { method: "POST", body: placementRequest() });
    assert.equal(plan.body.status, "awaiting_confirmation");
    const confirmed = await request(`/api/plans/${plan.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(confirmed.body.plan.status, "succeeded");
  });
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test tests/topology.test.js tests/api-v02.test.js`

Expected: FAIL for missing services/routes.

- [ ] **Step 4: Implement source-labelled telemetry and partial topology paths**

`devicePath(state, deviceId)` returns `{ device, power, network, redundancy:"unverified", missing_fields }`. It follows only explicit `power_connections` and `network_connections`, while rack-to-source information may come from design facts. It never emits `A路`, `B路`, or redundant status unless a future explicit fact says so.

- [ ] **Step 5: Implement small router and focused route modules**

Required endpoints:

```text
GET  /api/room
GET  /api/racks
GET  /api/racks/:id
GET  /api/devices/:id
GET  /api/capacity
GET  /api/topology/devices/:id
POST /api/plans
GET  /api/plans/:id
POST /api/plans/:id/confirm
GET  /api/audit
GET  /api/config/status
```

All responses include `state_version` where stale data matters. Domain error codes map to stable HTTP statuses: invalid input 400, authentication 401, authorization 403, missing 404, version conflict 409, hard constraint 422, model unavailable 503.

- [ ] **Step 6: Compose dependencies in `http-app.js` and update legacy tests**

`createServerApp({ repository, telemetryProvider, agentGateway, auth })` constructs services once. Tests use a memory repository and fake Agent. Convert `src/data-store.js` into a compatibility export for `createJsonRepository`; update `server.js` to construct the JSON repository from `data/seed/state.json` and `data/runtime/state.json`. Preserve old read routes as temporary aliases only where the current UI still needs them.

- [ ] **Step 7: Run API and full tests**

Run: `node --test tests/topology.test.js tests/api-v02.test.js tests/api.test.js && npm.cmd test`

Expected: all tests pass; V0.2 status codes and source labels are stable.

- [ ] **Step 8: Commit**

```powershell
git add -- src/telemetry src/topology src/http src/http-app.js src/data-store.js server.js tests/helpers.js tests/topology.test.js tests/api-v02.test.js tests/api.test.js
git commit -m "feat: expose capacity and topology APIs"
```

---

### Task 9: Implement alarm generation, diagnosis, remediation, and verified recovery

**Files:**
- Create: `src/alarms/alarm-engine.js`
- Create: `src/alarms/diagnosis-engine.js`
- Create: `src/http/routes/alarm-routes.js`
- Create: `src/http/routes/demo-routes.js`
- Create: `tests/alarms.test.js`
- Modify: `src/http-app.js`
- Modify: `src/workflows/plan-service.js`

**Interfaces:**
- Consumes: current state, constraint evidence, topology paths, service health, and plan service.
- Produces: alarm lifecycle functions and remediation plans that use the same final-confirmation workflow.

- [ ] **Step 1: Write failing alarm closed-loop tests**

```js
function alarmFixture() {
  const repository = createMemoryRepository(createDemoState());
  const planner = createPlanningEngine();
  const planService = createPlanService({ repository, planner, executor: createSimulatedExecutionAdapter() });
  const alarmEngine = createAlarmEngine({ repository });
  const diagnosisEngine = createDiagnosisEngine({ repository, alarmEngine, planService, topologyService: createTopologyService() });
  return { repository, planService, alarmEngine, diagnosisEngine };
}

test("power-high demo alarm is diagnosed and only resolves after remediation verification", async () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("power_high", "admin");
  assert.equal(alarm.status, "open");
  const diagnosis = fixture.diagnosisEngine.diagnose(alarm.id, "admin");
  assert.equal(diagnosis.root_cause_code, "RACK_POWER_HIGH");
  const plan = await fixture.diagnosisEngine.createRemediation(alarm.id, "admin");
  assert.equal(plan.status, "awaiting_confirmation");
  await fixture.planService.confirm(plan.id, "admin");
  assert.equal(fixture.repository.read().alarms.find((a) => a.id === alarm.id).status, "resolved");
});

test("an alarm cannot be manually marked resolved while its rule remains active", () => {
  const fixture = alarmFixture();
  const alarm = fixture.alarmEngine.triggerDemo("collector_offline", "admin");
  assert.throws(() => fixture.alarmEngine.resolve(alarm.id, "admin"), (error) => error.code === "ALARM_STILL_ACTIVE");
});
```

- [ ] **Step 2: Verify alarm tests fail**

Run: `node --test tests/alarms.test.js`

Expected: FAIL for missing alarm modules.

- [ ] **Step 3: Implement alarm lifecycle and demo scenarios**

Support `power_high`, `placement_conflict`, `collector_offline`, `model_offline`, and `execution_failure`. A trigger creates a tagged demo condition in state so recovery can be verified rather than merely changing the alarm label. Store `{ id, source:"rule"|"demo"|"telemetry", severity, object_type, object_id, trigger_code, evidence, status, opened_at, acknowledged_at, resolved_at }`.

```js
const transitions = {
  open: ["acknowledged", "diagnosing"], acknowledged: ["diagnosing"],
  diagnosing: ["action_pending", "resolved"], action_pending: ["executing"],
  executing: ["resolved", "action_pending"], resolved: [],
};
```

- [ ] **Step 4: Implement evidence-based diagnosis and remediation requests**

Diagnosis returns root-cause hypotheses with confidence, exact constraint/health evidence, affected power/network paths, and recommended actions. A remediation is not applied directly; it calls `planService.create({ kind:"alarm_remediation", alarm_id, actions })`. Plan success invokes alarm-rule re-evaluation and transitions to `resolved` only when the trigger is inactive.

- [ ] **Step 5: Add alarm and demo APIs**

```text
GET  /api/alarms
GET  /api/alarms/:id
POST /api/alarms/:id/acknowledge
POST /api/alarms/:id/diagnose
POST /api/alarms/:id/remediation
POST /api/demo/alarms
POST /api/demo/reset
```

There is no direct “force resolve” endpoint. Demo reset uses repository reset, requires administrator role, and writes an administrative audit event after reset.

- [ ] **Step 6: Run alarm, workflow, and API tests**

Run: `node --test tests/alarms.test.js tests/plan-service.test.js tests/api-v02.test.js && npm.cmd test`

Expected: all alarm scenarios reach verified outcomes and write linked audit entries.

- [ ] **Step 7: Commit**

```powershell
git add -- src/alarms src/http/routes/alarm-routes.js src/http/routes/demo-routes.js src/http-app.js src/workflows/plan-service.js tests/alarms.test.js
git commit -m "feat: add alarm diagnosis and recovery workflow"
```

---

### Task 10: Protect the remote demo with sessions and roles

**Files:**
- Create: `src/auth/session-auth.js`
- Create: `src/http/routes/auth-routes.js`
- Create: `tests/auth.test.js`
- Modify: `tests/helpers.js`
- Modify: `src/http-app.js`
- Modify: `src/config.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: environment credentials and request headers/cookies.
- Produces: `createSessionAuth(config)` with `login`, `logout`, `session`, `requireViewer`, `requireAdmin`, and `verifyMutationOrigin`.

- [ ] **Step 1: Write failing authentication and authorization tests**

```js
test("viewer can query but cannot confirm or trigger demo alarms", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    const cookie = await login("viewer", "viewer-pass");
    assert.equal((await request("/api/racks", { cookie })).response.status, 200);
    assert.equal((await request("/api/demo/alarms", { method: "POST", cookie, body: { scenario: "power_high" } })).response.status, 403);
  });
});

test("login response and logs never contain configured passwords or session secret", async () => {
  await withAuthenticatedServer(async ({ login }) => {
    const result = await login("admin", "admin-pass");
    assert.equal(JSON.stringify(result.body).includes("admin-pass"), false);
    assert.match(result.cookie, /^dc_session=/);
    assert.match(result.cookie, /HttpOnly/);
    assert.match(result.cookie, /SameSite=Strict/);
  });
});
```

Extend `tests/helpers.js` with `withAuthenticatedServer(assertions)`. It supplies `SESSION_SECRET="unit-test-session-secret"`, admin password `admin-pass`, viewer password `viewer-pass`, and returns `login(username,password)` as `{ body, cookie }`; the raw `Set-Cookie` header is kept so cookie attributes remain testable.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/auth.test.js`

Expected: FAIL for missing auth module/routes.

- [ ] **Step 3: Implement signed in-memory sessions and timing-safe password comparison**

Use `randomBytes(32)` session IDs, HMAC-SHA256 signatures from `SESSION_SECRET`, `timingSafeEqual` for credentials, a 12-hour expiry, `HttpOnly`, `SameSite=Strict`, and `Secure` when `TRUST_PROXY_HTTPS=true`. Do not store passwords or secrets in session objects.

- [ ] **Step 4: Enforce roles and same-origin mutation checks**

Read endpoints require viewer or admin. Plan creation, confirmation, alarm changes, scenario triggers, and reset require admin. For non-GET/HEAD methods, accept only a matching `Origin` host; tests may pass an explicit trusted test origin.

- [ ] **Step 5: Add auth routes and safe public config**

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
```

`GET /api/config/status` returns only configured booleans, model display name, telemetry status, and application version.

- [ ] **Step 6: Run auth, API, and secret tests**

Run: `node --test tests/auth.test.js tests/api-v02.test.js && npm.cmd test`

Run: `rg -n "APP_(ADMIN|VIEWER)_PASSWORD=[^[:space:]]+|SESSION_SECRET=[^[:space:]]+|sk-[A-Za-z0-9]{12,}" . --glob "!.git/**"`

Expected: tests pass; scan has no populated secrets.

- [ ] **Step 7: Commit**

```powershell
git add -- .env.example src/auth src/http/routes/auth-routes.js src/http-app.js src/config.js tests/helpers.js tests/auth.test.js
git commit -m "feat: protect demo with role sessions"
```

---

### Task 11: Build the visual room overview and rack/server drill-down

**Files:**
- Create: `public/js/api.js`
- Create: `public/js/state.js`
- Create: `public/js/components.js`
- Create: `public/js/views/overview.js`
- Create: `public/js/views/rack-detail.js`
- Create: `public/css/tokens.css`
- Create: `public/css/layout.css`
- Create: `public/css/components.css`
- Create: `public/css/views.css`
- Modify: `public/index.html`
- Modify: `public/js/app.js`
- Modify: `public/css/style.css`
- Create: `tests/frontend-contract.test.js`

**Interfaces:**
- Consumes: auth session, `/api/room`, `/api/racks`, `/api/racks/:id`, `/api/config/status`.
- Produces: navigable SPA shell, capacity overview, clickable 22-rack floor plan, 42U rack layers, and server detail panel.

- [ ] **Step 1: Write failing static contract tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("browser shell exposes overview, Agent, topology, alarms and audit navigation", () => {
  const html = readFileSync("public/index.html", "utf8");
  for (const view of ["overview", "agent", "topology", "alarms", "audit"]) assert.match(html, new RegExp(`data-view="${view}"`));
  assert.match(html, /id="login-panel"/);
  assert.match(html, /id="dialog-root"/);
});

test("legacy frontend files contain no mojibake markers", () => {
  const text = ["public/index.html", "public/js/app.js"].map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(text, /杈|鏈烘|璀︾ず|鎺ㄨ崘/);
});
```

- [ ] **Step 2: Verify contract tests fail against the current UI**

Run: `node --test tests/frontend-contract.test.js`

Expected: FAIL for missing navigation/login/dialog elements and mojibake.

- [ ] **Step 3: Replace the shell and split frontend responsibilities**

`app.js` must only authenticate, register views, subscribe to state, and render the active route. `api.js` throws `ApiError(status, code, message)`. `state.js` exposes `{ getState, setRoute, refreshRoom, subscribe }`. DOM helpers use `textContent`; server data is never inserted through raw `innerHTML`.

- [ ] **Step 4: Implement the overview interaction**

Render capacity cards with source chips (`设计`, `规则计算`, `模拟`, `未接入`), JG1/JG2 totals, active alarms, and a 22-rack plan. Rack color reflects normal/warning/blocker/offline; clicking a rack sets route `{ name:"rack", id }`.

- [ ] **Step 5: Implement the 42U rack and server detail**

Render L04 above L03 above L02 above bottom L01, exact absolute U labels, divider positions, one 2U reserve block per layer, device blocks, and remaining capacity. Clicking a device shows asset ID, hostname, model, serial, layer/U, U size, rated/real power, weight, ports, IP/VLAN, PDU outlet, switch port, service, owner, status, and links to topology/alarms/audit. Unknown values show `未接入`.

- [ ] **Step 6: Add responsive visual styling and login panel**

Use a dark control-room palette, accessible contrast, a two-column desktop layout, a single-column layout below 900px, visible keyboard focus, and motion limited to 180ms transitions. Preserve no garbled text.

- [ ] **Step 7: Run frontend contract and all tests**

Run: `node --test tests/frontend-contract.test.js && npm.cmd test`

Expected: frontend contracts and all server tests pass.

- [ ] **Step 8: Commit**

```powershell
git add -- public/index.html public/js public/css tests/frontend-contract.test.js
git commit -m "feat: visualize room racks and servers"
```

---

### Task 12: Complete Agent, topology, alarm, confirmation, and audit UI loops

**Files:**
- Create: `public/js/views/agent-console.js`
- Create: `public/js/views/topology.js`
- Create: `public/js/views/alarms.js`
- Create: `public/js/views/audit.js`
- Modify: `public/js/app.js`
- Modify: `public/js/state.js`
- Modify: `public/js/components.js`
- Modify: `public/css/views.css`
- Modify: `tests/frontend-contract.test.js`

**Interfaces:**
- Consumes: plan, topology, alarm, audit, demo, and confirmation APIs.
- Produces: every approved scenario as a visible, linked, state-changing browser loop.

- [ ] **Step 1: Extend frontend contracts for all loop actions**

```js
test("interactive views expose required closed-loop actions", () => {
  const files = ["agent-console.js", "topology.js", "alarms.js", "audit.js"].map((f) => readFileSync(`public/js/views/${f}`, "utf8")).join("\n");
  for (const action of ["createPlan", "confirmPlan", "loadTopology", "triggerDemoAlarm", "diagnoseAlarm", "createRemediation", "resetDemoState"]) {
    assert.match(files, new RegExp(action));
  }
});
```

- [ ] **Step 2: Verify the extended test fails**

Run: `node --test tests/frontend-contract.test.js`

Expected: FAIL because interactive view modules do not exist.

- [ ] **Step 3: Implement Agent planning and final-confirmation dialog**

The planning view supports natural language and structured forms. It displays extracted parameters, ranked candidates, before/after capacity, divider/migration actions, Agent adjustment reasons, source labels, red blockers, yellow warnings, and green allowed state. Only allowed plans show `进入最终确认`; the dialog contains all impacts and a single `确认并模拟执行` action.

- [ ] **Step 4: Implement topology and audit cross-navigation**

Topology search accepts device, rack, source, or switch identifiers; power and network paths render separately and show `冗余状态：未核实`. Unknown nodes remain visible. Audit entries link back to plan, alarm, rack, and device routes.

- [ ] **Step 5: Implement alarm diagnosis and recovery UI**

The page includes filterable alarm list, severity/source/status/time, five demo trigger buttons, affected chain, evidence, root-cause confidence, recommended actions, `生成处置方案`, and plan confirmation. After execution it refreshes alarm/rack/capacity/audit and shows recovery verification; no button can directly force an alarm to resolved.

- [ ] **Step 6: Implement service degradation and demo reset UI**

Model-offline state visibly switches to the structured form and deterministic planner. Collector-offline state shows last collection time and design capacity. Admin-only reset opens one confirmation dialog, calls `/api/demo/reset`, clears client route state, and reloads the canonical seed.

- [ ] **Step 7: Run frontend and server tests**

Run: `node --test tests/frontend-contract.test.js tests/alarms.test.js tests/api-v02.test.js && npm.cmd test`

Expected: all view contracts and workflow APIs pass.

- [ ] **Step 8: Commit**

```powershell
git add -- public/js/views public/js/app.js public/js/state.js public/js/components.js public/css/views.css tests/frontend-contract.test.js
git commit -m "feat: complete interactive management loops"
```

---

### Task 13: Add browser E2E verification and remote deployment packaging

**Files:**
- Create: `tests/e2e/closed-loops.spec.js`
- Create: `playwright.config.js`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `deploy/nginx.conf`
- Create: `src/http/routes/health-routes.js`
- Modify: `package.json`
- Modify: `src/http-app.js`
- Modify: `.env.example`
- Modify: `README.md` if it exists; otherwise create `README.md`

**Interfaces:**
- Consumes: completed V0.2 app and environment configuration.
- Produces: repeatable Chromium closed-loop tests, liveness/readiness endpoints, and a containerized HTTPS-ready demo.

- [ ] **Step 1: Add Playwright scripts and write the first failing E2E loop**

Add `@playwright/test` version `1.54.2`, `"test:e2e": "playwright test"`, and `"test:all": "npm test && npm run test:e2e"`.

`playwright.config.js` starts `node server.js` with `APP_ADMIN_PASSWORD=demo-admin-pass`, `APP_VIEWER_PASSWORD=demo-viewer-pass`, `SESSION_SECRET=e2e-only-session-secret`, `E2E_ADMIN_PASSWORD=demo-admin-pass`, `HOST=127.0.0.1`, and `PORT=3100`; it uses `http://127.0.0.1:3100` as `baseURL`. These values exist only in the test-process environment and are not written to `.env`.

```js
test("alarm diagnosis closes through remediation and audit", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(process.env.E2E_ADMIN_PASSWORD ?? "demo-admin-pass");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "报警诊断" }).click();
  await page.getByRole("button", { name: "模拟功率过高" }).click();
  await page.getByRole("button", { name: "Agent 诊断" }).click();
  await page.getByRole("button", { name: "生成处置方案" }).click();
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  await expect(page.getByText("已恢复", { exact: true })).toBeVisible();
  await expect(page.getByText("恢复验证通过")).toBeVisible();
});
```

- [ ] **Step 2: Install browser tooling and verify the E2E test fails before final wiring**

Run: `npm.cmd install`

Run: `npx.cmd playwright install chromium`

Run: `npm.cmd run test:e2e`

Expected: the test starts the app but fails at the first missing selector or health prerequisite, proving it exercises the browser.

- [ ] **Step 3: Cover all approved browser loops**

Add tests for login/viewer restriction, direct placement, capacity rebalance, device topology query, device move, power-high diagnosis/recovery, collector-offline degradation/recovery, model-offline structured fallback, execution-failure rollback, audit navigation, and demo reset. Each state-changing test asserts final inventory/capacity/alarm state and a linked audit entry.

- [ ] **Step 4: Add live and ready health routes**

```text
GET /health/live  -> 200 when Node event loop serves requests
GET /health/ready -> 200 when JSON repository is readable; body separately reports model and collector as healthy/degraded/not_connected
```

Model or collector degradation does not make the core app unready because deterministic fallback remains available.

- [ ] **Step 5: Add Docker and Compose packaging**

`Dockerfile` uses `node:22-alpine`, installs production dependencies with `npm ci --omit=dev`, runs as a non-root user, mounts `/app/data/runtime`, exposes 3000, and starts `node server.js`. `compose.yaml` defines the app volume, required secret environment variables, restart policy, and health check. It does not contain real credentials.

- [ ] **Step 6: Add Nginx reverse-proxy configuration and runbook**

`deploy/nginx.conf` proxies to the app, sets `X-Forwarded-Proto`, applies request-size and timeout limits, and reads deployment-mounted certificates from `/etc/nginx/certs/fullchain.pem` and `/etc/nginx/certs/privkey.pem`. The README contains exact local start, reset, test, Docker, environment, HTTPS, key-rotation, backup, and demo walkthrough commands without credentials.

- [ ] **Step 7: Run complete verification**

Run: `npm.cmd run test:all`

Expected: unit/integration and Chromium E2E suites pass.

Run: `docker compose config`

Expected: configuration renders successfully and contains environment variable references, not secret values.

Run: `docker build -t datacenter-agent:v0.2 .`

Expected: image builds successfully and the final container runs as non-root.

Run: `rg -n "10\\.245\\.100\\.107|sk-[A-Za-z0-9]{12,}|APP_(ADMIN|VIEWER)_PASSWORD=[^[:space:]]+|SESSION_SECRET=[^[:space:]]+" . --glob "!.git/**"`

Expected: no populated credentials or exposed private endpoint.

- [ ] **Step 8: Commit**

```powershell
git add -- package.json package-lock.json tests/e2e playwright.config.js Dockerfile .dockerignore compose.yaml deploy/nginx.conf src/http/routes/health-routes.js src/http-app.js .env.example README.md
git commit -m "chore: verify and package remote demo"
```

---

## Final Acceptance Run

- [ ] Run `npm.cmd run reset:demo` and confirm the canonical 22-rack seed is restored.
- [ ] Run `npm.cmd run test:all` and confirm all unit, integration, API, frontend-contract, and browser tests pass.
- [ ] Start the application with populated local environment variables and walk through all seven demo scenarios.
- [ ] Confirm every mutation has exactly one confirmation and every successful/failed execution has an audit trail.
- [ ] Confirm hard blockers cannot be confirmed, stale plans cannot execute, and rollback restores the previous state.
- [ ] Confirm all displayed values show `design`, `rule`, `demo`, `telemetry`, or `unknown` provenance.
- [ ] Confirm no screen claims A/B redundancy and no missing telemetry is shown as zero.
- [ ] Confirm no source, static asset, log, Docker layer, or Git diff contains the private model endpoint or API key.

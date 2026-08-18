# Placement Recommendation Batch Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the append-only structured recommendation suite, repair batch search behavior exposed by an empty room, and execute approved daily deployment scenarios—including 10 servers of 10U—through the existing browser test file and unified runner.

**Architecture:** `tests/placement-recommendation/cases.js` is the single data registry, with lifecycle governance and Node executors for core/compatibility cases. The existing `tests/e2e/closed-loops.spec.js` imports UI cases and supplies reusable form/confirmation/assertion helpers; Beam search is made rack-diverse and preference-aware so complete batches survive bounded search without weakening hard constraints or atomicity.

**Tech Stack:** Node.js 24 ESM and `node:test`, Playwright 1.61.1, existing Beam/CP-SAT planning adapters, Windows `.cmd` runner.

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-07-empty-startup-state-implementation.md` first; this plan consumes `createEmptyDemoState()` and an empty `/api/demo/reset`.
- Do not add a new Playwright `.spec.js`; all browser scenarios stay in `tests/e2e/closed-loops.spec.js`.
- New real-world cases use stable `SCENARIO-REC-*` IDs and `origin: { type: "real-world", approved_at: "2026-08-07" }`.
- Once a case is registered in `cases.js`, never delete or rewrite it. Deprecation adds a `despair` lifecycle record and skips by default.
- Bug work must append a stable `bug_id` case before production changes and preserve it after the fix.
- A successful batch contains exactly `count` unique `place_device` actions. An infeasible batch contains no executable partial candidate and does not change inventory.
- `10 × 10U` must succeed from the default empty state, use ten distinct server racks, and place every device in L01.
- All UI prerequisites are built through the real UI; do not add a production-only test endpoint.
- Current Git has a valid `HEAD`, but nearly the whole workspace is already staged and no remote is configured. Do not alter the index or commit until the staged state is normalized; the commit commands below define required review boundaries once Git is safe to use.

---

### Task 1: Create the append-only registry and lifecycle governance

**Files:**
- Create: `tests/placement-recommendation/cases.js`
- Create: `tests/placement-recommendation/lifecycle.js`
- Create: `tests/placement-recommendation/case-schema.js`
- Create: `tests/placement-recommendation/case-schema.test.js`

**Interfaces:**
- Produces: `placementCases: readonly PlacementCase[]`.
- Produces: `uiPlacementCases: readonly PlacementCase[]` filtered by `levels.includes("ui")`.
- Produces: `deviceIdsFor(request): string[]`, using `ID-1` through `ID-N` for batches.
- Produces: `lifecycleRecords: readonly LifecycleRecord[]` and `lifecycleFor(caseId)`.
- Produces: `validateCaseRegistry(cases, lifecycle): string[]`; an empty array means valid.

- [ ] **Step 1: Write failing governance tests**

Create `tests/placement-recommendation/case-schema.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { placementCases } from "./cases.js";
import { lifecycleRecords } from "./lifecycle.js";
import { validateCaseRegistry } from "./case-schema.js";

test("registered placement cases satisfy append-only governance", () => {
  assert.deepEqual(validateCaseRegistry(placementCases, lifecycleRecords), []);
});

test("schema rejects duplicate IDs and incomplete provenance", () => {
  const valid = {
    id: "SCENARIO-REC-999",
    title: "valid",
    origin: { type: "real-world", approved_at: "2026-08-07" },
    levels: ["ui"],
    tags: ["batch"],
    fixture: "empty-room",
    request: { id: "X", count: 1, u_size: 2, rated_power_w: 1, weight_kg: 1, network_ports: 1 },
    expected: { ui: { outcome: "executed", placed_count: 1 } },
  };
  const errors = validateCaseRegistry([
    valid,
    { ...valid },
    { ...valid, id: "BUG-MISSING-01", origin: { type: "bug" } },
  ], []);

  assert.ok(errors.some((error) => error.includes("duplicate case id: SCENARIO-REC-999")));
  assert.ok(errors.some((error) => error.includes("BUG-MISSING-01 requires origin.bug_id")));
});

test("schema rejects invalid despair relationships", () => {
  const errors = validateCaseRegistry([], [{
    case_id: "BASE-REC-404",
    tag: "despair",
    reason: "missing",
    recorded_at: "2026-08-07",
    superseded_by: "SCENARIO-REC-404",
  }]);

  assert.ok(errors.some((error) => error.includes("unknown lifecycle case: BASE-REC-404")));
  assert.ok(errors.some((error) => error.includes("unknown superseding case: SCENARIO-REC-404")));
});
```

- [ ] **Step 2: Run the governance test and verify missing modules**

Run: `node --test tests/placement-recommendation/case-schema.test.js`

Expected: FAIL because the registry, lifecycle, and validator modules do not exist.

- [ ] **Step 3: Create lifecycle storage**

Create `tests/placement-recommendation/lifecycle.js`:

```js
export const lifecycleRecords = Object.freeze([]);

export function lifecycleFor(caseId) {
  return lifecycleRecords.filter((record) => record.case_id === caseId);
}

export function despairFor(caseId) {
  return lifecycleFor(caseId).find((record) => record.tag === "despair") ?? null;
}
```

The empty array is intentional: no approved case is deprecated in this implementation.

- [ ] **Step 4: Create the registry helpers and register cases 001–008**

Create `tests/placement-recommendation/cases.js` with this interface and initial cases:

```js
function realWorld({ id, title, levels, tags, fixture, request, expected, setup = [] }) {
  return Object.freeze({
    id,
    title,
    origin: Object.freeze({ type: "real-world", approved_at: "2026-08-07" }),
    levels: Object.freeze(levels),
    tags: Object.freeze(tags),
    fixture,
    setup: Object.freeze(setup),
    request: Object.freeze(request),
    expected: Object.freeze(expected),
  });
}

function baseline({ id, title, levels, tags, fixture, request, expected }) {
  return Object.freeze({
    id,
    title,
    origin: Object.freeze({ type: "baseline" }),
    levels: Object.freeze(levels),
    tags: Object.freeze(tags),
    fixture,
    setup: Object.freeze([]),
    request: Object.freeze(request),
    expected: Object.freeze(expected),
  });
}

export function deviceIdsFor(request) {
  const count = Number(request.count ?? 1);
  return count > 1
    ? Array.from({ length: count }, (_, index) => `${request.id}-${index + 1}`)
    : [request.id];
}

export const placementCases = Object.freeze([
  baseline({ id: "BASE-REC-001", title: "普通 4U 设备生成合法推荐", levels: ["core", "compatibility"], tags: ["basic", "4u"], fixture: "empty-room", request: { id: "BASE-4U", count: 1, u_size: 4, rated_power_w: 1800, weight_kg: 32, network_ports: 2, preferred_rack_ids: [] }, expected: { core: { outcome: "success", action_count: 1 }, compatibility: { outcome: "success", action_count: 1 } } }),
  baseline({ id: "BASE-REC-002", title: "合法优选机柜排在首位", levels: ["core", "compatibility"], tags: ["preferred-rack"], fixture: "empty-room", request: { id: "BASE-PREFERRED", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"] }, expected: { core: { outcome: "success", first_rack: "CAB-03" }, compatibility: { outcome: "success", first_rack: "CAB-03" } } }),
  baseline({ id: "BASE-REC-003", title: "10U 设备只能进入 L01", levels: ["core", "compatibility"], tags: ["10u", "hard-constraint"], fixture: "empty-room", request: { id: "BASE-10U", count: 1, u_size: 10, rated_power_w: 2500, weight_kg: 80, network_ports: 4, preferred_rack_ids: [] }, expected: { core: { outcome: "success", action_count: 1, all_layers: ["L01"] }, compatibility: { outcome: "success", action_count: 1, all_layers: ["L01"] } } }),
  baseline({ id: "BASE-REC-004", title: "超过 10U 的设备被拒绝", levels: ["core", "compatibility"], tags: ["hard-constraint", "rejected"], fixture: "empty-room", request: { id: "BASE-TOO-LARGE", count: 1, u_size: 20, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: [] }, expected: { core: { outcome: "rejected", rejection_codes: ["DEVICE_U_UNSUPPORTED"] }, compatibility: { outcome: "rejected", rejection_codes: ["DEVICE_U_UNSUPPORTED"] } } }),
  baseline({ id: "BASE-REC-005", title: "副本批次跨电源域和交换机域", levels: ["core"], tags: ["batch", "replica"], fixture: "empty-room", request: { id: "BASE-REPLICA", count: 2, u_size: 2, rated_power_w: 1000, weight_kg: 20, network_ports: 2, preferred_rack_ids: [], replica_group: "BASE-RG-01" }, expected: { core: { outcome: "success", action_count: 2, distinct_power_and_switch_domains: true } } }),
  baseline({ id: "BASE-REC-006", title: "三种部署策略暴露稳定 ID", levels: ["core"], tags: ["strategy"], fixture: "empty-room", request: { id: "BASE-STRATEGY", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: [] }, expected: { core: { outcome: "success", strategy_ids: ["balanced_optimal", "consolidated", "load_balanced"] } } }),
  baseline({ id: "BASE-REC-007", title: "兼容字段映射到新规划模型", levels: ["compatibility"], tags: ["compatibility"], fixture: "empty-room", request: { id: "BASE-COMPAT", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"] }, expected: { compatibility: { outcome: "success", first_rack: "CAB-03", mapped_power_w: 500 } } }),
  baseline({ id: "BASE-REC-008", title: "UI 展示方案并完成一次最终确认", levels: ["ui"], tags: ["ui", "basic"], fixture: "empty-room", request: { id: "BASE-UI-PLACEMENT", count: 1, u_size: 4, rated_power_w: 1800, weight_kg: 32, network_ports: 2, preferred_rack_ids: ["CAB-03"] }, expected: { ui: { outcome: "executed", strategy_id: "balanced_optimal", placed_count: 1, preferred_rack_id: "CAB-03", preferred_count: 1 } } }),
  realWorld({
    id: "SCENARIO-REC-001",
    title: "总空闲 U 位足够但没有连续 4U",
    levels: ["core", "compatibility"],
    tags: ["fragmentation", "hard-constraint"],
    fixture: "fragmented-only-rack",
    request: { id: "SCN-001", count: 1, u_size: 4, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: [] },
    expected: {
      core: { outcome: "rejected", rejection_codes: ["NO_CONTIGUOUS_INTERVAL"] },
      compatibility: { outcome: "rejected" },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-002",
    title: "优选机柜空间足够但功率不足",
    levels: ["core", "compatibility"],
    tags: ["preferred-rack", "power"],
    fixture: "preferred-power-limited",
    request: { id: "SCN-002", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"] },
    expected: {
      core: { outcome: "success", action_count: 1, first_rack_not: "CAB-03" },
      compatibility: { outcome: "success", first_rack_not: "CAB-03" },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-003",
    title: "功率重量端口和 U 位恰好到达上限",
    levels: ["core", "compatibility"],
    tags: ["boundary", "hard-constraint"],
    fixture: "exact-capacity-boundary",
    request: { id: "SCN-003", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-01"] },
    expected: {
      core: { outcome: "success", action_count: 1, first_rack: "CAB-01", zero_margins: ["u", "power", "weight", "ports"] },
      compatibility: { outcome: "success", first_rack: "CAB-01", remaining_u_after: 0, power_margin_w: 0, weight_margin_kg: 0 },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-004",
    title: "功率边界超出一瓦",
    levels: ["core", "compatibility"],
    tags: ["boundary", "power", "hard-constraint"],
    fixture: "exact-capacity-boundary",
    request: { id: "SCN-004", count: 1, u_size: 2, rated_power_w: 501, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-01"] },
    expected: {
      core: { outcome: "rejected", rejection_codes: ["RACK_POWER_EXCEEDED"] },
      compatibility: { outcome: "rejected", rejection_codes: ["RACK_POWER_EXCEEDED"] },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-005",
    title: "实时功率缺失时按额定功率保守计算",
    levels: ["core", "compatibility"],
    tags: ["power", "missing-telemetry"],
    fixture: "rated-power-fallback",
    request: { id: "SCN-005", count: 1, u_size: 2, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-01"] },
    expected: {
      core: { outcome: "rejected", rejection_codes: ["RACK_POWER_EXCEEDED"] },
      compatibility: { outcome: "rejected", rejection_codes: ["RACK_POWER_EXCEEDED"] },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-006",
    title: "两台设备形成完整原子批次",
    levels: ["core", "compatibility"],
    tags: ["batch", "atomic"],
    fixture: "empty-room",
    request: { id: "SCN-006", count: 2, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: [] },
    expected: {
      core: { outcome: "success", action_count: 2, unique_device_ids: true, no_overlap: true },
      compatibility: { outcome: "success", action_count: 2 },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-007",
    title: "网络机柜不能成为服务器优选目标",
    levels: ["core", "compatibility", "ui"],
    tags: ["rack-role", "hard-constraint"],
    fixture: "empty-room",
    request: { id: "SCN-007", count: 1, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-21"] },
    expected: {
      core: { outcome: "success", first_rack_not: "CAB-21" },
      compatibility: { outcome: "success", first_rack_not: "CAB-21" },
      ui: { outcome: "option_absent", absent_rack_ids: ["CAB-21", "CAB-22"] },
    },
  }),
  realWorld({
    id: "SCENARIO-REC-008",
    title: "相同库存和请求产生确定结果",
    levels: ["core", "compatibility"],
    tags: ["determinism"],
    fixture: "empty-room",
    request: { id: "SCN-008", count: 3, u_size: 2, rated_power_w: 500, weight_kg: 10, network_ports: 1, preferred_rack_ids: [] },
    expected: {
      core: { outcome: "success", repeat_deterministic: true },
      compatibility: { outcome: "success", repeat_deterministic: true },
    },
  }),
]);

export const uiPlacementCases = Object.freeze(
  placementCases.filter((scenario) => scenario.levels.includes("ui")),
);
```

- [ ] **Step 5: Implement registry validation**

Create `tests/placement-recommendation/case-schema.js`:

```js
const LEVELS = new Set(["core", "compatibility", "ui"]);
const ORIGIN_TYPES = new Set(["baseline", "bug", "real-world"]);
const FIXTURES = new Set(["empty-room", "fragmented-only-rack", "preferred-power-limited", "exact-capacity-boundary", "rated-power-fallback"]);
const TAGS = new Set([
  "fragmentation", "hard-constraint", "preferred-rack", "power", "boundary",
  "missing-telemetry", "batch", "atomic", "rack-role", "determinism", "web",
  "load-balanced", "middleware", "consolidated", "virtualization", "gpu",
  "high-power", "ports", "spill", "sequential", "rollback", "10u",
  "upper-bound", "4u", "2u", "1u", "rejected",
  "basic", "replica", "strategy", "compatibility", "ui",
]);

export function validateCaseRegistry(cases, lifecycle) {
  const errors = [];
  const ids = new Set();
  for (const scenario of cases) {
    if (ids.has(scenario.id)) errors.push(`duplicate case id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!ORIGIN_TYPES.has(scenario.origin?.type)) errors.push(`${scenario.id} has invalid origin.type`);
    if (scenario.origin?.type === "bug" && !scenario.origin.bug_id) errors.push(`${scenario.id} requires origin.bug_id`);
    if (scenario.origin?.type === "real-world" && !scenario.origin.approved_at) errors.push(`${scenario.id} requires origin.approved_at`);
    if (scenario.origin?.type === "baseline" && !/^BASE-REC-/.test(scenario.id)) errors.push(`${scenario.id} requires BASE-REC prefix`);
    if (scenario.origin?.type === "bug" && !/^BUG-/.test(scenario.id)) errors.push(`${scenario.id} requires BUG prefix`);
    if (scenario.origin?.type === "real-world" && !/^SCENARIO-REC-/.test(scenario.id)) errors.push(`${scenario.id} requires SCENARIO-REC prefix`);
    if (!Array.isArray(scenario.levels) || scenario.levels.length === 0) errors.push(`${scenario.id} requires levels`);
    for (const level of scenario.levels ?? []) {
      if (!LEVELS.has(level)) errors.push(`${scenario.id} has unknown level: ${level}`);
      if (!scenario.expected?.[level]) errors.push(`${scenario.id} is missing expected.${level}`);
    }
    if (!FIXTURES.has(scenario.fixture)) errors.push(`${scenario.id} has unknown fixture: ${scenario.fixture}`);
    for (const tag of scenario.tags ?? []) {
      if (!TAGS.has(tag)) errors.push(`${scenario.id} has unknown tag: ${tag}`);
    }
    if (!scenario.request?.id) errors.push(`${scenario.id} requires request.id`);
    if (scenario.levels?.includes("ui") && !scenario.expected.ui?.outcome) errors.push(`${scenario.id} requires visible UI outcome`);
  }
  for (const scenario of cases) {
    if (scenario.supersedes && !ids.has(scenario.supersedes)) errors.push(`unknown superseded case: ${scenario.supersedes}`);
  }
  const lifecycleKeys = new Set();
  for (const record of lifecycle) {
    if (!ids.has(record.case_id)) errors.push(`unknown lifecycle case: ${record.case_id}`);
    if (record.superseded_by && !ids.has(record.superseded_by)) errors.push(`unknown superseding case: ${record.superseded_by}`);
    const key = `${record.case_id}:${record.tag}`;
    if (lifecycleKeys.has(key)) errors.push(`duplicate lifecycle record: ${key}`);
    lifecycleKeys.add(key);
    if (record.tag !== "despair") errors.push(`unsupported lifecycle tag: ${record.tag}`);
    if (!record.reason) errors.push(`${record.case_id} despair requires reason`);
    if (!record.recorded_at) errors.push(`${record.case_id} despair requires recorded_at`);
  }
  return errors;
}
```

- [ ] **Step 6: Run governance tests**

Run: `node --test tests/placement-recommendation/case-schema.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit the governance boundary when Git is usable**

```powershell
git add tests/placement-recommendation/cases.js tests/placement-recommendation/lifecycle.js tests/placement-recommendation/case-schema.js tests/placement-recommendation/case-schema.test.js
git commit -m "test: add governed placement case registry"
```

### Task 2: Execute core and compatibility cases 001–008

**Files:**
- Create: `tests/placement-recommendation/fixtures.js`
- Create: `tests/placement-recommendation/core.test.js`
- Create: `tests/placement-recommendation/compatibility.test.js`

**Interfaces:**
- Consumes: `createEmptyDemoState()`, `placementCases`, `deviceIdsFor()`.
- Produces: `buildFixture(name): DemoState`.
- Core executor calls `createPlanningEngine().recommend(state, request)`.
- Compatibility executor calls `recommendPlacement(state, legacyRequest)`.

- [ ] **Step 1: Write fixture contract tests in the core executor**

Create `tests/placement-recommendation/core.test.js` initially with:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createPlanningEngine } from "../../src/planning/planning-engine.js";
import { placementCases, deviceIdsFor } from "./cases.js";
import { buildFixture } from "./fixtures.js";
import { despairFor } from "./lifecycle.js";

function placements(result) {
  return result.candidates[0]?.actions.filter((action) => action.type === "place_device") ?? [];
}

function assertExpected(scenario, result, state) {
  const expected = scenario.expected.core;
  if (expected.outcome === "rejected") {
    assert.deepEqual(result.candidates, []);
    for (const code of expected.rejection_codes ?? []) {
      assert.ok(result.rejection_summary.some((item) => item.code === code), `${scenario.id}: missing ${code}`);
    }
    return;
  }
  assert.ok(result.candidates.length > 0, `${scenario.id}: expected a candidate`);
  const actions = placements(result);
  if (expected.action_count !== undefined) assert.equal(actions.length, expected.action_count);
  if (expected.first_rack) assert.equal(actions[0].rack_id, expected.first_rack);
  if (expected.first_rack_not) assert.notEqual(actions[0].rack_id, expected.first_rack_not);
  if (expected.unique_device_ids) assert.equal(new Set(actions.map((action) => action.device.id)).size, actions.length);
  if (expected.all_layers) assert.deepEqual([...new Set(actions.map((action) => action.layer_id))], expected.all_layers);
  if (expected.distinct_power_and_switch_domains) {
    const racks = actions.map((action) => state.racks.find((rack) => rack.id === action.rack_id));
    assert.notEqual(racks[0].source_id, racks[1].source_id);
    assert.notEqual(racks[0].network_switch_id, racks[1].network_switch_id);
  }
  if (expected.no_overlap) {
    for (const [index, left] of actions.entries()) {
      for (const right of actions.slice(index + 1)) {
        if (left.rack_id !== right.rack_id || left.layer_id !== right.layer_id) continue;
        const separated = left.start_u + left.device.u_size <= right.start_u
          || right.start_u + right.device.u_size <= left.start_u;
        assert.equal(separated, true, `${left.device.id} overlaps ${right.device.id}`);
      }
    }
  }
  if (expected.zero_margins) {
    const snapshot = result.candidates[0].validation.after[actions[0].rack_id];
    const margins = {
      u: snapshot.usable_u - snapshot.used_u,
      power: snapshot.design_power_w - snapshot.rated_power_used_w,
      weight: snapshot.max_weight_kg - snapshot.used_weight_kg,
      ports: snapshot.port_limit - snapshot.used_ports,
    };
    for (const metric of expected.zero_margins) assert.equal(margins[metric], 0);
  }
  assert.deepEqual(actions.map((action) => action.device.id).sort(), deviceIdsFor(scenario.request).sort());
  void state;
}

for (const scenario of placementCases.filter((item) => item.levels.includes("core"))) {
  const despair = despairFor(scenario.id);
  test(`${scenario.id} [core]${despair ? " [despair]" : ""} ${scenario.title}`, {
    skip: despair?.reason ?? false,
  }, () => {
    const state = buildFixture(scenario.fixture);
    const planner = createPlanningEngine();
    if (scenario.expected.core.strategy_ids) {
      const results = scenario.expected.core.strategy_ids.map((strategyId) => planner.recommend(
        buildFixture(scenario.fixture),
        scenario.request,
        { strategyId },
      ));
      assert.deepEqual(results.map((result) => result.strategy_id), scenario.expected.core.strategy_ids);
      assert.ok(results.every((result) => result.candidates.length > 0));
      return;
    }
    const first = planner.recommend(state, scenario.request);
    assertExpected(scenario, first, state);
    if (scenario.expected.core.repeat_deterministic) {
      const second = planner.recommend(buildFixture(scenario.fixture), scenario.request);
      assert.deepEqual(
        second.candidates.map((candidate) => [candidate.id, candidate.rack_id, candidate.layer_id, candidate.score]),
        first.candidates.map((candidate) => [candidate.id, candidate.rack_id, candidate.layer_id, candidate.score]),
      );
    }
  });
}
```

- [ ] **Step 2: Run the core executor and verify the missing fixture module**

Run: `node --test tests/placement-recommendation/core.test.js`

Expected: FAIL because `fixtures.js` does not exist.

- [ ] **Step 3: Implement deterministic fixtures**

Create `tests/placement-recommendation/fixtures.js`:

```js
import { createEmptyDemoState } from "../../src/demo-state.js";

function device(id, rackId, layerId, startU, uSize, overrides = {}) {
  return {
    id,
    rack_id: rackId,
    layer_id: layerId,
    start_u: startU,
    u_size: uSize,
    rated_power_w: 0,
    real_power_w: null,
    weight_kg: 0,
    network_ports: 0,
    status: "running",
    data_source: "demo",
    ...overrides,
  };
}

function onlyServerRack(state, rackId) {
  state.racks = state.racks.map((rack) => rack.role === "server" && rack.id !== rackId
    ? { ...rack, role: "network" }
    : rack);
  return state;
}

function fragmentedOnlyRack() {
  const state = onlyServerRack(createEmptyDemoState(), "CAB-01");
  state.devices = [
    device("F-L01-A", "CAB-01", "L01", 3, 2),
    device("F-L01-B", "CAB-01", "L01", 7, 2),
    device("F-L02-A", "CAB-01", "L02", 15, 2),
    device("F-L02-B", "CAB-01", "L02", 19, 2),
    device("F-L03-A", "CAB-01", "L03", 25, 2),
    device("F-L03-B", "CAB-01", "L03", 29, 2),
    device("F-L04-A", "CAB-01", "L04", 35, 2),
    device("F-L04-B", "CAB-01", "L04", 39, 2),
  ];
  return state;
}

function exactCapacityBoundary() {
  const state = onlyServerRack(createEmptyDemoState(), "CAB-01");
  state.racks = state.racks.map((rack) => rack.id === "CAB-01"
    ? { ...rack, design_power_w: 500, max_weight_kg: 10, network_port_limit: 1 }
    : rack);
  state.devices = [
    device("B-L01", "CAB-01", "L01", 1, 10),
    device("B-L02", "CAB-01", "L02", 13, 8),
    device("B-L03", "CAB-01", "L03", 23, 8),
    device("B-L04", "CAB-01", "L04", 33, 6),
  ];
  return state;
}

function preferredPowerLimited() {
  const state = createEmptyDemoState();
  state.devices.push(device("POWER-FILL", "CAB-03", "L01", 1, 2, { rated_power_w: 9_800 }));
  return state;
}

function ratedPowerFallback() {
  const state = onlyServerRack(createEmptyDemoState(), "CAB-01");
  state.racks = state.racks.map((rack) => rack.id === "CAB-01" ? { ...rack, design_power_w: 1_000 } : rack);
  state.devices.push(device("RATED-ONLY", "CAB-01", "L01", 1, 2, { rated_power_w: 900, real_power_w: null }));
  return state;
}

const BUILDERS = Object.freeze({
  "empty-room": () => createEmptyDemoState(),
  "fragmented-only-rack": fragmentedOnlyRack,
  "preferred-power-limited": preferredPowerLimited,
  "exact-capacity-boundary": exactCapacityBoundary,
  "rated-power-fallback": ratedPowerFallback,
});

export function buildFixture(name) {
  const builder = BUILDERS[name];
  if (!builder) throw new Error(`Unknown placement fixture: ${name}`);
  return builder();
}

export const fixtureNames = Object.freeze(Object.keys(BUILDERS));
```

- [ ] **Step 4: Create the compatibility executor**

Create `tests/placement-recommendation/compatibility.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { recommendPlacement } from "../../src/placement-recommender.js";
import { placementCases } from "./cases.js";
import { buildFixture } from "./fixtures.js";
import { despairFor } from "./lifecycle.js";

for (const scenario of placementCases.filter((item) => item.levels.includes("compatibility"))) {
  const despair = despairFor(scenario.id);
  test(`${scenario.id} [compatibility]${despair ? " [despair]" : ""} ${scenario.title}`, {
    skip: despair?.reason ?? false,
  }, () => {
    const expected = scenario.expected.compatibility;
    const result = recommendPlacement(buildFixture(scenario.fixture), {
      ...scenario.request,
      power_w: scenario.request.rated_power_w,
      preferred_cabinet_ids: scenario.request.preferred_rack_ids,
    });
    if (expected.outcome === "rejected") {
      assert.deepEqual(result.items, []);
      for (const code of expected.rejection_codes ?? []) {
        assert.ok(result.rejection_summary.some((item) => item.code === code));
      }
      return;
    }
    assert.ok(result.items.length > 0);
    if (expected.first_rack) assert.equal(result.items[0].cabinet_id, expected.first_rack);
    if (expected.first_rack_not) assert.notEqual(result.items[0].cabinet_id, expected.first_rack_not);
    if (expected.action_count !== undefined) {
      assert.equal(result.items[0].actions.filter((action) => action.type === "place_device").length, expected.action_count);
    }
    if (expected.all_layers) {
      const layers = result.items[0].actions.filter((action) => action.type === "place_device").map((action) => action.layer_id);
      assert.deepEqual([...new Set(layers)], expected.all_layers);
    }
    if (expected.mapped_power_w !== undefined) assert.equal(result.input.rated_power_w, expected.mapped_power_w);
    if (expected.remaining_u_after !== undefined) assert.equal(result.items[0].remaining_u_after, expected.remaining_u_after);
    if (expected.power_margin_w !== undefined) assert.equal(result.items[0].power_margin_w, expected.power_margin_w);
    if (expected.weight_margin_kg !== undefined) assert.equal(result.items[0].weight_margin_kg, expected.weight_margin_kg);
    if (expected.repeat_deterministic) {
      const repeated = recommendPlacement(buildFixture(scenario.fixture), {
        ...scenario.request,
        power_w: scenario.request.rated_power_w,
        preferred_cabinet_ids: scenario.request.preferred_rack_ids,
      });
      assert.deepEqual(
        repeated.items.map((item) => [item.id, item.cabinet_id, item.layer_id, item.score]),
        result.items.map((item) => [item.id, item.cabinet_id, item.layer_id, item.score]),
      );
    }
  });
}
```

- [ ] **Step 5: Add fixture-name governance**

Add this import to `case-schema.test.js`:

```js
import { fixtureNames } from "./fixtures.js";
```

Then add:

```js
test("every registered fixture has a builder", () => {
  for (const scenario of placementCases) {
    assert.ok(fixtureNames.includes(scenario.fixture), `${scenario.id}: ${scenario.fixture}`);
  }
});
```

- [ ] **Step 6: Run cases 001–008**

Run:

```powershell
node --test tests/placement-recommendation/case-schema.test.js tests/placement-recommendation/core.test.js tests/placement-recommendation/compatibility.test.js
```

Expected: all registered core/compatibility cases PASS. If a rejection code differs, fix fixture construction or production diagnosis; do not weaken the declared business result.

- [ ] **Step 7: Commit executable baseline cases when Git is usable**

```powershell
git add tests/placement-recommendation/fixtures.js tests/placement-recommendation/core.test.js tests/placement-recommendation/compatibility.test.js tests/placement-recommendation/case-schema.test.js
git commit -m "test: execute structured placement baselines"
```

### Task 3: Repair bounded batch search and preference scoring

**Files:**
- Modify: `tests/planning.test.js`
- Modify: `tests/strategy-scorer.test.js`
- Modify: `src/planning/candidate-generator.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `src/planning/strategy-scorer.js`
- Modify: `src/workflows/plan-service.js`
- Modify: `tests/plan-service.test.js`

**Interfaces:**
- Produces deterministic, rack-interleaved slot ordering that cannot starve later racks within `MAX_EXPANSIONS_PER_ITERATION`.
- Produces `evidence.preferred_miss_ratio: number` in `[0, 1]` for a whole batch.
- `scoreCandidate()` consumes `preferred_miss_ratio`, falling back to the original first-rack boolean for older candidates.

- [ ] **Step 1: Write failing batch regressions**

Append these helpers/tests to `tests/planning.test.js`:

```js
function emptyState() {
  const state = createDemoState();
  state.devices = [];
  state.power_connections = [];
  state.network_connections = [];
  return state;
}

function placementActions(result) {
  return result.candidates[0]?.actions.filter((action) => action.type === "place_device") ?? [];
}

test("empty room consolidated strategy can activate its first rack", () => {
  const result = createPlanningEngine().recommend(emptyState(), request({
    id: "EMPTY-CONSOLIDATED", count: 10, u_size: 2, rated_power_w: 600,
    network_ports: 1,
  }), { strategyId: "consolidated" });
  const actions = placementActions(result);

  assert.equal(actions.length, 10);
  assert.equal(new Set(actions.map((action) => action.rack_id)).size, 1);
});

test("high-port batch spills across racks instead of exhausting bounded search", () => {
  const result = createPlanningEngine().recommend(emptyState(), request({
    id: "PORT-SPILL", count: 10, u_size: 1, rated_power_w: 300,
    weight_kg: 10, network_ports: 8,
  }), { strategyId: "consolidated" });
  const actions = placementActions(result);
  const perRack = Map.groupBy(actions, (action) => action.rack_id);

  assert.equal(actions.length, 10);
  assert.ok(perRack.size >= 5);
  assert.ok([...perRack.values()].every((items) => items.length <= 2));
});

test("preferred rack receives every legal batch member before safe spill", () => {
  const state = emptyState();
  state.devices = [
    { id: "P1", rack_id: "CAB-03", layer_id: "L01", start_u: 1, u_size: 10, rated_power_w: 100, real_power_w: null, weight_kg: 1, network_ports: 1, status: "running", data_source: "demo" },
    { id: "P2", rack_id: "CAB-03", layer_id: "L02", start_u: 13, u_size: 8, rated_power_w: 100, real_power_w: null, weight_kg: 1, network_ports: 1, status: "running", data_source: "demo" },
    { id: "P3", rack_id: "CAB-03", layer_id: "L03", start_u: 23, u_size: 8, rated_power_w: 100, real_power_w: null, weight_kg: 1, network_ports: 1, status: "running", data_source: "demo" },
  ];
  const result = createPlanningEngine().recommend(state, request({
    id: "PREFERRED-SPILL", count: 5, u_size: 2, rated_power_w: 100,
    weight_kg: 1, network_ports: 1, preferred_rack_ids: ["CAB-03"],
  }), { strategyId: "balanced_optimal" });
  const actions = placementActions(result);

  assert.equal(actions.length, 5);
  assert.equal(actions.filter((action) => action.rack_id === "CAB-03").length, 4);
});

test("globally infeasible high-power batch is rejected atomically", () => {
  const result = createPlanningEngine().recommend(emptyState(), request({
    id: "POWER-ATOMIC", count: 10, u_size: 8, rated_power_w: 12_000,
    weight_kg: 100, network_ports: 4,
  }), { strategyId: "load_balanced" });

  assert.deepEqual(result.candidates, []);
  assert.ok(result.rejection_summary.some((item) => item.code === "RACK_POWER_EXCEEDED"));
});
```

If the runtime does not expose `Map.groupBy`, replace only that line with a local `Map` reducer; do not add a dependency.

- [ ] **Step 2: Write the failing whole-batch preference scoring test**

Append to `tests/strategy-scorer.test.js`:

```js
test("preferred scoring accounts for every placement in a batch", () => {
  const allPreferred = candidate("CAB-03", { preferred_miss_ratio: 0 });
  const mostlyMissed = candidate("CAB-03", { preferred_miss_ratio: 0.8 });
  const request = { preferred_rack_ids: ["CAB-03"] };

  const first = scoreCandidate(createDemoState(), request, allPreferred, { strategyId: "balanced_optimal" });
  const second = scoreCandidate(createDemoState(), request, mostlyMissed, { strategyId: "balanced_optimal" });

  assert.ok(first.score < second.score);
  assert.equal(second.breakdown.preferred.raw, 0.8);
});
```

- [ ] **Step 3: Write the failing planner-rejection propagation test**

Append to `tests/plan-service.test.js`:

```js
test("a plan without candidates preserves planner rejection codes", async () => {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({
    repository,
    planner: {
      recommend: () => ({
        candidates: [],
        rejected_count: 8,
        rejection_summary: [{ code: "RACK_POWER_EXCEEDED", count: 8 }],
        solver: {
          engine: "beam_search",
          status: "disabled",
          duration_ms: 0,
          candidate_count: 0,
          fallback_reason: null,
        },
      }),
    },
    executor: createSimulatedExecutionAdapter(),
  });

  const plan = await service.create({
    kind: "placement",
    device: sampleDevice({ id: "REJECTION-EVIDENCE" }),
  }, "planner");

  assert.equal(plan.status, "validated");
  assert.equal(plan.validation.allowed, false);
  assert.deepEqual(plan.validation.blockers.map((item) => item.code), ["RACK_POWER_EXCEEDED"]);
  assert.equal(plan.validation.blockers[0].evidence.rejected_count, 8);
});
```

- [ ] **Step 4: Run regressions and verify current failures**

Run: `node --test tests/planning.test.js tests/strategy-scorer.test.js`

Expected failures include the high-port complete batch, preferred spill count, missing `preferred_miss_ratio` scoring, and plan-service rejection code loss. Capture the exact failing assertions before implementation.

- [ ] **Step 5: Interleave candidate slots by rack**

In `src/planning/candidate-generator.js`, add:

```js
function orderedRackIds(grouped, preferredRackIds) {
  const preferred = (preferredRackIds ?? []).filter((rackId) => grouped.has(rackId));
  const preferredSet = new Set(preferred);
  const remaining = [...grouped.keys()].filter((rackId) => !preferredSet.has(rackId)).sort();
  return [...preferred, ...remaining];
}

function interleaveSlotsByRack(slots, preferredRackIds) {
  const grouped = Map.groupBy(slots, (slot) => slot.rack_id);
  const rackIds = orderedRackIds(grouped, preferredRackIds);
  const result = [];
  const maxLength = Math.max(0, ...rackIds.map((rackId) => grouped.get(rackId).length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const rackId of rackIds) {
      const slot = grouped.get(rackId)[index];
      if (slot) result.push(slot);
    }
  }
  return result;
}
```

If `Map.groupBy` is unavailable in the supported Node runtime, implement this exact replacement at the top of the helper:

```js
const grouped = new Map();
for (const slot of slots) grouped.set(slot.rack_id, [...(grouped.get(slot.rack_id) ?? []), slot]);
```

Change `candidateSlotTuples()` to return:

```js
return interleaveSlotsByRack(tuples, request.preferred_rack_ids);
```

Remove the rack-major `slots.sort(...)` inside `expandPlacementBeams`; it would undo the interleaving.

- [ ] **Step 6: Expand beams round-robin instead of exhausting the first beam**

Replace the beam-outer/slot-inner expansion loop in `expandPlacementBeams()` with:

```js
const slotsByBeam = beams.map((beam) => candidateSlotTuples(beam.projected, request));
const maxSlots = Math.max(0, ...slotsByBeam.map((slots) => slots.length));
for (let slotIndex = 0; slotIndex < maxSlots && attempts < MAX_EXPANSIONS_PER_ITERATION; slotIndex += 1) {
  for (let beamIndex = 0; beamIndex < beams.length && attempts < MAX_EXPANSIONS_PER_ITERATION; beamIndex += 1) {
    const beam = beams[beamIndex];
    const slot = slotsByBeam[beamIndex][slotIndex];
    if (!slot) continue;
    attempts += 1;
    if (!replicaDomainAvailable(baseState, request, beam.actions, slot.rack_id)) continue;
    const action = {
      type: "place_device",
      rack_id: slot.rack_id,
      layer_id: slot.layer_id,
      start_u: slot.start_u,
      device: { ...device, start_u: slot.start_u },
    };
    try {
      expansions.push({
        actions: [...beam.actions, action],
        projected: applyActions(beam.projected, [action]),
      });
    } catch {
      // A hard-constraint failure is recorded when the whole expansion is validated.
    }
  }
}
```

Keep `boundedAllowedExpansions()` and the 2,000-attempt safety bound.

- [ ] **Step 7: Add whole-batch preferred evidence**

In `candidateEvidence()` in `src/planning/planning-engine.js`, compute:

```js
const placements = candidate.actions.filter((action) => action.type === "place_device");
const preferredMisses = request.preferred_rack_ids.length > 0
  ? placements.filter((action) => !request.preferred_rack_ids.includes(action.rack_id)).length
  : 0;
```

Add to the returned evidence:

```js
preferred_miss_ratio: request.preferred_rack_ids.length > 0
  ? preferredMisses / Math.max(1, placements.length)
  : 0,
```

In `metricInputs()` in `src/planning/strategy-scorer.js`, replace the boolean preferred input with:

```js
const preferredMissRatio = preferredRackIds.length > 0
  ? Number(evidence.preferred_miss_ratio ?? (preferredRackIds.includes(candidate.rack_id) ? 0 : 1))
  : 0;
```

and return:

```js
preferred: { raw: preferredMissRatio, normalized: clampPenalty(preferredMissRatio * 100) },
```

- [ ] **Step 8: Preserve planner rejection codes in blocked plans**

Add this function next to `blockedValidation()` in `src/workflows/plan-service.js`:

```js
function blockedPlanningValidation(planning) {
  const summary = Array.isArray(planning?.rejection_summary) ? planning.rejection_summary : [];
  if (summary.length === 0) return blockedValidation("No candidate satisfies every hard constraint");
  return {
    allowed: false,
    blockers: summary.map((item) => ({
      code: item.code,
      target_id: "request",
      message: `${item.code} rejected ${Number(item.count) || 0} candidate expansions`,
      severity: "blocker",
      evidence: { rejected_count: Number(item.count) || 0 },
    })),
    warnings: [],
    before: {},
    after: {},
  };
}
```

Change plan construction to use:

```js
validation: clone(chosen?.validation ?? forcedValidation ?? blockedPlanningValidation(planning)),
```

Do not accept client-provided rejection metadata; only the server-owned `planner.recommend()` result may populate these blockers.

- [ ] **Step 9: Run focused planner and plan-service tests**

Run: `node --test tests/planning.test.js tests/strategy-scorer.test.js tests/constraints.test.js tests/cp-sat-slots.test.js tests/plan-service.test.js`

Expected: all tests PASS. The 10-device tests must complete without raising the expansion bound.

- [ ] **Step 10: Commit batch search behavior when Git is usable**

```powershell
git add src/planning/candidate-generator.js src/planning/planning-engine.js src/planning/strategy-scorer.js src/workflows/plan-service.js tests/planning.test.js tests/strategy-scorer.test.js tests/plan-service.test.js
git commit -m "fix: preserve complete batch candidates across racks"
```

### Task 4: Append approved UI scenarios 009–022

**Files:**
- Modify: `tests/placement-recommendation/cases.js`
- Modify: `tests/placement-recommendation/case-schema.test.js`

**Interfaces:**
- Consumes: `realWorld()` and `deviceIdsFor()` from Task 1.
- Produces: fourteen additional `ui` cases with `setup`, `request`, and declarative `expected.ui` data.

- [ ] **Step 1: Add a failing registry completeness test**

Append to `case-schema.test.js`:

```js
test("approved daily UI scenarios are registered contiguously", () => {
  const expected = Array.from({ length: 14 }, (_, index) => `SCENARIO-REC-${String(index + 9).padStart(3, "0")}`);
  const actual = placementCases.filter((item) => item.levels.includes("ui") && item.id >= "SCENARIO-REC-009").map((item) => item.id);
  assert.deepEqual(actual, expected);
});
```

- [ ] **Step 2: Run the test and verify missing IDs 009–022**

Run: `node --test tests/placement-recommendation/case-schema.test.js`

Expected: FAIL showing the empty/missing sequence.

- [ ] **Step 3: Append the exact approved UI cases**

Append these `realWorld(...)` entries after case 008 and before the closing `]);` in `cases.js`:

```js
  realWorld({ id: "SCENARIO-REC-009", title: "Web 前端日常扩容", levels: ["ui"], tags: ["batch", "web", "load-balanced"], fixture: "empty-room", setup: [], request: { id: "UI-WEB-4", count: 4, u_size: 2, rated_power_w: 800, weight_kg: 18, network_ports: 2, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", placed_count: 4, no_overlap: true } } }),
  realWorld({ id: "SCENARIO-REC-010", title: "中间件集中部署", levels: ["ui"], tags: ["batch", "middleware", "consolidated"], fixture: "empty-room", setup: [], request: { id: "UI-MW-3", count: 3, u_size: 2, rated_power_w: 600, weight_kg: 18, network_ports: 2, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "consolidated", placed_count: 3, max_unique_racks: 1 } } }),
  realWorld({ id: "SCENARIO-REC-011", title: "虚拟化节点扩容", levels: ["ui"], tags: ["batch", "virtualization"], fixture: "empty-room", setup: [], request: { id: "UI-VIRT-3", count: 3, u_size: 4, rated_power_w: 1800, weight_kg: 35, network_ports: 4, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "balanced_optimal", placed_count: 3, no_overlap: true } } }),
  realWorld({ id: "SCENARIO-REC-012", title: "GPU 推理节点扩容", levels: ["ui"], tags: ["batch", "gpu", "high-power"], fixture: "empty-room", setup: [], request: { id: "UI-GPU-2", count: 2, u_size: 8, rated_power_w: 3500, weight_kg: 80, network_ports: 4, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "load_balanced", placed_count: 2, no_overlap: true } } }),
  realWorld({ id: "SCENARIO-REC-013", title: "高端口存储节点安全溢出", levels: ["ui"], tags: ["batch", "ports", "preferred-rack"], fixture: "empty-room", setup: [{ id: "UI-PORT-PRE", count: 1, u_size: 2, rated_power_w: 200, weight_kg: 10, network_ports: 7, preferred_rack_ids: ["CAB-04"], strategy_id: "balanced_optimal" }], request: { id: "UI-STORAGE-3", count: 3, u_size: 2, rated_power_w: 900, weight_kg: 25, network_ports: 6, preferred_rack_ids: ["CAB-04"] }, expected: { ui: { outcome: "executed", strategy_id: "consolidated", placed_count: 3, preferred_rack_id: "CAB-04", preferred_count: 2, max_ports_per_rack: 24 } } }),
  realWorld({ id: "SCENARIO-REC-014", title: "优选机柜只能接收部分批次", levels: ["ui"], tags: ["batch", "preferred-rack", "spill"], fixture: "empty-room", setup: [{ id: "UI-U-PRE-4", count: 6, u_size: 4, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"], strategy_id: "balanced_optimal" }, { id: "UI-U-PRE-2", count: 1, u_size: 2, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"], strategy_id: "balanced_optimal" }], request: { id: "UI-SPILL-5", count: 5, u_size: 2, rated_power_w: 700, weight_kg: 20, network_ports: 2, preferred_rack_ids: ["CAB-03"] }, expected: { ui: { outcome: "executed", strategy_id: "balanced_optimal", placed_count: 5, preferred_rack_id: "CAB-03", preferred_count: 4 } } }),
  realWorld({ id: "SCENARIO-REC-015", title: "同日连续两个批次", levels: ["ui"], tags: ["batch", "sequential"], fixture: "empty-room", setup: [{ id: "UI-DAY-A", count: 2, u_size: 2, rated_power_w: 600, weight_kg: 15, network_ports: 2, preferred_rack_ids: [], strategy_id: "load_balanced" }], request: { id: "UI-DAY-B", count: 2, u_size: 4, rated_power_w: 1200, weight_kg: 30, network_ports: 2, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "load_balanced", placed_count: 2, setup_devices_present: true, no_overlap: true } } }),
  realWorld({ id: "SCENARIO-REC-016", title: "批量执行失败并回滚", levels: ["ui"], tags: ["batch", "rollback", "atomic"], fixture: "empty-room", setup: [], request: { id: "UI-ROLLBACK-3", count: 3, u_size: 2, rated_power_w: 800, weight_kg: 18, network_ports: 2, preferred_rack_ids: [] }, expected: { ui: { outcome: "rolled_back", strategy_id: "balanced_optimal", placed_count: 0, fail_at: "written" } } }),
  realWorld({ id: "SCENARIO-REC-017", title: "10 台 10U 大型服务器", levels: ["ui"], tags: ["batch", "10u", "upper-bound"], fixture: "empty-room", setup: [], request: { id: "UI-10X10U", count: 10, u_size: 10, rated_power_w: 2500, weight_kg: 80, network_ports: 4, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "load_balanced", placed_count: 10, unique_racks: 10, all_layers: ["L01"] } } }),
  realWorld({ id: "SCENARIO-REC-018", title: "10 台 4U 虚拟化节点", levels: ["ui"], tags: ["batch", "4u", "upper-bound"], fixture: "empty-room", setup: [], request: { id: "UI-10X4U", count: 10, u_size: 4, rated_power_w: 1800, weight_kg: 35, network_ports: 4, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "load_balanced", placed_count: 10, no_overlap: true } } }),
  realWorld({ id: "SCENARIO-REC-019", title: "10 台 2U Web 节点集中部署", levels: ["ui"], tags: ["batch", "2u", "consolidated"], fixture: "empty-room", setup: [], request: { id: "UI-10X2U", count: 10, u_size: 2, rated_power_w: 800, weight_kg: 18, network_ports: 2, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "consolidated", placed_count: 10, unique_racks: 2 } } }),
  realWorld({ id: "SCENARIO-REC-020", title: "10 台 2U 优选机柜溢出", levels: ["ui"], tags: ["batch", "preferred-rack", "upper-bound"], fixture: "empty-room", setup: [{ id: "UI-BIG-PRE-4", count: 6, u_size: 4, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"], strategy_id: "balanced_optimal" }, { id: "UI-BIG-PRE-2", count: 1, u_size: 2, rated_power_w: 200, weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"], strategy_id: "balanced_optimal" }], request: { id: "UI-SPILL-10", count: 10, u_size: 2, rated_power_w: 700, weight_kg: 20, network_ports: 2, preferred_rack_ids: ["CAB-03"] }, expected: { ui: { outcome: "executed", strategy_id: "balanced_optimal", placed_count: 10, preferred_rack_id: "CAB-03", preferred_count: 4 } } }),
  realWorld({ id: "SCENARIO-REC-021", title: "10 台 1U 高端口服务器", levels: ["ui"], tags: ["batch", "ports", "upper-bound"], fixture: "empty-room", setup: [], request: { id: "UI-10X1U-PORT", count: 10, u_size: 1, rated_power_w: 300, weight_kg: 10, network_ports: 8, preferred_rack_ids: [] }, expected: { ui: { outcome: "executed", strategy_id: "consolidated", placed_count: 10, min_unique_racks: 5, max_devices_per_rack: 2, max_ports_per_rack: 24 } } }),
  realWorld({ id: "SCENARIO-REC-022", title: "10 台 8U 超高功率服务器资源不足", levels: ["ui"], tags: ["batch", "power", "atomic", "rejected"], fixture: "empty-room", setup: [], request: { id: "UI-10X8U-POWER", count: 10, u_size: 8, rated_power_w: 12000, weight_kg: 100, network_ports: 4, preferred_rack_ids: [] }, expected: { ui: { outcome: "rejected", strategy_id: "load_balanced", placed_count: 0, rejection_codes: ["RACK_POWER_EXCEEDED"] } } }),
```

- [ ] **Step 4: Run schema and inspect the exported UI count**

Run:

```powershell
node --test tests/placement-recommendation/case-schema.test.js
node --input-type=module -e "import {uiPlacementCases} from './tests/placement-recommendation/cases.js'; console.log(uiPlacementCases.map(x=>x.id).join(','));"
```

Expected: governance PASS; output includes `SCENARIO-REC-007` and the contiguous range `009` through `022`.

- [ ] **Step 5: Commit approved scenario data when Git is usable**

```powershell
git add tests/placement-recommendation/cases.js tests/placement-recommendation/case-schema.test.js
git commit -m "test: register approved daily batch scenarios"
```

### Task 5: Run structured cases through the existing browser file

**Files:**
- Modify: `tests/e2e/closed-loops.spec.js`

**Interfaces:**
- Consumes: `uiPlacementCases`, `deviceIdsFor`.
- Produces local Playwright helpers `deployBatch(page, deployment)` and `inventoryForIds(page, ids)` inside `closed-loops.spec.js`.
- Must not create another Playwright file.

- [ ] **Step 1: Import the UI registry and add form helpers**

At the top of `closed-loops.spec.js`, add:

```js
import { deviceIdsFor, uiPlacementCases } from "../placement-recommendation/cases.js";
import { despairFor } from "../placement-recommendation/lifecycle.js";
```

After `resetDemo()`, add:

```js
async function openPlacement(page) {
  await page.getByRole("button", { name: /上架 Agent/ }).click();
}

async function deployBatch(page, deployment, { execute = true, failAt = null } = {}) {
  await openPlacement(page);
  await page.getByLabel("本次部署策略").selectOption(deployment.strategy_id ?? "balanced_optimal");
  await page.getByLabel("设备编号").fill(deployment.id);
  await page.getByLabel("数量").fill(String(deployment.count));
  await page.getByLabel("设备高度（U）").fill(String(deployment.u_size));
  await page.getByLabel("额定功率（W）").fill(String(deployment.rated_power_w));
  await page.getByLabel("重量（kg）").fill(String(deployment.weight_kg));
  await page.getByLabel("网络端口").fill(String(deployment.network_ports));
  await page.getByLabel("优选机柜").selectOption(deployment.preferred_rack_ids?.[0] ?? "");
  if (failAt) await page.getByLabel("执行演示").selectOption(failAt);
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().endsWith("/api/plans") && item.request().method() === "POST"),
    page.getByRole("button", { name: "生成上架方案" }).click(),
  ]);
  expect(response.status()).toBe(201);
  const plan = await response.json();
  if (!execute || plan.status !== "awaiting_confirmation") return plan;
  await page.getByRole("button", { name: "进入最终确认" }).click();
  await page.getByRole("button", { name: "确认并模拟执行" }).click();
  return plan;
}

async function inventoryForIds(page, ids) {
  const found = [];
  for (const id of ids) {
    const response = await page.request.get(`/api/devices/${id}`);
    if (response.ok()) found.push(await response.json());
    else expect(response.status()).toBe(404);
  }
  return found;
}

function assertNoOverlap(devices) {
  for (const [index, left] of devices.entries()) {
    for (const right of devices.slice(index + 1)) {
      if (left.rack_id !== right.rack_id || left.layer_id !== right.layer_id) continue;
      const separated = left.start_u + left.u_size <= right.start_u
        || right.start_u + right.u_size <= left.start_u;
      expect(separated, `${left.id} overlaps ${right.id}`).toBeTruthy();
    }
  }
}
```

- [ ] **Step 2: Register the unified UI loop**

Append this loop to `closed-loops.spec.js`:

```js
for (const scenario of uiPlacementCases) {
  const despair = despairFor(scenario.id);
  test(`${scenario.id} [ui]${despair ? " [despair]" : ""} ${scenario.title}`, async ({ page }) => {
    if (despair) test.skip(true, despair.reason);
    await login(page);
    await resetDemo(page);
    const expected = scenario.expected.ui;

    if (expected.outcome === "option_absent") {
      await openPlacement(page);
      for (const rackId of expected.absent_rack_ids) {
        await expect(page.getByLabel("优选机柜").locator(`option[value="${rackId}"]`)).toHaveCount(0);
      }
      return;
    }

    const setupIds = [];
    for (const setup of scenario.setup) {
      await deployBatch(page, setup);
      setupIds.push(...deviceIdsFor(setup));
      await expect(page.getByText("执行并验证成功")).toBeVisible();
    }

    const deployment = {
      ...scenario.request,
      strategy_id: expected.strategy_id ?? "balanced_optimal",
    };
    const execute = !["rejected"].includes(expected.outcome);
    const plan = await deployBatch(page, deployment, { execute, failAt: expected.fail_at ?? null });
    const ids = deviceIdsFor(scenario.request);

    if (expected.outcome === "rejected") {
      expect(plan.status).toBe("validated");
      expect(plan.actions).toEqual([]);
      await expect(page.getByText("未生成可执行候选。请查看下方“硬阻断”说明，修改设备参数或编号后重试。")).toBeVisible();
      for (const code of expected.rejection_codes ?? []) await expect(page.getByText(code, { exact: false })).toBeVisible();
      expect(await inventoryForIds(page, ids)).toEqual([]);
      return;
    }

    if (expected.outcome === "rolled_back") {
      await expect(page.getByText("执行失败，回滚完成")).toBeVisible();
      expect(await inventoryForIds(page, ids)).toEqual([]);
      await page.locator('[data-view="audit"]').click();
      await expect(page.locator(".audit-timeline")).toContainText("方案执行失败并回滚");
      return;
    }

    await expect(page.getByText("执行并验证成功")).toBeVisible();
    const devices = await inventoryForIds(page, ids);
    expect(devices).toHaveLength(expected.placed_count);
    const rackGroups = Map.groupBy(devices, (device) => device.rack_id);
    if (expected.unique_racks !== undefined) expect(rackGroups.size).toBe(expected.unique_racks);
    if (expected.min_unique_racks !== undefined) expect(rackGroups.size).toBeGreaterThanOrEqual(expected.min_unique_racks);
    if (expected.max_unique_racks !== undefined) expect(rackGroups.size).toBeLessThanOrEqual(expected.max_unique_racks);
    if (expected.max_devices_per_rack !== undefined) {
      expect(Math.max(...[...rackGroups.values()].map((items) => items.length))).toBeLessThanOrEqual(expected.max_devices_per_rack);
    }
    if (expected.preferred_rack_id) {
      expect(devices.filter((device) => device.rack_id === expected.preferred_rack_id)).toHaveLength(expected.preferred_count);
    }
    if (expected.all_layers) expect(new Set(devices.map((device) => device.layer_id)).toEqual(new Set(expected.all_layers));
    if (expected.no_overlap) assertNoOverlap(devices);
    if (expected.setup_devices_present) expect(await inventoryForIds(page, setupIds)).toHaveLength(setupIds.length);
    if (expected.max_ports_per_rack !== undefined) {
      for (const rackId of rackGroups.keys()) {
        const response = await page.request.get(`/api/racks/${rackId}`);
        const rack = await response.json();
        expect(rack.capacity.used_ports).toBeLessThanOrEqual(expected.max_ports_per_rack);
      }
    }
  });
}
```

Use a local reducer instead of `Map.groupBy` only if required by the supported Node runtime.

- [ ] **Step 3: Run the smallest UI cases first**

Run:

```powershell
node scripts/run-e2e.js tests/e2e/closed-loops.spec.js --grep "SCENARIO-REC-007|SCENARIO-REC-009|SCENARIO-REC-010"
```

Expected: 3 tests PASS. Fix selectors or response-shape assumptions in the helper; do not move cases to a new `.spec.js`.

- [ ] **Step 4: Run the 10-device boundary cases**

Run:

```powershell
node scripts/run-e2e.js tests/e2e/closed-loops.spec.js --grep "SCENARIO-REC-017|SCENARIO-REC-018|SCENARIO-REC-019|SCENARIO-REC-021|SCENARIO-REC-022"
```

Expected: 017–021 PASS with complete batches; 022 PASS by proving atomic rejection.

- [ ] **Step 5: Run every approved UI scenario**

Run: `node scripts/run-e2e.js tests/e2e/closed-loops.spec.js --grep "SCENARIO-REC-"`

Expected: all UI-level registered cases PASS; no process closes before the result summary.

- [ ] **Step 6: Commit the unified UI registry execution when Git is usable**

```powershell
git add tests/e2e/closed-loops.spec.js
git commit -m "test: run approved batches through existing ui suite"
```

### Task 6: Redesign legacy UI cases for an empty seed

**Files:**
- Modify: `tests/e2e/closed-loops.spec.js`

**Interfaces:**
- Consumes: `deployBatch()`, `inventoryForIds()`, `resetDemo()` from Task 5.
- Produces: the original business checks without relying on pre-seeded devices, occupancy, or audit records.

- [ ] **Step 1: Redesign overview and device detail**

At the start of the overview test, replace the CAB-09 pre-seeded-device assumption with:

```js
await expect(page.locator(".rack-card .rack-u")).toHaveText(Array(22).fill("0 / 34U"));
await deployBatch(page, {
  id: "SRV-E2E-OVERVIEW", count: 1, u_size: 2, rated_power_w: 800,
  weight_kg: 18, network_ports: 2, preferred_rack_ids: ["CAB-09"],
  strategy_id: "balanced_optimal",
});
await page.getByRole("button", { name: /机房总览/ }).click();
await page.getByRole("button", { name: "查看 CAB-09 机柜详情" }).click();
await page.getByRole("button", { name: "查看服务器 SRV-E2E-OVERVIEW" }).click();
await expect(page.getByText("CAB-09-PDU", { exact: false })).toBeVisible();
await expect(page.getByText("ASW-05", { exact: false })).toBeVisible();
```

This uses the existing capacity text and does not add test-only markup.

- [ ] **Step 2: Redesign removal to create its own device**

Before opening CAB-03 in the removal test, execute:

```js
await deployBatch(page, {
  id: "SRV-E2E-REMOVAL", count: 1, u_size: 2, rated_power_w: 500,
  weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"],
  strategy_id: "balanced_optimal",
});
await page.getByRole("button", { name: /机房总览/ }).click();
await page.getByRole("button", { name: "查看 CAB-03 机柜详情" }).click();
const removable = page.locator('.device-block[data-device-id="SRV-E2E-REMOVAL"]');
```

Keep the original removal confirmation, 404, and audit assertions.

- [ ] **Step 3: Redesign topology/reset and audit tests**

Create `SRV-E2E-TOPOLOGY` in CAB-09 through `deployBatch()` before querying topology. Assert its PDU and ASW-05 evidence, run the existing administrative reset, then add:

```js
expect((await page.request.get("/api/devices/SRV-E2E-TOPOLOGY")).status()).toBe(404);
for (const rackId of Array.from({ length: 20 }, (_, index) => `CAB-${String(index + 1).padStart(2, "0")}`)) {
  const rack = await (await page.request.get(`/api/racks/${rackId}`)).json();
  expect(rack.devices).toEqual([]);
}
```

For the audit-details test, create and inspect its own operation:

```js
await deployBatch(page, {
  id: "SRV-E2E-AUDIT", count: 1, u_size: 2, rated_power_w: 500,
  weight_kg: 10, network_ports: 1, preferred_rack_ids: ["CAB-03"],
  strategy_id: "balanced_optimal",
});
await page.getByRole("button", { name: /变更审计/ }).click();
const auditEntry = page.locator(".audit-entry").filter({ hasText: "SRV-E2E-AUDIT" }).first();
await auditEntry.locator("summary").click();
await expect(auditEntry.locator(".audit-entry-details")).toContainText("SRV-E2E-AUDIT");
```

- [ ] **Step 4: Redesign capacity-risk coloring**

Deploy this exact warning-line device before checking the overview:

```js
await deployBatch(page, {
  id: "SRV-E2E-WARNING", count: 1, u_size: 2, rated_power_w: 8000,
  weight_kg: 20, network_ports: 2, preferred_rack_ids: ["CAB-01"],
  strategy_id: "balanced_optimal",
});
await page.getByRole("button", { name: /机房总览/ }).click();
const warningRack = page.locator('.rack-card[data-risk-basis="功率"]').filter({ hasText: "CAB-01" });
await expect(warningRack).toHaveClass(/rack-warning/);
await expect(warningRack).toContainText("功率 80%");
```

Keep the weak-current topology assertions because rack/switch infrastructure remains seeded.

- [ ] **Step 5: Run all legacy closed-loop tests**

Run:

```powershell
node scripts/run-e2e.js tests/e2e/closed-loops.spec.js --grep-invert "SCENARIO-REC-"
```

Expected: all legacy cases PASS from an empty reset. No valid case is marked `despair`.

- [ ] **Step 6: Commit redesigned legacy cases when Git is usable**

```powershell
git add tests/e2e/closed-loops.spec.js
git commit -m "test: rebuild ui prerequisites from empty inventory"
```

### Task 7: Wire every executor into the unified folder script

**Files:**
- Modify: `tests/placement-recommendation/run-test-set.js`
- Modify: `tests/placement-recommendation/run-test-set.test.js`
- Verify: `tests/placement-recommendation/run-test-set.cmd`

**Interfaces:**
- `core` runs governance, structured core, structured compatibility, and the existing focused recommendation files.
- `ui` runs only `closed-loops.spec.js` and matches baseline placement tests plus `SCENARIO-REC-*`.
- `all` runs core before UI and stops on the first non-zero exit.

- [ ] **Step 1: Extend runner tests first**

In the core-mode test, require:

```js
for (const file of [
  "tests/placement-recommendation/case-schema.test.js",
  "tests/placement-recommendation/core.test.js",
  "tests/placement-recommendation/compatibility.test.js",
]) {
  assert.ok(commands[0].args.includes(file), `${file} must be included`);
}
```

In the UI-mode test, require:

```js
assert.match(command.args.at(-1), /SCENARIO-REC/);
assert.match(command.args.at(-1), /BASE-REC/);
assert.equal(command.args.filter((arg) => arg.endsWith(".spec.js")).length, 1);
```

- [ ] **Step 2: Run runner tests and verify missing structured files**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: FAIL because `buildCommands("core")` and the UI grep do not yet include the new executors/IDs.

- [ ] **Step 3: Update the runner command lists**

Prepend to `coreFiles` in `run-test-set.js`:

```js
"tests/placement-recommendation/case-schema.test.js",
"tests/placement-recommendation/core.test.js",
"tests/placement-recommendation/compatibility.test.js",
```

Add both `"BASE-REC"` and `"SCENARIO-REC"` to `placementUiPattern`. Keep `tests/e2e/closed-loops.spec.js` as the only spec path.

- [ ] **Step 4: Run runner unit and core modes**

Run:

```powershell
node --test tests/placement-recommendation/run-test-set.test.js
tests\placement-recommendation\run-test-set.cmd --no-pause core
```

Expected: runner tests PASS; core mode returns exit code 0.

- [ ] **Step 5: Run UI mode past the historical fourth-test boundary**

Run: `tests\placement-recommendation\run-test-set.cmd --no-pause ui`

Expected: all selected UI cases run, including cases after the fourth test, and the wrapper returns exit code 0 without an unexplained crash.

- [ ] **Step 6: Commit runner wiring when Git is usable**

```powershell
git add tests/placement-recommendation/run-test-set.js tests/placement-recommendation/run-test-set.test.js
git commit -m "test: wire structured cases into unified runner"
```

### Task 8: Full regression and append-only audit

**Files:**
- Verify all files changed by Tasks 1–7.

**Interfaces:**
- Produces final evidence for the empty-startup plan, structured suite, planner fixes, browser scenarios, and Windows wrapper.

- [ ] **Step 1: Run governance and planner focus**

Run:

```powershell
node --test tests/placement-recommendation/case-schema.test.js tests/placement-recommendation/core.test.js tests/placement-recommendation/compatibility.test.js tests/planning.test.js tests/strategy-scorer.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run the complete project unit suite**

Run: `npm test`

Expected: zero failures; the environment-only OR-Tools skip may remain.

- [ ] **Step 3: Run the unified suite exactly as users will**

Run: `tests\placement-recommendation\run-test-set.cmd --no-pause all`

Expected: core and UI sections both finish with exit code 0.

- [ ] **Step 4: Run the complete browser suite, including redesigned legacy cases**

Run: `npm run test:e2e`

Expected: zero failures across legacy and structured scenarios.

- [ ] **Step 5: Verify the 10 × 10U inventory evidence independently**

Run the focused browser case with retained trace-on-failure:

```powershell
node scripts/run-e2e.js tests/e2e/closed-loops.spec.js --grep "SCENARIO-REC-017"
```

Expected: one test PASS; its assertions prove ten device IDs, ten distinct racks, and L01-only placement.

- [ ] **Step 6: Audit the repository structure and lifecycle rules**

Run:

```powershell
rg -n "SCENARIO-REC-(00[9]|01[0-9]|02[0-2])|despair" tests/placement-recommendation tests/e2e/closed-loops.spec.js
rg --files tests/e2e -g "*.spec.js"
```

Expected: cases 009–022 occur in the unified registry and existing browser file; no new placement-specific `.spec.js` exists; `despair` appears only in governance support unless a future approved lifecycle record was appended.

- [ ] **Step 7: Inspect intentional diffs only**

Run:

```powershell
git diff -- src/planning/candidate-generator.js src/planning/planning-engine.js src/planning/strategy-scorer.js src/workflows/plan-service.js tests/placement-recommendation tests/e2e/closed-loops.spec.js
```

Expected: no unrelated user changes were overwritten. Record exact unit/core/UI pass and skip counts in the handoff.

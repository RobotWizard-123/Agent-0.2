# Manual Exact Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove selectable consolidated/load-balanced deployment strategies from the current rack-placement module and add validated single-device deployment to an exact rack, layer, and start U.

**Architecture:** Keep `POST /api/plans` and the existing plan confirmation/execution pipeline. The plan service passes a manual mode and target into the planning engine; the reconfiguration problem exposes exactly one new-device position and no movable existing devices, while the current constraint engine remains the final safety check.

**Tech Stack:** Node.js ES modules, browser DOM APIs, built-in `node:test`, existing deterministic/CP-SAT planning adapters.

## Global Constraints

- 保持已有项目结构不变。
- 只实现当前上架模块及其直接规划边界。
- 添加必要的异常处理。
- 生成对应测试案例。
- 手动模式只允许单台服务器。
- 用户必须指定机柜、挡板层和起始 U 位。
- 目标位置已占用时直接返回 `TARGET_POSITION_OCCUPIED`，不得迁移现有服务器。
- 自动部署固定使用 `balanced_optimal`；底层旧策略和历史方案兼容保留。
- 工作树已有大量用户修改；不得重置、覆盖或提交无关改动。

## File Structure

- Modify `src/planning/planning-engine.js`: normalize and validate manual placement options, run only the direct phase.
- Modify `src/planning/reconfiguration-problem.js`: restrict the new device to the exact target and treat all existing devices as fixed.
- Modify `src/workflows/plan-service.js`: forward top-level manual placement fields into the planner.
- Modify `src/http-app.js`: map manual input errors to HTTP 400 and target occupancy to HTTP 409.
- Modify `public/js/views/agent-console.js`: remove strategy controls and add automatic/manual exact-position form behavior.
- Modify `tests/planning.test.js`: planning contract and error cases.
- Modify `tests/api-v02.test.js`: HTTP creation/confirmation and exact persisted position.
- Modify `tests/frontend-contract.test.js`: current-module source contract.

---

### Task 1: Manual target validation and direct-only planning

**Files:**
- Modify: `tests/planning.test.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `src/planning/reconfiguration-problem.js`

**Interfaces:**
- Consumes: `planner.recommend(state, device, options)` and `deriveLayers(rack)`.
- Produces: options `{ placementMode: "manual", targetPosition: { rack_id, layer_id, start_u } }`; stable manual-target errors; a candidate with no `move_device` actions.

- [ ] **Step 1: Write failing exact-placement and direct-only tests**

```js
test("manual placement uses the exact rack, layer, and start U", () => {
  const result = createPlanningEngine({ cpSatAdapter: unavailableCp() }).recommend(
    createEmptyDemoState(),
    request({ id: "MANUAL-EXACT" }),
    {
      placementMode: "manual",
      targetPosition: { rack_id: "CAB-03", layer_id: "L02", start_u: 13 },
    },
  );
  const placement = result.candidates[0].actions.find((action) => action.type === "place_device");
  assert.deepEqual(
    { rack_id: placement.rack_id, layer_id: placement.layer_id, start_u: placement.start_u },
    { rack_id: "CAB-03", layer_id: "L02", start_u: 13 },
  );
  assert.equal(result.candidates[0].actions.some((action) => action.type === "move_device"), false);
});

test("manual placement rejects an occupied target without migration", () => {
  const state = createEmptyDemoState();
  state.devices.push({
    ...request({ id: "OCCUPANT", count: undefined }),
    rack_id: "CAB-03",
    layer_id: "L02",
    start_u: 13,
    status: "running",
    movable: true,
    criticality: "normal",
    maintenance_window: "Saturday 02:00-04:00",
  });
  assert.throws(
    () => createPlanningEngine({ cpSatAdapter: unavailableCp() }).recommend(
      state,
      request({ id: "MANUAL-BLOCKED" }),
      { placementMode: "manual", targetPosition: { rack_id: "CAB-03", layer_id: "L02", start_u: 13 } },
    ),
    (error) => error.code === "TARGET_POSITION_OCCUPIED",
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="manual placement" tests/planning.test.js`

Expected: the exact-position assertion fails because options are ignored, and the occupied-target assertion reports no `TARGET_POSITION_OCCUPIED` error.

- [ ] **Step 3: Add failing validation matrix tests**

```js
for (const scenario of [
  { name: "requires a target", count: 1, target: null, code: "MANUAL_TARGET_REQUIRED" },
  { name: "requires one device", count: 2, target: { rack_id: "CAB-03", layer_id: "L02", start_u: 13 }, code: "MANUAL_PLACEMENT_COUNT_INVALID" },
  { name: "requires an existing rack", count: 1, target: { rack_id: "CAB-99", layer_id: "L02", start_u: 13 }, code: "TARGET_RACK_NOT_FOUND" },
  { name: "requires a server rack", count: 1, target: { rack_id: "CAB-21", layer_id: "L02", start_u: 13 }, code: "TARGET_RACK_NOT_DEPLOYABLE" },
  { name: "requires a rack layer", count: 1, target: { rack_id: "CAB-03", layer_id: "L99", start_u: 13 }, code: "TARGET_LAYER_NOT_FOUND" },
  { name: "requires an integer start U", count: 1, target: { rack_id: "CAB-03", layer_id: "L02", start_u: 13.5 }, code: "TARGET_START_U_INVALID" },
  { name: "stays inside usable U", count: 1, target: { rack_id: "CAB-03", layer_id: "L02", start_u: 19 }, code: "TARGET_POSITION_OUT_OF_RANGE" },
]) {
  test(`manual placement ${scenario.name}`, () => {
    assert.throws(
      () => createPlanningEngine({ cpSatAdapter: unavailableCp() }).recommend(
        createEmptyDemoState(),
        request({ count: scenario.count }),
        { placementMode: "manual", targetPosition: scenario.target },
      ),
      (error) => error.code === scenario.code,
    );
  });
}
```

- [ ] **Step 4: Run the validation tests and verify RED**

Run: `node --test --test-name-pattern="manual placement" tests/planning.test.js`

Expected: every new validation case fails because stable manual-target validation is not implemented.

- [ ] **Step 5: Implement authoritative target normalization and occupancy checks**

Add helpers in `src/planning/planning-engine.js` with this interface and behavior:

```js
function manualPlacementError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function validateManualTarget(state, request, rawTarget) {
  if (request.count !== 1) {
    throw manualPlacementError("MANUAL_PLACEMENT_COUNT_INVALID", "Manual placement requires exactly one device");
  }
  if (!rawTarget || typeof rawTarget !== "object") {
    throw manualPlacementError("MANUAL_TARGET_REQUIRED", "Manual placement requires rack, layer, and start U");
  }
  const rack = state.racks.find((item) => item.id === rawTarget.rack_id);
  if (!rack) throw manualPlacementError("TARGET_RACK_NOT_FOUND", `Rack does not exist: ${rawTarget.rack_id}`);
  if (rack.role !== "server") throw manualPlacementError("TARGET_RACK_NOT_DEPLOYABLE", `${rack.id} is not a server rack`);
  const layer = deriveLayers(rack).find((item) => item.id === rawTarget.layer_id);
  if (!layer) throw manualPlacementError("TARGET_LAYER_NOT_FOUND", `Layer does not exist in ${rack.id}: ${rawTarget.layer_id}`);
  const startU = Number(rawTarget.start_u);
  if (!Number.isInteger(startU) || startU <= 0) {
    throw manualPlacementError("TARGET_START_U_INVALID", "Target start U must be a positive integer");
  }
  const endU = startU + request.u_size - 1;
  if (startU < layer.start_u || endU > layer.usable_end_u) {
    throw manualPlacementError("TARGET_POSITION_OUT_OF_RANGE", "Target interval exceeds the usable layer range");
  }
  const occupant = state.devices.find((device) => device.status !== "cancelled"
    && device.rack_id === rack.id
    && device.layer_id === layer.id
    && Number(device.start_u) <= endU
    && startU <= Number(device.start_u) + Number(device.u_size) - 1);
  if (occupant) {
    throw manualPlacementError("TARGET_POSITION_OCCUPIED", `Target U interval is occupied by ${occupant.id}`, { device_id: occupant.id });
  }
  return { rack_id: rack.id, layer_id: layer.id, start_u: startU };
}
```

Import `deriveLayers`, validate only when `options.placementMode === "manual"`, pass the result to `solvePhase`, and skip expanded search for manual mode.

- [ ] **Step 6: Restrict the reconfiguration problem to one target and zero movable devices**

Extend `buildReconfigurationProblem` options and filter the new-device positions:

```js
export function buildReconfigurationProblem(state, request, {
  strategyId = "balanced_optimal",
  phase = "normal",
  maxCandidates = 4,
  timeLimitMs = 2_000,
  targetPosition = null,
  allowMigrations = true,
} = {}) {
  const movable = allowMigrations ? eligibleMovableDevices(state) : [];
  // existing construction remains unchanged
  if (newDefinitions[0]) {
    newDefinitions[0].positions = positionOptions(state, fixedDevices, racks, newDefinitions[0], strategyId)
      .filter((position) => !targetPosition
        || (position.rack_id === targetPosition.rack_id
          && position.layer_id === targetPosition.layer_id
          && position.start_u === targetPosition.start_u));
  }
  // existing model construction remains unchanged
}
```

For manual planning call the problem builder with `targetPosition` and `allowMigrations: false`.

- [ ] **Step 7: Run Task 1 tests and verify GREEN**

Run: `node --test --test-name-pattern="manual placement" tests/planning.test.js`

Expected: all manual-placement tests pass.

---

### Task 2: Plan-service and HTTP contract

**Files:**
- Modify: `tests/api-v02.test.js`
- Modify: `src/workflows/plan-service.js`
- Modify: `src/http-app.js`

**Interfaces:**
- Consumes: top-level `placement_mode` and `target_position` from `POST /api/plans`.
- Produces: planner options `placementMode` and `targetPosition`; persisted plan request and exact `place_device` action.

- [ ] **Step 1: Write a failing API success test**

```js
test("V0.2 API confirms a manual plan at the exact target", async () => {
  await withV02Server(async ({ request }) => {
    const body = {
      ...placementRequest(),
      placement_mode: "manual",
      strategy_id: "balanced_optimal",
      target_position: { rack_id: "CAB-03", layer_id: "L03", start_u: 23 },
      device: { ...placementRequest().device, id: "SRV-MANUAL-API", preferred_rack_ids: [] },
    };
    const created = await request("/api/plans", { method: "POST", body });
    assert.equal(created.response.status, 201);
    const action = created.body.actions.find((item) => item.type === "place_device");
    assert.deepEqual(
      { rack_id: action.rack_id, layer_id: action.layer_id, start_u: action.start_u },
      body.target_position,
    );
    const confirmed = await request(`/api/plans/${created.body.id}/confirm`, { method: "POST", body: {} });
    assert.equal(confirmed.response.status, 200);
    const device = await request("/api/devices/SRV-MANUAL-API");
    assert.deepEqual(
      { rack_id: device.body.rack_id, layer_id: device.body.layer_id, start_u: device.body.start_u },
      body.target_position,
    );
  });
});
```

- [ ] **Step 2: Run the API test and verify RED**

Run: `node --test --test-name-pattern="manual plan" tests/api-v02.test.js`

Expected: the action is placed elsewhere because `plan-service` does not forward the manual target.

- [ ] **Step 3: Forward the manual options without changing the route**

Update the placement planner call in `src/workflows/plan-service.js`:

```js
planning = planner.recommend(state, effectiveRequest.device ?? {}, {
  limit: effectiveRequest.limit ?? 4,
  strategyId,
  placementMode: effectiveRequest.placement_mode ?? "automatic",
  targetPosition: effectiveRequest.target_position ?? null,
});
```

When converting natural language input, retain the fixed strategy and set `placement_mode: "automatic"`.

- [ ] **Step 4: Add and run an HTTP occupied-target error test**

```js
test("V0.2 API reports an occupied manual target without creating a migration plan", async () => {
  await withV02Server(async ({ request }) => {
    const result = await request("/api/plans", {
      method: "POST",
      body: {
        ...placementRequest(),
        placement_mode: "manual",
        target_position: { rack_id: "CAB-03", layer_id: "L02", start_u: 13 },
        device: { ...placementRequest().device, id: "SRV-MANUAL-OCCUPIED" },
      },
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, "TARGET_POSITION_OCCUPIED");
  });
});
```

Run: `node --test --test-name-pattern="manual" tests/api-v02.test.js`

Expected: both API manual-placement tests pass.

Map `MANUAL_TARGET_REQUIRED`, `MANUAL_PLACEMENT_COUNT_INVALID`, `TARGET_RACK_NOT_DEPLOYABLE`, `TARGET_START_U_INVALID`, and `TARGET_POSITION_OUT_OF_RANGE` to HTTP 400 in `errorStatus`; map `TARGET_POSITION_OCCUPIED` to HTTP 409. Add an API case that submits manual mode without a target and another with `count: 2`, and assert that neither request persists a plan.

---

### Task 3: Current-module UI and source contract

**Files:**
- Modify: `tests/frontend-contract.test.js`
- Modify: `public/js/views/agent-console.js`

**Interfaces:**
- Consumes: `state.racks[*].capacity.layers` and existing `createPlan(request)`.
- Produces: form fields `placement_mode`, `target_rack_id`, `target_layer_id`, `target_start_u`; a fixed `balanced_optimal` strategy request.

- [ ] **Step 1: Replace the old strategy-source assertions with failing manual-form assertions**

```js
test("placement console exposes automatic and exact manual placement without alternate strategies", () => {
  const consoleView = read("public/js/views/agent-console.js");
  assert.doesNotMatch(consoleView, /consolidated|load_balanced|updatePlacementDefault/);
  for (const field of ["placement_mode", "target_rack_id", "target_layer_id", "target_start_u", "target_position"]) {
    assert.match(consoleView, new RegExp(field));
  }
  assert.match(consoleView, /strategy_id:\s*["']balanced_optimal["']/);
  assert.match(consoleView, /placement_mode:\s*manualMode\s*\?\s*["']manual["']\s*:\s*["']automatic["']/);
});
```

- [ ] **Step 2: Run the frontend contract and verify RED**

Run: `node --test --test-name-pattern="placement console" tests/frontend-contract.test.js`

Expected: the source still contains alternate strategies and lacks manual target fields.

- [ ] **Step 3: Remove current-module strategy controls**

In `public/js/views/agent-console.js`:

```js
import { createPlan } from "../state.js";

const STRATEGY_ID = "balanced_optimal";
```

Delete the local `strategies`, `strategySelect`, and `strategyControls` definitions. Remove both rendered strategy selectors and submit `strategy_id: STRATEGY_ID` from structured and natural-language forms. Do not delete strategy profiles or historical labels from other files.

- [ ] **Step 4: Add exact-position controls and linked state**

Build controls using existing `h()` calls and the current rack payload:

```js
const modeSelect = h("select", { name: "placement_mode" }, [
  h("option", { value: "automatic", text: "自动规划位置" }),
  h("option", { value: "manual", text: "手动指定位置" }),
]);
const targetRack = h("select", { name: "target_rack_id" }, [
  h("option", { value: "", text: "请选择机柜" }),
  ...state.racks.filter((rack) => rack.role === "server")
    .map((rack) => h("option", { value: rack.id, text: rack.id })),
]);
const targetLayer = h("select", { name: "target_layer_id" }, [
  h("option", { value: "", text: "请先选择机柜" }),
]);
const targetStartU = h("input", { name: "target_start_u", type: "number", min: 1, step: 1 });
```

On rack changes, populate layers from `rack.capacity?.layers`; on layer changes, set the input `min` to `layer.start_u`, `max` to `layer.usable_end_u`, and clear its value. On mode changes, show/hide and toggle `required` for target controls, set count to `1`, and make count read-only while manual mode is active.

- [ ] **Step 5: Submit the authoritative request shape and map errors**

```js
const manualMode = data.get("placement_mode") === "manual";
await createPlan({
  kind: "placement",
  placement_mode: manualMode ? "manual" : "automatic",
  strategy_id: STRATEGY_ID,
  target_position: manualMode ? {
    rack_id: data.get("target_rack_id"),
    layer_id: data.get("target_layer_id"),
    start_u: Number(data.get("target_start_u")),
  } : null,
  fail_at: data.get("fail_at") || null,
  device,
});
```

Add a local error-message map for the eight manual validation codes and include the original code in the toast. Existing unknown errors continue to use `error.message`.

- [ ] **Step 6: Run the frontend contract and verify GREEN**

Run: `node --test --test-name-pattern="placement console" tests/frontend-contract.test.js`

Expected: the updated current-module contract passes.

---

### Task 4: Regression verification

**Files:**
- Test only; do not modify unrelated files.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: evidence that manual placement works and existing automatic, migration, removal, and historical rendering tests remain green.

- [ ] **Step 1: Run focused suites**

Run: `node --test tests/planning.test.js tests/api-v02.test.js tests/frontend-contract.test.js`

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run syntax and whitespace checks**

Run: `node --check src/planning/planning-engine.js`

Run: `node --check src/planning/reconfiguration-problem.js`

Run: `node --check src/workflows/plan-service.js`

Run: `node --check public/js/views/agent-console.js`

Run: `git diff --check -- src/planning/planning-engine.js src/planning/reconfiguration-problem.js src/workflows/plan-service.js src/http-app.js public/js/views/agent-console.js tests/planning.test.js tests/api-v02.test.js tests/frontend-contract.test.js`

Expected: every command exits successfully with no diagnostics.

- [ ] **Step 3: Run all unit tests**

Run: `npm.cmd test`

Expected: zero failed tests; the existing environment-dependent skipped test may remain skipped.

- [ ] **Step 4: Inspect only the scoped diff**

Run: `git diff -- src/planning/planning-engine.js src/planning/reconfiguration-problem.js src/workflows/plan-service.js src/http-app.js public/js/views/agent-console.js tests/planning.test.js tests/api-v02.test.js tests/frontend-contract.test.js`

Expected: only manual exact-placement, current-module strategy removal, error handling, and corresponding tests are present; no unrelated logic is changed.

# Empty Startup State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every application process start and every demo reset restore an empty server inventory while preserving the full rack, power, network, authentication, and placement-strategy configuration.

**Architecture:** Keep `createDemoState()` as the explicit mixed-occupancy fixture used by legacy/core tests, and add `createEmptyDemoState()` as the canonical website seed. A small startup-state module resets the repository before `createServerApp()` is constructed and rejects a non-empty seed, so the HTTP server can never expose stale runtime inventory.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, JSON state repository, existing HTTP/E2E stack.

## Global Constraints

- Every `server.js` process start intentionally discards prior runtime devices, connections, plans, alarms, diagnoses, changes, audit records, and demo conditions.
- Preserve all 22 racks, rack layers and reserves, capacity limits, power-source/PDU design, switch topology, authentication configuration, and `balanced_optimal` default strategy.
- `createDemoState()` remains available for tests that explicitly require the historical mixed-occupancy fixture.
- The server must restore and validate the empty seed before constructing or listening with the HTTP app.
- Use TDD: observe each new test fail for the intended reason before changing production code.
- Current Git has a valid `HEAD`, but nearly the whole workspace is already staged and no remote is configured. Do not alter the index or commit until the staged state is normalized; the commit commands below are the required boundaries once Git is safe to use.

---

### Task 1: Add a canonical empty website state

**Files:**
- Modify: `src/demo-state.js`
- Modify: `tests/demo-state.test.js`

**Interfaces:**
- Consumes: existing `createDemoState(): DemoState`.
- Produces: `createEmptyDemoState(): DemoState`, with infrastructure copied from the mixed fixture and all operational collections empty.

- [ ] **Step 1: Write the failing empty-state factory test**

Append this test and import to `tests/demo-state.test.js`:

```js
import { createDemoState, createEmptyDemoState } from "../src/demo-state.js";

test("empty website state preserves infrastructure and clears operational data", () => {
  const state = createEmptyDemoState();

  assert.equal(state.version, 1);
  assert.equal(state.racks.length, 22);
  assert.equal(state.racks.filter((rack) => rack.role === "server").length, 20);
  assert.equal(state.racks.filter((rack) => rack.role === "network").length, 2);
  assert.equal(state.power_sources.length, 3);
  assert.equal(state.topology.network.access_switches.length, 10);
  assert.equal(state.settings.placement.default_strategy_id, "balanced_optimal");
  for (const field of [
    "devices",
    "power_connections",
    "network_connections",
    "plans",
    "alarms",
    "diagnoses",
    "changes",
    "audit",
    "demo_conditions",
  ]) {
    assert.deepEqual(state[field], [], `${field} must start empty`);
  }

  assert.ok(createDemoState().devices.some((device) => device.id === "SRV-DEMO-10U"));
});
```

Replace the existing single-symbol import instead of leaving two imports from the same module.

- [ ] **Step 2: Run the focused test and verify the missing export**

Run: `node --test tests/demo-state.test.js`

Expected: FAIL because `src/demo-state.js` does not export `createEmptyDemoState`.

- [ ] **Step 3: Implement the empty-state factory**

Append this code to `src/demo-state.js` after `createDemoState()`:

```js
const EMPTY_OPERATIONAL_COLLECTIONS = Object.freeze([
  "devices",
  "power_connections",
  "network_connections",
  "plans",
  "alarms",
  "diagnoses",
  "changes",
  "audit",
  "demo_conditions",
]);

export function createEmptyDemoState() {
  const state = createDemoState();
  for (const field of EMPTY_OPERATIONAL_COLLECTIONS) state[field] = [];
  state.version = 1;
  return state;
}
```

Do not change `createDemoState()` or `createDemoOccupancy()`; they remain explicit mixed-state fixtures.

- [ ] **Step 4: Run the focused test and verify both factories**

Run: `node --test tests/demo-state.test.js`

Expected: all demo-state tests PASS, including the existing mixed-occupancy assertions.

- [ ] **Step 5: Commit the factory boundary when Git is usable**

```powershell
git add src/demo-state.js tests/demo-state.test.js
git commit -m "feat: add empty website state factory"
```

### Task 2: Restore and validate the empty seed before HTTP startup

**Files:**
- Create: `src/startup-state.js`
- Create: `tests/startup-state.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: repository contract `{ read(): DemoState, reset(): DemoState }` from `state-repository.js`.
- Produces: `restoreEmptyStartupState(repository): DemoState`.
- `server.js` must call `restoreEmptyStartupState(repository)` immediately after `createJsonRepository()` and before `createServerApp()`.

- [ ] **Step 1: Write the failing startup reset tests**

Create `tests/startup-state.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState, createEmptyDemoState } from "../src/demo-state.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { restoreEmptyStartupState } from "../src/startup-state.js";

test("startup restoration discards runtime business data", () => {
  const repository = createMemoryRepository(createEmptyDemoState());
  repository.mutate(1, (draft) => {
    draft.devices.push(createDemoState().devices[0]);
    draft.power_connections.push({ device_id: "STALE" });
    draft.network_connections.push({ device_id: "STALE" });
    draft.plans.push({ id: "STALE-PLAN" });
    draft.alarms.push({ id: "STALE-ALARM" });
    draft.audit.push({ id: "STALE-AUDIT" });
  });

  const restored = restoreEmptyStartupState(repository);

  assert.equal(restored.version, 1);
  assert.equal(restored.racks.length, 22);
  assert.deepEqual(restored.devices, []);
  assert.deepEqual(restored.power_connections, []);
  assert.deepEqual(restored.network_connections, []);
  assert.deepEqual(restored.plans, []);
  assert.deepEqual(restored.alarms, []);
  assert.deepEqual(restored.audit, []);
  assert.deepEqual(repository.read(), restored);
});

test("startup restoration refuses a non-empty seed", () => {
  const repository = createMemoryRepository(createDemoState());

  assert.throws(
    () => restoreEmptyStartupState(repository),
    (error) => error.code === "STARTUP_SEED_NOT_EMPTY"
      && error.non_empty_fields.includes("devices"),
  );
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `node --test tests/startup-state.test.js`

Expected: FAIL because `src/startup-state.js` does not exist.

- [ ] **Step 3: Implement startup restoration**

Create `src/startup-state.js`:

```js
const EMPTY_AT_STARTUP = Object.freeze([
  "devices",
  "power_connections",
  "network_connections",
  "plans",
  "alarms",
  "diagnoses",
  "changes",
  "audit",
  "demo_conditions",
]);

export function restoreEmptyStartupState(repository) {
  const state = repository.reset();
  const nonEmptyFields = EMPTY_AT_STARTUP
    .filter((field) => !Array.isArray(state[field]) || state[field].length > 0);
  if (nonEmptyFields.length > 0) {
    throw Object.assign(new Error(`Startup seed is not empty: ${nonEmptyFields.join(", ")}`), {
      code: "STARTUP_SEED_NOT_EMPTY",
      non_empty_fields: nonEmptyFields,
    });
  }
  return state;
}
```

- [ ] **Step 4: Call restoration before app construction**

In `server.js`, add:

```js
import { restoreEmptyStartupState } from "./src/startup-state.js";
```

Then change the repository/startup block to:

```js
const repository = createJsonRepository({
  seedPath: join(root, "data", "seed", "state.json"),
  statePath: join(root, "data", "runtime", "state.json"),
});
restoreEmptyStartupState(repository);
const agentGateway = runtime.agent_configured ? createAgentGateway(getAgentConfig()) : null;
```

The call must remain above `createServerApp(...)` and `server.listen(...)`.

- [ ] **Step 5: Run the startup tests**

Run: `node --test tests/startup-state.test.js tests/repository.test.js`

Expected: all tests PASS; repository persistence behavior remains unchanged unless startup restoration is explicitly called.

- [ ] **Step 6: Commit the startup boundary when Git is usable**

```powershell
git add src/startup-state.js tests/startup-state.test.js server.js
git commit -m "feat: reset inventory before server startup"
```

### Task 3: Generate and verify the canonical empty seed

**Files:**
- Modify: `scripts/reset-demo-data.js`
- Modify: `data/seed/state.json`
- Modify if tracked: `data/runtime/state.json`
- Modify: `tests/deployment.test.js`

**Interfaces:**
- Consumes: `createEmptyDemoState()` from `src/demo-state.js`.
- Produces: identical empty JSON documents for seed and current runtime when `node scripts/reset-demo-data.js` is run.

- [ ] **Step 1: Add a failing reset-script contract test**

Append to `tests/deployment.test.js`:

```js
test("demo reset generator writes the empty website state", () => {
  const source = readFileSync(resolve("scripts/reset-demo-data.js"), "utf8");
  assert.match(source, /import \{ createEmptyDemoState \}/);
  assert.match(source, /JSON\.stringify\(createEmptyDemoState\(\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(createDemoState\(\)/);
});
```

Reuse the file's existing `readFileSync` and `resolve` imports; add only missing symbols.

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test tests/deployment.test.js`

Expected: FAIL because the reset generator still imports and serializes `createDemoState()`.

- [ ] **Step 3: Switch the reset generator to the empty factory**

Change `scripts/reset-demo-data.js` to import and serialize the empty factory:

```js
import { createEmptyDemoState } from "../src/demo-state.js";

const json = `${JSON.stringify(createEmptyDemoState(), null, 2)}\n`;
```

Change the final log line to:

```js
console.log("Demo state reset to the empty canonical L5-A2-08 seed.");
```

- [ ] **Step 4: Regenerate seed and runtime JSON mechanically**

Run: `node scripts/reset-demo-data.js`

Expected output: `Demo state reset to the empty canonical L5-A2-08 seed.`

This generator is the authoritative mechanical writer for the two JSON files; do not hand-edit the large JSON documents.

- [ ] **Step 5: Verify the generated data exactly**

Run:

```powershell
node --input-type=module -e "import {readFileSync} from 'node:fs'; for (const p of ['data/seed/state.json','data/runtime/state.json']) { const s=JSON.parse(readFileSync(p,'utf8')); if(s.racks.length!==22||s.devices.length||s.power_connections.length||s.network_connections.length||s.plans.length||s.alarms.length||s.audit.length) process.exit(1); console.log(p,'empty-ok'); }"
```

Expected: both paths print `empty-ok`.

- [ ] **Step 6: Run focused and full non-browser verification**

Run: `node --test tests/demo-state.test.js tests/startup-state.test.js tests/repository.test.js tests/deployment.test.js tests/api-v02.test.js`

Expected: all tests PASS, with any pre-existing environment-only solver skip unchanged.

Run: `npm test`

Expected: zero failures. Existing tests that explicitly call `createDemoState()` continue using mixed occupancy.

- [ ] **Step 7: Commit the canonical seed when Git is usable**

```powershell
git add scripts/reset-demo-data.js data/seed/state.json tests/deployment.test.js
git add data/runtime/state.json
git commit -m "feat: make website seed empty on every start"
```

If `data/runtime/state.json` is ignored, omit only that path; never force-add runtime data.

### Task 4: Verify the startup sub-project as a standalone deliverable

**Files:**
- Verify only; no new production files.

**Interfaces:**
- Consumes: `createEmptyDemoState()` and `restoreEmptyStartupState(repository)`.
- Produces: evidence that restart semantics are implemented before the batch/UI plan begins.

- [ ] **Step 1: Run the focused startup suite**

Run:

```powershell
node --test tests/demo-state.test.js tests/startup-state.test.js tests/repository.test.js tests/deployment.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run the project unit suite**

Run: `npm test`

Expected: zero failures; record the exact pass/skip counts in the handoff.

- [ ] **Step 3: Inspect the final diff and seed collections**

Run:

```powershell
git diff -- src/demo-state.js src/startup-state.js server.js scripts/reset-demo-data.js tests/demo-state.test.js tests/startup-state.test.js tests/deployment.test.js data/seed/state.json
```

Expected: only the empty-state factory, pre-listen restoration, generator switch, tests, and mechanically regenerated seed are present.

- [ ] **Step 4: Mark the sub-project ready for the batch/UI plan**

Record that the next plan may rely on:

```text
createEmptyDemoState(): returns 22-rack infrastructure with empty operational collections
restoreEmptyStartupState(repository): resets runtime from seed before HTTP app construction
POST /api/demo/reset: resets to the same empty seed
```

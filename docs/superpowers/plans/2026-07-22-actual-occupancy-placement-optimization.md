# Actual-Occupancy Placement Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an occupancy-aware placement workflow with fixed U positions, three selectable strategies, bounded real-Agent intervention, migration impact controls, and one final confirmation.

**Architecture:** A versioned normalized room snapshot feeds a fixed-interval rack layout engine and deterministic hard-constraint validator. A bounded candidate generator produces direct, divider, and migration alternatives; a profile-driven scorer ranks valid candidates before a real Agent may adjust soft weights or propose revalidated alternatives. The existing plan service remains the only route to confirmation and simulated execution.

**Tech Stack:** Node.js ES modules, built-in `node:test`, JSON state repository, browser-native JavaScript/CSS, Playwright 1.61.1, existing OpenAI-compatible Agent gateway.

## Global Constraints

- Preserve all existing uncommitted floating-assistant, DNS-aware transport, acceptance-launcher, and 30-second polling changes; never reset or overwrite them.
- Keep 22 racks: 20 server racks and 2 network racks.
- Preserve the three stable demo anchors `SRV-DEMO-10U`, `SRV-DEMO-4U`, and `SRV-DEMO-2U`, including their documented CAB-09/CAB-11/CAB-14 power and network evidence, while adding the wider occupancy set.
- The canonical seed must use 404 of 680 usable U, approximately 59.4%, with exactly 2 growth racks at or below 4U used.
- Each physical layer reserves its top 2U exactly once; no existing or planned device may occupy the reserved interval.
- `start_u` is a fixed fact and `end_u` is always derived as `start_u + u_size - 1`.
- Rated power is the deterministic capacity input until complete real-power telemetry exists; unknown real power must remain `null`/`unknown`.
- Hard constraints are identical for all strategies and cannot be relaxed by the Agent.
- The three strategy IDs are `balanced_optimal`, `consolidated`, and `load_balanced`.
- Agent soft-weight multipliers are limited to `0.5–2.0`; no more than 3 Agent alternatives are accepted.
- Only `place_device`, `move_device`, and `set_dividers` are valid Agent planning actions.
- Existing devices are movable only when `movable=true`, `criticality !== "critical"`, and `maintenance_window` is non-empty.
- A plan has exactly one final confirmation. A stale `snapshot_version` must block confirmation.
- Do not add a solver, database, frontend framework, or new runtime dependency.
- Never expose or log the Agent API key, authorization header, or private Base URL.

---

## File Structure

### New server files

- `src/demo-occupancy.js`: deterministic mixed-occupancy device and connection generator.
- `src/planning/strategy-profiles.js`: immutable strategy IDs, default weights, multiplier validation, and labels.
- `src/planning/strategy-scorer.js`: normalized score metrics and strategy eligibility.
- `src/planning/candidate-generator.js`: bounded fixed-interval direct and divider candidate generation.
- `src/planning/migration-planner.js`: eligible one-device migration alternatives and impact/rollback records.
- `src/settings/placement-settings-service.js`: versioned default-strategy reads and administrative updates.

### Modified server files

- `src/demo-state.js`: install canonical occupancy and default placement settings.
- `data/seed/state.json`: regenerated canonical seed.
- `src/domain/rack-layout.js`: validate fixed intervals and expose free intervals.
- `src/domain/capacity.js`: report fragmentation and exact layer occupancy.
- `src/domain/constraint-engine.js`: apply exact positions, migration eligibility, and replica fault-domain constraints.
- `src/planning/planning-engine.js`: orchestrate generation, strategy scoring, and migration fallback.
- `src/agent/agent-schema.js`: validate weight adjustments and up to three alternatives.
- `src/agent/agent-gateway.js`: send the bounded placement-decision contract to the configured real model.
- `src/workflows/plan-service.js`: select strategy, process Agent intervention, persist evidence, and preserve the final-confirmation boundary.
- `src/http-app.js`: register settings service, administrative route protection, and stable error mapping.
- `src/http/routes/plan-routes.js`: expose placement-strategy settings.
- `src/http/routes/inventory-routes.js`: return fixed placements and free intervals.

### New browser file

- `public/js/views/placement-plan.js`: candidate comparison, score evidence, Agent intervention, migration impact, and final-confirmation rendering.

### Modified browser files

- `public/js/views/agent-console.js`: strategy selection, default-strategy update, and request form.
- `public/js/views/rack-detail.js`: exact U-position rendering with holes and reserved intervals.
- `public/js/state.js`: load/update placement settings and submit the selected strategy.
- `public/css/views.css`: exact rack-slot, strategy, comparison, and migration styles.

### Tests and documentation

- Modify: `tests/seed.test.js`
- Modify: `tests/rack-layout.test.js`
- Modify: `tests/constraints.test.js`
- Create: `tests/strategy-scorer.test.js`
- Modify: `tests/planning.test.js`
- Create: `tests/migration-planner.test.js`
- Create: `tests/agent-schema.test.js`
- Modify: `tests/agent-gateway.test.js`
- Modify: `tests/plan-service.test.js`
- Modify: `tests/api-v02.test.js`
- Modify: `tests/frontend-contract.test.js`
- Modify: `tests/e2e/closed-loops.spec.js`
- Modify: `scripts/mock-agent-server.js`
- Modify: `README.md`

---

### Task 1: Deterministic Mixed-Occupancy Seed

**Files:**
- Create: `src/demo-occupancy.js`
- Modify: `src/demo-state.js`
- Modify: `tests/seed.test.js`
- Generate: `data/seed/state.json`

**Interfaces:**
- Consumes: `racks: Rack[]` from `createDemoState()`.
- Produces: `createDemoOccupancy(racks): { devices, power_connections, network_connections }`.
- Produces device fields: `start_u`, `business_id`, `replica_group`, `movable`, `criticality`, `maintenance_window`.

- [ ] **Step 1: Write the failing seed invariants**

Append to `tests/seed.test.js`:

```js
test("seed represents a reproducible mixed-occupancy room", () => {
  const state = createDemoState();
  const serverRacks = state.racks.filter((rack) => rack.role === "server");
  const usedByRack = serverRacks.map((rack) => state.devices
    .filter((device) => device.rack_id === rack.id && device.status !== "cancelled")
    .reduce((sum, device) => sum + device.u_size, 0));

  assert.equal(usedByRack.reduce((sum, used) => sum + used, 0), 404);
  assert.equal(usedByRack.filter((used) => used <= 4).length, 2);
  assert.ok(usedByRack.some((used) => used >= 30));
  assert.ok(state.devices.every((device) => Number.isInteger(device.start_u)));
  assert.ok(state.devices.every((device) => ["normal", "important", "critical"].includes(device.criticality)));
  assert.ok(state.devices.some((device) => device.replica_group));
  assert.ok(state.devices.some((device) => device.movable && device.maintenance_window));
  assert.equal(createDemoState().devices.length, state.devices.length);
});

test("seed includes two racks immediately below the rated-power warning line", () => {
  const state = createDemoState();
  const ratios = state.racks.filter((rack) => rack.role === "server").map((rack) => {
    const used = state.devices.filter((device) => device.rack_id === rack.id)
      .reduce((sum, device) => sum + device.rated_power_w, 0);
    return used / rack.design_power_w;
  });
  assert.equal(ratios.filter((ratio) => ratio >= 0.78 && ratio < 0.8).length, 2);
});
```

- [ ] **Step 2: Run the seed tests and verify failure**

Run: `node --test tests/seed.test.js`

Expected: FAIL because the current seed has only 3 devices and no `start_u` or workload metadata.

- [ ] **Step 3: Implement the canonical occupancy generator**

Create `src/demo-occupancy.js` around these exact profile totals:

```js
const USED_U_BY_RACK = [2, 4, 16, 18, 20, 22, 24, 26, 28, 26, 22, 20, 18, 16, 22, 24, 26, 30, 20, 20];
const POWER_TOTALS = new Map([
  ["CAB-08", 7_900],
  ["CAB-10", 15_800],
]);
const DEVICE_SIZES = [4, 2, 6, 8, 10, 2, 4, 6];
const BUSINESSES = ["ai-platform", "compute-platform", "storage-platform", "database-platform"];
const ANCHORS = {
  "CAB-09": { id: "SRV-DEMO-10U", u_size: 10, hostname: "gpu-demo-01", model: "10U GPU Demo", business_id: "ai-platform" },
  "CAB-11": { id: "SRV-DEMO-4U", u_size: 4, hostname: "compute-demo-01", model: "4U Compute Demo", business_id: "compute-platform" },
  "CAB-14": { id: "SRV-DEMO-2U", u_size: 2, hostname: "storage-demo-01", model: "2U Storage Demo", business_id: "storage-platform" },
};

function usableIntervals(rack) {
  const ends = rack.dividers_u;
  return [[1, ends[0] - 2], [ends[0] + 1, ends[1] - 2], [ends[1] + 1, ends[2] - 2], [ends[2] + 1, rack.height_u - 2]];
}

function profileDevices(rack, rackIndex, targetU) {
  const devices = [];
  let remaining = targetU;
  let sizeIndex = rackIndex % DEVICE_SIZES.length;
  for (const [layerIndex, [start, end]] of usableIntervals(rack).entries()) {
    let cursor = start;
    while (remaining > 0 && cursor <= end) {
      const capacity = end - cursor + 1;
      const anchor = devices.length === 0 ? ANCHORS[rack.id] : null;
      const preferred = anchor?.u_size ?? DEVICE_SIZES[sizeIndex % DEVICE_SIZES.length];
      const size = Math.min(preferred, capacity, remaining, 10);
      if (size <= 0) break;
      const ordinal = devices.length + 1;
      const criticality = ordinal % 7 === 0 ? "critical" : ordinal % 3 === 0 ? "important" : "normal";
      const movable = criticality === "normal" && ordinal % 2 === 0;
      const businessId = anchor?.business_id ?? BUSINESSES[(rackIndex + ordinal) % BUSINESSES.length];
      devices.push({
        id: anchor?.id ?? `SRV-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        asset_id: `ASSET-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        hostname: anchor?.hostname ?? `node-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        model: anchor?.model ?? `${size}U Demo Server`,
        serial: `SIM-${rack.id.slice(4)}-${String(ordinal).padStart(2, "0")}`,
        rack_id: rack.id,
        layer_id: `L0${layerIndex + 1}`,
        start_u: cursor,
        u_size: size,
        rated_power_w: 0,
        real_power_w: null,
        weight_kg: size * 8,
        network_ports: size >= 8 ? 4 : 2,
        business_id: businessId,
        business: businessId,
        owner: `${businessId}-ops`,
        ip: `10.0.${rackIndex + 1}.${10 + ordinal}`,
        vlan: `VLAN-${100 + rackIndex + 1}`,
        replica_group: null,
        movable,
        criticality,
        maintenance_window: movable ? "Saturday 02:00-04:00" : null,
        status: "running",
        data_source: "demo",
      });
      cursor += size;
      remaining -= size;
      sizeIndex += 1;
    }
  }
  if (remaining !== 0) throw new Error(`Occupancy profile does not fit ${rack.id}`);
  return devices;
}

function assignPower(devices, targetW) {
  const totalU = devices.reduce((sum, device) => sum + device.u_size, 0);
  let assigned = 0;
  return devices.map((device, index) => {
    const power = index === devices.length - 1
      ? targetW - assigned
      : Math.max(100, Math.floor((targetW * device.u_size) / totalU / 10) * 10);
    assigned += power;
    return { ...device, rated_power_w: power };
  });
}

export function createDemoOccupancy(racks) {
  const serverRacks = racks.filter((rack) => rack.role === "server");
  const devices = serverRacks.flatMap((rack, index) => {
    const targetPower = POWER_TOTALS.get(rack.id) ?? Math.min(
      Math.floor(rack.design_power_w * (0.22 + USED_U_BY_RACK[index] / 100)),
      Math.floor(rack.design_power_w * 0.72),
    );
    const rackDevices = profileDevices(rack, index, USED_U_BY_RACK[index]);
    if (rack.id === "CAB-18") {
      const fragmented = rackDevices.find((device) => device.layer_id === "L04" && device.u_size === 4);
      fragmented.start_u = 35;
    }
    return assignPower(rackDevices, targetPower);
  });
  const replicas = [
    devices.find((device) => device.rack_id === "CAB-03"),
    devices.find((device) => device.rack_id === "CAB-14"),
  ];
  replicas.forEach((device) => {
    device.replica_group = "RG-DEMO-01";
    device.business_id = "database-platform";
    device.business = "database-platform";
  });
  const powerConnections = devices.filter((_, index) => index % 4 !== 0).map((device, index) => ({
      device_id: device.id,
      source_id: racks.find((rack) => rack.id === device.rack_id).source_id,
      rack_id: device.rack_id,
      pdu_id: `${device.rack_id}-PDU`,
      outlet: `P${String((index % 24) + 1).padStart(2, "0")}`,
      data_source: "demo",
    }));
  const networkConnections = devices.filter((_, index) => index % 5 !== 0).map((device, index) => ({
      device_id: device.id,
      device_port: "eth0",
      switch_id: racks.find((rack) => rack.id === device.rack_id).network_switch_id,
      switch_port: `GE0/0/${String((index % 48) + 1).padStart(2, "0")}`,
      vlan: `VLAN-${100 + (index % 20)}`,
      data_source: "demo",
    }));
  powerConnections.push(
    { device_id: "SRV-DEMO-10U", source_id: "JG1", rack_id: "CAB-09", pdu_id: "CAB-09-PDU", outlet: "P01", data_source: "demo" },
    { device_id: "SRV-DEMO-4U", source_id: "JG2", rack_id: "CAB-11", pdu_id: "CAB-11-PDU", outlet: "P03", data_source: "demo" },
  );
  networkConnections.push(
    { device_id: "SRV-DEMO-10U", device_port: "eth0", switch_id: "ASW-05", switch_port: "GE0/0/01", vlan: "VLAN-109", data_source: "demo" },
    { device_id: "SRV-DEMO-4U", device_port: "eth0", switch_id: "ASW-06", switch_port: "GE0/0/01", vlan: "VLAN-111", data_source: "demo" },
  );
  return {
    devices,
    power_connections: [...new Map(powerConnections.map((item) => [item.device_id, item])).values()],
    network_connections: [...new Map(networkConnections.map((item) => [item.device_id, item])).values()],
  };
}
```

In `createDemoState()`, build racks first, call `createDemoOccupancy(racks)`, use its three arrays, and add:

```js
settings: { placement: { default_strategy_id: "balanced_optimal" } },
```

- [ ] **Step 4: Regenerate seed JSON and run seed tests**

Run: `npm.cmd run reset:demo`

Run: `node --test tests/seed.test.js`

Expected: all seed tests PASS; `data/seed/state.json` contains the deterministic occupancy and no secrets.

- [ ] **Step 5: Commit the seed**

```powershell
git add src/demo-occupancy.js src/demo-state.js tests/seed.test.js data/seed/state.json
git commit -m "feat: seed realistic rack occupancy"
```

---

### Task 2: Fixed-U Layout and Free Intervals

**Files:**
- Modify: `src/domain/rack-layout.js`
- Modify: `src/domain/capacity.js`
- Modify: `tests/rack-layout.test.js`

**Interfaces:**
- Produces: `packDevices(rack, devices): Placement[]`, preserving `device.start_u`.
- Produces: `freeIntervals(rack, devices): FreeInterval[]` with `{ rack_id, layer_id, start_u, end_u, size_u }`.
- Produces layer fields: `reserve_start_u`, `reserve_end_u`, `free_intervals`, `largest_contiguous_u`.

- [ ] **Step 1: Replace compaction expectations with fixed-position tests**

Add to `tests/rack-layout.test.js`:

```js
test("fixed placements preserve holes instead of compacting devices", () => {
  const rack = createDemoState().racks[0];
  const devices = [
    { id: "LOW", rack_id: rack.id, layer_id: "L02", start_u: 13, u_size: 2 },
    { id: "HIGH", rack_id: rack.id, layer_id: "L02", start_u: 18, u_size: 2 },
  ];
  const packed = packDevices(rack, devices);
  assert.deepEqual(packed.map((item) => [item.device_id, item.start_u, item.end_u]), [
    ["LOW", 13, 14],
    ["HIGH", 18, 19],
  ]);
  assert.deepEqual(freeIntervals(rack, devices).filter((item) => item.layer_id === "L02"), [
    { rack_id: rack.id, layer_id: "L02", start_u: 15, end_u: 17, size_u: 3 },
    { rack_id: rack.id, layer_id: "L02", start_u: 20, end_u: 20, size_u: 1 },
  ]);
});

test("rejects overlap and the single reserved interval at the top of a layer", () => {
  const rack = createDemoState().racks[0];
  assert.throws(() => packDevices(rack, [
    { id: "A", layer_id: "L02", start_u: 13, u_size: 4 },
    { id: "B", layer_id: "L02", start_u: 15, u_size: 2 },
  ]), (error) => error.code === "DEVICE_U_OVERLAP");
  assert.throws(() => packDevices(rack, [
    { id: "RESERVED", layer_id: "L02", start_u: 20, u_size: 2 },
  ]), (error) => error.code === "LAYER_RESERVE_OCCUPIED");
});

test("canonical near-full rack exposes fragmented rather than aggregate-only space", () => {
  const state = createDemoState();
  const rack = state.racks.find((item) => item.id === "CAB-18");
  const intervals = freeIntervals(rack, state.devices.filter((device) => device.rack_id === rack.id));
  assert.equal(intervals.reduce((sum, item) => sum + item.size_u, 0), 4);
  assert.equal(Math.max(...intervals.map((item) => item.size_u)), 2);
});
```

Update imports to include `freeIntervals`.

- [ ] **Step 2: Run layout tests and verify failure**

Run: `node --test tests/rack-layout.test.js`

Expected: FAIL because `freeIntervals` is missing and `packDevices` still compacts devices.

- [ ] **Step 3: Implement exact interval analysis**

In `deriveLayers`, add:

```js
reserve_start_u: endU - reserveU + 1,
reserve_end_u: endU,
usable_end_u: endU - reserveU,
```

Replace `packDevices` with fixed-range validation and export `freeIntervals`:

```js
export function packDevices(rack, devices) {
  const layers = deriveLayers(rack);
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const placements = devices.filter((device) => device.status !== "cancelled").map((device) => {
    const layer = layerById.get(device.layer_id);
    if (!layer) throw layoutError("LAYER_NOT_FOUND", `${device.layer_id} does not exist in ${rack.id}`, { device_id: device.id, layer_id: device.layer_id });
    const startU = Number(device.start_u);
    const sizeU = Number(device.u_size);
    if (!Number.isInteger(startU) || !Number.isInteger(sizeU) || sizeU <= 0) {
      throw layoutError("DEVICE_U_INVALID", `${device.id} has an invalid U range`, { device_id: device.id });
    }
    const endU = startU + sizeU - 1;
    if (startU < layer.start_u || endU > layer.end_u) {
      throw layoutError("DEVICE_LAYER_RANGE_INVALID", `${device.id} crosses ${layer.id}`, { device_id: device.id, layer_id: layer.id });
    }
    if (endU >= layer.reserve_start_u) {
      throw layoutError("LAYER_RESERVE_OCCUPIED", `${device.id} occupies the reserved U interval`, { device_id: device.id, layer_id: layer.id });
    }
    return { device_id: device.id, rack_id: rack.id, layer_id: layer.id, start_u: startU, end_u: endU };
  }).sort((left, right) => left.start_u - right.start_u || left.device_id.localeCompare(right.device_id));

  for (let index = 1; index < placements.length; index += 1) {
    const previous = placements[index - 1];
    const current = placements[index];
    if (previous.end_u >= current.start_u) {
      throw layoutError("DEVICE_U_OVERLAP", `${previous.device_id} overlaps ${current.device_id}`, { device_id: current.device_id, layer_id: current.layer_id });
    }
  }
  return placements;
}

export function freeIntervals(rack, devices) {
  const placements = packDevices(rack, devices);
  return deriveLayers(rack).flatMap((layer) => {
    const occupied = placements.filter((item) => item.layer_id === layer.id);
    const intervals = [];
    let cursor = layer.start_u;
    for (const placement of occupied) {
      if (cursor < placement.start_u) intervals.push({ rack_id: rack.id, layer_id: layer.id, start_u: cursor, end_u: placement.start_u - 1, size_u: placement.start_u - cursor });
      cursor = placement.end_u + 1;
    }
    if (cursor <= layer.usable_end_u) intervals.push({ rack_id: rack.id, layer_id: layer.id, start_u: cursor, end_u: layer.usable_end_u, size_u: layer.usable_end_u - cursor + 1 });
    return intervals;
  });
}
```

Update `capacitySnapshot` so every layer includes its `free_intervals` and `largest_contiguous_u`, and the rack snapshot includes the maximum of those values.

- [ ] **Step 4: Run layout and capacity tests**

Run: `node --test tests/rack-layout.test.js tests/constraints.test.js`

Expected: layout tests PASS; any old fixtures without `start_u` fail and identify the exact fixtures that Task 3 must update.

- [ ] **Step 5: Commit fixed-U layout**

```powershell
git add src/domain/rack-layout.js src/domain/capacity.js tests/rack-layout.test.js
git commit -m "feat: model fixed rack U positions"
```

---

### Task 3: Exact-Position and Fault-Domain Hard Constraints

**Files:**
- Modify: `src/domain/constraint-engine.js`
- Modify: `tests/constraints.test.js`
- Modify: existing test fixtures that create devices or actions without `start_u`.

**Interfaces:**
- `place_device` requires `rack_id`, `layer_id`, `start_u`, and `device`.
- `move_device` requires `device_id`, `rack_id`, `layer_id`, and `start_u`.
- `evaluateActions(state, actions)` adds stable blocker codes for migration and replica failures.

- [ ] **Step 1: Add failing hard-constraint tests**

Add to `tests/constraints.test.js`:

```js
test("placement action preserves its exact start U", () => {
  const result = evaluateActions(createDemoState(), [placement(
    { id: "FIXED-U", u_size: 2 },
    { rack_id: "CAB-01", layer_id: "L02", start_u: 17 },
  )]);
  assert.equal(result.allowed, true);
  assert.equal(result.projected_devices.find((device) => device.id === "FIXED-U").start_u, 17);
});

test("migration requires eligibility and a maintenance window", () => {
  const state = createDemoState();
  const locked = state.devices.find((device) => !device.movable);
  const result = evaluateActions(state, [{
    type: "move_device", device_id: locked.id, rack_id: "CAB-02", layer_id: "L02", start_u: 13,
  }]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === "DEVICE_MOVE_NOT_ALLOWED"));
});

test("replicas cannot share a power source or access switch", () => {
  const state = createDemoState();
  const replica = state.devices.find((device) => device.replica_group === "RG-DEMO-01");
  const peer = state.devices.find((device) => device.replica_group === "RG-DEMO-01" && device.id !== replica.id);
  peer.movable = true;
  peer.criticality = "normal";
  peer.maintenance_window = "Saturday 02:00-04:00";
  const result = evaluateActions(state, [{
    type: "move_device", device_id: peer.id, rack_id: replica.rack_id, layer_id: "L04", start_u: 33,
  }]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === "REPLICA_FAULT_DOMAIN_CONFLICT"));
});
```

Make the shared `placement()` helper copy `action.start_u` into the placed device.

- [ ] **Step 2: Verify the new tests fail**

Run: `node --test tests/constraints.test.js`

Expected: FAIL because actions do not preserve `start_u`, migration eligibility is unchecked, and replica domains are unchecked.

- [ ] **Step 3: Implement action and domain validation**

In `applyActions`, set exact positions:

```js
start_u: Number(action.start_u ?? action.device?.start_u),
```

for placements and:

```js
device.rack_id = action.rack_id;
device.layer_id = action.layer_id;
device.start_u = Number(action.start_u);
```

for moves.

Before applying a move, add blockers when the original device is not movable, is critical, or lacks a maintenance window. After projection, group active devices by `replica_group`; for every pair, block when either `source_id` or `network_switch_id` matches:

```js
function validateReplicaDomains(state, blockers) {
  const groups = new Map();
  for (const device of state.devices.filter((item) => item.status !== "cancelled" && item.replica_group)) {
    groups.set(device.replica_group, [...(groups.get(device.replica_group) ?? []), device]);
  }
  for (const [group, devices] of groups) {
    for (let left = 0; left < devices.length; left += 1) {
      for (let right = left + 1; right < devices.length; right += 1) {
        const leftRack = findRack(state, devices[left].rack_id);
        const rightRack = findRack(state, devices[right].rack_id);
        if (leftRack.source_id === rightRack.source_id || leftRack.network_switch_id === rightRack.network_switch_id) {
          blockers.push(issue("REPLICA_FAULT_DOMAIN_CONFLICT", group, `${group} shares a fault domain`, "blocker", {
            device_ids: [devices[left].id, devices[right].id],
            source_ids: [leftRack.source_id, rightRack.source_id],
            switch_ids: [leftRack.network_switch_id, rightRack.network_switch_id],
          }));
        }
      }
    }
  }
}
```

Return `projected_devices` from `evaluateActions` for deterministic tests and candidate evidence, while retaining existing `before` and `after` snapshots.

- [ ] **Step 4: Update all fixtures and run domain tests**

Run: `rg -n "type: [\"'](place_device|move_device)" tests src`

Add explicit valid `start_u` values to every test action and fixture found by the command.

Run: `node --test tests/rack-layout.test.js tests/constraints.test.js tests/recommendation.test.js tests/planning.test.js tests/plan-service.test.js`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit hard constraints**

```powershell
git add src/domain/constraint-engine.js tests
git commit -m "feat: enforce physical placement constraints"
```

---

### Task 4: Three Profile-Driven Scoring Strategies

**Files:**
- Create: `src/planning/strategy-profiles.js`
- Create: `src/planning/strategy-scorer.js`
- Create: `tests/strategy-scorer.test.js`

**Interfaces:**
- Produces: `STRATEGY_IDS`, `DEFAULT_STRATEGY_ID`, `strategyProfile(id)`, `validateWeightMultipliers(value)`.
- Produces: `scoreCandidate(state, request, candidate, options): { eligible, score, breakdown, weights }`.

- [ ] **Step 1: Write failing strategy tests**

Create `tests/strategy-scorer.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { scoreCandidate } from "../src/planning/strategy-scorer.js";
import { validateWeightMultipliers } from "../src/planning/strategy-profiles.js";

function candidate(rackId, overrides = {}) {
  return {
    id: `C-${rackId}`,
    rack_id: rackId,
    actions: [],
    validation: { warnings: [], after: {}, allowed: true },
    evidence: {
      projected_ratios: { power: 0.5, u: 0.5, weight: 0.3, ports: 0.4 },
      largest_contiguous_u_after: 6,
      activated_empty_rack: false,
      business_distance: 0,
      link_distance: 0,
      source_imbalance: 0.2,
      migration_count: 0,
      ...overrides,
    },
  };
}

test("strategies produce different preferences from the same valid candidates", () => {
  const state = createDemoState();
  const dense = candidate("CAB-03", { projected_ratios: { power: 0.72, u: 0.76, weight: 0.5, ports: 0.6 } });
  const empty = candidate("CAB-01", { activated_empty_rack: true, projected_ratios: { power: 0.2, u: 0.2, weight: 0.2, ports: 0.2 } });
  assert.ok(scoreCandidate(state, {}, dense, { strategyId: "consolidated" }).score < scoreCandidate(state, {}, empty, { strategyId: "consolidated" }).score);
  assert.ok(scoreCandidate(state, {}, empty, { strategyId: "load_balanced" }).score < scoreCandidate(state, {}, dense, { strategyId: "load_balanced" }).score);
});

test("consolidated strategy rejects a projection at the warning line", () => {
  const result = scoreCandidate(createDemoState(), {}, candidate("CAB-03", {
    projected_ratios: { power: 0.8, u: 0.6, weight: 0.4, ports: 0.4 },
  }), { strategyId: "consolidated" });
  assert.equal(result.eligible, false);
  assert.equal(result.reason_code, "CONSOLIDATED_WARNING_LINE");
});

test("Agent weight multipliers stay between one half and two", () => {
  assert.deepEqual(validateWeightMultipliers({ fragmentation: 1.5 }), { fragmentation: 1.5 });
  assert.throws(() => validateWeightMultipliers({ fragmentation: 2.1 }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validateWeightMultipliers({ hard_power_limit: 0.5 }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});
```

- [ ] **Step 2: Verify strategy tests fail**

Run: `node --test tests/strategy-scorer.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Define immutable profiles and multiplier validation**

Create `src/planning/strategy-profiles.js` with these exact defaults:

```js
export const STRATEGY_IDS = ["balanced_optimal", "consolidated", "load_balanced"];
export const DEFAULT_STRATEGY_ID = "balanced_optimal";
export const ADJUSTABLE_METRICS = ["preferred", "business", "fragmentation", "link", "capacity", "growth", "activation", "source_imbalance", "migration"];

const PROFILES = Object.freeze({
  balanced_optimal: Object.freeze({ preferred: 25, business: 20, fragmentation: 15, link: 10, capacity: 15, growth: 5, activation: 0, source_imbalance: 0, migration: 10 }),
  consolidated: Object.freeze({ preferred: 15, business: 5, fragmentation: 15, link: 0, capacity: 10, growth: 0, activation: 30, source_imbalance: 0, migration: 10 }),
  load_balanced: Object.freeze({ preferred: 10, business: 5, fragmentation: 10, link: 5, capacity: 35, growth: 0, activation: 0, source_imbalance: 25, migration: 10 }),
});

export function strategyProfile(id) {
  if (!STRATEGY_IDS.includes(id)) throw Object.assign(new Error(`Unknown placement strategy: ${id}`), { code: "PLACEMENT_STRATEGY_INVALID" });
  return { id, weights: { ...PROFILES[id] } };
}

export function validateWeightMultipliers(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Weight multipliers must be an object"), { code: "AGENT_RESPONSE_INVALID" });
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    const multiplier = Number(raw);
    if (!ADJUSTABLE_METRICS.includes(key) || !Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2) {
      throw Object.assign(new Error(`Invalid weight multiplier: ${key}`), { code: "AGENT_RESPONSE_INVALID" });
    }
    return [key, multiplier];
  }));
}
```

- [ ] **Step 4: Implement normalized scoring**

Create `scoreCandidate` so each breakdown item contains `{ raw, normalized, weight, contribution }`; clamp normalized penalties to 0–100, apply weight multipliers only after validation, and return the weighted mean. `capacity` is the maximum projected power/U/weight/port ratio; `activation` is 100 only for a newly activated rack; `migration` is 100 when any move exists. For `consolidated`, return `eligible:false` when any projected capacity ratio is at least `0.8`.

- [ ] **Step 5: Run and commit strategy tests**

Run: `node --test tests/strategy-scorer.test.js`

Expected: all strategy tests PASS.

```powershell
git add src/planning/strategy-profiles.js src/planning/strategy-scorer.js tests/strategy-scorer.test.js
git commit -m "feat: add selectable placement strategies"
```

---

### Task 5: Bounded Direct and Divider Candidate Generation

**Files:**
- Create: `src/planning/candidate-generator.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `tests/planning.test.js`
- Modify: `src/placement-recommender.js`

**Interfaces:**
- Produces: `generatePlacementCandidates(state, request, { maxBeams = 64 }): Candidate[]`.
- `createPlanningEngine().recommend(state, request, { limit, strategyId, weightMultipliers })` returns scored candidates with explicit `start_u` actions.

- [ ] **Step 1: Add failing planning tests**

Add to `tests/planning.test.js`:

```js
test("planner uses real free intervals and records exact start U", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, request({ id: "FIXED-PLAN", u_size: 4 }), {
    strategyId: "balanced_optimal",
  });
  const action = result.candidates[0].actions.find((item) => item.type === "place_device");
  assert.ok(Number.isInteger(action.start_u));
  assert.equal(action.device.start_u, action.start_u);
  assert.ok(result.candidates[0].score_breakdown.fragmentation);
});

test("replica batch is distributed across power and switch domains", () => {
  const state = createDemoState();
  const result = createPlanningEngine().recommend(state, request({
    id: "DB-PAIR", count: 2, u_size: 2, replica_group: "RG-NEW-01", business_id: "database-platform",
  }), { strategyId: "balanced_optimal" });
  const placements = result.candidates[0].actions.filter((item) => item.type === "place_device");
  const racks = placements.map((item) => state.racks.find((rack) => rack.id === item.rack_id));
  assert.notEqual(racks[0].source_id, racks[1].source_id);
  assert.notEqual(racks[0].network_switch_id, racks[1].network_switch_id);
});

test("three strategies expose their selected strategy and stable scores", () => {
  const state = createDemoState();
  const ids = ["balanced_optimal", "consolidated", "load_balanced"];
  const results = ids.map((strategyId) => createPlanningEngine().recommend(state, request({ id: `S-${strategyId}` }), { strategyId }));
  assert.deepEqual(results.map((result) => result.strategy_id), ids);
  assert.equal(new Set(results.map((result) => result.candidates[0].rack_id)).size >= 2, true);
});

test("planner explains why no physical candidate exists", () => {
  const result = createPlanningEngine().recommend(createDemoState(), request({ id: "TOO-TALL", u_size: 20 }), {
    strategyId: "balanced_optimal",
  });
  assert.deepEqual(result.candidates, []);
  assert.ok(result.rejection_summary.some((item) => item.code === "DEVICE_U_UNSUPPORTED"));
});
```

- [ ] **Step 2: Verify planning tests fail**

Run: `node --test tests/planning.test.js`

Expected: FAIL because current candidates omit `start_u`, strategy evidence, and cross-domain batch placement.

- [ ] **Step 3: Implement bounded beam generation**

Create `generatePlacementCandidates` using `freeIntervals` and incremental `evaluateActions`. Start with one empty beam, expand each requested device into every interval with sufficient `size_u`, reject blocked projections, sort expansions deterministically by rack/layer/start U, and keep at most 64 beams after each device. For a replica batch, exclude any expansion that shares a power source or access switch with an earlier placement. Every action must include:

```js
{
  type: "place_device",
  rack_id: interval.rack_id,
  layer_id: interval.layer_id,
  start_u: interval.start_u,
  device: { ...deviceFor(request, index), start_u: interval.start_u },
}
```

Generate divider candidates only when direct generation returns no candidate for the complete batch. Recalculate free intervals against the proposed divider layout and reject any divider that invalidates an existing fixed placement or reserve.

- [ ] **Step 4: Rebuild the planning orchestrator**

`recommend` must normalize `business_id`, `replica_group`, and strategy options; generate deterministic candidates; call `scoreCandidate`; discard `eligible:false`; sort by score then ID; and return:

```js
{
  request,
  strategy_id: strategyId,
  strategy_weights: scored[0]?.weights ?? strategyProfile(strategyId).weights,
  candidates: scored.slice(0, limit),
  rejected_count,
  rejection_summary,
}
```

Keep `recommendPlacement` backward compatible by mapping the first scored candidate into the existing `items` shape.

- [ ] **Step 5: Run planner compatibility tests and commit**

Run: `node --test tests/planning.test.js tests/recommendation.test.js tests/api.test.js`

Expected: all selected tests PASS.

```powershell
git add src/planning/candidate-generator.js src/planning/planning-engine.js src/placement-recommender.js tests/planning.test.js
git commit -m "feat: plan against real rack intervals"
```

---

### Task 6: Controlled Migration Alternatives and Impact

**Files:**
- Create: `src/planning/migration-planner.js`
- Create: `tests/migration-planner.test.js`
- Modify: `src/planning/planning-engine.js`

**Interfaces:**
- Produces: `generateMigrationCandidates(state, request, options): { candidates, assessments }`.
- Produces candidate `impact: { devices, businesses, maintenance_window, steps, rollback_actions }`.
- Produces analysis-only assessment `{ device_id, reason_code, impact }` when useful migration is blocked by missing maintenance data.

- [ ] **Step 1: Write failing migration tests**

Create `tests/migration-planner.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { generateMigrationCandidates } from "../src/planning/migration-planner.js";

function migrationState() {
  const state = createDemoState();
  state.devices = state.devices.filter((device) => !["CAB-01", "CAB-02"].includes(device.rack_id));
  state.devices.push({
    id: "MOVABLE-10U", rack_id: "CAB-01", layer_id: "L01", start_u: 1, u_size: 10,
    rated_power_w: 1_000, real_power_w: null, weight_kg: 40, network_ports: 2,
    business_id: "batch-platform", replica_group: null, movable: true, criticality: "normal",
    maintenance_window: "Saturday 02:00-04:00", status: "running", data_source: "demo",
  });
  return state;
}

test("migration candidates include only eligible devices and a rollback", () => {
  const state = migrationState();
  const result = generateMigrationCandidates(state, {
    id: "NEEDS-SPACE", count: 1, u_size: 10, rated_power_w: 2_000, weight_kg: 60, network_ports: 2,
  }, { maxCandidates: 16 });
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    const move = candidate.actions.find((action) => action.type === "move_device");
    const original = state.devices.find((device) => device.id === move.device_id);
    assert.equal(original.movable, true);
    assert.notEqual(original.criticality, "critical");
    assert.ok(original.maintenance_window);
    assert.equal(candidate.risk, "warning");
    assert.ok(candidate.impact.rollback_actions.some((action) => action.device_id === original.id && action.start_u === original.start_u));
  }
});

test("missing maintenance data prevents a confirmable migration", () => {
  const state = migrationState();
  state.devices.forEach((device) => { device.maintenance_window = null; });
  const result = generateMigrationCandidates(state, {
    id: "NO-WINDOW", count: 1, u_size: 10, rated_power_w: 2_000, weight_kg: 60, network_ports: 2,
  });
  assert.deepEqual(result.candidates, []);
  assert.ok(result.assessments.some((item) => item.reason_code === "MAINTENANCE_WINDOW_REQUIRED"));
});
```

- [ ] **Step 2: Verify migration tests fail**

Run: `node --test tests/migration-planner.test.js`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement one-device migration search**

Inspect devices occupying an otherwise suitable target interval. Ineligible devices create analysis-only assessments with stable reason codes. For each eligible device, find a destination interval, create one exact `move_device`, append the new placement action, run `evaluateActions`, and return valid candidates. Build impact with exact steps:

```js
impact: {
  devices: [movable.id],
  businesses: [movable.business_id].filter(Boolean),
  maintenance_window: movable.maintenance_window,
  steps: [
    `Precheck ${movable.id}`,
    `Move ${movable.id} to ${destination.rack_id} U${destination.start_u}`,
    `Place ${request.id} in ${target.rack_id} U${target.start_u}`,
    "Verify power, network, and service health",
  ],
  rollback_actions: [{
    type: "move_device",
    device_id: movable.id,
    rack_id: movable.rack_id,
    layer_id: movable.layer_id,
    start_u: movable.start_u,
  }],
},
```

Call migration generation only when direct and divider generation have no allowed candidate. Migration candidates always have `risk:"warning"` and a positive migration penalty. Return `migration_assessments` beside normal planning candidates so the UI can explain useful but non-confirmable migration ideas.

- [ ] **Step 4: Run planning and migration tests**

Run: `node --test tests/migration-planner.test.js tests/planning.test.js tests/constraints.test.js`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit migration planning**

```powershell
git add src/planning/migration-planner.js src/planning/planning-engine.js tests/migration-planner.test.js tests/planning.test.js
git commit -m "feat: add controlled migration alternatives"
```

---

### Task 7: Bounded Real-Agent Decision Contract

**Files:**
- Modify: `src/agent/agent-schema.js`
- Modify: `src/agent/agent-gateway.js`
- Create: `tests/agent-schema.test.js`
- Modify: `tests/agent-gateway.test.js`
- Modify: `scripts/mock-agent-server.js`

**Interfaces:**
- `validatePlanAdjustment(value)` returns `{ candidate_id, reason, weight_multipliers, alternatives }`.
- Each alternative returns `{ id, reason, actions }`; maximum 3.
- `agentGateway.adjustPlan(context)` uses the existing configured endpoint and DNS-aware transport.
- `agentGateway.describe()` returns safe metadata `{ model }` and never returns the Base URL or API key.

- [ ] **Step 1: Write failing Agent-schema tests**

Create `tests/agent-schema.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validatePlanAdjustment } from "../src/agent/agent-schema.js";

test("accepts bounded weights and exact-position alternatives", () => {
  const value = validatePlanAdjustment({
    candidate_id: "DIRECT-1",
    reason: "Keep database nodes close while preserving fault domains",
    weight_multipliers: { business: 1.5, fragmentation: 1.2 },
    alternatives: [{
      id: "AGENT-ALT-1",
      reason: "Use a larger continuous interval",
      actions: [{
        type: "place_device", rack_id: "CAB-04", layer_id: "L02", start_u: 13,
        device: { id: "SRV-NEW", u_size: 4, start_u: 13, rated_power_w: 1_200, weight_kg: 30, network_ports: 2 },
      }],
    }],
  });
  assert.equal(value.weight_multipliers.business, 1.5);
  assert.equal(value.alternatives[0].actions[0].start_u, 13);
});

test("rejects more than three alternatives and out-of-range weights", () => {
  const alternative = { id: "A", reason: "x", actions: [] };
  assert.throws(() => validatePlanAdjustment({ candidate_id: null, reason: "x", alternatives: [alternative, alternative, alternative, alternative] }), (error) => error.code === "AGENT_RESPONSE_INVALID");
  assert.throws(() => validatePlanAdjustment({ candidate_id: null, reason: "x", weight_multipliers: { capacity: 2.5 } }), (error) => error.code === "AGENT_RESPONSE_INVALID");
});
```

- [ ] **Step 2: Verify Agent tests fail**

Run: `node --test tests/agent-schema.test.js tests/agent-gateway.test.js`

Expected: FAIL because the existing schema has only `candidate_id`, `reason`, and one action list.

- [ ] **Step 3: Implement strict schema validation**

Require `start_u` for placement and move actions. Reject every top-level or nested field outside the documented contract, unknown action types, alternatives over 3, duplicate alternative IDs, and multipliers outside `0.5–2.0`. Reuse `validateWeightMultipliers` from `strategy-profiles.js`.

- [ ] **Step 4: Update the real-model prompt and test double**

The placement system prompt must request only:

```json
{
  "candidate_id": "known candidate ID or null",
  "reason": "decision explanation",
  "weight_multipliers": { "business": 1.0 },
  "alternatives": [
    { "id": "AGENT-ALT-1", "reason": "explanation", "actions": [] }
  ]
}
```

State in the prompt that the model cannot modify measured facts, design capacity, state version, hard-constraint results, or action types. Update `scripts/mock-agent-server.js` to return this contract without logging request headers or bodies.

- [ ] **Step 5: Run and commit Agent contract tests**

Run: `node --test tests/agent-schema.test.js tests/agent-gateway.test.js tests/mock-agent-server.test.js`

Expected: all selected tests PASS.

```powershell
git add src/agent/agent-schema.js src/agent/agent-gateway.js scripts/mock-agent-server.js tests/agent-schema.test.js tests/agent-gateway.test.js tests/mock-agent-server.test.js
git commit -m "feat: bound Agent placement decisions"
```

---

### Task 8: Plan-Service Intervention, Default Strategy, and Audit

**Files:**
- Create: `src/settings/placement-settings-service.js`
- Modify: `src/workflows/plan-service.js`
- Modify: `src/http-app.js`
- Modify: `src/http/routes/plan-routes.js`
- Modify: `tests/plan-service.test.js`
- Modify: `tests/api-v02.test.js`

**Interfaces:**
- `createPlacementSettingsService({ repository, now, idFactory })` exposes `get()` and `update(strategyId, actor)`.
- `POST /api/settings/placement-strategy` accepts `{ strategy_id }` and requires admin.
- `GET /api/settings/placement-strategy` is viewer-readable.
- `planService.create` stores `snapshot_version`, `strategy_id`, `baseline_candidate_id`, and `agent_intervention`.
- `planService.create` retains `agent_adjustment` as a safe compatibility summary for existing assistant consumers.

- [ ] **Step 1: Write failing service tests**

Add to `tests/plan-service.test.js`:

```js
test("request strategy overrides the stored default without mutating settings", async () => {
  const { repository, service } = fixture();
  const plan = await service.create({ kind: "placement", strategy_id: "load_balanced", device: sampleDevice() }, "planner");
  assert.equal(plan.strategy_id, "load_balanced");
  assert.equal(repository.read().settings.placement.default_strategy_id, "balanced_optimal");
  assert.equal(plan.snapshot_version, plan.base_version);
});

test("invalid Agent alternative is audited and baseline remains confirmable", async () => {
  const repository = createMemoryRepository(createDemoState());
  const service = createPlanService({
    repository,
    planner: createPlanningEngine(),
    executor: createSimulatedExecutionAdapter(),
    agentGateway: { async adjustPlan() { return {
      candidate_id: null,
      reason: "Try an impossible position",
      weight_multipliers: { business: 1.5 },
      alternatives: [{ id: "BAD", reason: "overlap", actions: [{
        type: "place_device", rack_id: "CAB-01", layer_id: "L01", start_u: 1,
        device: { ...sampleDevice(), start_u: 1 },
      }] }],
    }; } },
  });
  const plan = await service.create({ kind: "placement", device: sampleDevice() }, "planner");
  assert.equal(plan.status, "awaiting_confirmation");
  assert.ok(plan.agent_intervention.rejected_alternatives.some((item) => item.id === "BAD"));
});
```

Add API tests for GET/POST settings, viewer POST rejection, strategy selection, and stale confirmation.

- [ ] **Step 2: Verify service/API tests fail**

Run: `node --test tests/plan-service.test.js tests/api-v02.test.js`

Expected: FAIL because settings routes and new plan fields do not exist.

- [ ] **Step 3: Implement placement settings**

`get()` returns `{ default_strategy_id, state_version }`. `update()` validates via `strategyProfile`, mutates the versioned repository, and writes an audit entry with old/new strategy IDs and actor.

Register both routes. Add the POST path to `requiresAdmin()` and map `PLACEMENT_STRATEGY_INVALID` to HTTP 400.

- [ ] **Step 4: Integrate baseline and Agent scoring**

In plan creation:

1. Resolve `strategy_id` from the request or `state.settings.placement.default_strategy_id`.
2. Generate baseline candidates and preserve their score evidence.
3. Send only bounded context to `adjustPlan`.
4. Rescore known candidates with validated multipliers.
5. Validate every Agent alternative against the current entity whitelist, preserve `id`, `u_size`, `rated_power_w`, `real_power_w`, `weight_kg`, `network_ports`, `business_id`, and `replica_group`, then rerun all hard constraints.
6. Keep accepted alternatives beside the baseline candidates and record rejected alternatives with stable reason codes.
7. Choose the lowest valid Agent-adjusted score, but store both baseline and Agent IDs.
8. Store `snapshot_version: state.version + 1`, matching the repository version after plan persistence.

The confirmation path must compare current repository version to `snapshot_version`, rerun `evaluateActions`, and preserve the existing `confirmation_count === 1` behavior.

Use stable Agent reason codes `AGENT_UNAVAILABLE`, `AGENT_RESPONSE_INVALID`, `AGENT_ENTITY_UNKNOWN`, `AGENT_FACT_MUTATION`, and `AGENT_HARD_CONSTRAINT_BLOCKED`; expose only safe messages and validation evidence to the browser.

- [ ] **Step 5: Persist complete audit evidence**

`plan_created` audit details must include strategy, baseline candidate, final candidate, safe Agent model name from `agentGateway.describe()`, Agent status, weight changes, accepted/rejected alternative IDs, and risk. Every accepted Agent move must also receive server-generated migration impact and rollback details. Never include prompts, authorization values, API key, or Base URL.

- [ ] **Step 6: Run and commit workflow/API tests**

Run: `node --test tests/plan-service.test.js tests/api-v02.test.js tests/api.test.js tests/auth.test.js tests/agent-gateway.test.js`

Expected: all selected tests PASS.

```powershell
git add src/settings/placement-settings-service.js src/workflows/plan-service.js src/http-app.js src/http/routes/plan-routes.js tests/plan-service.test.js tests/api-v02.test.js
git commit -m "feat: orchestrate Agent placement intervention"
```

---

### Task 9: Inventory API and Exact Rack Visualization

**Files:**
- Modify: `src/http/routes/inventory-routes.js`
- Modify: `public/js/views/rack-detail.js`
- Modify: `public/css/views.css`
- Modify: `tests/api-v02.test.js`
- Modify: `tests/frontend-contract.test.js`

**Interfaces:**
- `GET /api/racks/:id` returns devices with exact placement and layers with free intervals.
- Rack UI renders occupied, free, and reserved intervals at their real U positions.

- [ ] **Step 1: Write failing API/frontend assertions**

Add API assertions:

```js
assert.equal(device.body.start_u, 1);
assert.equal(rack.body.devices[0].placement.start_u, rack.body.devices[0].start_u);
assert.ok(rack.body.layers.every((layer) => Array.isArray(layer.free_intervals)));
assert.ok(rack.body.layers.every((layer) => Number.isInteger(layer.reserve_start_u)));
```

Add frontend contract assertions for `data-start-u`, `free_intervals`, `reserve_start_u`, and the absence of `.innerHTML`.

- [ ] **Step 2: Verify assertions fail**

Run: `node --test tests/api-v02.test.js tests/frontend-contract.test.js`

Expected: FAIL because rack responses and rendering do not expose exact interval metadata.

- [ ] **Step 3: Enrich rack responses**

Use `packDevices` and `freeIntervals` once per rack. Attach exact placement to each device and filter intervals into their owning layer. Do not derive device positions in the browser.

- [ ] **Step 4: Render physical holes**

Replace the flex-based compact stack with one CSS grid per layer. Each device, free interval, and reserved interval receives `grid-row` derived from server-provided U bounds. Device accessible labels must include hostname, rack, and `Uxx–Uyy`. Preserve keyboard navigation and the existing device drawer.

- [ ] **Step 5: Run and commit API/frontend tests**

Run: `node --test tests/api-v02.test.js tests/frontend-contract.test.js`

Expected: all selected tests PASS.

```powershell
git add src/http/routes/inventory-routes.js public/js/views/rack-detail.js public/css/views.css tests/api-v02.test.js tests/frontend-contract.test.js
git commit -m "feat: visualize exact rack occupancy"
```

---

### Task 10: Strategy and Agent Decision UI

**Files:**
- Create: `public/js/views/placement-plan.js`
- Modify: `public/js/views/agent-console.js`
- Modify: `public/js/state.js`
- Modify: `public/css/views.css`
- Modify: `tests/frontend-contract.test.js`

**Interfaces:**
- State exposes `placementSettings`, `loadPlacementSettings()`, and `updatePlacementDefault(strategyId)`.
- Plan requests include `strategy_id`.
- `renderPlacementPlan(plan, state)` and `openPlanConfirmation(plan, onComplete)` own plan result UI.

- [ ] **Step 1: Add failing frontend contracts**

Assert that browser modules contain:

```js
/name:\s*["']strategy_id["']/
/updatePlacementDefault/
/baseline_score/
/agent_score/
/score_breakdown/
/maintenance_window/
/rollback_actions/
/snapshot_version/
```

Also assert `placement-plan.js` exists and contains no `.innerHTML`.

- [ ] **Step 2: Verify frontend contracts fail**

Run: `node --test tests/frontend-contract.test.js`

Expected: FAIL because the strategy and comparison UI are absent.

- [ ] **Step 3: Add settings state and strategy controls**

Load `/api/settings/placement-strategy` during authenticated room refresh. The structured and natural-language forms must submit the currently selected strategy. Add an admin-only “设为系统默认” button that POSTs the setting and refreshes it; viewer controls remain read-only.

- [ ] **Step 4: Extract and enhance plan rendering**

Move plan rendering from `agent-console.js` into `placement-plan.js`. Candidate cards must show:

- rule rank and Agent rank;
- exact target rack/layer/start/end U;
- projected U, rated power, weight, and port ratios;
- baseline and Agent score;
- collapsible score breakdown and weight changes;
- Agent accepted/rejected reason;
- migration business impact, maintenance window, steps, and rollback.
- rejection summaries when no confirmable candidate exists.

The final dialog must show strategy ID, snapshot version, Agent intervention status, exact actions, capacity changes, all warnings, and migration impact. It must retain only the existing single “确认并模拟执行” mutation button.

- [ ] **Step 5: Style comparison and responsive states**

Add CSS for `.strategy-controls`, `.decision-comparison`, `.score-breakdown`, `.agent-intervention`, and `.migration-impact`. At widths below 720px, use one column; respect the existing reduced-motion and focus-visible rules.

- [ ] **Step 6: Run and commit frontend tests**

Run: `node --test tests/frontend-contract.test.js tests/assistant-client.test.js`

Expected: all selected tests PASS and assistant draft preservation remains intact.

```powershell
git add public/js/views/placement-plan.js public/js/views/agent-console.js public/js/state.js public/css/views.css tests/frontend-contract.test.js
git commit -m "feat: compare placement strategies and Agent decisions"
```

---

### Task 11: Closed-Loop Browser Acceptance, Documentation, and Full Verification

**Files:**
- Modify: `tests/e2e/closed-loops.spec.js`
- Modify: `scripts/mock-agent-server.js`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- E2E uses the existing acceptance stack, mock model, one-confirmation flow, and deterministic reset.

- [ ] **Step 1: Add browser acceptance scenarios**

Add Playwright scenarios that:

1. reset the canonical 404U seed and inspect a rack with physical holes;
2. submit the same device under all three strategies and verify at least two different top racks;
3. verify the selected strategy, score breakdown, and exact U range;
4. receive an Agent rerank and display bounded weight changes;
5. receive an invalid Agent alternative and continue with the baseline candidate;
6. display migration impact and rollback when no direct candidate exists;
7. mutate state after plan creation and receive `PLAN_STALE` at confirmation;
8. confirm once, update the rack view, and write an audit entry;
9. verify a viewer can inspect decisions but cannot set defaults, create plans, or confirm.

- [ ] **Step 2: Run E2E and fix only evidence-backed failures**

Run: `npm.cmd run test:e2e`

Expected: all closed-loop browser scenarios PASS, screenshots stay under ignored `output/playwright`, and no browser console error is reported.

- [ ] **Step 3: Update operational documentation**

Document:

- the 404U deterministic mixed-occupancy seed;
- exact `start_u` semantics and per-layer 2U reserve;
- the three strategy behaviors and default-setting endpoint;
- bounded real-Agent intervention and deterministic fallback;
- migration eligibility, maintenance, and rollback;
- one final confirmation and stale-plan behavior;
- future NetBox field mapping for rack, position, device, interface, power port, cable, business, replica group, and collection source.

Add `.playwright-cli/` to `.gitignore` without changing ignored `.env` or `output/` behavior.

- [ ] **Step 4: Run the complete verification suite**

Run: `npm.cmd run reset:demo`

Run: `npm.cmd run test:all`

Run: `git diff --check`

Run the tracked-source secret scan:

```powershell
$trackedFiles = git ls-files
$secretHits = $trackedFiles | Select-String -Pattern 'sk-[A-Za-z0-9_-]{12,}|AGENT_API_KEY\s*=\s*[^\s]+'
if ($secretHits) { $secretHits; exit 1 }
```

Expected: reset succeeds; unit/API/browser tests PASS; diff check is clean; secret scan emits no matches.

- [ ] **Step 5: Perform real-model acceptance without exposing credentials**

Start the acceptance stack with the ignored `.env`. Log in as administrator, create one `balanced_optimal` plan, and verify the UI shows either `model_status=healthy` with a validated intervention or `model_status=degraded` with a usable baseline plan. Inspect browser network responses and application logs to confirm they contain neither the API key nor the private Base URL.

- [ ] **Step 6: Commit verification and docs**

```powershell
git add tests/e2e/closed-loops.spec.js scripts/mock-agent-server.js README.md .gitignore
git commit -m "test: verify occupancy-aware placement flow"
```

---

## Completion Checklist

- [ ] Canonical reset produces 404/680 occupied U with the documented mixed profiles.
- [ ] Existing servers retain fixed U positions and fragmented free space is visible.
- [ ] Hard constraints reject overlaps, reserved U, capacity excess, invalid migration, and replica fault-domain conflicts.
- [ ] All three strategies are selectable, explainable, and use one shared hard-constraint engine.
- [ ] Administrators can set a default strategy and override it per request.
- [ ] The real Agent can adjust only soft weights and validated alternatives.
- [ ] Agent failure cannot prevent deterministic plan creation.
- [ ] Migration plans include impact, maintenance, steps, and rollback.
- [ ] Stale plans cannot use the final confirmation.
- [ ] Exactly one final confirmation precedes execution.
- [ ] Viewer permissions remain read-only.
- [ ] Full tests, diff checks, and tracked-source secret scans pass.

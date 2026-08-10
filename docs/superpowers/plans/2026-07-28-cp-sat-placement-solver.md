# CP-SAT Placement Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic OR-Tools CP-SAT candidate generator for direct and batch server placement, with a four-candidate limit, rule-engine revalidation, Beam Search fallback, solver metadata, and server-side packaging.

**Architecture:** The synchronous Node.js planner builds a bounded JSON optimization problem and invokes an official Python OR-Tools CLI through a shell-free adapter. CP-SAT returns direct-placement candidates only; Node.js validates every candidate with `evaluateActions()`, applies the existing three-strategy scorer, and falls back to Beam Search or the existing divider/migration paths when appropriate.

**Tech Stack:** Node.js ESM, `node:test`, Python 3.11+, `ortools==9.15.6755`, Python `unittest`, Docker.

## Global Constraints

- Python must be version 3.11 or newer; pin OR-Tools to `ortools==9.15.6755`.
- CP-SAT may return at most 4 candidates. Node.js and Python must both enforce the limit.
- Python receives a total solving budget of 2000 ms; the Node.js process timeout defaults to 2500 ms.
- Use CP-SAT only for direct and batch placement in this phase.
- Existing divider adjustment and cross-rack migration behavior remains the fallback after a proven direct-placement `infeasible` result.
- Every CP-SAT candidate must pass the existing `evaluateActions()` hard-constraint engine.
- CP-SAT cannot mutate measured device facts, rack design capacities, state versions, or final rule results.
- Python process execution must use `shell:false`, fixed script paths, bounded input/output, and stable error codes.
- Use fixed random seed `20260728` and one CP-SAT worker for deterministic demonstrations.
- Keep the existing single final confirmation and audit workflow.
- Remote browser clients never need Python; the deployed server/container owns Python and OR-Tools.

---

## File Structure

### New files

- `src/planning/cp-sat-slots.js`: build the bounded solver problem and enumerate every exact direct-placement slot.
- `src/planning/cp-sat-adapter.js`: invoke Python, validate the JSON contract, convert placements into actions, and revalidate candidates.
- `solver/__init__.py`: make the solver importable by Python tests.
- `solver/cp_sat_solver.py`: construct and solve the CP-SAT model and implement the stdin/stdout CLI.
- `solver/test_cp_sat_solver.py`: Python solver unit tests.
- `tests/cp-sat-slots.test.js`: Node.js slot-builder and config tests.
- `tests/cp-sat-adapter.test.js`: Node.js process-boundary and contract tests.
- `tests/cp-sat-integration.test.js`: opt-in real Python/OR-Tools integration test.
- `tests/deployment.test.js`: dependency and container contract tests.
- `scripts/run-solver-tests.js`: cross-platform Python and Node integration-test launcher.
- `requirements-solver.txt`: pinned Python dependency.
- `Dockerfile`: production image containing Node.js, Python, and OR-Tools.
- `.dockerignore`: exclude local state, credentials, development artifacts, and virtual environments.

### Modified files

- `src/config.js`: add `getCpSatConfig()`.
- `.env.example`: document CP-SAT runtime configuration.
- `.gitignore`: ignore `.venv/` and Python cache files.
- `src/planning/candidate-generator.js`: export direct and divider candidate passes separately.
- `src/planning/planning-engine.js`: prefer CP-SAT, route infeasible/unavailable outcomes correctly, clamp output to 4, and return solver metadata.
- `src/workflows/plan-service.js`: persist solver metadata in the plan and audit event.
- `public/js/views/placement-plan.js`: show solver source, status, duration, candidate count, and fallback reason.
- `tests/planning.test.js`: cover CP-SAT precedence, infeasible routing, Beam fallback, and four-candidate limit.
- `tests/plan-service.test.js`: verify plan and audit persistence.
- `tests/frontend-contract.test.js`: verify solver metadata is rendered without raw HTML.
- `scripts/start-e2e-stack.js`: explicitly disable CP-SAT in the dependency-free browser test stack.
- `package.json`: add Python solver test scripts.
- `README.md`: document local setup, fallback behavior, and container startup.

---

### Task 1: Add CP-SAT configuration and deterministic slot-problem construction

**Files:**
- Create: `src/planning/cp-sat-slots.js`
- Create: `tests/cp-sat-slots.test.js`
- Modify: `src/config.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getCpSatConfig(env) -> { enabled, pythonPath, timeoutMs }`.
- Produces: `buildCpSatProblem(state, request, { strategyId, maxCandidates, timeLimitMs }) -> SolverProblem`.
- `SolverProblem.slots` contains exact `rack_id`, `layer_id`, `start_u`, `end_u`, and integer `soft_cost`.

- [ ] **Step 1: Write failing configuration and slot-enumeration tests**

Create `tests/cp-sat-slots.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getCpSatConfig } from "../src/config.js";
import { createDemoState } from "../src/demo-state.js";
import { buildCpSatProblem } from "../src/planning/cp-sat-slots.js";

function request(overrides = {}) {
  return {
    id: "CP-SAT-REQUEST",
    count: 1,
    u_size: 4,
    rated_power_w: 1_200,
    weight_kg: 30,
    network_ports: 2,
    preferred_rack_ids: [],
    business_id: null,
    replica_group: null,
    ...overrides,
  };
}

test("CP-SAT configuration is disabled by default and clamps process timeout", () => {
  assert.deepEqual(getCpSatConfig({}), {
    enabled: false,
    pythonPath: "python",
    timeoutMs: 2_500,
  });
  assert.deepEqual(getCpSatConfig({
    CP_SAT_ENABLED: "true",
    CP_SAT_PYTHON: "C:\\solver\\.venv\\Scripts\\python.exe",
    CP_SAT_TIMEOUT_MS: "100",
  }), {
    enabled: true,
    pythonPath: "C:\\solver\\.venv\\Scripts\\python.exe",
    timeoutMs: 500,
  });
});

test("slot builder enumerates every legal start inside a free interval", () => {
  const state = createDemoState();
  state.racks = state.racks.filter((rack) => rack.id === "CAB-01");
  state.devices = [];

  const problem = buildCpSatProblem(state, request(), {
    strategyId: "balanced_optimal",
    maxCandidates: 4,
    timeLimitMs: 2_000,
  });
  const l01 = problem.slots.filter((slot) => slot.rack_id === "CAB-01" && slot.layer_id === "L01");

  assert.deepEqual(l01.map((slot) => slot.start_u), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(l01.every((slot) => slot.end_u === slot.start_u + 3));
  assert.equal(problem.max_candidates, 4);
  assert.equal(problem.time_limit_ms, 2_000);
});

test("slot builder restricts 10U devices to L01 and blocks existing replica domains", () => {
  const state = createDemoState();
  const peer = state.devices.find((device) => device.rack_id === "CAB-01");
  peer.replica_group = "RG-CP-SAT";

  const problem = buildCpSatProblem(state, request({
    id: "CP-SAT-10U",
    u_size: 10,
    replica_group: "RG-CP-SAT",
  }), {
    strategyId: "load_balanced",
    maxCandidates: 9,
    timeLimitMs: 9_999,
  });
  const blockedRack = state.racks.find((rack) => rack.id === "CAB-01");

  assert.ok(problem.slots.length > 0);
  assert.ok(problem.slots.every((slot) => slot.layer_id === "L01"));
  assert.ok(problem.slots.every((slot) => slot.source_id !== blockedRack.source_id));
  assert.ok(problem.slots.every((slot) => slot.network_switch_id !== blockedRack.network_switch_id));
  assert.equal(problem.max_candidates, 4);
  assert.equal(problem.time_limit_ms, 2_000);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test tests/cp-sat-slots.test.js
```

Expected: FAIL because `getCpSatConfig` and `cp-sat-slots.js` do not exist.

- [ ] **Step 3: Implement bounded runtime configuration**

Add to `src/config.js`:

```js
function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function getCpSatConfig(env = process.env) {
  return {
    enabled: env.CP_SAT_ENABLED?.trim().toLowerCase() === "true",
    pythonPath: env.CP_SAT_PYTHON?.trim() || "python",
    timeoutMs: boundedInteger(env.CP_SAT_TIMEOUT_MS, 2_500, 500, 10_000),
  };
}
```

Append to `.env.example`:

```dotenv

CP_SAT_ENABLED=false
CP_SAT_PYTHON=python
CP_SAT_TIMEOUT_MS=2500
```

- [ ] **Step 4: Implement exact slot and problem construction**

Create `src/planning/cp-sat-slots.js` with these responsibilities and exports:

```js
import { capacitySnapshot } from "../domain/capacity.js";
import { freeIntervals } from "../domain/rack-layout.js";
import { strategyProfile } from "./strategy-profiles.js";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function activeDevices(state, rackId) {
  return state.devices.filter((device) => device.rack_id === rackId && device.status !== "cancelled");
}

function projectedCapacityMetric(snapshot, request) {
  return Math.round(100 * Math.max(
    (snapshot.rated_power_used_w + request.rated_power_w) / snapshot.design_power_w,
    (snapshot.used_weight_kg + request.weight_kg) / snapshot.max_weight_kg,
    (snapshot.used_ports + request.network_ports) / snapshot.port_limit,
    (snapshot.used_u + request.u_size) / snapshot.usable_u,
  ));
}

function sourceRatios(state) {
  const sources = new Map();
  for (const rack of state.racks.filter((item) => item.role === "server")) {
    const snapshot = capacitySnapshot(state, rack.id);
    const current = sources.get(rack.source_id) ?? { used: 0, capacity: 0 };
    current.used += snapshot.rated_power_used_w;
    current.capacity += snapshot.design_power_w;
    sources.set(rack.source_id, current);
  }
  return new Map([...sources].map(([id, source]) => [
    id,
    source.capacity > 0 ? source.used / source.capacity : 0,
  ]));
}

function slotMetrics({ state, request, rack, interval, snapshot, businessRacks, businessSwitches, ratios }) {
  const remaining = interval.size_u - request.u_size;
  const preferred = request.preferred_rack_ids.length > 0 && !request.preferred_rack_ids.includes(rack.id) ? 100 : 0;
  const business = request.business_id && businessRacks.size > 0 && !businessRacks.has(rack.id) ? 100 : 0;
  const link = request.business_id && businessSwitches.size > 0 && !businessSwitches.has(rack.network_switch_id) ? 100 : 0;
  const capacity = clamp(projectedCapacityMetric(snapshot, request), 0, 100);
  const sourceRatio = ratios.get(rack.source_id) ?? 0;
  const projectedSourceRatio = sourceRatio + request.rated_power_w
    / state.racks.filter((item) => item.source_id === rack.source_id)
      .reduce((sum, item) => sum + Number(item.design_power_w), 0);
  return {
    preferred,
    business,
    fragmentation: clamp(100 - remaining * 10, 0, 100),
    link,
    capacity,
    growth: clamp(100 - remaining * 10, 0, 100),
    activation: activeDevices(state, rack.id).length === 0 ? 100 : 0,
    source_imbalance: clamp(projectedSourceRatio * 100, 0, 100),
    migration: 0,
  };
}

function weightedCost(metrics, weights) {
  return Math.round(Object.entries(weights)
    .reduce((sum, [metric, weight]) => sum + Number(metrics[metric] ?? 0) * Number(weight), 0));
}

export function buildCpSatProblem(state, request, {
  strategyId = "balanced_optimal",
  maxCandidates = 4,
  timeLimitMs = 2_000,
} = {}) {
  const profile = strategyProfile(strategyId);
  const businessRacks = new Set(state.devices
    .filter((device) => request.business_id && device.business_id === request.business_id && device.status !== "cancelled")
    .map((device) => device.rack_id));
  const businessSwitches = new Set(state.racks
    .filter((rack) => businessRacks.has(rack.id))
    .map((rack) => rack.network_switch_id));
  const existingReplicaRacks = new Set(state.devices
    .filter((device) => request.replica_group && device.replica_group === request.replica_group && device.status !== "cancelled")
    .map((device) => device.rack_id));
  const blockedSources = new Set(state.racks.filter((rack) => existingReplicaRacks.has(rack.id)).map((rack) => rack.source_id));
  const blockedSwitches = new Set(state.racks.filter((rack) => existingReplicaRacks.has(rack.id)).map((rack) => rack.network_switch_id));
  const ratios = sourceRatios(state);
  const racks = [];
  const slots = [];

  for (const rack of state.racks.filter((item) => item.role === "server")) {
    const snapshot = capacitySnapshot(state, rack.id);
    racks.push({
      id: rack.id,
      source_id: rack.source_id,
      network_switch_id: rack.network_switch_id,
      design_power_w: Number(snapshot.design_power_w),
      current_power_w: Number(snapshot.rated_power_used_w),
      remaining_power_w: Number(snapshot.design_power_w) - Number(snapshot.rated_power_used_w),
      remaining_weight_kg: Number(snapshot.max_weight_kg) - Number(snapshot.used_weight_kg),
      remaining_ports: Number(snapshot.port_limit) - Number(snapshot.used_ports),
      activated: activeDevices(state, rack.id).length > 0,
    });
    if (request.replica_group && (blockedSources.has(rack.source_id) || blockedSwitches.has(rack.network_switch_id))) continue;

    const intervals = freeIntervals(rack, activeDevices(state, rack.id))
      .filter((interval) => interval.size_u >= request.u_size)
      .filter((interval) => request.u_size !== 10 || interval.layer_id === "L01");
    for (const interval of intervals) {
      const metrics = slotMetrics({
        state, request, rack, interval, snapshot, businessRacks, businessSwitches, ratios,
      });
      if (strategyId === "consolidated" && metrics.capacity >= 80) continue;
      for (let startU = interval.start_u; startU <= interval.end_u - request.u_size + 1; startU += 1) {
        slots.push({
          id: `${rack.id}:${interval.layer_id}:${startU}`,
          rack_id: rack.id,
          layer_id: interval.layer_id,
          start_u: startU,
          end_u: startU + request.u_size - 1,
          source_id: rack.source_id,
          network_switch_id: rack.network_switch_id,
          soft_cost: weightedCost(metrics, profile.weights),
        });
      }
    }
  }

  return {
    schema_version: 1,
    strategy_id: strategyId,
    max_candidates: Math.min(4, Math.max(1, Number(maxCandidates) || 4)),
    time_limit_ms: Math.min(2_000, Math.max(50, Number(timeLimitMs) || 2_000)),
    request: {
      id: request.id,
      count: Number(request.count),
      u_size: Number(request.u_size),
      rated_power_w: Number(request.rated_power_w),
      weight_kg: Number(request.weight_kg),
      network_ports: Number(request.network_ports),
      replica_group: request.replica_group ?? null,
    },
    racks: racks.sort((left, right) => left.id.localeCompare(right.id)),
    slots: slots.sort((left, right) => left.id.localeCompare(right.id)),
  };
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
node --test tests/cp-sat-slots.test.js
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit configuration and slot construction**

```powershell
git add -- src/config.js src/planning/cp-sat-slots.js tests/cp-sat-slots.test.js .env.example
git commit -m "feat: build CP-SAT placement problems"
```

---

### Task 2: Implement the Python OR-Tools solver and deterministic four-solution enumeration

**Files:**
- Create: `requirements-solver.txt`
- Create: `solver/__init__.py`
- Create: `solver/cp_sat_solver.py`
- Create: `solver/test_cp_sat_solver.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: schema version 1 `SolverProblem` from Task 1 on stdin.
- Produces: `solve_problem(payload) -> { schema_version, engine, status, duration_ms, candidates }`.
- CLI writes one JSON object to stdout and exits with code 0 for `optimal`, `feasible`, `infeasible`, and `unknown`.

- [ ] **Step 1: Add the pinned dependency and ignore local Python artifacts**

Create `requirements-solver.txt`:

```text
ortools==9.15.6755
```

Append to `.gitignore`:

```gitignore
.venv/
__pycache__/
*.pyc
```

Create an empty `solver/__init__.py`.

- [ ] **Step 2: Create the Python virtual environment and install OR-Tools**

Run:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-solver.txt
```

Expected: `ortools==9.15.6755` installs successfully. Network access requires explicit approval when the implementation is executed.

- [ ] **Step 3: Write failing Python model tests**

Create `solver/test_cp_sat_solver.py`:

```python
import unittest

from solver.cp_sat_solver import solve_problem


def problem(**request_overrides):
    request = {
        "id": "PY-SOLVER",
        "count": 1,
        "u_size": 2,
        "rated_power_w": 100,
        "weight_kg": 10,
        "network_ports": 1,
        "replica_group": None,
    }
    request.update(request_overrides)
    racks = [
        {
            "id": "CAB-01",
            "source_id": "SRC-A",
            "network_switch_id": "SW-A",
            "design_power_w": 1000,
            "current_power_w": 0,
            "remaining_power_w": 1000,
            "remaining_weight_kg": 100,
            "remaining_ports": 10,
            "activated": True,
        },
        {
            "id": "CAB-02",
            "source_id": "SRC-B",
            "network_switch_id": "SW-B",
            "design_power_w": 1000,
            "current_power_w": 0,
            "remaining_power_w": 1000,
            "remaining_weight_kg": 100,
            "remaining_ports": 10,
            "activated": False,
        },
    ]
    slots = [
        {
            "id": f"CAB-01:L01:{start}",
            "rack_id": "CAB-01",
            "layer_id": "L01",
            "start_u": start,
            "end_u": start + request["u_size"] - 1,
            "source_id": "SRC-A",
            "network_switch_id": "SW-A",
            "soft_cost": start,
        }
        for start in (1, 3, 5)
    ] + [
        {
            "id": f"CAB-02:L01:{start}",
            "rack_id": "CAB-02",
            "layer_id": "L01",
            "start_u": start,
            "end_u": start + request["u_size"] - 1,
            "source_id": "SRC-B",
            "network_switch_id": "SW-B",
            "soft_cost": 100 + start,
        }
        for start in (1, 3, 5)
    ]
    return {
        "schema_version": 1,
        "strategy_id": "balanced_optimal",
        "max_candidates": 4,
        "time_limit_ms": 2000,
        "request": request,
        "racks": racks,
        "slots": slots,
    }


class CpSatSolverTests(unittest.TestCase):
    def test_returns_no_more_than_four_distinct_candidates(self):
        result = solve_problem(problem())
        self.assertIn(result["status"], {"optimal", "feasible"})
        self.assertEqual(len(result["candidates"]), 4)
        signatures = {
            tuple((item["device_index"], item["rack_id"], item["layer_id"], item["start_u"])
                  for item in candidate["placements"])
            for candidate in result["candidates"]
        }
        self.assertEqual(len(signatures), 4)

    def test_batch_devices_do_not_overlap_and_replica_domains_are_distinct(self):
        result = solve_problem(problem(count=2, replica_group="RG-01"))
        self.assertIn(result["status"], {"optimal", "feasible"})
        placements = result["candidates"][0]["placements"]
        self.assertEqual(len(placements), 2)
        self.assertNotEqual(placements[0]["rack_id"], placements[1]["rack_id"])

    def test_capacity_constraints_can_make_the_problem_infeasible(self):
        payload = problem(rated_power_w=2000)
        result = solve_problem(payload)
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual(result["candidates"], [])

    def test_same_input_has_stable_candidate_order(self):
        first = solve_problem(problem())
        second = solve_problem(problem())
        self.assertEqual(first["candidates"], second["candidates"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run Python tests and verify RED**

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest solver.test_cp_sat_solver -v
```

Expected: FAIL because `solver.cp_sat_solver` does not exist.

- [ ] **Step 5: Implement the CP-SAT model and CLI**

Create `solver/cp_sat_solver.py`. The implementation must include these complete model rules:

```python
import json
import sys
import time

from ortools.sat.python import cp_model


SEED = 20260728
MAX_CANDIDATES = 4
MAX_TIME_MS = 2000


def _validated(payload):
    if payload.get("schema_version") != 1:
        raise ValueError("schema_version must equal 1")
    request = payload["request"]
    if int(request["count"]) < 1:
        raise ValueError("request.count must be positive")
    racks = sorted(payload.get("racks", []), key=lambda rack: rack["id"])
    slots = sorted(payload.get("slots", []), key=lambda slot: slot["id"])
    rack_ids = {rack["id"] for rack in racks}
    if any(slot["rack_id"] not in rack_ids for slot in slots):
        raise ValueError("slot references an unknown rack")
    return {
        **payload,
        "max_candidates": min(MAX_CANDIDATES, max(1, int(payload.get("max_candidates", MAX_CANDIDATES)))),
        "time_limit_ms": min(MAX_TIME_MS, max(50, int(payload.get("time_limit_ms", MAX_TIME_MS)))),
        "racks": racks,
        "slots": slots,
    }


def _status_name(status):
    if status == cp_model.OPTIMAL:
        return "optimal"
    if status == cp_model.FEASIBLE:
        return "feasible"
    if status == cp_model.INFEASIBLE:
        return "infeasible"
    return "unknown"


def solve_problem(raw_payload):
    started = time.monotonic()
    payload = _validated(raw_payload)
    request = payload["request"]
    racks = payload["racks"]
    slots = payload["slots"]
    count = int(request["count"])
    model = cp_model.CpModel()
    assignments = {
        (device_index, slot_index): model.new_bool_var(f"x_{device_index}_{slot_index}")
        for device_index in range(count)
        for slot_index in range(len(slots))
    }

    for device_index in range(count):
        model.add_exactly_one(assignments[device_index, slot_index] for slot_index in range(len(slots)))

    for rack in racks:
        rack_slot_indexes = [index for index, slot in enumerate(slots) if slot["rack_id"] == rack["id"]]
        for unit in sorted({
            unit
            for index in rack_slot_indexes
            for unit in range(int(slots[index]["start_u"]), int(slots[index]["end_u"]) + 1)
        }):
            model.add(sum(
                assignments[device_index, slot_index]
                for device_index in range(count)
                for slot_index in rack_slot_indexes
                if int(slots[slot_index]["start_u"]) <= unit <= int(slots[slot_index]["end_u"])
            ) <= 1)
        chosen = sum(
            assignments[device_index, slot_index]
            for device_index in range(count)
            for slot_index in rack_slot_indexes
        )
        model.add(chosen * int(request["rated_power_w"]) <= int(rack["remaining_power_w"]))
        model.add(chosen * int(request["weight_kg"]) <= int(rack["remaining_weight_kg"]))
        model.add(chosen * int(request["network_ports"]) <= int(rack["remaining_ports"]))

    if request.get("replica_group"):
        for field in ("source_id", "network_switch_id"):
            for domain in sorted({slot[field] for slot in slots}):
                model.add(sum(
                    assignments[device_index, slot_index]
                    for device_index in range(count)
                    for slot_index, slot in enumerate(slots)
                    if slot[field] == domain
                ) <= 1)

    selected_slot_indexes = []
    for device_index in range(count):
        selected = model.new_int_var(0, max(0, len(slots) - 1), f"selected_slot_{device_index}")
        model.add(selected == sum(
            slot_index * assignments[device_index, slot_index]
            for slot_index in range(len(slots))
        ))
        selected_slot_indexes.append(selected)
    for device_index in range(count - 1):
        model.add(selected_slot_indexes[device_index] < selected_slot_indexes[device_index + 1])

    used_racks = {}
    utilization = []
    for rack in racks:
        rack_slot_indexes = [index for index, slot in enumerate(slots) if slot["rack_id"] == rack["id"]]
        chosen = sum(
            assignments[device_index, slot_index]
            for device_index in range(count)
            for slot_index in rack_slot_indexes
        )
        used = model.new_bool_var(f"used_{rack['id']}")
        model.add(chosen >= used)
        model.add(chosen <= count * used)
        used_racks[rack["id"]] = used
        ratio = model.new_int_var(0, 10000, f"power_ratio_{rack['id']}")
        projected = int(rack["current_power_w"]) + chosen * int(request["rated_power_w"])
        model.add(ratio * int(rack["design_power_w"]) >= projected * 10000)
        utilization.append(ratio)

    soft_cost = sum(
        int(slot["soft_cost"]) * assignments[device_index, slot_index]
        for device_index in range(count)
        for slot_index, slot in enumerate(slots)
    )
    strategy = payload["strategy_id"]
    if strategy == "consolidated":
        new_racks = sum(
            used_racks[rack["id"]]
            for rack in racks
            if not rack["activated"]
        )
        model.minimize(new_racks * 1_000_000 + sum(used_racks.values()) * 100_000 + soft_cost)
    elif strategy == "load_balanced":
        max_utilization = model.new_int_var(0, 10000, "max_power_utilization")
        model.add_max_equality(max_utilization, utilization)
        model.minimize(max_utilization * 100_000 + soft_cost)
    else:
        model.minimize(soft_cost)

    candidates = []
    last_status = cp_model.UNKNOWN
    deadline = started + payload["time_limit_ms"] / 1000
    while len(candidates) < payload["max_candidates"]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(0.01, remaining)
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = SEED
        status = solver.solve(model)
        last_status = status
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        chosen_variables = []
        placements = []
        for device_index in range(count):
            for slot_index, slot in enumerate(slots):
                variable = assignments[device_index, slot_index]
                if solver.value(variable):
                    chosen_variables.append(variable)
                    placements.append({
                        "device_index": device_index,
                        "rack_id": slot["rack_id"],
                        "layer_id": slot["layer_id"],
                        "start_u": int(slot["start_u"]),
                    })
        placements.sort(key=lambda item: item["device_index"])
        candidates.append({
            "objective_value": int(round(solver.objective_value)),
            "placements": placements,
        })
        model.add(sum(chosen_variables) <= count - 1)

    if candidates:
        result_status = "optimal" if last_status == cp_model.OPTIMAL else "feasible"
    else:
        result_status = _status_name(last_status)
    return {
        "schema_version": 1,
        "engine": "cp_sat",
        "status": result_status,
        "duration_ms": int(round((time.monotonic() - started) * 1000)),
        "candidates": candidates,
    }


def main():
    payload = json.load(sys.stdin)
    json.dump(solve_problem(payload), sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

The empty-slot case must return `infeasible` before `add_exactly_one()` is called, because OR-Tools cannot assign a device when no slot variables exist:

```python
if not slots:
    return {
        "schema_version": 1,
        "engine": "cp_sat",
        "status": "infeasible",
        "duration_ms": int(round((time.monotonic() - started) * 1000)),
        "candidates": [],
    }
```

Place that guard immediately after `count = int(request["count"])`.

- [ ] **Step 6: Run Python tests and verify GREEN**

Run:

```powershell
.\.venv\Scripts\python.exe -m unittest solver.test_cp_sat_solver -v
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit the Python solver**

```powershell
git add -- requirements-solver.txt solver/__init__.py solver/cp_sat_solver.py solver/test_cp_sat_solver.py .gitignore
git commit -m "feat: add deterministic CP-SAT solver"
```

---

### Task 3: Build the guarded Node.js Python-process adapter

**Files:**
- Create: `src/planning/cp-sat-adapter.js`
- Create: `tests/cp-sat-adapter.test.js`
- Modify: `src/planning/candidate-generator.js`

**Interfaces:**
- Consumes: `buildCpSatProblem()` and `getCpSatConfig()`.
- Produces: `createCpSatAdapter({ config, validator, runProcess, scriptPath }).solve(state, request, { strategyId })`.
- `solve()` returns `{ outcome: "success" | "infeasible" | "unavailable", candidates, solver }`.
- Exports shared `placementDevice(request, index, startU)` from `candidate-generator.js`.

- [ ] **Step 1: Write failing adapter tests**

Create `tests/cp-sat-adapter.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { evaluateActions } from "../src/domain/constraint-engine.js";
import { createCpSatAdapter } from "../src/planning/cp-sat-adapter.js";

function request(overrides = {}) {
  return {
    id: "ADAPTER-SRV",
    count: 1,
    u_size: 2,
    rated_power_w: 500,
    weight_kg: 20,
    network_ports: 2,
    preferred_rack_ids: [],
    ...overrides,
  };
}

function adapterReturning(payload, overrides = {}) {
  return createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    scriptPath: "solver/cp_sat_solver.py",
    runProcess: () => ({
      status: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
      ...overrides,
    }),
  });
}

test("adapter converts a valid Python placement and revalidates it", () => {
  const state = createDemoState();
  state.devices = [];
  const adapter = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 12,
    candidates: [{
      objective_value: 1,
      placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: 1 }],
    }],
  });

  const result = adapter.solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "success");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].validation.allowed, true);
  assert.equal(result.candidates[0].actions[0].device.id, "ADAPTER-SRV");
  assert.equal(result.solver.engine, "cp_sat");
});

test("adapter rejects unknown placements and maps process failures to safe codes", () => {
  const state = createDemoState();
  const invalid = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 1,
    candidates: [{
      objective_value: 1,
      placements: [{ device_index: 0, rack_id: "CAB-404", layer_id: "L01", start_u: 1 }],
    }],
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(invalid.outcome, "unavailable");
  assert.equal(invalid.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");

  const timedOut = createCpSatAdapter({
    config: { enabled: true, pythonPath: "python", timeoutMs: 2_500 },
    validator: evaluateActions,
    runProcess: () => ({ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }),
  }).solve(state, request(), { strategyId: "balanced_optimal" });
  assert.equal(timedOut.outcome, "unavailable");
  assert.equal(timedOut.solver.fallback_reason, "CP_SAT_TIMEOUT");
});

test("adapter enforces the four-candidate contract", () => {
  const state = createDemoState();
  state.devices = [];
  const candidates = [1, 3, 5, 7, 9].map((startU) => ({
    objective_value: startU,
    placements: [{ device_index: 0, rack_id: "CAB-01", layer_id: "L01", start_u: startU }],
  }));
  const result = adapterReturning({
    schema_version: 1,
    engine: "cp_sat",
    status: "optimal",
    duration_ms: 10,
    candidates,
  }).solve(state, request(), { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "unavailable");
  assert.equal(result.solver.fallback_reason, "CP_SAT_CONTRACT_INVALID");
});
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
node --test tests/cp-sat-adapter.test.js
```

Expected: FAIL because `cp-sat-adapter.js` does not exist.

- [ ] **Step 3: Share deterministic device construction**

In `src/planning/candidate-generator.js`, rename the private `deviceFor` function to an exported function:

```js
export function placementDevice(request, index, startU) {
  const suffix = request.count > 1 ? `-${index + 1}` : "";
  return {
    ...structuredClone(request),
    id: `${request.id}${suffix}`,
    count: undefined,
    preferred_rack_ids: undefined,
    start_u: startU,
    status: "pending",
    data_source: "demo",
  };
}
```

Replace the existing internal call to `deviceFor(request, index, interval.start_u)` with:

```js
const device = placementDevice(request, index, interval.start_u);
```

- [ ] **Step 4: Implement the process adapter and contract validation**

Create `src/planning/cp-sat-adapter.js` with:

```js
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCpSatConfig } from "../config.js";
import { evaluateActions } from "../domain/constraint-engine.js";
import { buildCpSatProblem } from "./cp-sat-slots.js";
import { placementDevice } from "./candidate-generator.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const defaultScriptPath = join(root, "solver", "cp_sat_solver.py");
const MAX_BUFFER = 2_000_000;

function metadata(status, durationMs = 0, candidateCount = 0, fallbackReason = null, engine = "cp_sat") {
  return {
    engine,
    status,
    duration_ms: Number(durationMs) || 0,
    candidate_count: candidateCount,
    fallback_reason: fallbackReason,
  };
}

function unavailable(code, durationMs = 0) {
  return {
    outcome: "unavailable",
    candidates: [],
    solver: metadata("fallback", durationMs, 0, code, "beam_search"),
  };
}

function processFailure(result) {
  if (result.error?.code === "ENOENT") return "CP_SAT_PYTHON_UNAVAILABLE";
  if (result.error?.code === "ETIMEDOUT") return "CP_SAT_TIMEOUT";
  if (result.error?.code === "ENOBUFS") return "CP_SAT_OUTPUT_TOO_LARGE";
  if (/No module named ['"]ortools/i.test(result.stderr ?? "")) return "CP_SAT_DEPENDENCY_MISSING";
  return "CP_SAT_PROCESS_FAILED";
}

function parseOutput(result) {
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error("CP-SAT process failed"), { code: processFailure(result) });
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw Object.assign(new Error("CP-SAT output is not JSON"), { code: "CP_SAT_OUTPUT_INVALID" });
  }
}

function matchedSlot(problem, placement) {
  return problem.slots.find((slot) =>
    slot.rack_id === placement.rack_id
    && slot.layer_id === placement.layer_id
    && slot.start_u === Number(placement.start_u));
}

function candidateFromOutput(state, request, problem, output, validator, index) {
  if (!Array.isArray(output.placements) || output.placements.length !== request.count) {
    throw Object.assign(new Error("Candidate placement count is invalid"), { code: "CP_SAT_CONTRACT_INVALID" });
  }
  const indexes = new Set(output.placements.map((placement) => Number(placement.device_index)));
  if (indexes.size !== request.count || [...indexes].some((value) => value < 0 || value >= request.count)) {
    throw Object.assign(new Error("Candidate device indexes are invalid"), { code: "CP_SAT_CONTRACT_INVALID" });
  }
  const placements = [...output.placements].sort((left, right) => left.device_index - right.device_index);
  const actions = placements.map((placement) => {
    const slot = matchedSlot(problem, placement);
    if (!slot) throw Object.assign(new Error("Candidate references an unknown slot"), { code: "CP_SAT_CONTRACT_INVALID" });
    return {
      type: "place_device",
      rack_id: slot.rack_id,
      layer_id: slot.layer_id,
      start_u: slot.start_u,
      device: placementDevice(request, placement.device_index, slot.start_u),
    };
  });
  const validation = validator(state, actions);
  return {
    id: `CP-SAT-${String(index + 1).padStart(2, "0")}-${actions.map((action) => `${action.rack_id}-${action.layer_id}-${action.start_u}`).join("--")}`,
    rack_id: actions[0]?.rack_id ?? null,
    layer_id: actions[0]?.layer_id ?? null,
    actions,
    validation,
    cp_sat_objective: Number(output.objective_value),
  };
}

export function createCpSatAdapter({
  config = getCpSatConfig(),
  validator = evaluateActions,
  runProcess = spawnSync,
  scriptPath = defaultScriptPath,
} = {}) {
  return {
    solve(state, request, { strategyId = "balanced_optimal" } = {}) {
      if (!config.enabled) {
        return {
          outcome: "unavailable",
          candidates: [],
          solver: metadata("disabled", 0, 0, null, "beam_search"),
        };
      }
      const problem = buildCpSatProblem(state, request, {
        strategyId,
        maxCandidates: 4,
        timeLimitMs: 2_000,
      });
      let payload;
      try {
        const serialized = JSON.stringify(problem);
        if (Buffer.byteLength(serialized, "utf8") > MAX_BUFFER) {
          return unavailable("CP_SAT_CONTRACT_INVALID");
        }
        const result = runProcess(config.pythonPath, [scriptPath], {
          input: serialized,
          encoding: "utf8",
          timeout: config.timeoutMs,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          shell: false,
        });
        payload = parseOutput(result);
      } catch (error) {
        return unavailable(error.code ?? "CP_SAT_PROCESS_FAILED", config.timeoutMs);
      }
      if (
        payload?.schema_version !== 1
        || payload.engine !== "cp_sat"
        || !["optimal", "feasible", "infeasible", "unknown"].includes(payload.status)
        || !Array.isArray(payload.candidates)
        || payload.candidates.length > 4
      ) return unavailable("CP_SAT_CONTRACT_INVALID", payload?.duration_ms);
      if (payload.status === "infeasible") {
        return {
          outcome: "infeasible",
          candidates: [],
          solver: metadata("infeasible", payload.duration_ms, 0),
        };
      }
      if (payload.status === "unknown") return unavailable("CP_SAT_UNKNOWN", payload.duration_ms);
      try {
        const converted = payload.candidates.map((candidate, index) =>
          candidateFromOutput(state, request, problem, candidate, validator, index));
        const signatures = converted.map((candidate) =>
          candidate.actions.map((action) =>
            `${action.device.id}:${action.rack_id}:${action.layer_id}:${action.start_u}`).join("|"));
        if (new Set(signatures).size !== signatures.length) {
          return unavailable("CP_SAT_CONTRACT_INVALID", payload.duration_ms);
        }
        const allowed = converted.filter((candidate) => candidate.validation.allowed);
        if (allowed.length === 0) return unavailable("CP_SAT_VALIDATION_REJECTED", payload.duration_ms);
        return {
          outcome: "success",
          candidates: allowed,
          solver: metadata(payload.status, payload.duration_ms, allowed.length),
        };
      } catch (error) {
        return unavailable(error.code ?? "CP_SAT_CONTRACT_INVALID", payload.duration_ms);
      }
    },
  };
}
```

- [ ] **Step 5: Run adapter and existing candidate tests**

Run:

```powershell
node --test tests/cp-sat-adapter.test.js tests/planning.test.js tests/recommendation.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit the guarded adapter**

```powershell
git add -- src/planning/cp-sat-adapter.js src/planning/candidate-generator.js tests/cp-sat-adapter.test.js
git commit -m "feat: guard the CP-SAT process boundary"
```

---

### Task 4: Integrate CP-SAT outcomes into planning, fallback, plan storage, and audit

**Files:**
- Modify: `src/planning/candidate-generator.js`
- Modify: `src/planning/planning-engine.js`
- Modify: `src/workflows/plan-service.js`
- Modify: `tests/planning.test.js`
- Modify: `tests/plan-service.test.js`
- Modify: `scripts/start-e2e-stack.js`

**Interfaces:**
- `generateDirectPlacementCandidates(state, request, options) -> Candidate[]`.
- `generateDividerCandidates(state, request, options) -> Candidate[]`.
- `createPlanningEngine({ validator, cpSatAdapter }).recommend(...)` returns `solver` metadata on every placement result.
- Persisted placement plans expose `plan.solver`; plan audit details expose safe scalar solver fields.

- [ ] **Step 1: Add failing planner routing tests**

Append to `tests/planning.test.js`:

```js
test("planner prefers CP-SAT candidates and clamps the result to four", () => {
  const state = createDemoState();
  const fake = {
    solve() {
      const base = createPlanningEngine({ cpSatAdapter: { solve: () => ({ outcome: "unavailable", candidates: [], solver: { engine: "beam_search", status: "disabled", duration_ms: 0, candidate_count: 0, fallback_reason: null } }) } })
        .recommend(state, request({ id: "INNER" }), { limit: 1 }).candidates[0];
      return {
        outcome: "success",
        candidates: [1, 2, 3, 4, 5].map((number) => ({
          ...structuredClone(base),
          id: `CP-${number}`,
        })),
        solver: { engine: "cp_sat", status: "optimal", duration_ms: 10, candidate_count: 5, fallback_reason: null },
      };
    },
  };
  const result = createPlanningEngine({ cpSatAdapter: fake }).recommend(state, request({ id: "OUTER" }), { limit: 8 });

  assert.equal(result.candidates.length, 4);
  assert.equal(result.solver.engine, "cp_sat");
});

test("planner sends CP-SAT infeasible results to dividers without technical fallback", () => {
  const state = createDemoState();
  state.devices = [{
    id: "FIXED-L01-CP",
    rack_id: "CAB-01",
    layer_id: "L01",
    start_u: 1,
    u_size: 10,
    rated_power_w: 100,
    real_power_w: null,
    weight_kg: 10,
    network_ports: 1,
    movable: false,
    criticality: "normal",
    maintenance_window: null,
    status: "running",
    data_source: "demo",
  }];
  state.racks = state.racks.map((rack) => rack.id === "CAB-01" ? rack : { ...rack, role: "network" });
  const cpSatAdapter = {
    solve: () => ({
      outcome: "infeasible",
      candidates: [],
      solver: { engine: "cp_sat", status: "infeasible", duration_ms: 5, candidate_count: 0, fallback_reason: null },
    }),
  };
  const result = createPlanningEngine({ cpSatAdapter }).recommend(state, request({ id: "DIVIDER-CP", u_size: 9 }));

  assert.ok(result.candidates.some((candidate) => candidate.actions.some((action) => action.type === "set_dividers")));
  assert.equal(result.solver.status, "infeasible");
  assert.equal(result.solver.fallback_reason, null);
});

test("planner records Beam fallback when CP-SAT is unavailable", () => {
  const cpSatAdapter = {
    solve: () => ({
      outcome: "unavailable",
      candidates: [],
      solver: { engine: "beam_search", status: "fallback", duration_ms: 2500, candidate_count: 0, fallback_reason: "CP_SAT_TIMEOUT" },
    }),
  };
  const result = createPlanningEngine({ cpSatAdapter }).recommend(createDemoState(), request());

  assert.ok(result.candidates.length > 0);
  assert.equal(result.solver.engine, "beam_search");
  assert.equal(result.solver.fallback_reason, "CP_SAT_TIMEOUT");
});
```

- [ ] **Step 2: Add failing plan and audit persistence tests**

In `tests/plan-service.test.js`, add a fake planner result with:

```js
solver: {
  engine: "cp_sat",
  status: "optimal",
  duration_ms: 17,
  candidate_count: 2,
  fallback_reason: null,
}
```

Assert after plan creation:

```js
assert.equal(plan.solver.engine, "cp_sat");
assert.equal(plan.solver.candidate_count, 2);
const audit = repository.read().audit.find((entry) => entry.entity_id === plan.id && entry.action === "plan_created");
assert.equal(audit.details.solver_engine, "cp_sat");
assert.equal(audit.details.solver_status, "optimal");
assert.equal(audit.details.solver_fallback_reason, null);
```

- [ ] **Step 3: Run planner and plan tests and verify RED**

Run:

```powershell
node --test tests/planning.test.js tests/plan-service.test.js
```

Expected: FAIL because the planner ignores `cpSatAdapter` and plans do not persist `solver`.

- [ ] **Step 4: Split direct and divider candidate generation**

In `src/planning/candidate-generator.js`:

- Export the current direct call as:

```js
export function generateDirectPlacementCandidates(state, request, {
  maxBeams = 64,
  validator = evaluateActions,
} = {}) {
  const beamLimit = Math.max(1, Math.min(256, Number(maxBeams) || 64));
  return expandPlacementBeams(state, request, { maxBeams: beamLimit, validator }).map(toCandidate);
}
```

- Move the current divider loop into:

```js
export function generateDividerCandidates(state, request, {
  maxBeams = 64,
  validator = evaluateActions,
} = {}) {
  if (request.u_size === 10) return [];
  const beamLimit = Math.max(1, Math.min(256, Number(maxBeams) || 64));
  const dividerBeams = [];

  for (const rack of state.racks.filter((item) => item.role === "server")) {
    for (const layerId of ["L02", "L03", "L04"]) {
      const dividersU = dividerLayoutFor(layerId, request.u_size + 2);
      if (!dividersU || dividersU.every((value, index) => value === rack.dividers_u[index])) continue;
      const dividerAction = {
        type: "set_dividers",
        rack_id: rack.id,
        dividers_u: dividersU,
      };
      const dividerValidation = validator(state, [dividerAction]);
      if (!dividerValidation.allowed) continue;
      const projected = applyActions(state, [dividerAction]);
      const beams = expandPlacementBeams(state, request, {
        maxBeams: beamLimit,
        validator,
        initialBeam: {
          actions: [dividerAction],
          projected,
          validation: dividerValidation,
        },
      }).filter((beam) => beam.actions.some((action) =>
        action.type === "place_device"
        && action.rack_id === rack.id
        && action.layer_id === layerId));
      dividerBeams.push(...beams);
      if (dividerBeams.length >= beamLimit) break;
    }
    if (dividerBeams.length >= beamLimit) break;
  }

  return dividerBeams
    .sort((left, right) => actionKey(left.actions).localeCompare(actionKey(right.actions)))
    .slice(0, beamLimit)
    .map(toCandidate);
}
```

The final `generatePlacementCandidates()` must contain complete orchestration:

```js
export function generatePlacementCandidates(state, request, options = {}) {
  const direct = generateDirectPlacementCandidates(state, request, options);
  if (direct.length > 0) return direct;
  return generateDividerCandidates(state, request, options);
}
```

This is a mechanical extraction: `dividerLayoutFor`, `expandPlacementBeams`, `actionKey`, and `toCandidate` remain private helpers in the same file.

- [ ] **Step 5: Integrate CP-SAT with exact outcome routing**

Modify `src/planning/planning-engine.js`:

```js
import { createCpSatAdapter } from "./cp-sat-adapter.js";
import {
  generateDividerCandidates,
  generatePlacementCandidates,
} from "./candidate-generator.js";
```

Change the factory signature:

```js
export function createPlanningEngine({
  validator = evaluateActions,
  cpSatAdapter = createCpSatAdapter({ validator }),
} = {}) {
```

Inside `recommend()`, clamp the limit:

```js
const limit = Math.max(1, Math.min(4, Number(options.limit) || 4));
```

Replace direct candidate selection with:

```js
const cpSat = cpSatAdapter.solve(state, request, { strategyId });
let generated;
if (cpSat.outcome === "success") {
  generated = cpSat.candidates;
} else if (cpSat.outcome === "infeasible") {
  generated = generateDividerCandidates(state, request, { maxBeams: 64, validator });
} else {
  generated = generatePlacementCandidates(state, request, { maxBeams: 64, validator });
}
const migration = generated.length > 0
  ? { candidates: [], assessments: [] }
  : generateMigrationCandidates(state, request, { maxCandidates: 32, validator });
```

Return safe solver metadata:

```js
solver: {
  ...cpSat.solver,
  candidate_count: Math.min(4, accepted.length),
},
```

For `DEVICE_U_UNSUPPORTED`, return:

```js
solver: {
  engine: "beam_search",
  status: "not_run",
  duration_ms: 0,
  candidate_count: 0,
  fallback_reason: null,
},
```

- [ ] **Step 6: Persist solver metadata in plans and audit**

In `src/workflows/plan-service.js`, change the placement planner limit:

```js
limit: effectiveRequest.limit ?? 4,
```

Add to the persisted plan:

```js
solver: clone(planning.solver ?? null),
```

Add safe scalar fields to `plan_created` audit details:

```js
solver_engine: plan.solver?.engine ?? null,
solver_status: plan.solver?.status ?? null,
solver_duration_ms: plan.solver?.duration_ms ?? null,
solver_candidate_count: plan.solver?.candidate_count ?? null,
solver_fallback_reason: plan.solver?.fallback_reason ?? null,
```

- [ ] **Step 7: Isolate browser E2E from developer environment**

In `scripts/start-e2e-stack.js`, add this override:

```js
CP_SAT_ENABLED: "false",
```

This prevents a developer's inherited `CP_SAT_ENABLED=true` from changing deterministic E2E behavior.

- [ ] **Step 8: Run focused and full Node.js tests**

Run:

```powershell
node --test tests/cp-sat-slots.test.js tests/cp-sat-adapter.test.js tests/planning.test.js tests/plan-service.test.js tests/recommendation.test.js tests/constraints.test.js
npm.cmd test
```

Expected: all Node.js tests pass with zero failures.

- [ ] **Step 9: Commit planner integration**

```powershell
git add -- src/planning/candidate-generator.js src/planning/planning-engine.js src/workflows/plan-service.js tests/planning.test.js tests/plan-service.test.js scripts/start-e2e-stack.js
git commit -m "feat: prefer CP-SAT with guarded fallback"
```

---

### Task 5: Expose solver evidence in the planning UI and audit-safe API

**Files:**
- Modify: `public/js/views/placement-plan.js`
- Modify: `tests/frontend-contract.test.js`
- Modify: `tests/api-v02.test.js`
- Modify: `tests/e2e/closed-loops.spec.js`

**Interfaces:**
- Consumes: persisted `plan.solver`.
- Produces: visible solver badge and detail text without introducing a new interaction or confirmation.

- [ ] **Step 1: Write failing frontend contract assertions**

Append to the placement-planning test in `tests/frontend-contract.test.js`:

```js
for (const field of [
  "solver.engine",
  "solver.status",
  "solver.duration_ms",
  "solver.candidate_count",
  "solver.fallback_reason",
]) assert.match(planView, new RegExp(field.replace(".", "\\.")));
assert.match(planView, /CP-SAT|Beam Search/);
```

In `tests/api-v02.test.js`, after creating a placement plan, assert:

```js
assert.ok(["cp_sat", "beam_search"].includes(created.body.solver.engine));
assert.ok(["optimal", "feasible", "disabled", "fallback", "infeasible"].includes(created.body.solver.status));
assert.equal(Number.isInteger(created.body.solver.candidate_count), true);
```

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```powershell
node --test tests/frontend-contract.test.js tests/api-v02.test.js
```

Expected: FAIL because `placement-plan.js` does not reference solver metadata.

- [ ] **Step 3: Render solver source and fallback evidence**

Add to `public/js/views/placement-plan.js`:

```js
function solverEvidence(solver) {
  if (!solver) return null;
  const engine = solver.engine === "cp_sat" ? "CP-SAT" : "Beam Search";
  const tone = solver.engine === "cp_sat" && ["optimal", "feasible"].includes(solver.status)
    ? "ok"
    : solver.fallback_reason
      ? "warning"
      : "neutral";
  return h("section", { className: "solver-evidence" }, [
    h("div", { className: "candidate-ranks" }, [
      statusBadge(`${engine} · ${solver.status}`, tone),
      h("span", { text: `${Number(solver.duration_ms) || 0}ms · ${Number(solver.candidate_count) || 0} 个候选` }),
    ]),
    solver.fallback_reason
      ? h("p", { text: `求解器已安全回退：${solver.fallback_reason}` })
      : h("p", { text: "所有候选均已通过确定性风险规则复核。" }),
  ]);
}
```

Insert this immediately after `.plan-status-row` in the normal placement plan:

```js
isRemoval ? null : solverEvidence(plan.solver),
```

Do not add a new button and do not alter `openPlanConfirmation()`.

- [ ] **Step 4: Add one E2E assertion for the dependency-free fallback path**

After a structured placement plan is rendered in `tests/e2e/closed-loops.spec.js`, add:

```js
await expect(page.locator(".solver-evidence")).toContainText("Beam Search");
```

The E2E launcher explicitly disables CP-SAT, so this proves the normal fallback UI without requiring Python in browser CI.

- [ ] **Step 5: Run frontend and browser tests**

Run:

```powershell
node --test tests/frontend-contract.test.js tests/api-v02.test.js
npm.cmd run test:e2e
```

Expected: contract tests and all browser closed-loop scenarios pass.

- [ ] **Step 6: Commit solver evidence UI**

```powershell
git add -- public/js/views/placement-plan.js tests/frontend-contract.test.js tests/api-v02.test.js tests/e2e/closed-loops.spec.js
git commit -m "feat: show placement solver evidence"
```

---

### Task 6: Add real integration verification and production dependency packaging

**Files:**
- Create: `tests/cp-sat-integration.test.js`
- Create: `tests/deployment.test.js`
- Create: `scripts/run-solver-tests.js`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- `npm.cmd run test:solver` runs Python unit tests and the real Node-to-Python integration.
- Docker image exposes port 3000 and sets `CP_SAT_PYTHON=/opt/venv/bin/python`.

- [ ] **Step 1: Write the real integration test**

Create `tests/cp-sat-integration.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/demo-state.js";
import { evaluateActions } from "../src/domain/constraint-engine.js";
import { createCpSatAdapter } from "../src/planning/cp-sat-adapter.js";

const enabled = process.env.CP_SAT_INTEGRATION === "1";

test("real Python OR-Tools process returns revalidated placement candidates", { skip: !enabled }, () => {
  const adapter = createCpSatAdapter({
    config: {
      enabled: true,
      pythonPath: process.env.CP_SAT_PYTHON || ".venv\\Scripts\\python.exe",
      timeoutMs: 2_500,
    },
    validator: evaluateActions,
  });
  const result = adapter.solve(createDemoState(), {
    id: "REAL-CP-SAT",
    count: 2,
    u_size: 2,
    rated_power_w: 800,
    weight_kg: 20,
    network_ports: 2,
    preferred_rack_ids: [],
    business_id: "compute-platform",
    replica_group: "RG-REAL-CP",
  }, { strategyId: "balanced_optimal" });

  assert.equal(result.outcome, "success");
  assert.ok(result.candidates.length >= 1 && result.candidates.length <= 4);
  assert.ok(result.candidates.every((candidate) => candidate.validation.allowed));
  assert.equal(result.solver.engine, "cp_sat");
});
```

- [ ] **Step 2: Add a cross-platform solver-test launcher**

Create `scripts/run-solver-tests.js`:

```js
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const defaultPython = process.platform === "win32"
  ? ".venv\\Scripts\\python.exe"
  : ".venv/bin/python";
const pythonPath = process.env.CP_SAT_PYTHON || defaultPython;

if (!existsSync(pythonPath)) {
  process.stderr.write(`CP-SAT Python interpreter not found: ${pythonPath}\n`);
  process.exit(1);
}

const python = spawnSync(pythonPath, ["-m", "unittest", "solver.test_cp_sat_solver", "-v"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});
if (python.status !== 0) process.exit(python.status ?? 1);

const integration = spawnSync(process.execPath, ["--test", "tests/cp-sat-integration.test.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CP_SAT_INTEGRATION: "1",
    CP_SAT_PYTHON: pythonPath,
  },
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});
process.exit(integration.status ?? 1);
```

Add to `package.json`:

```json
"test:solver": "node scripts/run-solver-tests.js"
```

Keep `test` and `test:e2e` unchanged.

- [ ] **Step 3: Write failing deployment contract tests**

Create `tests/deployment.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("solver dependency is pinned and container owns Python runtime", () => {
  const requirements = readFileSync("requirements-solver.txt", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");

  assert.match(requirements, /^ortools==9\.15\.6755\s*$/m);
  assert.match(dockerfile, /python3\s+-m\s+venv\s+\/opt\/venv/);
  assert.match(dockerfile, /\/opt\/venv\/bin\/pip\s+install/);
  assert.match(dockerfile, /CP_SAT_ENABLED=true/);
  assert.match(dockerfile, /CP_SAT_PYTHON=\/opt\/venv\/bin\/python/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /EXPOSE 3000/);
});
```

- [ ] **Step 4: Run deployment test and verify RED**

Run:

```powershell
node --test tests/deployment.test.js
```

Expected: FAIL because `Dockerfile` does not exist.

- [ ] **Step 5: Create the production Docker image**

Create `Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-solver.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements-solver.txt

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3000
ENV CP_SAT_ENABLED=true
ENV CP_SAT_PYTHON=/opt/venv/bin/python
ENV CP_SAT_TIMEOUT_MS=2500

EXPOSE 3000

CMD ["npm", "start"]
```

Create `.dockerignore`:

```dockerignore
.git
.env
.env.*
!.env.example
.venv
node_modules
data/runtime
output
playwright-report
test-results
```

- [ ] **Step 6: Document local and container operation**

Add a CP-SAT section to `README.md` containing these exact commands:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-solver.txt
```

Local `.env` values:

```dotenv
CP_SAT_ENABLED=true
CP_SAT_PYTHON=.venv\Scripts\python.exe
CP_SAT_TIMEOUT_MS=2500
```

Container commands:

```powershell
docker build -t datacenter-mgr:cp-sat .
docker run --rm -p 3000:3000 --env-file .env datacenter-mgr:cp-sat
```

Document that remote users only need the website URL; Python exists inside the server container. Document that disabling CP-SAT or losing Python causes Beam Search fallback without disabling planning.

- [ ] **Step 7: Enable CP-SAT in the untracked local runtime**

Use `apply_patch` to append these values to the existing `.env` without changing its authentication or Agent secrets:

```dotenv
CP_SAT_ENABLED=true
CP_SAT_PYTHON=.venv\Scripts\python.exe
CP_SAT_TIMEOUT_MS=2500
```

Run:

```powershell
git status --short
```

Expected: `.env` is not listed because it remains ignored.

- [ ] **Step 8: Run solver, deployment, full unit, and browser verification**

Run:

```powershell
npm.cmd run test:solver
node --test tests/deployment.test.js
npm.cmd test
npm.cmd run test:e2e
git diff --check
```

Expected:

- Python solver tests pass.
- Real Node-to-Python integration passes.
- Deployment contract passes.
- All Node.js tests pass with zero failures.
- All browser closed-loop tests pass.
- `git diff --check` returns no output.

If Docker is installed, also run:

```powershell
docker build -t datacenter-mgr:cp-sat .
```

Expected: image builds successfully. If Docker is unavailable, report the skipped image build separately; do not claim it passed.

- [ ] **Step 9: Commit packaging and verification**

```powershell
git add -- tests/cp-sat-integration.test.js tests/deployment.test.js scripts/run-solver-tests.js Dockerfile .dockerignore package.json README.md .env.example
git commit -m "build: package the CP-SAT runtime"
```

---

## Final Verification Checklist

- [ ] `ortools==9.15.6755` is installed in `.venv`.
- [ ] Python unit tests pass and prove four-candidate, non-overlap, capacity, replica-domain, and deterministic behavior.
- [ ] Real Node-to-Python integration passes.
- [ ] CP-SAT candidates are revalidated by `evaluateActions()`.
- [ ] CP-SAT technical failures record stable fallback codes and preserve Beam planning.
- [ ] CP-SAT `infeasible` proceeds to divider/migration logic without being labeled a technical failure.
- [ ] Every planning result contains safe solver metadata.
- [ ] Plan and audit records persist solver metadata without full payloads or stack traces.
- [ ] UI displays CP-SAT or Beam Search evidence without adding a second confirmation.
- [ ] Candidate output never exceeds 4.
- [ ] Existing unit, API, and browser tests pass.
- [ ] Container build is either verified or explicitly reported as not run.

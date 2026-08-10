import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDemoState } from "../src/demo-state.js";
import { createPlanningEngine } from "../src/planning/planning-engine.js";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("rack backend cleanup removes rack business data and preserves the seed", async () => {
  const { clearRackBackendData } = await import("../scripts/clear-rack-backend-data.js");
  const projectRoot = mkdtempSync(join(tmpdir(), "rack-data-clear-"));
  const dataDirectory = join(projectRoot, "data");
  const runtimeDirectory = join(dataDirectory, "runtime");
  const seedDirectory = join(dataDirectory, "seed");
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(seedDirectory, { recursive: true });

  const state = createDemoState();
  state.version = 7;
  state.plans = [{ id: "PLAN-01" }];
  state.alarms = [{ id: "ALARM-01" }];
  state.diagnoses = [{ id: "DIAGNOSIS-01" }];
  state.changes = [{ id: "CHANGE-01" }];
  state.audit = [{ id: "AUDIT-01" }];
  state.demo_conditions = [{ id: "CONDITION-01" }];
  const legacyCabinets = [{ id: "CAB-01" }];
  writeJson(join(runtimeDirectory, "state.json"), state);
  writeJson(join(seedDirectory, "state.json"), state);
  writeJson(join(dataDirectory, "cabinets.json"), legacyCabinets);
  writeJson(join(dataDirectory, "servers.json"), [{ id: "SRV-01" }]);
  writeJson(join(dataDirectory, "batches.json"), [{ id: "BATCH-01" }]);
  writeJson(join(dataDirectory, "deployments.json"), [{ id: "DEPLOYMENT-01" }]);
  writeJson(join(dataDirectory, "topology.json"), { room: { id: "ROOM-01" } });

  try {
    const result = clearRackBackendData({ projectRoot });
    const cleared = readJson(join(runtimeDirectory, "state.json"));

    assert.equal(result.runtime_state_cleared, true);
    assert.equal(cleared.version, 8);
    for (const field of ["devices", "power_connections", "network_connections"]) {
      assert.deepEqual(cleared[field], []);
    }
    assert.deepEqual(cleared.racks, state.racks);
    for (const field of ["plans", "alarms", "diagnoses", "changes", "audit", "demo_conditions"]) {
      assert.deepEqual(cleared[field], state[field]);
    }
    assert.deepEqual(cleared.room, state.room);
    assert.deepEqual(cleared.power_sources, state.power_sources);
    assert.deepEqual(cleared.topology, state.topology);
    assert.deepEqual(cleared.settings, state.settings);
    assert.deepEqual(cleared.service_health, state.service_health);
    assert.deepEqual(readJson(join(seedDirectory, "state.json")), state);
    assert.deepEqual(readJson(join(dataDirectory, "cabinets.json")), legacyCabinets);
    assert.deepEqual(readJson(join(dataDirectory, "servers.json")), []);
    assert.deepEqual(readJson(join(dataDirectory, "batches.json")), []);
    assert.deepEqual(readJson(join(dataDirectory, "deployments.json")), []);
    assert.deepEqual(readJson(join(dataDirectory, "topology.json")), { room: { id: "ROOM-01" } });

    const recommendation = createPlanningEngine().recommend(cleared, {
      id: "POST-CLEAR-PLACEMENT",
      count: 1,
      u_size: 4,
      rated_power_w: 1_000,
      weight_kg: 20,
      network_ports: 2,
      preferred_rack_ids: [],
    });
    assert.ok(recommendation.candidates.length > 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("rack backend cleanup derives an empty runtime state from seed when runtime is absent", async () => {
  const { clearRackBackendData } = await import("../scripts/clear-rack-backend-data.js");
  const projectRoot = mkdtempSync(join(tmpdir(), "rack-data-clear-"));
  const dataDirectory = join(projectRoot, "data");
  const seedDirectory = join(dataDirectory, "seed");
  mkdirSync(seedDirectory, { recursive: true });
  writeJson(join(seedDirectory, "state.json"), {
    version: 2,
    racks: [{ id: "CAB-01" }],
    devices: [{ id: "SRV-01" }],
  });

  try {
    clearRackBackendData({ projectRoot });
    const cleared = readJson(join(dataDirectory, "runtime", "state.json"));
    assert.equal(cleared.version, 3);
    assert.deepEqual(cleared.racks, [{ id: "CAB-01" }]);
    assert.deepEqual(cleared.devices, []);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("rack backend cleanup repairs racks removed by the previous cleanup behavior", async () => {
  const { clearRackBackendData } = await import("../scripts/clear-rack-backend-data.js");
  const projectRoot = mkdtempSync(join(tmpdir(), "rack-data-clear-"));
  const dataDirectory = join(projectRoot, "data");
  const runtimeDirectory = join(dataDirectory, "runtime");
  const seedDirectory = join(dataDirectory, "seed");
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(seedDirectory, { recursive: true });
  const seed = createDemoState();
  writeJson(join(seedDirectory, "state.json"), seed);
  writeJson(join(runtimeDirectory, "state.json"), { ...seed, version: 9, racks: [], devices: [] });

  try {
    clearRackBackendData({ projectRoot });
    const cleared = readJson(join(runtimeDirectory, "state.json"));
    assert.deepEqual(cleared.racks, seed.racks);
    assert.deepEqual(cleared.devices, []);

    const recommendation = createPlanningEngine().recommend(cleared, {
      id: "RECOVERED-PLACEMENT",
      count: 1,
      u_size: 4,
      rated_power_w: 1_000,
      weight_kg: 20,
      network_ports: 2,
      preferred_rack_ids: [],
    });
    assert.ok(recommendation.candidates.length > 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Windows launcher runs the cleanup script from the project directory", () => {
  const launcher = readFileSync(new URL("../clear-rack-data.cmd", import.meta.url), "utf8");
  assert.match(launcher, /cd \/d "%~dp0"/i);
  assert.match(launcher, /node scripts\\clear-rack-backend-data\.js/i);
});

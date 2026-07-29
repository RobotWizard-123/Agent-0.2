import test from "node:test";
import assert from "node:assert/strict";
import { createBatch, advanceBatch, controlBatch } from "../src/batch-engine.js";
import { loadData } from "../src/data-store.js";

test("batch engine splits servers into batches and completes successful deployments", () => {
  const data = loadData();
  const batch = createBatch(data, {
    name: "two wave deployment",
    batch_size: 1,
    confirm_warnings: true,
    servers: [
      {
        id: "SRV-BATCH-01",
        cabinet_id: "CAB-14",
        layer_id: "CAB-14-L02",
        u_size: 2,
        power_w: 500,
        weight_kg: 10,
        network_ports: 1,
      },
      {
        id: "SRV-BATCH-02",
        cabinet_id: "CAB-15",
        layer_id: "CAB-15-L02",
        u_size: 2,
        power_w: 500,
        weight_kg: 10,
        network_ports: 1,
      },
    ],
  });

  assert.equal(batch.items.length, 2);
  assert.equal(batch.status, "pending");

  advanceBatch(data, batch);
  assert.equal(batch.status, "running");
  assert.equal(batch.items[0].status, "completed");

  advanceBatch(data, batch);
  assert.equal(batch.status, "completed");
  assert.equal(batch.items[1].status, "completed");
});

test("batch engine pauses when warnings are not confirmed", () => {
  const data = loadData();
  const batch = createBatch(data, {
    name: "warning deployment",
    batch_size: 1,
    confirm_warnings: false,
    servers: [
      {
        id: "SRV-BATCH-WARN-01",
        cabinet_id: "CAB-16",
        layer_id: "CAB-16-L02",
        u_size: 4,
        power_w: 8200,
        weight_kg: 50,
        network_ports: 2,
      },
    ],
  });

  advanceBatch(data, batch);
  assert.equal(batch.status, "paused");
  assert.equal(batch.items[0].status, "warning_wait");

  controlBatch(batch, "resume");
  assert.equal(batch.confirm_warnings, true);
  advanceBatch(data, batch);
  assert.equal(batch.status, "completed");
});

test("batch engine fails fast on blockers", () => {
  const data = loadData();
  const batch = createBatch(data, {
    name: "blocked deployment",
    batch_size: 1,
    confirm_warnings: true,
    servers: [
      {
        id: "SRV-BATCH-BLOCK-01",
        cabinet_id: "CAB-09",
        layer_id: "CAB-09-L02",
        u_size: 4,
        power_w: 25000,
        weight_kg: 90,
        network_ports: 2,
      },
    ],
  });

  advanceBatch(data, batch);
  assert.equal(batch.status, "failed");
  assert.ok(batch.items[0].blockers.length > 0);
});

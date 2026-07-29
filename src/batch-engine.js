import { runPrecheck } from "./deploy-agent.js";

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function chunks(items, size) {
  const safeSize = Math.max(1, Number(size) || 1);
  const result = [];
  for (let index = 0; index < items.length; index += safeSize) {
    result.push(items.slice(index, index + safeSize));
  }
  return result;
}

export function createBatch(_data, payload) {
  return {
    id: nextId("BATCH"),
    name: payload.name ?? "deployment batch",
    status: "pending",
    batch_size: Math.max(1, Number(payload.batch_size) || 1),
    confirm_warnings: Boolean(payload.confirm_warnings),
    created_at: new Date().toISOString(),
    items: chunks(payload.servers ?? [], payload.batch_size).map((servers, index) => ({
      id: `ITEM-${index + 1}`,
      index,
      status: "pending",
      servers,
      blockers: [],
      warnings: [],
    })),
  };
}

export function advanceBatch(data, batch) {
  if (["completed", "failed", "cancelled", "paused"].includes(batch.status)) {
    return batch;
  }

  const item = batch.items.find((entry) => entry.status === "pending" || entry.status === "warning_wait");
  if (!item) {
    batch.status = "completed";
    return batch;
  }

  const result = runPrecheck(data, { servers: item.servers });
  item.blockers = result.blockers;
  item.warnings = result.warnings;

  if (result.blockers.length > 0) {
    item.status = "failed";
    batch.status = "failed";
    return batch;
  }

  if (result.warnings.length > 0 && !batch.confirm_warnings) {
    item.status = "warning_wait";
    batch.status = "paused";
    return batch;
  }

  item.status = "completed";
  for (const server of item.servers) {
    data.servers.push({ status: "deployed", ...server });
  }

  batch.status = batch.items.every((entry) => entry.status === "completed") ? "completed" : "running";
  return batch;
}

export function controlBatch(batch, action) {
  if (action === "pause" && batch.status === "running") {
    batch.status = "paused";
  }
  if (action === "resume" && batch.status === "paused") {
    batch.confirm_warnings = true;
    batch.status = "running";
  }
  if (action === "cancel" && !["completed", "failed"].includes(batch.status)) {
    batch.status = "cancelled";
  }
  return batch;
}

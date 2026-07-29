import { createBatch } from "./batch-engine.js";

function buildServer(server, placement, index) {
  const suffix = server.count > 1 ? `-${index + 1}` : "";
  return {
    id: `${server.id || "SRV-ADOPT"}${suffix}`,
    cabinet_id: placement.cabinet_id,
    layer_id: placement.layer_id,
    u_size: Number(server.u_size || 0),
    power_w: Number(server.power_w || 0),
    weight_kg: Number(server.weight_kg || 0),
    network_ports: Number(server.network_ports || 0),
  };
}

export function adoptPlacement(data, payload) {
  const count = Math.max(1, Number(payload.server?.count || 1));
  const servers = Array.from({ length: count }, (_, index) => buildServer(payload.server ?? {}, payload.placement ?? {}, index));
  const batch = createBatch(data, {
    name: payload.name || "adopted recommendation",
    batch_size: payload.batch_size || count,
    confirm_warnings: Boolean(payload.confirm_warnings),
    servers,
  });

  data.batches.push(batch);
  return batch;
}

import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantContextService } from "../src/assistant/context-service.js";
import { createDemoState } from "../src/demo-state.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createTopologyService } from "../src/topology/topology-service.js";

function createService(runtimeStatus = () => ({
  agent_configured: true,
  agent_model: "glm-demo",
  telemetry_status: "not_connected",
})) {
  return createAssistantContextService({
    repository: createMemoryRepository(createDemoState()),
    topologyService: createTopologyService(),
    runtimeStatus,
    now: () => "2026-07-22T00:00:00.000Z",
  });
}

test("assistant context covers the whole site and resolves the selected rack", () => {
  const context = createService().build({
    role: "admin",
    uiContext: { route: "rack", entity_id: "CAB-09", filters: {} },
  });

  assert.equal(context.state_version, 1);
  assert.equal(context.site.room.id, "L5-A2-08");
  assert.equal(context.site.racks.length, 22);
  assert.equal(context.site.devices.length, 100);
  assert.equal(context.ui_context.current_entity.id, "CAB-09");
  assert.ok(context.entity_index.some((item) => item.type === "device" && item.id === "SRV-DEMO-10U"));
  assert.ok(context.site.links["SRV-DEMO-10U"].power.length > 0);
  assert.deepEqual(context.site.runtime, {
    agent_configured: true,
    agent_model: "glm-demo",
    telemetry_status: "not_connected",
  });
});

test("assistant context never exposes secrets or session material", () => {
  const context = createService(() => ({
    agent_configured: true,
    agent_model: "glm-demo",
  })).build({
    role: "viewer",
    uiContext: {
      route: "overview",
      cookie: "dc_session=secret",
      api_key: "secret-key",
      filters: { query: "CAB-09", api_key: "nested-secret" },
    },
  });
  const serialized = JSON.stringify(context);

  assert.equal(serialized.includes("dc_session"), false);
  assert.equal(serialized.includes("secret-key"), false);
  assert.equal(serialized.includes("nested-secret"), false);
  assert.equal(serialized.includes("AGENT_BASE_URL"), false);
  assert.deepEqual(context.ui_context.filters, { query: "CAB-09" });
});

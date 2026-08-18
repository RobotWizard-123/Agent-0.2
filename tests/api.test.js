import test from "node:test";
import assert from "node:assert/strict";
import { withV02Server } from "./helpers.js";

test("compatibility read APIs expose canonical power, network, racks, and devices", async () => {
  await withV02Server(async ({ request }) => {
    const power = await request("/api/topology/power");
    const network = await request("/api/topology/network");
    const cabinets = await request("/api/cabinets");
    const servers = await request("/api/servers");

    assert.equal(power.response.status, 200);
    assert.equal(power.body.room.id, "L5-A2-08");
    assert.deepEqual(power.body.power_sources.map((source) => source.id), ["JG1", "JG2", "KT1"]);
    assert.equal(power.body.redundancy.status, "unverified");
    assert.equal(network.body.access_switches.length, 10);
    assert.equal(cabinets.body.items.length, 22);
    assert.ok(servers.body.items.some((device) => device.id === "SRV-DEMO-10U"));
  });
});

test("config API reports Agent status without exposing key or private base URL", async () => {
  const previous = {
    baseUrl: process.env.AGENT_BASE_URL,
    apiKey: process.env.AGENT_API_KEY,
    model: process.env.AGENT_MODEL,
  };
  process.env.AGENT_BASE_URL = "http://private-model.test";
  process.env.AGENT_API_KEY = "test-secret-value";
  process.env.AGENT_MODEL = "test-model";

  try {
    await withV02Server(async ({ request }) => {
      const status = await request("/api/config/status");
      assert.equal(status.body.agent_configured, true);
      assert.equal(status.body.agent_model, "test-model");
      assert.equal(JSON.stringify(status.body).includes("test-secret-value"), false);
      assert.equal(JSON.stringify(status.body).includes("private-model.test"), false);
    });
  } finally {
    for (const [name, value] of [["AGENT_BASE_URL", previous.baseUrl], ["AGENT_API_KEY", previous.apiKey], ["AGENT_MODEL", previous.model]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("compatibility precheck and recommendation use V0.2 deterministic rules", async () => {
  await withV02Server(async ({ request }) => {
    const precheck = await request("/api/deploy/precheck", {
      method: "POST",
      body: {
        servers: [{
          id: "SRV-API-PRECHECK",
          cabinet_id: "CAB-01",
          layer_id: "CAB-01-L02",
          u_size: 4,
          power_w: 5_600,
          weight_kg: 50,
          network_ports: 2,
        }],
      },
    });
    const recommended = await request("/api/agent/recommend-placement", {
      method: "POST",
      body: { id: "SRV-API-REC", u_size: 4, power_w: 1_800, weight_kg: 32, network_ports: 2, count: 1 },
    });

    assert.equal(precheck.response.status, 200);
    assert.ok(precheck.body.warnings.some((issue) => issue.code === "RACK_POWER_HIGH"));
    assert.equal(recommended.response.status, 200);
    assert.ok(recommended.body.items.length > 0);
    assert.deepEqual(recommended.body.ignored_constraints, []);
  });
});

test("all legacy mutation routes are disabled", async () => {
  await withV02Server(async ({ request }) => {
    for (const [path, method] of [
      ["/api/agent/adopt-placement", "POST"],
      ["/api/deploy/batch", "POST"],
      ["/api/deploy/batches", "GET"],
      ["/api/deploy/batches/OLD/poll", "POST"],
    ]) {
      const result = await request(path, { method, body: method === "POST" ? {} : undefined });
      assert.equal(result.response.status, 410);
      assert.equal(result.body.error, "LEGACY_BATCH_DISABLED");
    }
  });
});

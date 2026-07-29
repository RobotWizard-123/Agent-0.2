import test from "node:test";
import assert from "node:assert/strict";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a late anonymous bootstrap response cannot overwrite a completed login", async () => {
  let resolveBootstrap;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    if (path === "/api/auth/session") {
      return new Promise((resolve) => { resolveBootstrap = resolve; });
    }
    if (path === "/api/auth/login" && options.method === "POST") {
      return json({ authenticated: true, actor: "admin", role: "admin" });
    }
    if (path === "/api/room") return json({ id: "ROOM", state_version: 1 });
    if (path === "/api/racks") return json({ items: [] });
    if (path === "/api/alarms") return json({ items: [] });
    if (path === "/api/topology/power") return json({ nodes: [] });
    if (path === "/api/topology/network") return json({ core: null, access_switches: [] });
    if (path === "/api/config/status") return json({ agent_configured: false });
    if (path === "/api/settings/placement-strategy") return json({ default_strategy_id: "balanced_optimal", state_version: 1 });
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    const state = await import(`../public/js/state.js?bootstrap-race=${Date.now()}`);
    const bootstrapping = state.bootstrap();
    await state.login("admin", "demo-admin-pass");
    resolveBootstrap(json({ authenticated: false, actor: null, role: null }));
    await bootstrapping;
    assert.deepEqual(state.getState().session, { authenticated: true, actor: "admin", role: "admin" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

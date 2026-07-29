import test from "node:test";
import assert from "node:assert/strict";
import { withAuthenticatedServer } from "./helpers.js";
import { getAuthConfig } from "../src/config.js";

test("authentication config stays server-side and enables secure proxy cookies", () => {
  assert.deepEqual(getAuthConfig({
    SESSION_SECRET: " secret ",
    APP_ADMIN_PASSWORD: "admin-pass",
    APP_VIEWER_PASSWORD: "viewer-pass",
    TRUST_PROXY_HTTPS: "true",
  }), {
    sessionSecret: "secret",
    adminPassword: "admin-pass",
    viewerPassword: "viewer-pass",
    secureCookies: true,
  });
});

test("anonymous API requests are rejected while session status remains public", async () => {
  await withAuthenticatedServer(async ({ request }) => {
    assert.equal((await request("/api/auth/session")).response.status, 200);
    assert.equal((await request("/api/racks")).response.status, 401);
  });
});

test("viewer can query but cannot create plans or trigger demo alarms", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    const session = await login("viewer", "viewer-pass");
    assert.equal(session.response.status, 200);
    assert.equal((await request("/api/racks", { cookie: session.cookie })).response.status, 200);
    assert.equal((await request("/api/plans", {
      method: "POST",
      cookie: session.cookie,
      body: { kind: "placement", device: { id: "AUTH-DEMO", u_size: 2, rated_power_w: 100 } },
    })).response.status, 403);
    assert.equal((await request("/api/demo/alarms", {
      method: "POST",
      cookie: session.cookie,
      body: { scenario: "power_high" },
    })).response.status, 403);
  });
});

test("administrator can trigger a demo alarm", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    const session = await login("admin", "admin-pass");
    const result = await request("/api/demo/alarms", {
      method: "POST",
      cookie: session.cookie,
      body: { scenario: "collector_offline" },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.trigger_code, "COLLECTOR_OFFLINE");
  });
});

test("login response never exposes credentials and issues a hardened cookie", async () => {
  await withAuthenticatedServer(async ({ login }) => {
    const result = await login("admin", "admin-pass");
    const serialized = JSON.stringify(result.body);
    assert.equal(serialized.includes("admin-pass"), false);
    assert.equal(serialized.includes("unit-test-session-secret"), false);
    assert.match(result.cookie, /^dc_session=/);
    assert.match(result.cookie, /HttpOnly/i);
    assert.match(result.cookie, /SameSite=Strict/i);
    assert.match(result.cookie, /Max-Age=43200/i);
  });
});

test("invalid credentials and cross-origin mutations are rejected", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    assert.equal((await login("admin", "wrong-password")).response.status, 401);
    const session = await login("admin", "admin-pass");
    const result = await request("/api/demo/reset", {
      method: "POST",
      cookie: session.cookie,
      headers: { origin: "https://attacker.example" },
      body: {},
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, "ORIGIN_MISMATCH");
  });
});

test("logout invalidates the signed session", async () => {
  await withAuthenticatedServer(async ({ login, request }) => {
    const session = await login("viewer", "viewer-pass");
    const logout = await request("/api/auth/logout", {
      method: "POST",
      cookie: session.cookie,
      body: {},
    });
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    assert.equal((await request("/api/racks", { cookie: session.cookie })).response.status, 401);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantClient } from "../public/js/assistant-client.js";

test("assistant client polls every thirty seconds and advances its cursor", async () => {
  let scheduled;
  const calls = [];
  const client = createAssistantClient({
    getImpl: async (path) => {
      calls.push(path);
      return path.startsWith("/api/assistant/feedback")
        ? {
            events: [{ id: "E1", message: "risk" }],
            next_cursor: 1,
            state_version: 2,
            synced_at: "now",
          }
        : { messages: [], feedback: [], next_cursor: 0 };
    },
    postImpl: async () => ({}),
    getUiContext: () => ({ route: "overview", entity_id: null, filters: {} }),
    setIntervalImpl: (callback, delay) => {
      scheduled = { callback, delay };
      return 1;
    },
    clearIntervalImpl: () => {},
  });

  await client.setSession({ authenticated: true, role: "admin" });
  assert.equal(scheduled.delay, 30_000);
  await scheduled.callback();

  assert.equal(client.snapshot().cursor, 1);
  assert.equal(client.snapshot().unread, 1);
  assert.equal(client.snapshot().sync_status, "ready");
  // The poll issues a feedback call first, then a follow-up agent-status
  // probe so the assistant panel's model_status reflects real connectivity.
  const feedbackCall = calls.find((path) => path.startsWith("/api/assistant/feedback"));
  assert.ok(feedbackCall, "expected at least one /api/assistant/feedback call");
  assert.match(feedbackCall, /route=overview/);
  assert.ok(calls.some((path) => path.startsWith("/api/agent/status")), "expected an agent status probe after the feedback poll");
});

test("assistant client sends current UI context and adopts but never confirms a plan", async () => {
  const posts = [];
  let adopted = null;
  const client = createAssistantClient({
    getImpl: async () => ({ messages: [], feedback: [], next_cursor: 0 }),
    postImpl: async (path, body) => {
      posts.push({ path, body });
      return path.endsWith("/plans")
        ? { id: "PLAN-1", status: "awaiting_confirmation" }
        : {
            answer: "ok",
            evidence: [],
            proposal: { id: "P1", type: "placement" },
            model_status: "available",
            state_version: 4,
          };
    },
    getUiContext: () => ({ route: "rack", entity_id: "CAB-09", filters: {} }),
    onPlanCreated: (plan) => { adopted = plan; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  await client.setSession({ authenticated: true, role: "admin" });
  await client.send("容量如何");
  await client.acceptProposal("P1");

  assert.equal(posts[0].body.ui_context.entity_id, "CAB-09");
  assert.equal(adopted.status, "awaiting_confirmation");
  assert.equal(posts.some((item) => item.path.includes("/confirm")), false);
});

test("opening clears unread feedback and logout clears all assistant state", async () => {
  let scheduled;
  let stopped = 0;
  const client = createAssistantClient({
    getImpl: async (path) => path.startsWith("/api/assistant/feedback")
      ? { events: [{ id: "E1", message: "risk" }], next_cursor: 1, state_version: 2, synced_at: "now" }
      : { messages: [{ role: "assistant", content: "old" }], feedback: [], next_cursor: 0 },
    postImpl: async () => ({}),
    getUiContext: () => ({ route: "overview", entity_id: null, filters: {} }),
    setIntervalImpl: (callback) => { scheduled = callback; return 7; },
    clearIntervalImpl: () => { stopped += 1; },
  });

  await client.setSession({ authenticated: true, role: "viewer" });
  await scheduled();
  assert.equal(client.snapshot().unread, 1);
  client.setOpen(true);
  assert.equal(client.snapshot().unread, 0);

  await client.setSession({ authenticated: false, role: null });
  assert.equal(client.snapshot().messages.length, 0);
  assert.equal(client.snapshot().feedback.length, 0);
  assert.equal(client.snapshot().authenticated, false);
  assert.equal(stopped, 1);
});

test("polling failures degrade sync without breaking the session", async () => {
  let calls = 0;
  const client = createAssistantClient({
    getImpl: async () => {
      calls += 1;
      if (calls === 1) return { messages: [], feedback: [], next_cursor: 0 };
      throw Object.assign(new Error("offline"), { code: "REQUEST_FAILED" });
    },
    postImpl: async () => ({}),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  await client.setSession({ authenticated: true, role: "admin" });
  await client.poll();

  assert.equal(client.snapshot().sync_status, "interrupted");
  assert.equal(client.snapshot().authenticated, true);
});

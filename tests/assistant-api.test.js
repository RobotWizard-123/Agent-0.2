import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantSessionStore } from "../src/assistant/session-store.js";
import { withAuthenticatedServer } from "./helpers.js";

function fakeAssistantGateway() {
  return {
    async answerAssistant({ message }) {
      return message.includes("SRV-CHAT")
        ? {
            answer: "可以生成受约束方案",
            evidence: [{ type: "rack", id: "CAB-09" }],
            intent: { type: "propose_placement" },
          }
        : {
            answer: "CAB-09 容量可查询",
            evidence: [{ type: "rack", id: "CAB-09" }],
            intent: { type: "answer" },
          };
    },
    async extractRequest() {
      return {
        id: "SRV-CHAT",
        count: 1,
        u_size: 4,
        rated_power_w: 1_200,
        real_power_w: null,
        weight_kg: 30,
        network_ports: 2,
        preferred_rack_ids: ["CAB-09"],
      };
    },
    async adjustPlan(context) {
      const candidate = context.candidates[0];
      return {
        candidate_id: candidate?.id ?? null,
        reason: "保持规则引擎首选方案",
        actions: candidate?.actions ?? [],
      };
    },
  };
}

function sessionIdFromCookie(cookie) {
  const token = /dc_session=([^;]+)/.exec(cookie)?.[1] ?? "";
  return token.slice(0, token.lastIndexOf("."));
}

test("admin chats, polls feedback, and converts a proposal into an unconfirmed plan", async () => {
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("admin", "admin-pass");
    const chat = await request("/api/assistant/messages", {
      method: "POST",
      cookie: signedIn.cookie,
      body: {
        message: "上架 SRV-CHAT 4U 1200W 30kg 2端口到 CAB-09",
        ui_context: { route: "rack", entity_id: "CAB-09", filters: {} },
      },
    });

    assert.equal(chat.response.status, 200);
    assert.equal(chat.body.proposal.type, "placement");

    const created = await request(
      `/api/assistant/proposals/${chat.body.proposal.id}/plans`,
      { method: "POST", cookie: signedIn.cookie, body: {} },
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, "awaiting_confirmation");
    assert.equal(created.body.confirmation_count, 0);

    const repeated = await request(
      `/api/assistant/proposals/${chat.body.proposal.id}/plans`,
      { method: "POST", cookie: signedIn.cookie, body: {} },
    );
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.error, "ASSISTANT_PROPOSAL_USED");

    const feedback = await request(
      "/api/assistant/feedback?cursor=0&route=rack&entity_id=CAB-09",
      { cookie: signedIn.cookie },
    );
    assert.equal(feedback.response.status, 200);
    assert.ok(Number.isInteger(feedback.body.next_cursor));
  }, { agentGateway: fakeAssistantGateway() });
});

test("viewer can chat but cannot convert proposals", async () => {
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("viewer", "viewer-pass");
    const chat = await request("/api/assistant/messages", {
      method: "POST",
      cookie: signedIn.cookie,
      body: { message: "CAB-09 容量", ui_context: {} },
    });
    assert.equal(chat.response.status, 200);
    assert.equal(chat.body.proposal, null);

    const forbidden = await request("/api/assistant/proposals/P1/plans", {
      method: "POST",
      cookie: signedIn.cookie,
      body: {},
    });
    assert.equal(forbidden.response.status, 403);
  }, { agentGateway: fakeAssistantGateway() });
});

test("logout clears assistant messages from the server session store", async () => {
  const assistantSessionStore = createAssistantSessionStore();
  await withAuthenticatedServer(async ({ request, login }) => {
    const signedIn = await login("admin", "admin-pass");
    const sessionId = sessionIdFromCookie(signedIn.cookie);
    await request("/api/assistant/messages", {
      method: "POST",
      cookie: signedIn.cookie,
      body: { message: "全站状态", ui_context: {} },
    });
    assert.equal(assistantSessionStore.session(sessionId).messages.length, 2);

    await request("/api/auth/logout", {
      method: "POST",
      cookie: signedIn.cookie,
      body: {},
    });
    assert.equal(assistantSessionStore.session(sessionId).messages.length, 0);
  }, { assistantSessionStore });
});

test("assistant rejects anonymous access and cross-origin chat mutations", async () => {
  await withAuthenticatedServer(async ({ request, login, baseUrl }) => {
    const anonymous = await request("/api/assistant/session");
    assert.equal(anonymous.response.status, 401);

    const signedIn = await login("admin", "admin-pass");
    const crossOrigin = await request("/api/assistant/messages", {
      method: "POST",
      cookie: signedIn.cookie,
      headers: { origin: "http://attacker.test" },
      body: { message: "全站状态", ui_context: {} },
    });
    assert.notEqual(baseUrl, "http://attacker.test");
    assert.equal(crossOrigin.response.status, 403);
    assert.equal(crossOrigin.body.error, "ORIGIN_MISMATCH");
  });
});

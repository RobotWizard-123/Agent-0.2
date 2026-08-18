import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantSessionStore } from "../src/assistant/session-store.js";

test("session keeps only twenty user-assistant turns", () => {
  const store = createAssistantSessionStore();
  for (let index = 0; index < 21; index += 1) {
    store.appendTurn("S1", { content: `u${index}` }, { content: `a${index}` });
  }

  const session = store.session("S1");
  assert.equal(session.messages.length, 40);
  assert.equal(session.messages[0].content, "u1");
  assert.equal(session.messages[0].role, "user");
  assert.equal(session.messages.at(-1).role, "assistant");
});

test("feedback cursor returns each event once and clear removes the session", () => {
  const store = createAssistantSessionStore();
  const snapshot = { state_version: 2, signals: {} };
  store.syncFeedback("S1", snapshot, [{ id: "E1", message: "risk" }]);
  const first = store.feedback("S1", 0);
  const second = store.feedback("S1", first.next_cursor);

  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].cursor, 1);
  assert.equal(second.events.length, 0);
  assert.deepEqual(store.feedbackSnapshot("S1"), snapshot);

  store.clear("S1");
  assert.equal(store.session("S1").messages.length, 0);
  assert.equal(store.feedback("S1", 0).events.length, 0);
});

test("session rejects concurrent and eleventh requests in one minute", () => {
  let clock = 1_000;
  const store = createAssistantSessionStore({ now: () => clock });

  store.beginRequest("S1");
  assert.throws(
    () => store.beginRequest("S1"),
    (error) => error.code === "ASSISTANT_BUSY",
  );
  store.endRequest("S1");

  for (let index = 1; index < 10; index += 1) {
    store.beginRequest("S1");
    store.endRequest("S1");
  }
  assert.throws(
    () => store.beginRequest("S1"),
    (error) => error.code === "ASSISTANT_RATE_LIMITED" && error.retry_after_ms > 0,
  );

  clock += 60_001;
  assert.doesNotThrow(() => store.beginRequest("S1"));
});

test("proposal can be read but only marked used once", () => {
  const store = createAssistantSessionStore();
  store.saveProposal("S1", { id: "PROPOSAL-1", type: "placement", used: false });

  assert.equal(store.getProposal("S1", "PROPOSAL-1").type, "placement");
  assert.equal(store.markProposalUsed("S1", "PROPOSAL-1").used, true);
  assert.throws(
    () => store.getProposal("S1", "PROPOSAL-1"),
    (error) => error.code === "ASSISTANT_PROPOSAL_USED",
  );
  assert.throws(
    () => store.markProposalUsed("S1", "PROPOSAL-1"),
    (error) => error.code === "ASSISTANT_PROPOSAL_USED",
  );
  assert.throws(
    () => store.getProposal("S1", "PROPOSAL-MISSING"),
    (error) => error.code === "ASSISTANT_PROPOSAL_NOT_FOUND",
  );
});

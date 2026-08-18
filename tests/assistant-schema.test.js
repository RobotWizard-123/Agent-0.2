import test from "node:test";
import assert from "node:assert/strict";
import { validateAssistantResponse } from "../src/assistant/assistant-schema.js";

test("assistant accepts cited answers and placement intents", () => {
  const result = validateAssistantResponse({
    answer: "CAB-09 当前仍需经过容量复核。",
    evidence: [{ type: "rack", id: "CAB-09" }],
    intent: { type: "propose_placement" },
  }, {
    entityIds: new Set(["CAB-09"]),
    entityTypes: new Map([["CAB-09", "rack"]]),
  });

  assert.equal(result.intent.type, "propose_placement");
  assert.deepEqual(result.evidence, [{ type: "rack", id: "CAB-09" }]);
});

test("assistant accepts navigation and remediation only for known entities", () => {
  const navigation = validateAssistantResponse({
    answer: "打开告警。",
    evidence: [{ type: "alarm", id: "ALARM-1" }],
    intent: { type: "navigate", target: { type: "alarm", id: "ALARM-1" } },
  }, {
    entityIds: new Set(["ALARM-1"]),
    entityTypes: new Map([["ALARM-1", "alarm"]]),
  });
  const remediation = validateAssistantResponse({
    answer: "可以生成处置方案。",
    evidence: [{ type: "alarm", id: "ALARM-1" }],
    intent: { type: "propose_remediation", alarm_id: "ALARM-1" },
  }, {
    entityIds: new Set(["ALARM-1"]),
    entityTypes: new Map([["ALARM-1", "alarm"]]),
  });

  assert.equal(navigation.intent.target.id, "ALARM-1");
  assert.equal(remediation.intent.alarm_id, "ALARM-1");
});

test("assistant rejects invented evidence, mismatched types, and unsupported actions", () => {
  const entities = {
    entityIds: new Set(["CAB-09"]),
    entityTypes: new Map([["CAB-09", "rack"]]),
  };
  assert.throws(
    () => validateAssistantResponse({
      answer: "x",
      evidence: [{ type: "rack", id: "CAB-99" }],
      intent: { type: "answer" },
    }, entities),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
  assert.throws(
    () => validateAssistantResponse({
      answer: "x",
      evidence: [{ type: "device", id: "CAB-09" }],
      intent: { type: "answer" },
    }, entities),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
  assert.throws(
    () => validateAssistantResponse({
      answer: "x",
      evidence: [],
      intent: { type: "execute_plan", plan_id: "P1" },
    }, entities),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
});

test("assistant requires non-empty bounded plain text", () => {
  assert.throws(
    () => validateAssistantResponse({ answer: " ", evidence: [], intent: { type: "answer" } }),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
  assert.throws(
    () => validateAssistantResponse({ answer: "x".repeat(4_001), evidence: [], intent: { type: "answer" } }),
    (error) => error.code === "AGENT_RESPONSE_INVALID",
  );
});

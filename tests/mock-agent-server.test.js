import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockCompletion } from "../scripts/mock-agent-server.js";
import { sanitizeEnvironment, withEnvironmentOverrides } from "../scripts/start-e2e-stack.js";
import { parseEnv } from "../scripts/start-acceptance-stack.js";

function completion(messages) {
  return JSON.parse(createMockCompletion({ messages }).choices[0].message.content);
}

test("mock model answers rack questions with typed evidence", () => {
  const payload = completion([{
    role: "user",
    content: JSON.stringify({
      message: "CAB-09 的容量如何？",
      context: { entity_index: [{ type: "rack", id: "CAB-09" }] },
    }),
  }]);

  assert.match(payload.answer, /CAB-09/);
  assert.deepEqual(payload.evidence, [{ type: "rack", id: "CAB-09" }]);
  assert.deepEqual(payload.intent, { type: "answer" });
});

test("mock model identifies itself without inventing a rack answer", () => {
  const payload = completion([{
    role: "user",
    content: JSON.stringify({
      message: "你是什么模型？",
      context: { entity_index: [{ type: "rack", id: "CAB-01" }] },
    }),
  }]);

  assert.match(payload.answer, /e2e-agent-model/);
  assert.match(payload.answer, /本地.*验收/);
  assert.deepEqual(payload.evidence, []);
});

test("mock model proposes placement then extracts immutable device facts", () => {
  const proposal = completion([{
    role: "user",
    content: JSON.stringify({
      message: "上架 SRV-ASSIST-E2E，4U、1200W、30kg、2端口到 CAB-09",
      context: { entity_index: [{ type: "rack", id: "CAB-09" }] },
    }),
  }]);
  const device = completion([{
    role: "user",
    content: "上架 SRV-ASSIST-E2E，4U、1200W、30kg、2端口到 CAB-09",
  }]);

  assert.deepEqual(proposal.intent, { type: "propose_placement" });
  assert.equal(device.id, "SRV-ASSIST-E2E");
  assert.equal(device.real_power_w, undefined);
  assert.deepEqual(device.preferred_rack_ids, ["CAB-09"]);
});

test("mock model chooses only an existing planning candidate", () => {
  const payload = completion([{
    role: "user",
    content: JSON.stringify({
      request: { id: "SRV-ASSIST-E2E" },
      candidates: [{ id: "CANDIDATE-1", actions: [{ type: "place_device" }] }],
    }),
  }]);

  assert.equal(payload.candidate_id, "CANDIDATE-1");
  assert.deepEqual(payload.weight_multipliers, {});
  assert.deepEqual(payload.alternatives, []);
});

test("E2E runner wires the app to the local mock without real credentials", () => {
  const runner = readFileSync("scripts/run-e2e.js", "utf8");
  assert.match(runner, /mock-agent-server\.js/);
  assert.match(runner, /AGENT_BASE_URL:\s*"http:\/\/127\.0\.0\.1:3200"/);
  assert.match(runner, /AGENT_API_KEY:\s*"e2e-only-agent-key"/);
  assert.match(runner, /finally[\s\S]*mockAgent/);
});

test("manual E2E launcher removes case-insensitive environment duplicates", () => {
  const clean = sanitizeEnvironment({ PATH: "primary", Path: "duplicate", TEMP: "tmp" });
  assert.equal(clean.PATH, "primary");
  assert.equal(clean.Path, undefined);
  assert.equal(clean.TEMP, "tmp");
});

test("E2E environment overrides case-insensitive inherited values", () => {
  const clean = withEnvironmentOverrides(
    { app_admin_password: "stale", PATH: "primary", Path: "duplicate" },
    { APP_ADMIN_PASSWORD: "e2e", PORT: "3100" },
  );
  assert.equal(clean.APP_ADMIN_PASSWORD, "e2e");
  assert.equal(clean.app_admin_password, undefined);
  assert.equal(clean.PATH, "primary");
  assert.equal(clean.Path, undefined);
});

test("acceptance launcher reads local Agent config without logging values", () => {
  assert.deepEqual(parseEnv([
    "AGENT_BASE_URL=http://example.invalid",
    "AGENT_API_KEY=local-only",
    "AGENT_MODEL=demo-model",
    "# ignored",
  ].join("\n")), {
    AGENT_BASE_URL: "http://example.invalid",
    AGENT_API_KEY: "local-only",
    AGENT_MODEL: "demo-model",
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("browser shell exposes the complete management navigation and overlay roots", () => {
  const html = read("public/index.html");
  for (const view of ["overview", "agent", "topology", "alarms", "audit"]) {
    assert.match(html, new RegExp(`data-view=["']${view}["']`));
  }
  assert.match(html, /id="login-panel"/);
  assert.match(html, /id="dialog-root"/);
  assert.match(html, /id="toast-root"/);
  assert.match(html, /id="assistant-root"/);
});

test("frontend is split into safe API, state, component, overview, and rack modules", () => {
  for (const path of [
    "public/js/api.js",
    "public/js/state.js",
    "public/js/components.js",
    "public/js/views/overview.js",
    "public/js/views/rack-detail.js",
  ]) assert.equal(existsSync(path), true, `${path} should exist`);

  assert.match(read("public/js/api.js"), /class ApiError/);
  assert.match(read("public/js/state.js"), /export function setRoute/);
  assert.match(read("public/js/views/overview.js"), /data-rack-id/);
  assert.match(read("public/js/views/rack-detail.js"), /reserve_start_u/);
});

test("overview exposes interactive capacity risk and weak-current routing", () => {
  const state = read("public/js/state.js");
  const overview = read("public/js/views/overview.js");

  assert.match(state, /topologyNetwork/);
  assert.match(overview, /rackRisk/);
  assert.match(overview, /network-route-map/);
  assert.match(overview, /弱电路由视图/);
  assert.match(overview, /setRoute\("topology"/);
});

test("audit expands details locally and topology nodes query without route jumps", () => {
  const audit = read("public/js/views/audit.js");
  const topology = read("public/js/views/topology.js");

  assert.match(audit, /h\("details"/);
  assert.match(audit, /audit-entry-details/);
  assert.doesNotMatch(audit, /navigateEntry|setRoute/);
  assert.match(topology, /loadTopology\(id\)/);
  assert.match(topology, /topology-quick-query/);
  assert.doesNotMatch(topology, /setRoute/);
});

test("rack detail exposes a confirmed server-removal workflow", () => {
  const rack = read("public/js/views/rack-detail.js");
  const plan = read("public/js/views/placement-plan.js");
  assert.match(rack, /createRemovalPlan/);
  assert.match(rack, /生成取出方案/);
  assert.match(plan, /remove_device/);
  assert.match(plan, /取出并验证成功/);
});

test("rack detail renders fixed devices, physical holes, and reserved intervals", () => {
  const rack = read("public/js/views/rack-detail.js");
  assert.match(rack, /data-start-u/);
  assert.match(rack, /free_intervals/);
  assert.match(rack, /reserve_start_u/);
  assert.doesNotMatch(rack, /\.innerHTML/);
});

test("frontend source contains no legacy mojibake and avoids raw server-data HTML", () => {
  const files = [
    "public/index.html",
    "public/js/app.js",
    "public/js/components.js",
    "public/js/views/overview.js",
    "public/js/views/rack-detail.js",
  ].filter(existsSync).map(read).join("\n");
  assert.doesNotMatch(files, /鏈烘埧|鎬昏|璀︾ず|閮ㄧ讲|鍔熻€?/);
  assert.doesNotMatch(files, /\.innerHTML\s*=/);
});

test("visual system defines the single-line-diagram palette and responsive focus states", () => {
  for (const path of [
    "public/css/tokens.css",
    "public/css/layout.css",
    "public/css/components.css",
    "public/css/views.css",
  ]) assert.equal(existsSync(path), true, `${path} should exist`);

  const css = ["tokens", "layout", "components", "views"].map((name) => read(`public/css/${name}.css`)).join("\n");
  assert.match(css, /--busbar-copper/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
});

test("interactive views expose every closed-loop action", () => {
  const viewFiles = ["agent-console", "placement-plan", "topology", "alarms", "audit"];
  for (const name of viewFiles) assert.equal(existsSync(`public/js/views/${name}.js`), true, `${name}.js should exist`);
  const files = viewFiles.map((name) => read(`public/js/views/${name}.js`)).join("\n");
  for (const action of [
    "createPlan",
    "confirmPlan",
    "loadTopology",
    "triggerDemoAlarm",
    "diagnoseAlarm",
    "createRemediation",
    "resetDemoState",
  ]) assert.match(files, new RegExp(action));
  assert.doesNotMatch(files, /forceResolve|force_resolve|强制恢复/);
});

test("state and application register planning, topology, alarms, and audit views", () => {
  const state = read("public/js/state.js");
  const app = read("public/js/app.js");
  for (const name of ["renderAgentConsole", "renderTopology", "renderAlarms", "renderAudit"]) assert.match(app, new RegExp(name));
  assert.match(state, /export async function createPlan/);
  assert.match(state, /export async function confirmPlan/);
  assert.match(state, /export async function resetDemoState/);
});

test("placement planning compares strategies, Agent scores, and migration impact", () => {
  assert.equal(existsSync("public/js/views/placement-plan.js"), true);
  const state = read("public/js/state.js");
  const consoleView = read("public/js/views/agent-console.js");
  const planView = read("public/js/views/placement-plan.js");
  assert.match(consoleView, /name:\s*["']strategy_id["']/);
  assert.match(state, /updatePlacementDefault/);
  for (const field of ["baseline_score", "agent_score", "score_breakdown", "maintenance_window", "rollback_actions", "snapshot_version"]) {
    assert.match(planView, new RegExp(field));
  }
  assert.doesNotMatch(planView, /\.innerHTML/);
});

test("floating assistant is safely mounted with responsive control-room styling", () => {
  assert.equal(existsSync("public/js/assistant-panel.js"), true);
  assert.equal(existsSync("public/css/assistant.css"), true);
  const index = read("public/index.html");
  const app = read("public/js/app.js");
  const style = read("public/css/style.css");
  const panel = read("public/js/assistant-panel.js");
  const css = read("public/css/assistant.css");

  assert.match(index, /id="assistant-root"/);
  assert.match(app, /createAssistantClient/);
  assert.match(app, /mountAssistantPanel/);
  assert.match(style, /assistant\.css/);
  assert.match(panel, /AI 助手/);
  assert.match(panel, /生成待确认方案/);
  assert.match(panel, /draft\s*=\s*prompt\.value/);
  assert.match(panel, /textarea\.value\s*=\s*draft/);
  assert.doesNotMatch(panel, /innerHTML/);
  assert.match(css, /\.assistant-launcher/);
  assert.match(css, /width:\s*min\(420px/);
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
});

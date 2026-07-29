import { clear, emptyState, h, loadingState, statusBadge } from "./components.js";
import { createAssistantClient } from "./assistant-client.js";
import { mountAssistantPanel } from "./assistant-panel.js";
import {
  adoptAssistantPlan,
  bootstrap,
  getAssistantUiContext,
  getState,
  loadAudit,
  loadRack,
  loadTopology,
  login,
  logout,
  refreshAgentStatus,
  selectAlarm,
  setRoute,
  subscribe,
} from "./state.js";
import { renderOverview } from "./views/overview.js";
import { renderRackDetail } from "./views/rack-detail.js";
import { renderAgentConsole } from "./views/agent-console.js";
import { renderTopology } from "./views/topology.js";
import { renderAlarms } from "./views/alarms.js";
import { renderAudit } from "./views/audit.js";

const app = document.querySelector("#app");
const title = document.querySelector("#view-title");
const statusStrip = document.querySelector("#status-strip");
const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const sessionSummary = document.querySelector("#session-summary");
const logoutButton = document.querySelector("#logout-button");
const assistantRoot = document.querySelector("#assistant-root");

const titles = {
  overview: "机房总览",
  rack: "机柜与服务器",
  agent: "上架 Agent",
  topology: "链路查询",
  alarms: "报警诊断",
  audit: "变更审计",
};

let requestedRackId = null;
let requestedTopology = false;
let auditLoaded = false;
let assistantSessionKey = null;

const assistantClient = createAssistantClient({
  getUiContext: getAssistantUiContext,
  onPlanCreated: adoptAssistantPlan,
});

mountAssistantPanel(assistantRoot, {
  client: assistantClient,
  onNavigate(reference) {
    if (reference.type === "rack") setRoute("rack", reference.id);
    else if (reference.type === "device") setRoute("topology", reference.id);
    else if (reference.type === "alarm") setRoute("alarms", reference.id);
    else if (reference.type === "plan") setRoute("agent", reference.id);
    else setRoute("audit", reference.id);
    assistantClient.setOpen(false);
  },
});

function topLevelRoute(route) {
  return route.name === "rack" ? "overview" : route.name;
}

function renderStatus(state) {
  clear(statusStrip,
    statusBadge(`状态版本 ${state.room?.state_version ?? "—"}`, "neutral"),
    statusBadge(`报警 ${state.alarms.filter((alarm) => alarm.status !== "resolved").length}`, state.alarms.some((alarm) => alarm.status !== "resolved") ? "warning" : "ok"),
    agentStatusBadge(state),
  );
}

// Renders the truthful agent connectivity badge. Source of truth is
// state.agentStatus which is populated from /api/agent/status (real probe,
// not just config presence).
function agentStatusBadge(state) {
  const agentStatus = state.agentStatus;
  const configured = state.config?.agent_configured;
  if (!agentStatus) {
    return configured
      ? statusBadge(`Agent 探活中… (${state.config.agent_model})`, "neutral")
      : statusBadge("Agent 未配置 · 规则降级", "warning");
  }
  const status = agentStatus.status;
  const model = agentStatus.model ?? state.config?.agent_model ?? null;
  if (status === "available") {
    return h("span", {
      className: "status-badge tone-ok",
      title: `模型 ${model} 真实接入，探活耗时 ${agentStatus.probe_ms ?? "?"}ms`,
      text: model ? `Agent ${model} · 在线` : "Agent 在线",
    });
  }
  if (status === "degraded") {
    const reason = agentStatus.error_code ? `（${agentStatus.error_code}）` : "";
    return h("span", {
      className: "status-badge tone-warning",
      title: `${model ?? "Agent"} 不可达：${agentStatus.error_message ?? "未知原因"}。系统已自动降级到规则引擎。`,
      text: model ? `Agent ${model} · 不可达 ${reason}` : "Agent 不可达 · 规则降级",
    });
  }
  if (status === "unconfigured") {
    return statusBadge("Agent 未配置 · 规则降级", "warning");
  }
  // probing / unknown
  return statusBadge("Agent 探活中…", "neutral");
}

function render() {
  const state = getState();
  const nextAssistantSessionKey = `${state.session.authenticated}:${state.session.actor ?? ""}:${state.session.role ?? ""}`;
  if (nextAssistantSessionKey !== assistantSessionKey) {
    assistantSessionKey = nextAssistantSessionKey;
    void assistantClient.setSession(state.session);
  }
  loginPanel.classList.toggle("is-hidden", state.session.authenticated);
  document.querySelector("#app-shell").classList.toggle("is-locked", !state.session.authenticated);
  logoutButton.hidden = !state.session.authenticated;
  clear(sessionSummary, state.session.authenticated ? h("div", {}, [
    h("strong", { text: state.session.actor }),
    h("span", { text: state.session.role === "admin" ? "管理员 · 可执行" : "只读查看者" }),
  ]) : h("span", { text: "尚未登录" }));

  if (!state.session.authenticated) return;
  title.textContent = titles[state.route.name] ?? "机房智能管理";
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === topLevelRoute(state.route)));
  renderStatus(state);

  if (state.loading) {
    clear(app, loadingState());
    return;
  }
  if (state.error) {
    clear(app, emptyState("数据读取失败", `${state.error.code ?? "REQUEST_FAILED"} · ${state.error.message}`));
    return;
  }
  if (state.route.name === "overview") renderOverview(app, state);
  else if (state.route.name === "rack") {
    if (state.selectedRack?.id === state.route.id) renderRackDetail(app, state);
    else if (requestedRackId !== state.route.id) {
      requestedRackId = state.route.id;
      clear(app, loadingState(`正在读取 ${state.route.id} 机柜`));
      loadRack(state.route.id).finally(() => { requestedRackId = null; });
    }
  } else if (state.route.name === "agent") renderAgentConsole(app, state);
  else if (state.route.name === "topology") {
    renderTopology(app, state);
    const desiredQuery = state.route.id || "SRV-DEMO-10U";
    if ((!state.topologyResult || state.route.id && state.topologyResult.query !== state.route.id) && !requestedTopology) {
      requestedTopology = true;
      loadTopology(desiredQuery).finally(() => { requestedTopology = false; });
    }
  } else if (state.route.name === "alarms") {
    if (state.route.id && state.selectedAlarm?.id !== state.route.id && state.alarms.some((alarm) => alarm.id === state.route.id)) {
      selectAlarm(state.route.id);
      return;
    }
    renderAlarms(app, state);
  } else if (state.route.name === "audit") {
    renderAudit(app, state);
    if (!auditLoaded) {
      auditLoaded = true;
      loadAudit().catch(() => { auditLoaded = false; });
    }
  } else clear(app, emptyState("未知界面", "请从左侧导航选择功能。"));
}

document.querySelector(".primary-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) setRoute(button.dataset.view);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const data = new FormData(loginForm);
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "正在登录…";
  try {
    await login(data.get("username"), data.get("password"));
    loginForm.reset();
  } catch (error) {
    loginError.textContent = error.status === 401 ? "用户名或密码错误" : `${error.code ?? "LOGIN_FAILED"} · ${error.message}`;
  } finally {
    submit.disabled = false;
    submit.textContent = "登录控制台";
  }
});

logoutButton.addEventListener("click", () => logout().catch(() => {}));
subscribe(render);
bootstrap().then(render);

// Periodically probe the agent so the top-bar badge reflects real
// connectivity (not just config presence). Cache on the server keeps the
// load low (10s TTL), so polling every 15s is safe. Runs regardless of
// auth state because /api/agent/status is public.
let agentStatusTimer = null;
function startAgentStatusPolling() {
  if (agentStatusTimer) return;
  void refreshAgentStatus({ force: true });
  agentStatusTimer = setInterval(() => {
    void refreshAgentStatus();
  }, 15_000);
}
startAgentStatusPolling();

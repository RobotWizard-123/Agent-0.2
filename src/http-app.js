import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlanningEngine } from "./planning/planning-engine.js";
import { createSimulatedExecutionAdapter } from "./workflows/simulated-execution-adapter.js";
import { createPlanService } from "./workflows/plan-service.js";
import { createPlacementSettingsService } from "./settings/placement-settings-service.js";
import { createTopologyService } from "./topology/topology-service.js";
import { createAlarmEngine } from "./alarms/alarm-engine.js";
import { createDiagnosisEngine } from "./alarms/diagnosis-engine.js";
import { getRuntimeConfig, getAgentConfig } from "./config.js";
import { createAssistantContextService } from "./assistant/context-service.js";
import { createAssistantSessionStore } from "./assistant/session-store.js";
import { createAssistantOrchestrator } from "./assistant/assistant-orchestrator.js";
import { createAssistantActionBridge } from "./assistant/action-bridge.js";
import { createRouter, sendJson } from "./http/router.js";
import { registerInventoryRoutes } from "./http/routes/inventory-routes.js";
import { registerTopologyRoutes } from "./http/routes/topology-routes.js";
import { registerPlanRoutes } from "./http/routes/plan-routes.js";
import { registerAuditRoutes } from "./http/routes/audit-routes.js";
import { registerAlarmRoutes } from "./http/routes/alarm-routes.js";
import { registerDemoRoutes } from "./http/routes/demo-routes.js";
import { registerAuthRoutes } from "./http/routes/auth-routes.js";
import { registerHealthRoutes } from "./http/routes/health-routes.js";
import { registerAgentRoutes } from "./http/routes/agent-routes.js";
import { registerAssistantRoutes } from "./http/routes/assistant-routes.js";
import { createAgentGateway } from "./agent/agent-gateway.js";
import { createAgentStatusProbe } from "./agent/agent-status.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = resolve(root, "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function errorStatus(code) {
  if (["INVALID_JSON", "AGENT_INPUT_INVALID", "PLACEMENT_STRATEGY_INVALID"].includes(code)) return 400;
  if (code === "ASSISTANT_INPUT_INVALID") return 400;
  if (["AUTH_REQUIRED", "INVALID_CREDENTIALS"].includes(code)) return 401;
  if (["FORBIDDEN", "ORIGIN_MISMATCH"].includes(code)) return 403;
  if (code === "REQUEST_TOO_LARGE") return 413;
  if (code === "LEGACY_BATCH_DISABLED") return 410;
  if (code?.endsWith("_NOT_FOUND") || code === "PLAN_NOT_FOUND") return 404;
  if (["STATE_VERSION_CONFLICT", "PLAN_STALE", "PLAN_ALREADY_CONFIRMED", "PLAN_NOT_CONFIRMABLE"].includes(code)) return 409;
  if (["ASSISTANT_BUSY", "ASSISTANT_PROPOSAL_USED"].includes(code)) return 409;
  if (code === "ASSISTANT_RATE_LIMITED") return 429;
  if (["PLAN_BLOCKED", "AGENT_RESPONSE_INVALID"].includes(code)) return 422;
  if (code === "ASSISTANT_PROPOSAL_INVALID") return 422;
  if (["AGENT_UNAVAILABLE", "AUTH_NOT_CONFIGURED"].includes(code)) return 503;
  return 500;
}

function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fullPath = resolve(publicDir, relative);
  if (!(fullPath === publicDir || fullPath.startsWith(`${publicDir}${sep}`)) || !existsSync(fullPath)) return false;
  response.writeHead(200, { "content-type": contentTypes[extname(fullPath)] ?? "application/octet-stream" });
  createReadStream(fullPath).pipe(response);
  return true;
}

function requiresAdmin(method, pathname) {
  if (method !== "POST") return false;
  return pathname === "/api/plans"
    || pathname === "/api/settings/placement-strategy"
    || /^\/api\/plans\/[^/]+\/confirm$/.test(pathname)
    || /^\/api\/alarms\/[^/]+\/(acknowledge|diagnose|remediation)$/.test(pathname)
    || /^\/api\/assistant\/proposals\/[^/]+\/plans$/.test(pathname)
    || /^\/api\/demo\/(alarms|reset)$/.test(pathname);
}

export function createServerApp({
  repository,
  telemetryProvider,
  agentGateway = null,
  auth = null,
  assistantSessionStore = createAssistantSessionStore(),
}) {
  // If a gateway was not supplied but config is present (or not), build the
  // real probe regardless. This way the badge reflects truth even when the
  // app is launched without an explicit agentGateway (legacy wiring).
  const runtimeConfig = getRuntimeConfig();
  const agentStatusProbe = createAgentStatusProbe({ agentGateway });
  const router = createRouter();
  const planner = createPlanningEngine();
  const planService = createPlanService({
    repository,
    planner,
    executor: createSimulatedExecutionAdapter(),
    agentGateway,
  });
  const placementSettingsService = createPlacementSettingsService({ repository });
  const topologyService = createTopologyService();
  const alarmEngine = createAlarmEngine({ repository });
  const diagnosisEngine = createDiagnosisEngine({
    repository,
    alarmEngine,
    planService,
    topologyService,
  });
  const assistantContextService = createAssistantContextService({
    repository,
    topologyService,
    runtimeStatus: () => getRuntimeConfig(),
  });
  const assistantOrchestrator = createAssistantOrchestrator({
    contextService: assistantContextService,
    sessionStore: assistantSessionStore,
    agentGateway,
  });
  const assistantActionBridge = createAssistantActionBridge({
    repository,
    planService,
    diagnosisEngine,
  });

  if (auth) registerAuthRoutes(router, {
    auth,
    onLogout: (sessionId) => assistantOrchestrator.clear(sessionId),
  });
  registerHealthRoutes(router, { repository, telemetryProvider, agentGateway, agentStatusProbe });
  registerAgentRoutes(router, { agentStatusProbe });
  registerInventoryRoutes(router, { repository, telemetryProvider });
  registerTopologyRoutes(router, { repository, topologyService });
  registerPlanRoutes(router, { repository, planService, placementSettingsService, diagnosisEngine });
  registerAlarmRoutes(router, { repository, alarmEngine, diagnosisEngine });
  registerDemoRoutes(router, { repository, alarmEngine });
  registerAuditRoutes(router, { repository });
  registerAssistantRoutes(router, {
    orchestrator: assistantOrchestrator,
    actionBridge: assistantActionBridge,
  });

  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      const context = auth
        ? await auth.context(request)
        : { actor: "demo-admin", role: "admin" };

      if (auth && url.pathname.startsWith("/api/")) {
        auth.verifyMutationOrigin(request);
        const publicRoute = url.pathname === "/api/auth/login"
          || url.pathname === "/api/auth/session"
          || url.pathname === "/api/agent/status";
        if (!publicRoute) auth.requireViewer(context);
        if (requiresAdmin(request.method, url.pathname)) auth.requireAdmin(context);
      }

      if (await router.dispatch(request, response, context)) return;
      if (request.method === "GET" && serveStatic(url.pathname, response)) return;
      sendJson(response, 404, { error: "NOT_FOUND", message: "Route does not exist" });
    } catch (error) {
      sendJson(response, errorStatus(error.code), {
        error: error.code ?? "INTERNAL_ERROR",
        message: errorStatus(error.code) === 500 ? "Internal server error" : error.message,
        details: errorStatus(error.code) === 500 ? undefined : {
          plan_id: error.plan_id,
          state_version: error.state_version,
          plan_version: error.plan_version,
          blockers: error.blockers,
          retry_after_ms: error.retry_after_ms,
        },
      });
    }
  });
}

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(".env");
  }
} catch {
  // .env may be missing; rely on already-exported environment variables.
}

import { createAgentGateway } from "./src/agent/agent-gateway.js";
import { createSessionAuth } from "./src/auth/session-auth.js";
import { getAgentConfig, getAuthConfig, getRuntimeConfig } from "./src/config.js";
import { createServerApp } from "./src/http-app.js";
import { createJsonRepository } from "./src/repositories/state-repository.js";
import { restoreEmptyStartupState } from "./src/startup-state.js";
import { createDemoTelemetryProvider } from "./src/telemetry/demo-telemetry-provider.js";

// ---- 全局错误处理：防止未捕获异常导致进程崩溃 ----
function logCrash(label, error) {
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack : "";
  console.error(`[${timestamp}] ${label}: ${message}`);
  if (stack) console.error(stack);
}

process.on("uncaughtException", (error) => {
  logCrash("UNCAUGHT_EXCEPTION", error);
  // 不退出进程：记录错误后继续运行，防止单次请求异常导致整个服务中断
});

process.on("unhandledRejection", (reason) => {
  logCrash("UNHANDLED_REJECTION", reason);
  // 不退出进程：Node.js 默认行为已改为警告，但显式处理确保不崩溃
});

// ---- 应用启动 ----
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const runtime = getRuntimeConfig();
const repository = createJsonRepository({
  seedPath: join(root, "data", "seed", "state.json"),
  statePath: join(root, "data", "runtime", "state.json"),
});
restoreEmptyStartupState(repository);
const agentGateway = runtime.agent_configured ? createAgentGateway(getAgentConfig()) : null;
const auth = createSessionAuth(getAuthConfig());
const server = createServerApp({
  repository,
  telemetryProvider: createDemoTelemetryProvider(),
  agentGateway,
  auth,
});

server.on("error", (error) => {
  logCrash("SERVER_ERROR", error);
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing process or use a different PORT.`);
    process.exit(1);
  }
});

server.listen(port, host, () => {
  console.log(`datacenter-mgr listening on http://${host}:${port}`);
});

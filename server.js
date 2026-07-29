import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentGateway } from "./src/agent/agent-gateway.js";
import { createSessionAuth } from "./src/auth/session-auth.js";
import { getAgentConfig, getAuthConfig, getRuntimeConfig } from "./src/config.js";
import { createServerApp } from "./src/http-app.js";
import { createJsonRepository } from "./src/repositories/state-repository.js";
import { createDemoTelemetryProvider } from "./src/telemetry/demo-telemetry-provider.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const runtime = getRuntimeConfig();
const repository = createJsonRepository({
  seedPath: join(root, "data", "seed", "state.json"),
  statePath: join(root, "data", "runtime", "state.json"),
});
const agentGateway = runtime.agent_configured ? createAgentGateway(getAgentConfig()) : null;
const auth = createSessionAuth(getAuthConfig());
const server = createServerApp({
  repository,
  telemetryProvider: createDemoTelemetryProvider(),
  agentGateway,
  auth,
});

server.listen(port, host, () => {
  console.log(`datacenter-mgr listening on http://${host}:${port}`);
});

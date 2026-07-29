import { createDemoState } from "../src/demo-state.js";
import { createServerApp } from "../src/http-app.js";
import { createMemoryRepository } from "../src/repositories/state-repository.js";
import { createDemoTelemetryProvider } from "../src/telemetry/demo-telemetry-provider.js";
import { createSessionAuth } from "../src/auth/session-auth.js";

export async function withV02Server(assertions, overrides = {}) {
  const repository = overrides.repository ?? createMemoryRepository(overrides.state ?? createDemoState());
  const server = createServerApp({
    repository,
    telemetryProvider: overrides.telemetryProvider ?? createDemoTelemetryProvider(),
    agentGateway: overrides.agentGateway ?? null,
    auth: overrides.auth ?? null,
    assistantSessionStore: overrides.assistantSessionStore,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    let body = options.body;
    if (body !== undefined && typeof body !== "string") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers, body });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    return { response, body: payload };
  }

  try {
    await assertions({ repository, request, baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function withAuthenticatedServer(assertions, overrides = {}) {
  const auth = createSessionAuth({
    sessionSecret: "unit-test-session-secret",
    adminPassword: "admin-pass",
    viewerPassword: "viewer-pass",
    secureCookies: false,
  });

  await withV02Server(async ({ repository, request: rawRequest, baseUrl }) => {
    const request = (path, options = {}) => rawRequest(path, {
      ...options,
      headers: {
        origin: baseUrl,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.headers ?? {}),
      },
    });

    async function login(username, password) {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      return {
        ...result,
        cookie: result.response.headers.get("set-cookie") ?? "",
      };
    }

    await assertions({ repository, request, login, baseUrl });
  }, { ...overrides, auth });
}

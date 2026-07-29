export function getAgentConfig(env = process.env) {
  return {
    baseUrl: env.AGENT_BASE_URL?.trim() ?? "",
    apiKey: env.AGENT_API_KEY?.trim() ?? "",
    model: env.AGENT_MODEL?.trim() ?? "",
    timeoutMs: Number(env.AGENT_TIMEOUT_MS || 8_000),
  };
}

export function getAuthConfig(env = process.env) {
  return {
    sessionSecret: env.SESSION_SECRET?.trim() ?? "",
    adminPassword: env.APP_ADMIN_PASSWORD ?? "",
    viewerPassword: env.APP_VIEWER_PASSWORD ?? "",
    secureCookies: env.TRUST_PROXY_HTTPS === "true",
  };
}

export function getRuntimeConfig(env = process.env) {
  const agent = getAgentConfig(env);
  const auth = getAuthConfig(env);
  return {
    agent_configured: Boolean(agent.baseUrl && agent.apiKey && agent.model),
    agent_model: agent.model || null,
    authentication_configured: Boolean(auth.sessionSecret && auth.adminPassword && auth.viewerPassword),
    telemetry_status: "not_connected",
    application_version: "0.2.0",
  };
}

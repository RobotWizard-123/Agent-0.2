export function getAgentConfig(env = process.env) {
  return {
    baseUrl: env.AGENT_BASE_URL?.trim() ?? "",
    apiKey: env.AGENT_API_KEY?.trim() ?? "",
    model: env.AGENT_MODEL?.trim() ?? "",
    contextTokens: boundedInteger(env.AGENT_CONTEXT_TOKENS, 245_760, 1, 2_000_000),
    outputTokens: boundedInteger(env.AGENT_OUTPUT_TOKENS, 16_384, 1, 200_000),
    hardLimitTokens: boundedInteger(env.AGENT_HARD_LIMIT_TOKENS, 262_144, 1, 2_000_000),
    timeoutMs: Number(env.AGENT_TIMEOUT_MS || 60_000),
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function getCpSatConfig(env = process.env) {
  return {
    enabled: env.CP_SAT_ENABLED?.trim().toLowerCase() === "true",
    pythonPath: env.CP_SAT_PYTHON?.trim() || "python",
    timeoutMs: boundedInteger(env.CP_SAT_TIMEOUT_MS, 2_500, 500, 10_000),
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

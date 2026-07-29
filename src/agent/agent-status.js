// Cached real-availability probe for the agent gateway.
// Distinct from runtime config: it actually pings the model with a short
// timeout and caches the result, so the top-bar badge, /health/ready, and
// the assistant panel all read the same truthful state without hammering
// the model endpoint.

const DEFAULT_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_TTL_MS = 10_000;

export function createAgentStatusProbe({
  agentGateway = null,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
}) {
  let cache = null;
  let inflight = null;

  function describeConfigured() {
    if (!agentGateway) return { model: null, base_url: null };
    try {
      const desc = agentGateway.describe?.() ?? {};
      return {
        model: desc.model ?? null,
        base_url: agentGateway.baseUrl ?? null,
      };
    } catch {
      return { model: null, base_url: null };
    }
  }

  async function probeOnce() {
    if (!agentGateway) {
      return {
        status: "unconfigured",
        configured: false,
        model: null,
        base_url: null,
        error_code: null,
        error_message: null,
        probe_ms: 0,
        probed_at: new Date(now()).toISOString(),
        cached: false,
      };
    }
    const desc = describeConfigured();
    const start = now();
    let result;
    try {
      const h = await agentGateway.health({ timeoutMs: probeTimeoutMs });
      if (h?.status === "healthy") {
        result = {
          status: "available",
          configured: true,
          error_code: null,
          error_message: null,
        };
      } else {
        result = {
          status: "degraded",
          configured: true,
          error_code: h?.error_code ?? "AGENT_UNAVAILABLE",
          error_message: h?.message ?? "Agent health check returned degraded",
        };
      }
    } catch (error) {
      result = {
        status: "degraded",
        configured: true,
        error_code: error?.code ?? "AGENT_UNAVAILABLE",
        error_message: error?.message ?? "Agent probe threw",
      };
    }
    return {
      ...result,
      model: desc.model,
      base_url: desc.base_url,
      probe_ms: now() - start,
      probed_at: new Date(now()).toISOString(),
      cached: false,
    };
  }

  async function status({ force = false } = {}) {
    if (!force && cache && now() - cache.probed_at < ttlMs) {
      return { ...cache.snapshot, cached: true };
    }
    if (inflight) {
      const value = await inflight;
      return { ...value, cached: true };
    }
    inflight = probeOnce().then((snapshot) => {
      cache = { snapshot, probed_at: now() };
      inflight = null;
      return snapshot;
    }).catch((error) => {
      inflight = null;
      throw error;
    });
    return inflight;
  }

  return {
    status,
    invalidate() { cache = null; },
    describeConfigured,
  };
}

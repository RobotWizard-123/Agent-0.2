// Exposes truthful agent connectivity state to the UI and health probes.
// Independent of runtime config: even if AGENT_* is set, the model may be
// unreachable, and the UI must show that instead of pretending everything
// is fine.

export function registerAgentRoutes(router, { agentStatusProbe }) {
  router.add("GET", "/api/agent/status", async ({ url }) => {
    const force = url.searchParams.get("force") === "1";
    const result = agentStatusProbe ? await agentStatusProbe.status({ force }) : {
      status: "unconfigured",
      configured: false,
      model: null,
      base_url: null,
      error_code: null,
      error_message: "Agent status probe is not wired",
      probe_ms: 0,
      probed_at: new Date().toISOString(),
      cached: false,
    };
    return { status: 200, body: result };
  });
}

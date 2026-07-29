export function registerHealthRoutes(router, { repository, telemetryProvider, agentGateway, agentStatusProbe = null }) {
  router.add("GET", "/health/live", () => ({ status: "live", application_version: "0.2.0" }));

  router.add("GET", "/health/ready", async () => {
    repository.read();
    const collector = typeof telemetryProvider?.health === "function"
      ? await telemetryProvider.health()
      : { status: "not_connected" };
    // Use the real probe (cached, ~10s) when available so the readiness
    // signal reflects actual model reachability, not just config presence.
    let model = "not_configured";
    let modelDetail = null;
    if (agentStatusProbe) {
      const probed = await agentStatusProbe.status();
      model = probed.status;
      modelDetail = {
        model: probed.model,
        base_url: probed.base_url,
        error_code: probed.error_code,
        probe_ms: probed.probe_ms,
        probed_at: probed.probed_at,
      };
    } else if (agentGateway) {
      model = "configured";
    }
    return {
      status: "ready",
      core: { repository: "ready" },
      dependencies: {
        model,
        model_detail: modelDetail,
        collector: collector.status ?? "unknown",
      },
    };
  });
}

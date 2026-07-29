export function createDemoTelemetryProvider({ readings = {}, status = "not_connected" } = {}) {
  return {
    async rackPower(rackId) {
      const reading = readings[rackId];
      if (!reading) {
        return { value_w: null, source: "unknown", collected_at: null, status };
      }
      return {
        value_w: Number.isFinite(reading.value_w) ? reading.value_w : null,
        source: reading.source ?? "demo",
        collected_at: reading.collected_at ?? null,
        status: reading.status ?? "healthy",
      };
    },
    async health() {
      return { status, source: status === "healthy" ? "demo" : "unknown" };
    },
  };
}

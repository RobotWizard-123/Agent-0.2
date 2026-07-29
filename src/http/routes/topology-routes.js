export function registerTopologyRoutes(router, { repository, topologyService }) {
  router.add("GET", "/api/topology/devices/:id", ({ params }) => {
    const state = repository.read();
    return { ...topologyService.devicePath(state, params.id), state_version: state.version };
  });

  router.add("GET", "/api/topology/power", () => {
    const state = repository.read();
    return {
      room: state.room,
      power_sources: state.power_sources,
      cabinets: state.racks.map((rack) => ({ id: rack.id, role: rack.role, design_power_w: rack.design_power_w, source_id: rack.source_id })),
      redundancy: state.topology.redundancy,
      state_version: state.version,
    };
  });

  router.add("GET", "/api/topology/network", () => {
    const state = repository.read();
    return { ...state.topology.network, redundancy: state.topology.redundancy, state_version: state.version };
  });
}

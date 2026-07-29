export function registerAuditRoutes(router, { repository }) {
  router.add("GET", "/api/audit", () => {
    const state = repository.read();
    return { state_version: state.version, items: [...state.audit].reverse() };
  });
}

import { randomUUID } from "node:crypto";

export function registerDemoRoutes(router, { repository, alarmEngine }) {
  router.add("POST", "/api/demo/alarms", async ({ request, context, readJsonBody }) => {
    const body = await readJsonBody(request);
    return { status: 201, body: alarmEngine.triggerDemo(body.scenario, context.actor) };
  });

  router.add("POST", "/api/demo/reset", async ({ request, context, readJsonBody }) => {
    await readJsonBody(request);
    repository.reset();
    const state = repository.read();
    return repository.mutate(state.version, (draft) => {
      draft.audit.push({
        id: `AUDIT-${randomUUID()}`,
        entity_type: "system",
        entity_id: draft.room.id,
        action: "demo_state_reset",
        actor: context.actor,
        at: new Date().toISOString(),
        details: { seed_version: 1 },
      });
    });
  });
}

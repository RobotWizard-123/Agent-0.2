export function registerAlarmRoutes(router, { repository, alarmEngine, diagnosisEngine }) {
  router.add("GET", "/api/alarms", () => ({ state_version: repository.read().version, items: alarmEngine.list() }));
  router.add("GET", "/api/alarms/:id", ({ params }) => ({ ...alarmEngine.get(params.id), state_version: repository.read().version }));

  router.add("POST", "/api/alarms/:id/acknowledge", async ({ request, params, context, readJsonBody }) => {
    await readJsonBody(request);
    return alarmEngine.acknowledge(params.id, context.actor);
  });

  router.add("POST", "/api/alarms/:id/diagnose", async ({ request, params, context, readJsonBody }) => {
    await readJsonBody(request);
    return diagnosisEngine.diagnose(params.id, context.actor);
  });

  router.add("POST", "/api/alarms/:id/remediation", async ({ request, params, context, readJsonBody }) => {
    await readJsonBody(request);
    return { status: 201, body: await diagnosisEngine.createRemediation(params.id, context.actor) };
  });
}

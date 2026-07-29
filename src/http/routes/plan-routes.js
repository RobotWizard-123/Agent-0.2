import { recommendPlacement } from "../../placement-recommender.js";
import { runPrecheck } from "../../deploy-agent.js";

function gone() {
  throw Object.assign(new Error("Legacy batch execution is disabled; create and confirm a plan instead"), { code: "LEGACY_BATCH_DISABLED" });
}

export function registerPlanRoutes(router, { repository, planService, placementSettingsService, diagnosisEngine = null }) {
  router.add("GET", "/api/settings/placement-strategy", () => placementSettingsService.get());
  router.add("POST", "/api/settings/placement-strategy", async ({ request, context, readJsonBody }) => {
    const body = await readJsonBody(request);
    return placementSettingsService.update(body.strategy_id, context.actor);
  });

  router.add("POST", "/api/plans", async ({ request, context, readJsonBody }) => ({
    status: 201,
    body: await planService.create(await readJsonBody(request), context.actor),
  }));

  router.add("GET", "/api/plans/:id", ({ params }) => planService.get(params.id));

  router.add("POST", "/api/plans/:id/confirm", async ({ request, params, context, readJsonBody }) => {
    await readJsonBody(request);
    const plan = planService.get(params.id);
    if (plan.kind === "alarm_remediation" && diagnosisEngine) {
      return diagnosisEngine.confirmRemediation(params.id, context.actor);
    }
    return planService.confirm(params.id, context.actor);
  });

  router.add("POST", "/api/plans/:id/select-candidate", async ({ request, params, context, readJsonBody }) => {
    const body = await readJsonBody(request);
    if (typeof body?.candidate_id !== "string" || !body.candidate_id.trim()) {
      throw Object.assign(new Error("candidate_id is required"), { code: "PLAN_CANDIDATE_INVALID" });
    }
    return { status: 200, body: planService.selectCandidate(params.id, body.candidate_id, context.actor) };
  });

  router.add("POST", "/api/deploy/precheck", async ({ request, readJsonBody }) => runPrecheck(repository.read(), await readJsonBody(request)));
  router.add("POST", "/api/agent/recommend-placement", async ({ request, readJsonBody }) => recommendPlacement(repository.read(), await readJsonBody(request)));

  for (const [method, path] of [
    ["POST", "/api/agent/adopt-placement"],
    ["POST", "/api/deploy/batch"],
    ["GET", "/api/deploy/batches"],
    ["GET", "/api/deploy/batches/:id"],
    ["POST", "/api/deploy/batches/:id/poll"],
    ["POST", "/api/deploy/batches/:id/action"],
  ]) {
    router.add(method, path, gone);
  }
}

function sessionKey(context) {
  return context.sessionId ?? "demo-session";
}

export function registerAssistantRoutes(router, { orchestrator, actionBridge }) {
  router.add("GET", "/api/assistant/session", ({ context }) => (
    orchestrator.session(sessionKey(context))
  ));

  router.add("GET", "/api/assistant/feedback", ({ context, url }) => (
    orchestrator.feedback({
      sessionId: sessionKey(context),
      actor: context.actor,
      role: context.role,
      cursor: Number(url.searchParams.get("cursor") || 0),
      uiContext: {
        route: url.searchParams.get("route") ?? "overview",
        entity_id: url.searchParams.get("entity_id"),
        filters: {},
      },
    })
  ));

  router.add("POST", "/api/assistant/messages", async ({
    request,
    context,
    readJsonBody,
  }) => {
    const body = await readJsonBody(request);
    return orchestrator.send({
      sessionId: sessionKey(context),
      actor: context.actor,
      role: context.role,
      message: body.message,
      uiContext: body.ui_context,
    });
  });

  router.add("POST", "/api/assistant/proposals/:id/plans", async ({
    request,
    params,
    context,
    readJsonBody,
  }) => {
    await readJsonBody(request);
    const proposal = orchestrator.markProposalUsed(sessionKey(context), params.id);
    const plan = await actionBridge.createPlan(proposal, context.actor);
    return { status: 201, body: plan };
  });
}

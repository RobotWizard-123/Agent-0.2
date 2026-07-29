export function registerAuthRoutes(router, { auth, onLogout = () => {} }) {
  router.add("POST", "/api/auth/login", async ({ request, readJsonBody }) => {
    const body = await readJsonBody(request);
    const result = auth.login(body.username, body.password);
    return { status: 200, body: result.session, headers: { "set-cookie": result.cookie } };
  });

  router.add("POST", "/api/auth/logout", ({ context }) => {
    onLogout(context.sessionId);
    const result = auth.logout(context);
    return { status: 200, body: result.session, headers: { "set-cookie": result.cookie } };
  });

  router.add("GET", "/api/auth/session", ({ context }) => auth.session(context));
}

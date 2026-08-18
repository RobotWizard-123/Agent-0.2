import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

function authError(code, message) {
  return Object.assign(new Error(message), { code });
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

export function createSessionAuth({
  sessionSecret,
  adminPassword,
  viewerPassword,
  secureCookies = false,
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();
  const configured = Boolean(sessionSecret && adminPassword && viewerPassword);

  function sign(sessionId) {
    return createHmac("sha256", sessionSecret ?? "unconfigured")
      .update(sessionId, "utf8")
      .digest("base64url");
  }

  function makeCookie(value, maxAge) {
    return [
      `dc_session=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      ...(secureCookies ? ["Secure"] : []),
    ].join("; ");
  }

  function publicSession(context) {
    if (!context?.sessionId) return { authenticated: false, actor: null, role: null };
    return { authenticated: true, actor: context.actor, role: context.role };
  }

  return {
    configured,
    login(username, password) {
      if (!configured) throw authError("AUTH_NOT_CONFIGURED", "Authentication is not configured");
      const role = username === "admin" ? "admin" : username === "viewer" ? "viewer" : null;
      const expected = role === "admin" ? adminPassword : role === "viewer" ? viewerPassword : "invalid-user";
      if (!role || !safeEqual(password ?? "", expected)) {
        throw authError("INVALID_CREDENTIALS", "Username or password is incorrect");
      }

      const sessionId = randomBytes(32).toString("base64url");
      const context = { sessionId, actor: username, role, expiresAt: now() + SESSION_TTL_MS };
      sessions.set(sessionId, context);
      return {
        session: publicSession(context),
        cookie: makeCookie(`${sessionId}.${sign(sessionId)}`, SESSION_TTL_MS / 1_000),
      };
    },
    async context(request) {
      if (!configured) return { sessionId: null, actor: null, role: null };
      const token = parseCookies(request.headers.cookie).dc_session;
      if (!token) return { sessionId: null, actor: null, role: null };
      const separator = token.lastIndexOf(".");
      if (separator < 0) return { sessionId: null, actor: null, role: null };
      const sessionId = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      if (!safeEqual(signature, sign(sessionId))) return { sessionId: null, actor: null, role: null };
      const session = sessions.get(sessionId);
      if (!session || session.expiresAt <= now()) {
        sessions.delete(sessionId);
        return { sessionId: null, actor: null, role: null };
      }
      return { ...session };
    },
    session: publicSession,
    logout(context) {
      if (context?.sessionId) sessions.delete(context.sessionId);
      return { session: publicSession(null), cookie: makeCookie("", 0) };
    },
    requireViewer(context) {
      if (!context?.role) throw authError("AUTH_REQUIRED", "Login is required");
      if (!["viewer", "admin"].includes(context.role)) throw authError("FORBIDDEN", "Viewer role is required");
      return context;
    },
    requireAdmin(context) {
      if (!context?.role) throw authError("AUTH_REQUIRED", "Login is required");
      if (context.role !== "admin") throw authError("FORBIDDEN", "Administrator role is required");
      return context;
    },
    verifyMutationOrigin(request) {
      if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
      const origin = request.headers.origin;
      const requestHost = request.headers.host;
      let originHost = null;
      try {
        originHost = origin ? new URL(origin).host : null;
      } catch {
        throw authError("ORIGIN_MISMATCH", "Mutation origin is invalid");
      }
      if (!originHost || !requestHost || originHost !== requestHost) {
        throw authError("ORIGIN_MISMATCH", "Mutation origin does not match this site");
      }
    },
  };
}

import { get, post } from "./api.js";

function initialState() {
  return {
    authenticated: false,
    role: null,
    open: false,
    loading: false,
    sending: false,
    sync_status: "idle",
    model_status: "unknown",
    state_version: null,
    cursor: 0,
    unread: 0,
    messages: [],
    feedback: [],
    error: null,
  };
}

function clientError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createAssistantClient({
  getImpl = get,
  postImpl = post,
  getUiContext = () => ({ route: "overview", entity_id: null, filters: {} }),
  onPlanCreated = () => {},
  setIntervalImpl = globalThis.setInterval.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval.bind(globalThis),
  pollMs = 30_000,
} = {}) {
  const listeners = new Set();
  let state = initialState();
  let timer = null;

  function snapshot() {
    return structuredClone(state);
  }

  function notify() {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function patch(value) {
    Object.assign(state, value);
    notify();
  }

  function stop() {
    if (timer === null) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  function start() {
    if (timer !== null || !state.authenticated) return;
    timer = setIntervalImpl(() => {
      void poll();
    }, pollMs);
  }

  async function poll() {
    if (!state.authenticated) return null;
    patch({ sync_status: "syncing" });
    try {
      const uiContext = getUiContext() ?? {};
      const params = new URLSearchParams({
        cursor: String(state.cursor),
        route: uiContext.route ?? "overview",
      });
      if (uiContext.entity_id) params.set("entity_id", uiContext.entity_id);
      const result = await getImpl(`/api/assistant/feedback?${params}`);
      const known = new Set(state.feedback.map((item) => item.id));
      const additions = (result.events ?? []).filter((item) => !known.has(item.id));
      patch({
        feedback: [...state.feedback, ...additions].slice(-200),
        cursor: Number(result.next_cursor || state.cursor),
        unread: state.open ? 0 : state.unread + additions.length,
        state_version: result.state_version ?? state.state_version,
        sync_status: "ready",
        error: null,
      });
      return result;
    } catch (error) {
      patch({ sync_status: "interrupted", error });
      return null;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    async setSession(session) {
      const authenticated = Boolean(session?.authenticated);
      const role = session?.role ?? null;
      if (!authenticated) {
        stop();
        state = initialState();
        notify();
        return;
      }
      if (state.authenticated && state.role === role) return;
      patch({ authenticated: true, role, loading: true, error: null });
      try {
        const current = await getImpl("/api/assistant/session");
        patch({
          messages: current.messages ?? [],
          feedback: current.feedback ?? [],
          cursor: Number(current.next_cursor || 0),
          loading: false,
          sync_status: "ready",
        });
      } catch (error) {
        patch({ loading: false, sync_status: "interrupted", error });
      }
      start();
    },
    setOpen(open) {
      patch({ open: Boolean(open), unread: open ? 0 : state.unread });
    },
    start,
    stop,
    poll,
    async send(message) {
      if (!state.authenticated) throw clientError("AUTH_REQUIRED", "需要登录");
      if (typeof message !== "string" || !message.trim()) {
        throw clientError("ASSISTANT_INPUT_INVALID", "请输入内容");
      }
      const content = message.trim();
      patch({
        sending: true,
        error: null,
        messages: [...state.messages, { role: "user", content, at: new Date().toISOString() }],
      });
      try {
        const result = await postImpl("/api/assistant/messages", {
          message: content,
          ui_context: getUiContext(),
        });
        patch({
          sending: false,
          model_status: result.model_status ?? state.model_status,
          state_version: result.state_version ?? state.state_version,
          messages: [...state.messages, {
            id: result.message_id,
            role: "assistant",
            content: result.answer,
            evidence: result.evidence ?? [],
            proposal: result.proposal ?? null,
            model_status: result.model_status,
            state_version: result.state_version,
            at: new Date().toISOString(),
          }],
        });
        return result;
      } catch (error) {
        patch({ sending: false, error });
        throw error;
      }
    },
    async acceptProposal(proposalId) {
      if (state.role !== "admin") {
        throw clientError("FORBIDDEN", "需要管理员权限");
      }
      patch({ sending: true, error: null });
      try {
        const plan = await postImpl(
          `/api/assistant/proposals/${encodeURIComponent(proposalId)}/plans`,
          {},
        );
        state.messages = state.messages.map((message) => (
          message.proposal?.id === proposalId
            ? { ...message, proposal: { ...message.proposal, used: true, plan_id: plan.id } }
            : message
        ));
        onPlanCreated(plan);
        patch({ sending: false });
        return plan;
      } catch (error) {
        patch({ sending: false, error });
        throw error;
      }
    },
  };
}

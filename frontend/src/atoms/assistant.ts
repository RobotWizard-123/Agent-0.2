import { atom } from "jotai";
import { api } from "../api/endpoints";
import type {
  AssistantMessage,
  AssistantFeedbackEvent,
  AssistantModelStatus,
  AssistantSyncStatus,
  AssistantProposal,
  Plan,
} from "../types/domain";

export const assistantMessagesAtom = atom<AssistantMessage[]>([]);
export const assistantFeedbackAtom = atom<AssistantFeedbackEvent[]>([]);
export const assistantOpenAtom = atom<boolean>(false);
export const assistantSendingAtom = atom<boolean>(false);
export const assistantLoadingAtom = atom<boolean>(false);
export const assistantSyncStatusAtom = atom<AssistantSyncStatus>("idle");
export const assistantModelStatusAtom = atom<AssistantModelStatus>("unknown");
export const assistantCursorAtom = atom<number>(0);
export const assistantStateVersionAtom = atom<number | null>(null);
export const assistantUnreadAtom = atom<number>(0);
export const assistantErrorAtom = atom<string | null>(null);

export const assistantSessionKeyAtom = atom<string | null>(null);

export const initAssistantAction = atom(null, async (get, set, sessionKey: string) => {
  const prevKey = get(assistantSessionKeyAtom);
  if (prevKey === sessionKey) return;
  set(assistantSessionKeyAtom, sessionKey);
  set(assistantLoadingAtom, true);
  set(assistantErrorAtom, null);
  try {
    const session = await api.assistant.session();
    set(assistantMessagesAtom, session.messages ?? []);
    set(assistantFeedbackAtom, session.feedback ?? []);
    set(assistantCursorAtom, Number(session.next_cursor || 0));
    set(assistantSyncStatusAtom, "ready");
  } catch (error) {
    const e = error as Error;
    set(assistantErrorAtom, e.message);
    set(assistantSyncStatusAtom, "interrupted");
  } finally {
    set(assistantLoadingAtom, false);
  }
});

export const sendAssistantMessageAction = atom(
  null,
  async (get, set, { message, route, entityId }: { message: string; route: string; entityId: string | null }) => {
    set(assistantSendingAtom, true);
    set(assistantErrorAtom, null);
    const userMsg: AssistantMessage = {
      role: "user",
      content: message,
      at: new Date().toISOString(),
    };
    set(assistantMessagesAtom, [...get(assistantMessagesAtom), userMsg]);
    try {
      const result = await api.assistant.send({
        message,
        ui_context: { route, entity_id: entityId, filters: {} },
      });
      const assistantMsg: AssistantMessage = {
        id: result.message_id,
        role: "assistant",
        content: result.answer,
        evidence: result.evidence,
        proposal: result.proposal,
        intent: result.intent,
        model_status: result.model_status as AssistantModelStatus,
        state_version: result.state_version,
        at: new Date().toISOString(),
      };
      set(assistantMessagesAtom, [...get(assistantMessagesAtom), assistantMsg]);
      set(assistantModelStatusAtom, result.model_status as AssistantModelStatus);
      set(assistantStateVersionAtom, result.state_version);
    } catch (error) {
      const e = error as Error;
      set(assistantErrorAtom, e.message);
      throw error;
    } finally {
      set(assistantSendingAtom, false);
    }
  },
);

export const pollAssistantFeedbackAction = atom(
  null,
  async (get, set, { route, entityId }: { route: string; entityId: string | null }) => {
    set(assistantSyncStatusAtom, "syncing");
    try {
      const result = await api.assistant.feedback({
        cursor: get(assistantCursorAtom),
        route,
        entity_id: entityId ?? undefined,
      });
      const known = new Set(get(assistantFeedbackAtom).map((e) => e.id));
      const additions = (result.events ?? []).filter((e) => !known.has(e.id));
      set(assistantFeedbackAtom, [...get(assistantFeedbackAtom), ...additions].slice(-200));
      set(assistantCursorAtom, Number(result.next_cursor || get(assistantCursorAtom)));
      set(assistantStateVersionAtom, result.state_version ?? null);
      set(assistantSyncStatusAtom, "ready");
      set(assistantErrorAtom, null);
      if (!get(assistantOpenAtom())) {
        set(assistantUnreadAtom, get(assistantUnreadAtom) + additions.length);
      }
    } catch {
      set(assistantSyncStatusAtom, "interrupted");
    }
  },
);

export const acceptProposalAction = atom(null, async (get, set, proposalId: string) => {
  const plan = await api.assistant.acceptProposal(proposalId);
  set(assistantMessagesAtom, (prev) =>
    prev.map((m) =>
      m.proposal?.id === proposalId
        ? { ...m, proposal: { ...m.proposal, used: true, plan_id: plan.id } }
        : m,
    ),
  );
  return plan;
});

export const setAssistantOpenAction = atom(null, (get, set, open: boolean) => {
  set(assistantOpenAtom, open);
  if (open) set(assistantUnreadAtom, 0);
});

export const clearAssistantAction = atom(null, (get, set) => {
  set(assistantMessagesAtom, []);
  set(assistantFeedbackAtom, []);
  set(assistantCursorAtom, 0);
  set(assistantSessionKeyAtom, null);
  set(assistantUnreadAtom, 0);
});

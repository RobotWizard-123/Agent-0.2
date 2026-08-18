function sessionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function clone(value) {
  return structuredClone(value);
}

export function createAssistantSessionStore({
  now = () => Date.now(),
  maxTurns = 20,
  requestsPerMinute = 10,
  maxFeedbackEvents = 200,
} = {}) {
  const records = new Map();

  function createRecord() {
    return {
      messages: [],
      feedback_snapshot: null,
      feedback_events: [],
      next_cursor: 0,
      proposals: new Map(),
      request_started_at: [],
      busy: false,
    };
  }

  function record(sessionId) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw sessionError("AUTH_REQUIRED", "An authenticated session is required");
    }
    if (!records.has(sessionId)) records.set(sessionId, createRecord());
    return records.get(sessionId);
  }

  function getProposal(sessionId, proposalId) {
    const proposal = record(sessionId).proposals.get(proposalId);
    if (!proposal) {
      throw sessionError(
        "ASSISTANT_PROPOSAL_NOT_FOUND",
        `Assistant proposal does not exist: ${proposalId}`,
      );
    }
    if (proposal.used) {
      throw sessionError(
        "ASSISTANT_PROPOSAL_USED",
        `Assistant proposal has already been used: ${proposalId}`,
      );
    }
    return clone(proposal);
  }

  return {
    session(sessionId) {
      const current = record(sessionId);
      return {
        messages: clone(current.messages),
        feedback: clone(current.feedback_events),
        next_cursor: current.next_cursor,
      };
    },
    appendTurn(sessionId, userMessage, assistantMessage) {
      const current = record(sessionId);
      current.messages.push(
        { ...clone(userMessage), role: "user" },
        { ...clone(assistantMessage), role: "assistant" },
      );
      current.messages = current.messages.slice(-(maxTurns * 2));
      return clone(current.messages);
    },
    beginRequest(sessionId) {
      const current = record(sessionId);
      if (current.busy) {
        throw sessionError("ASSISTANT_BUSY", "An assistant request is already running");
      }
      const currentTime = Number(now());
      current.request_started_at = current.request_started_at
        .filter((startedAt) => currentTime - startedAt < 60_000);
      if (current.request_started_at.length >= requestsPerMinute) {
        const retryAfter = Math.max(
          1,
          current.request_started_at[0] + 60_000 - currentTime,
        );
        throw sessionError(
          "ASSISTANT_RATE_LIMITED",
          "Assistant request rate limit exceeded",
          { retry_after_ms: retryAfter },
        );
      }
      current.request_started_at.push(currentTime);
      current.busy = true;
    },
    endRequest(sessionId) {
      record(sessionId).busy = false;
    },
    feedbackSnapshot(sessionId) {
      const snapshot = record(sessionId).feedback_snapshot;
      return snapshot ? clone(snapshot) : null;
    },
    syncFeedback(sessionId, snapshot, events) {
      const current = record(sessionId);
      const knownIds = new Set(current.feedback_events.map((event) => event.id));
      const added = [];
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        current.next_cursor += 1;
        const stored = { ...clone(event), cursor: current.next_cursor };
        current.feedback_events.push(stored);
        knownIds.add(event.id);
        added.push(stored);
      }
      current.feedback_events = current.feedback_events.slice(-maxFeedbackEvents);
      current.feedback_snapshot = clone(snapshot);
      return clone(added);
    },
    feedback(sessionId, cursor = 0) {
      const current = record(sessionId);
      const normalizedCursor = Number.isInteger(Number(cursor))
        ? Math.max(0, Number(cursor))
        : 0;
      return {
        events: clone(current.feedback_events
          .filter((event) => event.cursor > normalizedCursor)),
        next_cursor: current.next_cursor,
        state_version: current.feedback_snapshot?.state_version ?? null,
      };
    },
    saveProposal(sessionId, proposal) {
      if (!proposal?.id) {
        throw sessionError("ASSISTANT_PROPOSAL_INVALID", "Proposal ID is required");
      }
      const current = record(sessionId);
      current.proposals.set(proposal.id, { ...clone(proposal), used: false });
      return clone(current.proposals.get(proposal.id));
    },
    getProposal,
    markProposalUsed(sessionId, proposalId) {
      const current = record(sessionId);
      getProposal(sessionId, proposalId);
      const proposal = current.proposals.get(proposalId);
      proposal.used = true;
      return clone(proposal);
    },
    clear(sessionId) {
      if (sessionId) records.delete(sessionId);
    },
  };
}

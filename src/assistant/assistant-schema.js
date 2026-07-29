const evidenceTypes = new Set(["rack", "device", "alarm", "plan", "audit"]);
const navigationTypes = new Set(["rack", "device", "alarm", "plan", "audit"]);

function invalid(message, details = {}) {
  return Object.assign(new Error(message), {
    code: "AGENT_RESPONSE_INVALID",
    ...details,
  });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  return value;
}

function reference(value, label, { entityIds, entityTypes }, allowedTypes) {
  const input = object(value, label);
  if (!allowedTypes.has(input.type) || typeof input.id !== "string" || !input.id) {
    throw invalid(`${label} is invalid`);
  }
  if (entityIds && !entityIds.has(input.id)) {
    throw invalid(`${label} references an unknown entity`);
  }
  if (entityTypes?.has(input.id) && entityTypes.get(input.id) !== input.type) {
    throw invalid(`${label} type does not match the entity`);
  }
  return { type: input.type, id: input.id };
}

function intent(value, entities) {
  const input = object(value, "Assistant intent");
  if (input.type === "answer" || input.type === "propose_placement") {
    return { type: input.type };
  }
  if (input.type === "navigate") {
    return {
      type: "navigate",
      target: reference(input.target, "Navigation target", entities, navigationTypes),
    };
  }
  if (input.type === "propose_remediation") {
    if (typeof input.alarm_id !== "string" || !input.alarm_id) {
      throw invalid("Remediation alarm ID is required");
    }
    if (entities.entityIds && !entities.entityIds.has(input.alarm_id)) {
      throw invalid("Remediation alarm does not exist");
    }
    if (entities.entityTypes?.has(input.alarm_id)
      && entities.entityTypes.get(input.alarm_id) !== "alarm") {
      throw invalid("Remediation target is not an alarm");
    }
    return { type: "propose_remediation", alarm_id: input.alarm_id };
  }
  throw invalid(`Unsupported assistant intent: ${input.type}`);
}

export function validateAssistantResponse(value, {
  entityIds = null,
  entityTypes = null,
} = {}) {
  const input = object(value, "Assistant response");
  if (typeof input.answer !== "string") {
    throw invalid("Assistant answer must be text");
  }
  const answer = input.answer.trim();
  if (!answer || answer.length > 4_000) {
    throw invalid("Assistant answer length is invalid");
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > 20) {
    throw invalid("Assistant evidence must be an array with at most 20 items");
  }
  const entities = { entityIds, entityTypes };
  const evidence = input.evidence.map((item) => reference(
    item,
    "Assistant evidence",
    entities,
    evidenceTypes,
  ));

  return {
    answer,
    evidence: [...new Map(evidence.map((item) => [`${item.type}:${item.id}`, item])).values()],
    intent: intent(input.intent, entities),
  };
}

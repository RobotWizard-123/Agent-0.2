const evidenceTypes = new Set(["rack", "device", "alarm", "plan", "audit"]);
const navigationTypes = new Set(["rack", "device", "alarm", "plan", "audit"]);
const supportedIntentTypes = new Set(["answer", "navigate", "propose_placement", "propose_remediation"]);

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

function normalizeEvidenceArray(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return [value];
  throw invalid("Assistant evidence must be an array");
}

function normalizeIntent(value) {
  if (typeof value === "string") {
    return { type: value };
  }
  return object(value, "Assistant intent");
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

function nullablePositiveInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function nullableNonNegativeInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function deviceRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const q = nullablePositiveInt(value.quantity) ?? 1;
  const u = nullablePositiveInt(value.u_size);
  const p = nullableNonNegativeInt(value.rated_power_w);
  const w = nullableNonNegativeInt(value.weight_kg);
  const ports = nullableNonNegativeInt(value.port_count);
  if (u === null && p === null && w === null && ports === null) return null;
  return {
    quantity: q,
    u_size: u,
    rated_power_w: p,
    weight_kg: w,
    port_count: ports,
  };
}

function intent(value, entities) {
  const input = normalizeIntent(value);
  if (!supportedIntentTypes.has(input.type)) {
    throw invalid(`Unsupported assistant intent: ${input.type}`);
  }
  if (input.type === "answer") {
    return { type: "answer" };
  }
  if (input.type === "propose_placement") {
    const dr = deviceRequest(input.device_request);
    return { type: "propose_placement", device_request: dr };
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
  const evidenceList = normalizeEvidenceArray(input.evidence);
  if (evidenceList.length > 20) {
    throw invalid("Assistant evidence must be an array with at most 20 items");
  }
  const entities = { entityIds, entityTypes };
  const evidence = evidenceList.map((item) => reference(
    item,
    "Assistant evidence",
    entities,
    evidenceTypes,
  ));

  return {
    answer,
    evidence: [...new Map(evidence.map((item) => [`${item.type}:${item.id}`, item])).values()],
    intent: intent(input.intent ?? { type: "answer" }, entities),
  };
}

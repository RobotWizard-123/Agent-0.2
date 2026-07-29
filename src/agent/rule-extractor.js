// Rule-based fallback extractor for natural-language device requests.
// Used when the LLM-backed agent is unavailable or returns invalid output.
// Returns a partially populated device; the caller decides whether the
// extracted fields are sufficient to build a proposal.



const REQUIRED = ["u_size", "rated_power_w", "weight_kg", "network_ports"];

const RACK_PATTERN = /\bCAB-\d{2}\b/gi;
const U_PATTERN = /(\d{1,2})\s*[uU](?!\w)/g;
const W_PATTERN = /(\d+(?:\.\d+)?)\s*[kK]?[wW]\b/g;
const W_KW_PATTERN = /(\d+(?:\.\d+)?)\s*[kK]\s*[wW]\b/g;
const KG_PATTERN = /(\d+(?:\.\d+)?)\s*(?:kg|公斤|KG)\b/g;
const PORTS_PATTERN = /(\d{1,3})\s*(?:个?\s*)?(?:网\s*口|端口|网口|端口数)/g;
const COUNT_PATTERN = /(\d{1,3})\s*台/g;
const HOSTNAME_PATTERN = /(?:hostname|主机名)\s*[:：=]?\s*([A-Za-z][A-Za-z0-9._-]{1,63})/i;
const MODEL_PATTERN = /(?:型号|设备型号|model)\s*[:：=]?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,63})/i;

function firstMatch(text, pattern) {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return m ? m[1] : null;
}

function allMatches(text, pattern) {
  pattern.lastIndex = 0;
  const out = [];
  let m;
  while ((m = pattern.exec(text)) !== null) out.push(m[1] ?? m[0]);
  return out;
}

function toInt(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function toPowerW(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  // If the matched string already contains "k" or "K", multiply by 1000.
  // (The W_PATTERN and W_KW_PATTERN are matched separately; this helper takes
  // the number group and decides via the surrounding context, but we also let
  // the caller pass a kw hint.)
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function extractDeviceFromText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { device: null, missing: [...REQUIRED], confidence: "low", source: "rule" };
  }
  const source = text.trim();
  // DEBUG
  

  // U size: take the first occurrence (smallest reasonable value to avoid
  // capturing "1U 设备" 误抓 > 10 的数字).
  const uCandidates = allMatches(source, U_PATTERN)
    .map((v) => toInt(v, null))
    .filter((n) => n !== null && n > 0 && n <= 10);
  const uSize = uCandidates[0] ?? null;

  // Power: try kW first, then plain W.
  const kwCandidates = allMatches(source, W_KW_PATTERN)
    .map((v) => Number(v))
    .filter(Number.isFinite)
    .map((n) => Math.round(n * 1000));
  const wCandidates = allMatches(source, W_PATTERN)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 10); // filter out "1U 2端口" false-positives
  const ratedPowerW = kwCandidates[0] ?? wCandidates[0] ?? null;

  // Weight
  const weightCandidates = allMatches(source, KG_PATTERN)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 1000);
  const weightKg = weightCandidates[0] ?? null;

  // Ports
  const portCandidates = allMatches(source, PORTS_PATTERN)
    .map((v) => toInt(v, null))
    .filter((n) => n !== null && n > 0 && n <= 256);
  const networkPorts = portCandidates[0] ?? null;

  // Racks
  const racks = [...new Set(allMatches(source, RACK_PATTERN).map((r) => r.toUpperCase()))];

  // Count
  const countCandidates = allMatches(source, COUNT_PATTERN)
    .map((v) => toInt(v, null))
    .filter((n) => n !== null && n > 0 && n <= 100);
  const count = countCandidates[0] ?? 1;

  // Hostname / model hints
  const hostname = (source.match(HOSTNAME_PATTERN) || [])[1] || null;
  const modelHint = (source.match(MODEL_PATTERN) || [])[1] || null;

  // Default id; orchestrator / plan-service may rename.
  const id = "SRV-AGENT";

  const device = {
    id,
    count,
    u_size: uSize,
    rated_power_w: ratedPowerW,
    real_power_w: null,
    weight_kg: weightKg,
    network_ports: networkPorts,
    preferred_rack_ids: racks,
    hostname,
    model: modelHint,
    business: null,
    owner: null,
  };

  const missing = REQUIRED.filter((field) => device[field] === null || device[field] === undefined);
  const confidence = missing.length === 0 ? "high" : missing.length <= 2 ? "medium" : "low";

  return { device, missing, confidence, source: "rule" };
}

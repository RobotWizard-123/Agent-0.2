import { get, post } from "./api.js";

const listeners = new Set();
let topologyRequestSerial = 0;
let candidateSelectionRequest = null;
const state = {
  session: { authenticated: false, actor: null, role: null },
  route: { name: "overview" },
  loading: true,
  error: null,
  room: null,
  racks: [],
  alarms: [],
  topologyPower: null,
  topologyNetwork: null,
  config: null,
  placementSettings: null,
  selectedRack: null,
  selectedDeviceTopology: null,
  currentPlan: null,
  lastExecution: null,
  topologyResult: null,
  selectedAlarm: null,
  diagnosis: null,
  audit: [],
};

function notify() {
  for (const listener of listeners) listener(getState());
}

function assign(patch) {
  Object.assign(state, patch);
  notify();
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRoute(name, id = null) {
  assign({ route: { name, id }, error: null, selectedDeviceTopology: null });
}

export function getAssistantUiContext() {
  return {
    route: state.route.name,
    entity_id: state.route.id ?? null,
    filters: {},
  };
}

export function adoptAssistantPlan(plan) {
  const remediation = plan.kind === "alarm_remediation";
  assign({
    currentPlan: plan,
    lastExecution: null,
    route: remediation
      ? { name: "alarms", id: plan.request?.alarm_id ?? null }
      : { name: "agent" },
  });
  return plan;
}

export async function refreshRoom() {
  assign({ loading: true, error: null });
  try {
    const [room, racks, alarms, topologyPower, topologyNetwork, config, placementSettings] = await Promise.all([
      get("/api/room"),
      get("/api/racks"),
      get("/api/alarms"),
      get("/api/topology/power"),
      get("/api/topology/network"),
      get("/api/config/status"),
      get("/api/settings/placement-strategy"),
    ]);
    const selectedAlarm = state.selectedAlarm
      ? alarms.items.find((alarm) => alarm.id === state.selectedAlarm.id) ?? state.selectedAlarm
      : null;
    assign({ room, racks: racks.items, alarms: alarms.items, topologyPower, topologyNetwork, config, placementSettings, selectedAlarm, loading: false });
  } catch (error) {
    assign({ loading: false, error });
    throw error;
  }
}

export async function loadPlacementSettings() {
  const placementSettings = await get("/api/settings/placement-strategy");
  assign({ placementSettings });
  return placementSettings;
}

export async function updatePlacementDefault(strategyId) {
  const placementSettings = await post("/api/settings/placement-strategy", { strategy_id: strategyId });
  assign({ placementSettings });
  await loadAudit();
  return placementSettings;
}

export async function loadRack(id) {
  assign({ loading: true, selectedRack: null, selectedDeviceTopology: null });
  try {
    const selectedRack = await get(`/api/racks/${encodeURIComponent(id)}`);
    assign({ selectedRack, loading: false });
  } catch (error) {
    assign({ loading: false, error });
  }
}

export async function loadDeviceTopology(id) {
  try {
    const selectedDeviceTopology = await get(`/api/topology/devices/${encodeURIComponent(id)}`);
    assign({ selectedDeviceTopology });
  } catch (error) {
    assign({ error });
  }
}

export async function createPlan(request) {
  const currentPlan = await post("/api/plans", request);
  assign({ currentPlan, lastExecution: null });
  await loadAudit();
  return currentPlan;
}

export async function createRemovalPlan(device) {
  const currentPlan = await post("/api/plans", {
    kind: "removal",
    device_id: device.id,
    actions: [{
      type: "remove_device",
      device_id: device.id,
      rack_id: device.rack_id,
      device: {
        id: device.id,
        hostname: device.hostname,
        business_id: device.business_id,
        replica_group: device.replica_group,
        maintenance_window: device.maintenance_window,
      },
    }],
    reasons: ["执行前校验可移动性、维护窗口、业务归属与副本风险"],
  });
  assign({
    currentPlan,
    lastExecution: null,
    selectedRack: null,
    selectedDeviceTopology: null,
    route: { name: "agent" },
  });
  await loadAudit();
  return currentPlan;
}

export async function selectPlanCandidate(planId, candidateId) {
  if (candidateSelectionRequest) return candidateSelectionRequest;
  candidateSelectionRequest = post(`/api/plans/${encodeURIComponent(planId)}/select-candidate`, { candidate_id: candidateId })
    .then((currentPlan) => {
      assign({ currentPlan });
      return currentPlan;
    })
    .catch((error) => {
      if (["PLAN_NOT_FOUND", "PLAN_STALE"].includes(error.code)) {
        assign({ currentPlan: null, lastExecution: null });
      }
      throw error;
    })
    .finally(() => {
      candidateSelectionRequest = null;
    });
  return candidateSelectionRequest;
}

export async function confirmPlan(planId) {
  const result = await post(`/api/plans/${encodeURIComponent(planId)}/confirm`);
  assign({
    currentPlan: result.plan,
    lastExecution: result.execution,
    selectedAlarm: result.alarm ?? state.selectedAlarm,
    selectedRack: null,
    selectedDeviceTopology: null,
  });
  await refreshRoom();
  await loadAudit();
  return result;
}

export async function loadTopology(query = "") {
  const requestSerial = ++topologyRequestSerial;
  const normalized = query.trim();
  const deviceQuery = normalized.toUpperCase().startsWith("SRV-");
  let topologyResult;
  if (deviceQuery) {
    topologyResult = { kind: "device", query: normalized, device: await get(`/api/topology/devices/${encodeURIComponent(normalized)}`) };
  } else {
    const [power, network] = await Promise.all([get("/api/topology/power"), get("/api/topology/network")]);
    topologyResult = { kind: "aggregate", query: normalized, power, network };
  }
  if (requestSerial === topologyRequestSerial) assign({ topologyResult });
  return topologyResult;
}

export async function triggerDemoAlarm(scenario) {
  const selectedAlarm = await post("/api/demo/alarms", { scenario });
  assign({ selectedAlarm, diagnosis: null, currentPlan: null, lastExecution: null });
  await refreshRoom();
  await loadAudit();
  return selectedAlarm;
}

export function selectAlarm(id) {
  assign({ selectedAlarm: state.alarms.find((alarm) => alarm.id === id) ?? null, diagnosis: null, currentPlan: null, lastExecution: null });
}

export async function acknowledgeAlarm(id) {
  const selectedAlarm = await post(`/api/alarms/${encodeURIComponent(id)}/acknowledge`);
  const alarms = await get("/api/alarms");
  assign({ alarms: alarms.items, selectedAlarm });
  await loadAudit();
  return selectedAlarm;
}

export async function diagnoseAlarm(id) {
  const diagnosis = await post(`/api/alarms/${encodeURIComponent(id)}/diagnose`);
  const alarms = await get("/api/alarms");
  assign({ alarms: alarms.items, selectedAlarm: alarms.items.find((alarm) => alarm.id === id), diagnosis });
  await loadAudit();
  return diagnosis;
}

export async function createRemediation(id) {
  const currentPlan = await post(`/api/alarms/${encodeURIComponent(id)}/remediation`);
  const alarms = await get("/api/alarms");
  assign({ alarms: alarms.items, selectedAlarm: alarms.items.find((alarm) => alarm.id === id), currentPlan });
  await loadAudit();
  return currentPlan;
}

export async function loadAudit() {
  const result = await get("/api/audit");
  assign({ audit: result.items });
  return result.items;
}

export async function resetDemoState() {
  await post("/api/demo/reset");
  assign({
    route: { name: "overview" },
    currentPlan: null,
    lastExecution: null,
    selectedAlarm: null,
    diagnosis: null,
    topologyResult: null,
    selectedRack: null,
  });
  await refreshRoom();
  await loadAudit();
}

export async function login(username, password) {
  const session = await post("/api/auth/login", { username, password });
  assign({ session, route: { name: "overview" } });
  await refreshRoom();
}

export async function logout() {
  await post("/api/auth/logout");
  assign({
    session: { authenticated: false, actor: null, role: null },
    room: null,
    racks: [],
    alarms: [],
    topologyPower: null,
    topologyNetwork: null,
    placementSettings: null,
    selectedRack: null,
    currentPlan: null,
    selectedAlarm: null,
    audit: [],
  });
}

export async function bootstrap() {
  const initialSession = state.session;
  try {
    const session = await get("/api/auth/session");
    if (state.session !== initialSession) return;
    assign({ session, loading: false });
    if (session.authenticated) await refreshRoom();
  } catch (error) {
    if (state.session !== initialSession) return;
    assign({ loading: false, error });
  }
}

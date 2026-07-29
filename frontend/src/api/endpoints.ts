import { get, post } from "./client";
import type {
  Room,
  Rack,
  RackDetail,
  Alarm,
  Diagnosis,
  Plan,
  PlanConfirmResult,
  AuditEntry,
  Session,
  RuntimeConfig,
  AgentStatusResult,
  PlacementSettings,
  DeviceTopology,
  NetworkTopology,
  PowerTopology,
  AssistantSession,
  AssistantMessage,
  AssistantFeedbackEvent,
} from "../types/domain";
import type {
  LoginInput,
  PlanCreateInput,
  SelectCandidateInput,
  TriggerAlarmInput,
  AssistantMessageInput,
  AssistantFeedbackParams,
} from "../types/api";

export const api = {
  auth: {
    login: (input: LoginInput) =>
      post<{ authenticated: boolean; actor: string; role: string }>("/api/auth/login", input),
    logout: () => post<{ authenticated: boolean; actor: null; role: null }>("/api/auth/logout"),
    session: () => get<Session>("/api/auth/session"),
  },

  room: {
    get: () => get<Room>("/api/room"),
  },

  racks: {
    list: () => get<{ state_version: number; items: Rack[] }>("/api/racks"),
    detail: (id: string) => get<RackDetail>(`/api/racks/${encodeURIComponent(id)}`),
  },

  devices: {
    get: (id: string) => get<RackDetail["devices"][number]>(`/api/devices/${encodeURIComponent(id)}`),
  },

  capacity: {
    list: () => get<{ state_version: number; items: unknown[] }>("/api/capacity"),
  },

  config: {
    status: () => get<RuntimeConfig>("/api/config/status"),
  },

  topology: {
    device: (id: string) =>
      get<DeviceTopology & { state_version: number }>(`/api/topology/devices/${encodeURIComponent(id)}`),
    power: () => get<PowerTopology & { state_version: number }>("/api/topology/power"),
    network: () => get<NetworkTopology & { state_version: number }>("/api/topology/network"),
  },

  plans: {
    create: (input: PlanCreateInput) => post<Plan>("/api/plans", input),
    get: (id: string) => get<Plan>(`/api/plans/${encodeURIComponent(id)}`),
    confirm: (id: string) =>
      post<PlanConfirmResult>(`/api/plans/${encodeURIComponent(id)}/confirm`),
    selectCandidate: (id: string, input: SelectCandidateInput) =>
      post<Plan>(`/api/plans/${encodeURIComponent(id)}/select-candidate`, input),
  },

  alarms: {
    list: () => get<{ state_version: number; items: Alarm[] }>("/api/alarms"),
    get: (id: string) => get<Alarm>(`/api/alarms/${encodeURIComponent(id)}`),
    acknowledge: (id: string) => post<Alarm>(`/api/alarms/${encodeURIComponent(id)}/acknowledge`),
    diagnose: (id: string) => post<Diagnosis>(`/api/alarms/${encodeURIComponent(id)}/diagnose`),
    remediation: (id: string) =>
      post<Plan>(`/api/alarms/${encodeURIComponent(id)}/remediation`),
  },

  demo: {
    triggerAlarm: (input: TriggerAlarmInput) => post<Alarm>("/api/demo/alarms", input),
    reset: () => post<unknown>("/api/demo/reset"),
  },

  audit: {
    list: () => get<{ state_version: number; items: AuditEntry[] }>("/api/audit"),
  },

  settings: {
    placement: () => get<PlacementSettings>("/api/settings/placement-strategy"),
    updatePlacement: (strategyId: string) =>
      post<PlacementSettings>("/api/settings/placement-strategy", { strategy_id: strategyId }),
  },

  agent: {
    status: (force = false) =>
      get<AgentStatusResult>(`/api/agent/status${force ? "?force=1" : ""}`),
  },

  health: {
    live: () => get<{ status: string; application_version: string }>("/health/live"),
    ready: () => get<unknown>("/health/ready"),
  },

  assistant: {
    session: () => get<AssistantSession>("/api/assistant/session"),
    feedback: (params: AssistantFeedbackParams) => {
      const search = new URLSearchParams({
        cursor: String(params.cursor),
        route: params.route,
      });
      if (params.entity_id) search.set("entity_id", params.entity_id);
      return get<{ events: AssistantFeedbackEvent[]; next_cursor: number; state_version: number }>(
        `/api/assistant/feedback?${search}`,
      );
    },
    send: (input: AssistantMessageInput) =>
      post<{
        message_id: string;
        answer: string;
        evidence: { type: string; id: string; label?: string }[];
        proposal: import("../types/domain").AssistantProposal | null;
        intent: import("../types/domain").AssistantIntent;
        model_status: string;
        state_version: number;
      }>("/api/assistant/messages", input),
    acceptProposal: (proposalId: string) =>
      post<Plan>(`/api/assistant/proposals/${encodeURIComponent(proposalId)}/plans`),
  },
};

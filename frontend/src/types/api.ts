export interface ApiErrorBody {
  error: string;
  message: string;
  details?: {
    plan_id?: string;
    state_version?: number;
    plan_version?: number;
    blockers?: unknown[];
    retry_after_ms?: number;
  };
}

export interface ListResponse<T> {
  state_version: number;
  items: T[];
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  session: import("./domain").Session;
  cookie: string;
}

export interface PlanCreateInput {
  kind: import("./domain").PlanKind;
  device?: Partial<import("./domain").RackDevice>;
  text?: string;
  strategy_id?: string;
  fail_at?: string | null;
  actions?: import("./domain").PlanAction[];
  reasons?: string[];
  risk?: import("./domain").RiskLevel;
}

export interface SelectCandidateInput {
  candidate_id: string;
}

export interface TriggerAlarmInput {
  scenario: import("./domain").AlarmScenario;
}

export interface AssistantMessageInput {
  message: string;
  ui_context: {
    route: string;
    entity_id: string | null;
    filters: Record<string, string>;
  };
}

export interface AssistantFeedbackParams {
  cursor: number;
  route: string;
  entity_id?: string;
}

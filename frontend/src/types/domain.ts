export type DataSource = "design" | "rule" | "demo" | "telemetry" | "unknown";

export type RackRole = "server" | "network";

export type DeviceStatus = "running" | "pending" | "cancelled";

export type DeviceCriticality = "normal" | "important" | "critical";

export type AlarmSeverity = "warning" | "critical";

export type AlarmStatus =
  | "open"
  | "acknowledged"
  | "diagnosing"
  | "action_pending"
  | "executing"
  | "resolved";

export type AlarmScenario =
  | "power_high"
  | "placement_conflict"
  | "collector_offline"
  | "model_offline"
  | "execution_failure";

export type PlanKind =
  | "placement"
  | "natural_language"
  | "alarm_remediation"
  | "removal"
  | "change";

export type PlanStatus =
  | "draft"
  | "planned"
  | "validated"
  | "awaiting_confirmation"
  | "locked"
  | "executing"
  | "succeeded"
  | "failed"
  | "input_required";

export type StrategyId = "balanced_optimal" | "consolidated" | "load_balanced";

export type RiskLevel = "safe" | "warning" | "blocked";

export type AgentStatus = "available" | "degraded" | "unconfigured";

export type AssistantModelStatus = "available" | "degraded" | "not_configured";

export type AssistantSyncStatus = "idle" | "syncing" | "ready" | "interrupted";

export interface Room {
  id: string;
  name: string;
  rack_count: number;
  server_rack_count: number;
  network_rack_count: number;
  data_source: DataSource;
  state_version?: number;
}

export interface PowerSource {
  id: string;
  name: string;
  calculated_load_w: number | null;
  rack_ids: string[];
  data_source: DataSource;
}

export interface FloorPosition {
  row: number;
  column: number;
  data_source: DataSource;
}

export interface RackLayer {
  id: string;
  start_u: number;
  end_u: number;
  capacity_u: number;
  reserve_u: number;
  reserve_start_u: number;
  reserve_end_u: number;
  usable_end_u: number;
  usable_u: number;
  used_u?: number;
  free_intervals?: FreeInterval[];
  devices?: RackDevice[];
}

export interface FreeInterval {
  rack_id: string;
  layer_id: string;
  start_u: number;
  end_u: number;
  size_u: number;
}

export interface RackCapacity {
  rack_id: string;
  source: string;
  design_power_w: number;
  rated_power_used_w: number;
  real_power_w: number | null;
  real_power_source: string;
  used_u: number;
  usable_u: number;
  used_weight_kg: number;
  max_weight_kg: number;
  used_ports: number;
  port_limit: number;
  largest_contiguous_u: number;
  layers: RackLayer[];
}

export interface Rack {
  id: string;
  name: string;
  role: RackRole;
  height_u: number;
  dividers_u: [number, number, number];
  reserve_u_per_layer: number;
  max_weight_kg: number;
  network_port_limit: number;
  network_switch_id: string;
  pdu_ids: string[];
  floor_position: FloorPosition;
  data_source: DataSource;
  source_id: string;
  design_power_w: number;
  breaker: string;
  cable: string;
  alias?: string;
  capacity: RackCapacity;
  state_version?: number;
}

export interface RackDetail extends Rack {
  layers: RackLayer[];
  devices: RackDevice[];
  telemetry: TelemetryReading;
}

export interface TelemetryReading {
  value_w: number | null;
  source: string;
  collected_at: string | null;
  status: string;
}

export interface RackDevice {
  id: string;
  asset_id?: string;
  hostname?: string;
  model?: string;
  serial?: string;
  rack_id: string;
  layer_id: string;
  start_u: number;
  u_size: number;
  rated_power_w: number;
  real_power_w: number | null;
  weight_kg: number;
  network_ports: number;
  ip?: string;
  vlan?: string;
  business?: string;
  business_id?: string;
  owner?: string;
  replica_group?: string | null;
  movable?: boolean;
  criticality?: DeviceCriticality;
  maintenance_window?: string | null;
  status: DeviceStatus;
  data_source: DataSource;
  placement?: DevicePlacement;
}

export interface DevicePlacement {
  device_id: string;
  rack_id: string;
  layer_id: string;
  start_u: number;
  end_u: number;
}

export interface Alarm {
  id: string;
  scenario: AlarmScenario;
  source: string;
  severity: AlarmSeverity;
  object_type: string;
  object_id: string;
  trigger_code: string;
  condition_id: string;
  evidence: unknown;
  status: AlarmStatus;
  opened_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  recovery_verified: boolean;
}

export interface Diagnosis {
  id: string;
  alarm_id: string;
  root_cause_code: string;
  summary: string;
  confidence: number;
  evidence: unknown;
  affected_chain: AffectedChainNode[];
  recommended_actions: PlanAction[];
  status: string;
  created_at: string;
  created_by: string;
  plan_id: string | null;
}

export interface AffectedChainNode {
  type: string;
  id: string | null;
  label: string;
  source: DataSource;
}

export interface PlanAction {
  type: "place_device" | "move_device" | "remove_device" | "set_dividers" | "set_service_health" | "clear_demo_condition";
  rack_id?: string;
  layer_id?: string;
  start_u?: number;
  device_id?: string;
  device?: Partial<RackDevice>;
  dividers_u?: number[];
  service?: string;
  status?: string;
  condition_id?: string;
}

export interface PlanCandidate {
  id: string;
  rack_id: string;
  layer_id: string | null;
  actions: PlanAction[];
  validation: PlanValidation;
  risk: RiskLevel;
  reasons: string[];
  score?: number | null;
  baseline_score?: number | null;
  score_breakdown?: Record<string, ScoreBreakdownItem>;
  weights?: Record<string, number>;
  evidence?: CandidateEvidence;
  impact?: MigrationImpact | null;
}

export interface ScoreBreakdownItem {
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
}

export interface CandidateEvidence {
  projected_ratios: {
    power: number;
    u: number;
    weight: number;
    ports: number;
  };
  largest_contiguous_u_after: number;
  activated_empty_rack: boolean;
  business_distance: number;
  link_distance: number;
  source_imbalance: number;
  migration_count: number;
}

export interface MigrationImpact {
  devices: string[];
  businesses: string[];
  maintenance_window: string | null;
  steps: string[];
  rollback_actions: PlanAction[];
}

export interface PlanValidation {
  allowed: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  before: Record<string, RackCapacity>;
  after: Record<string, RackCapacity>;
  projected_devices?: RackDevice[];
}

export interface ValidationIssue {
  code: string;
  target_id: string;
  message: string;
  severity: "blocker" | "warning";
  evidence: Record<string, unknown>;
}

export interface Plan {
  id: string;
  kind: PlanKind;
  request: PlanRequest;
  status: PlanStatus;
  timeline: { status: string; at: string }[];
  created_at: string;
  created_by: string;
  base_version: number;
  snapshot_version: number;
  strategy_id: string | null;
  baseline_candidate_id: string | null;
  original_candidates: PlanCandidate[];
  selected_candidate_id: string | null;
  baseline_score: number | null;
  agent_score: number | null;
  actions: PlanAction[];
  reasons: string[];
  risk: RiskLevel;
  validation: PlanValidation;
  confirmation_count: number;
  confirmed_at: string | null;
  confirmed_by: string | null;
  execution: PlanExecution | null;
  agent_status: string;
  agent_adjustment: AgentAdjustment | null;
  agent_intervention: AgentIntervention | null;
  migration_impact: MigrationImpact | null;
  fallback?: string;
  error_code?: string;
  missing_fields?: string[];
}

export interface PlanRequest {
  kind: PlanKind;
  device?: Partial<RackDevice>;
  text?: string;
  strategy_id?: string;
  fail_at?: string | null;
  actions?: PlanAction[];
  reasons?: string[];
  risk?: RiskLevel;
  alarm_id?: string;
  diagnosis_id?: string;
  candidate_id?: string;
  limit?: number;
  natural_language?: string;
}

export interface PlanExecution {
  ok: boolean;
  code: string | null;
  message: string;
  stages: string[];
  rolled_back: boolean;
}

export interface AgentAdjustment {
  accepted: boolean;
  reason_code: string | null;
  reason: string;
  proposed_actions?: PlanAction[];
}

export interface AgentIntervention {
  status: string;
  model: string | null;
  reason?: string;
  baseline_candidate_id: string | null;
  final_candidate_id: string | null;
  requested_candidate_id: string | null;
  weight_multipliers: Record<string, number>;
  accepted_alternatives: { id: string; score: number }[];
  rejected_alternatives: { id: string; reason_code: string }[];
}

export interface PlanConfirmResult {
  plan: Plan;
  execution: PlanExecution;
  state_version: number;
  alarm?: Alarm;
}

export interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  at: string;
  details: Record<string, unknown>;
}

export interface Session {
  authenticated: boolean;
  actor: string | null;
  role: "admin" | "viewer" | null;
}

export interface RuntimeConfig {
  agent_configured: boolean;
  agent_model: string | null;
  authentication_configured: boolean;
  telemetry_status: string;
  application_version: string;
}

export interface AgentStatusResult {
  status: AgentStatus;
  configured: boolean;
  model: string | null;
  base_url: string | null;
  error_code: string | null;
  error_message: string | null;
  probe_ms: number;
  probed_at: string;
  cached: boolean;
}

export interface PlacementSettings {
  default_strategy_id: StrategyId;
  state_version: number;
}

export interface ServiceHealth {
  model: { status: string; checked_at: string | null };
  collector: { status: string; checked_at: string | null };
}

export interface TopologyNode {
  type: string;
  id: string | null;
  label: string;
  source: DataSource;
  details?: Record<string, unknown>;
}

export interface DeviceTopology {
  device: RackDevice;
  rack: Rack;
  power: TopologyNode[];
  network: TopologyNode[];
  redundancy: string;
  missing_fields: string[];
}

export interface NetworkTopology {
  external_uplink: { label: string; data_source: DataSource };
  core: { id: string; name: string; uplink: string; ports: number; data_source: DataSource };
  access_switches: AccessSwitch[];
  redundancy: { status: string; data_source: DataSource };
}

export interface AccessSwitch {
  id: string;
  name: string;
  uplink: string;
  downlink: string;
  downlink_ports: number;
  connected_rack_ids: string[];
  data_source: DataSource;
}

export interface PowerTopology {
  room: Room;
  power_sources: PowerSource[];
  cabinets: { id: string; role: RackRole; design_power_w: number; source_id: string }[];
  redundancy: { status: string; data_source: DataSource };
}

export interface AssistantMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  at?: string;
  evidence?: AssistantEvidence[];
  proposal?: AssistantProposal | null;
  intent?: AssistantIntent;
  model_status?: AssistantModelStatus;
  state_version?: number;
}

export interface AssistantEvidence {
  type: string;
  id: string;
  label?: string;
}

export interface AssistantIntent {
  type: "answer" | "navigate" | "propose_placement" | "propose_remediation";
  target?: { type: string; id: string };
  alarm_id?: string;
}

export interface AssistantProposal {
  id: string;
  type: "placement" | "remediation";
  payload: { device?: Partial<RackDevice>; alarm_id?: string };
  state_version: number;
  created_at: string;
  created_by: string;
  used: boolean;
  plan_id?: string;
}

export interface AssistantFeedbackEvent {
  id: string;
  type: string;
  severity: string;
  entity: { type: string; id: string };
  message: string;
  state_version: number;
  occurred_at: string;
  cursor: number;
}

export interface AssistantSession {
  messages: AssistantMessage[];
  feedback: AssistantFeedbackEvent[];
  next_cursor: number;
}

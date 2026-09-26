/**
 * PHASE 9 — REAL-TIME LOGISTICS CONTROL TOWER (client contract).
 *
 * Every figure on the Control Tower is computed by the database over the
 * authoritative logistics spine (packages, dispatch jobs, routes, stops,
 * manifests, warehouse operations, carrier capacity, freight finance, offline
 * journal). This module only transports those verdicts.
 *
 * Laws honoured here:
 *   - No dashboard-side arithmetic on operational truth. If a snapshot fails,
 *     callers render DATA_NOT_AVAILABLE — never a confident zero.
 *   - Every command terminates in a server verdict (`ct_command_execute`),
 *     which authorises, executes through the existing authoritative RPCs and
 *     writes an observability row. The client never mutates spine tables.
 *   - Authorisation is a server fact. `AUTHORIZATION_DENIED` is surfaced as a
 *     withheld surface, never as an empty dataset.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

const db = untypedDb;

export const NOT_AVAILABLE = "DATA_NOT_AVAILABLE";

export interface CtEnvelope {
  ok: boolean;
  code?: string;
  category?: string;
  message?: string;
  reason?: string;
  retryable?: boolean;
  request_id?: string;
  correlation_id?: string;
}

export type CtResult<T> =
  | { ok: true; data: T; denied?: false; code?: string; message?: string; reason?: string }
  | { ok: false; data?: undefined; denied: boolean; code: string; message: string; reason?: string };

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<CtResult<T>> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    return { ok: false, denied: false, code: "TRANSPORT_ERROR", message: error.message };
  }
  const env = (data ?? {}) as CtEnvelope;
  if (env.ok === false) {
    return {
      ok: false,
      denied: env.code === "AUTHORIZATION_DENIED",
      code: env.code ?? "UNKNOWN",
      message: env.message ?? "This request could not be completed.",
      reason: env.reason,
    };
  }
  return { ok: true, data: data as T };
}

/* ------------------------------------------------------------------ */
/* Operational vocabulary — mirrors the database state machine exactly */
/* ------------------------------------------------------------------ */

export type SlaState = "GREEN" | "AMBER" | "RED" | "BREACHED" | "MET" | "UNKNOWN";

export type OperationalState =
  | "ON_TRACK"
  | "AT_RISK"
  | "DELAYED"
  | "EXCEPTION"
  | "AWAITING_ACTION"
  | "POD_PENDING"
  | "RETURN_REQUIRED"
  | "CAPACITY_CONSTRAINED"
  | "COMPLIANCE_BLOCKED";

export const OPERATIONAL_STATE_LABEL: Record<OperationalState, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  DELAYED: "Delayed",
  EXCEPTION: "Exception",
  AWAITING_ACTION: "Awaiting action",
  POD_PENDING: "Proof of delivery pending",
  RETURN_REQUIRED: "Return required",
  CAPACITY_CONSTRAINED: "Capacity constrained",
  COMPLIANCE_BLOCKED: "Compliance blocked",
};

export const OPERATIONAL_STATE_TONE: Record<OperationalState, "ok" | "warn" | "danger" | "info"> = {
  ON_TRACK: "ok",
  AT_RISK: "warn",
  DELAYED: "danger",
  EXCEPTION: "danger",
  AWAITING_ACTION: "info",
  POD_PENDING: "warn",
  RETURN_REQUIRED: "warn",
  CAPACITY_CONSTRAINED: "warn",
  COMPLIANCE_BLOCKED: "danger",
};

export const SLA_TONE: Record<SlaState, "ok" | "warn" | "danger" | "info"> = {
  GREEN: "ok",
  MET: "ok",
  AMBER: "warn",
  RED: "danger",
  BREACHED: "danger",
  UNKNOWN: "info",
};

/* ------------------------------- Board ---------------------------- */

export interface BoardCounters {
  active_packages: number;
  active_orders: number;
  active_dispatch_jobs: number;
  active_routes: number;
  active_stops: number;
  active_manifests: number;
  active_drivers: number;
  active_vehicles: number;
  hub_operations_24h: number;
  open_exceptions: number;
  failed_deliveries_24h: number;
  pod_pending: number;
  open_returns: number;
  open_deviations: number;
  sla_at_risk: number;
  sla_breached: number;
  capacity_constrained: number;
  warehouse_backlog: number;
  recon_exceptions: number;
  open_alerts: number;
  offline_conflicts: number;
}

export interface BoardSnapshot {
  ok: true;
  measured_at: string;
  policy_scope: string | null;
  counters: BoardCounters;
}

export const BOARD_LENSES = [
  "packages",
  "dispatch",
  "routes",
  "stops",
  "exceptions",
  "pod_pending",
  "returns",
] as const;
export type BoardLens = (typeof BOARD_LENSES)[number];

export const BOARD_LENS_LABEL: Record<BoardLens, string> = {
  packages: "Shipments",
  dispatch: "Dispatch jobs",
  routes: "Routes",
  stops: "Stops",
  exceptions: "Exceptions",
  pod_pending: "Proof of delivery",
  returns: "Returns",
};

export interface BoardRow {
  id: string;
  reference: string | null;
  status: string | null;
  module?: string | null;
  severity?: string | null;
  assigned_driver_id?: string | null;
  vehicle_id?: string | null;
  created_at?: string | null;
  delivered_at?: string | null;
  deadline?: string | null;
  sla_state?: SlaState;
  op_state?: OperationalState | string;
  location?: string | null;
  party?: string | null;
  minutes_remaining?: number | null;
  package_id?: string | null;
  route_id?: string | null;
  order_id?: string | null;
  stop_count?: number | null;
  attempts?: number | null;
  disposition?: string | null;
  narrative?: string | null;
  reason_code?: string | null;
  owner_role?: string | null;
}

export interface BoardPage {
  ok: true;
  lens: BoardLens;
  total: number;
  limit: number;
  offset: number;
  measured_at: string;
  rows: BoardRow[];
}

export const boardSnapshot = () => call<BoardSnapshot>("ct_board_snapshot");

export const boardRows = (params: {
  lens: BoardLens;
  limit?: number;
  offset?: number;
  state?: string | null;
  module?: string | null;
  search?: string | null;
}) =>
  call<BoardPage>("ct_board_rows", {
    _lens: params.lens,
    _limit: params.limit ?? 50,
    _offset: params.offset ?? 0,
    _state: params.state ?? null,
    _module: params.module ?? null,
    _search: params.search ?? null,
  });

/* ------------------------------ Live map -------------------------- */

export interface MapDriver {
  driver_id: string;
  vehicle_id: string | null;
  lat: number | null;
  lng: number | null;
  speed_kph: number | null;
  available: boolean | null;
  updated_at: string;
}
export interface MapHub {
  id: string;
  code: string;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  max_capacity: number | null;
  current_capacity: number | null;
}
export interface MapStop {
  id: string;
  route_id: string;
  sequence: number;
  status: string;
  lat: number | null;
  lng: number | null;
  eta: string | null;
  type: string | null;
}
export interface MapException {
  id: string;
  reference: string | null;
  severity: string | null;
  kind: string | null;
  lat: number | null;
  lng: number | null;
  package_id: string | null;
}
export interface MapDeviation {
  id: string;
  route_id: string;
  kind: string | null;
  severity: string | null;
  distance_m: number | null;
  detected_at: string | null;
}
export interface LiveMap {
  ok: true;
  measured_at: string;
  drivers: MapDriver[];
  hubs: MapHub[];
  stops: MapStop[];
  exceptions: MapException[];
  deviations: MapDeviation[];
}

export const liveMap = (city?: string | null, hubId?: string | null) =>
  call<LiveMap>("ct_live_map", { _city: city ?? null, _hub: hubId ?? null });

/* --------------------------- Domain snapshots --------------------- */

export interface CapacitySnapshot {
  ok: true;
  measured_at: string;
  threshold_pct: number;
  carrier_slots: {
    id: string;
    slot_reference: string | null;
    carrier: string | null;
    corridor: string | null;
    vehicle_type: string | null;
    offered_kg: number | null;
    reserved_kg: number | null;
    committed_kg: number | null;
    consumed_kg: number | null;
    remaining_kg: number | null;
    utilisation_pct: number | null;
    state: string;
    effective_from: string | null;
    effective_until: string | null;
  }[];
  hubs: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    capacity_unit: string | null;
    max_capacity: number | null;
    current_capacity: number | null;
    utilisation_pct: number | null;
  }[];
  reservations: { active: number; expiring_24h: number };
}

export interface WarehouseSnapshot {
  ok: true;
  measured_at: string;
  backlogs: { receiving: number; pick: number; pack: number; returns: number; staged: number };
  operations_24h: { operation_type: string; events: number; last_at: string }[];
  dock_activity_24h: number;
}

export interface CarrierSnapshot {
  ok: true;
  measured_at: string;
  carriers: {
    carrier_id: string;
    name: string;
    code: string | null;
    operating_status: string | null;
    contract_status: string | null;
    active_bookings: number;
    open_exceptions: number;
    scorecard: Record<string, unknown> | null;
  }[];
}

export interface FinanceSnapshot {
  ok: true;
  measured_at: string;
  charges: { open: number; amount: number };
  invoices: { issued: number; outstanding: number; overdue: number };
  settlements: { pending: number; variance: number };
  reconciliation: { open_exceptions: number; variance: number };
  payments: { allocated: number; unmatched: number };
}

export interface OfflineSnapshot {
  ok: true;
  measured_at: string;
  devices: { total: number; active: number; suspended: number; stale: number; max_clock_skew_ms: number | null };
  queue: { queued: number; failed: number; conflicts: number; applied_24h: number; oldest_pending_at: string | null };
}

export const capacitySnapshot = () => call<CapacitySnapshot>("ct_capacity_snapshot");
export const warehouseSnapshot = () => call<WarehouseSnapshot>("ct_warehouse_snapshot");
export const carrierSnapshot = (limit = 10) => call<CarrierSnapshot>("ct_carrier_snapshot", { _limit: limit });
export const financeSnapshot = () => call<FinanceSnapshot>("ct_finance_snapshot");
export const offlineSnapshot = () => call<OfflineSnapshot>("ct_offline_snapshot");

/* ------------------------------- Search --------------------------- */

export interface SearchHit {
  kind: string;
  id: string;
  reference: string | null;
  status: string | null;
  created_at: string | null;
}

export const search = (q: string, limit = 20) =>
  call<{ ok: true; query: string; results: SearchHit[] }>("ct_search", { _q: q, _limit: limit });

/* -------------------------------- Alerts -------------------------- */

export type AlertStatus = "CREATED" | "ACKNOWLEDGED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  CREATED: "New",
  ACKNOWLEDGED: "Acknowledged",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export interface AlertHistoryEntry {
  action: string;
  to_status: AlertStatus | null;
  actor_id: string | null;
  notes: string | null;
  at: string;
}

export interface AlertRow {
  id: string;
  alert_number: string;
  rule_key: string;
  condition_kind: string;
  severity: "info" | "warning" | "critical";
  status: AlertStatus;
  entity_type: string;
  entity_id: string | null;
  entity_ref: string | null;
  reason: string;
  detail: Record<string, unknown>;
  observed_value: number | null;
  threshold: number | null;
  correlation_id: string;
  owner_user_id: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  history: AlertHistoryEntry[];
}

export const alertsList = (params: { status?: string | null; severity?: string | null; limit?: number; offset?: number } = {}) =>
  call<{ ok: true; total: number; rows: AlertRow[]; measured_at: string }>("ct_alerts_list", {
    _status: params.status ?? null,
    _severity: params.severity ?? null,
    _limit: params.limit ?? 50,
    _offset: params.offset ?? 0,
  });

export const alertScan = () =>
  call<{ ok: true; scanned_at: string; conditions_raised: number; open_alerts: number }>("ct_alert_scan");

export type AlertAction = "ACKNOWLEDGE" | "ASSIGN" | "START" | "RESOLVE" | "CLOSE" | "REOPEN";

export const alertTransition = (params: {
  alertId: string;
  action: AlertAction;
  notes?: string | null;
  assignee?: string | null;
  resolution?: string | null;
}) =>
  call<{ ok: true; alert_id: string; status: AlertStatus }>("ct_alert_transition", {
    _alert_id: params.alertId,
    _action: params.action,
    _notes: params.notes ?? null,
    _assignee: params.assignee ?? null,
    _resolution: params.resolution ?? null,
  });

/* --------------------------- Operator commands -------------------- */

export type CtCommand =
  | "ASSIGN_DRIVER"
  | "REASSIGN_DRIVER"
  | "ASSIGN_VEHICLE"
  | "REORDER_STOPS"
  | "RECALCULATE_ROUTE"
  | "HOLD_DISPATCH"
  | "RELEASE_DISPATCH"
  | "ESCALATE_EXCEPTION"
  | "RESOLVE_EXCEPTION"
  | "ASSIGN_EXCEPTION"
  | "CREATE_RETURN"
  | "REATTEMPT_DELIVERY"
  | "RESOLVE_DEVIATION"
  | "STOP_TRANSITION";

export const COMMAND_LABEL: Record<CtCommand, string> = {
  ASSIGN_DRIVER: "Assign driver",
  REASSIGN_DRIVER: "Reassign driver",
  ASSIGN_VEHICLE: "Assign vehicle",
  REORDER_STOPS: "Reorder stops",
  RECALCULATE_ROUTE: "Recalculate route",
  HOLD_DISPATCH: "Hold dispatch",
  RELEASE_DISPATCH: "Release dispatch",
  ESCALATE_EXCEPTION: "Escalate exception",
  RESOLVE_EXCEPTION: "Resolve exception",
  ASSIGN_EXCEPTION: "Take ownership",
  CREATE_RETURN: "Authorise return",
  REATTEMPT_DELIVERY: "Schedule re-attempt",
  RESOLVE_DEVIATION: "Resolve deviation",
  STOP_TRANSITION: "Update stop",
};

export const commandExecute = (params: {
  operation: CtCommand;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  requestId?: string;
}) =>
  call<Record<string, unknown> & { ok: true }>("ct_command_execute", {
    _operation: params.operation,
    _entity_type: params.entityType,
    _entity_id: params.entityId,
    _payload: params.payload ?? {},
    _request_id: params.requestId ?? null,
    _correlation_id: null,
  });

/* ---------------------------- Configuration ----------------------- */

export interface CtSetting {
  setting_key: string;
  label: string;
  category: string;
  value: unknown;
  state: "SET" | "OWNER_CONFIGURATION_REQUIRED";
  guidance: string | null;
  updated_at: string;
}
export interface CtSlaPolicy {
  id: string;
  scope_kind: "global" | "service" | "customer" | "contract";
  scope_value: string | null;
  label: string;
  target_minutes: number;
  warning_threshold_pct: number;
  critical_threshold_pct: number;
  breach_grace_minutes: number;
  stop_overdue_minutes: number;
  active: boolean;
  notes: string | null;
}
export interface CtAlertRule {
  rule_key: string;
  condition_kind: string;
  label: string;
  description: string | null;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  threshold_numeric: number | null;
  window_minutes: number;
  owner_role: string;
}
export interface CtCommandLogRow {
  id: string;
  request_id: string;
  correlation_id: string;
  operation: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: "APPLIED" | "REJECTED" | "FAILED";
  error_code: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface ConfigOverview {
  ok: true;
  settings: CtSetting[];
  sla_policies: CtSlaPolicy[];
  alert_rules: CtAlertRule[];
  recent_commands: CtCommandLogRow[];
}

export const configOverview = () => call<ConfigOverview>("ct_config_overview");

export const settingSet = (key: string, value: unknown) =>
  call<{ ok: true; setting_key: string }>("ct_setting_set", { _key: key, _value: value });

export const alertRuleSet = (params: {
  ruleKey: string;
  enabled: boolean;
  severity?: string | null;
  threshold?: number | null;
  windowMinutes?: number | null;
  ownerRole?: string | null;
}) =>
  call<{ ok: true; rule_key: string }>("ct_alert_rule_set", {
    _rule_key: params.ruleKey,
    _enabled: params.enabled,
    _severity: params.severity ?? null,
    _threshold: params.threshold ?? null,
    _window_minutes: params.windowMinutes ?? null,
    _owner_role: params.ownerRole ?? null,
  });

export const slaPolicyUpsert = (p: {
  scopeKind: CtSlaPolicy["scope_kind"];
  scopeValue?: string | null;
  label: string;
  targetMinutes: number;
  warnPct: number;
  critPct: number;
  graceMinutes: number;
  stopOverdueMinutes: number;
  active?: boolean;
  notes?: string | null;
}) =>
  call<{ ok: true; policy_id: string }>("ct_sla_policy_upsert", {
    _scope_kind: p.scopeKind,
    _scope_value: p.scopeValue ?? null,
    _label: p.label,
    _target_minutes: p.targetMinutes,
    _warn: p.warnPct,
    _crit: p.critPct,
    _grace: p.graceMinutes,
    _stop_overdue: p.stopOverdueMinutes,
    _active: p.active ?? true,
    _notes: p.notes ?? null,
  });

/* ------------------------------ Presentation ---------------------- */

/** Human time for an SLA countdown. Never fabricates a value. */
export function minutesLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return "—";
  const abs = Math.abs(minutes);
  const text =
    abs >= 1440
      ? `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h`
      : abs >= 60
        ? `${Math.floor(abs / 60)}h ${abs % 60}m`
        : `${abs}m`;
  return minutes < 0 ? `${text} overdue` : `${text} left`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

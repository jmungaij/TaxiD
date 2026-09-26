/**
 * Operations view of the offline execution spine.
 *
 * Every figure here is read from the authoritative journal / device registry —
 * nothing is derived in dashboard components. When a section has no rows the
 * caller renders DATA_NOT_AVAILABLE rather than a fabricated number.
 */
import { untypedDb , type UntypedQuery } from "@/integrations/supabase/untyped";
import type { OfflineCommandState, OfflineError } from "./types";

const db = untypedDb;

export interface DeviceRow {
  id: string;
  device_id: string;
  owner_user_id: string;
  platform: string;
  app_version: string;
  state: "ACTIVE" | "STALE" | "SUSPENDED" | "RETIRED";
  state_reason: string | null;
  sync_cursor: number;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_clock_skew_ms: number | null;
  queued_count: number;
  failed_count: number;
  conflict_count: number;
  created_at: string;
}

export interface CommandRow {
  id: string;
  command_id: string;
  idempotency_key: string;
  device_id: string;
  actor_id: string;
  operation: string;
  entity_type: string;
  entity_id: string | null;
  sequence_number: number;
  state: OfflineCommandState;
  attempts: number;
  next_attempt_at: string | null;
  transaction_id: string | null;
  server_result: Record<string, unknown> | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
  retryable: boolean | null;
  conflict_reason: string | null;
  conflict_detail: Record<string, unknown> | null;
  resolution: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  client_captured_at: string;
  client_clock_skew_ms: number | null;
  server_received_at: string | null;
  server_applied_at: string | null;
  correlation_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  gps_lat: number | null;
  gps_lng: number | null;
  app_version: string;
  created_at: string;
}

export interface CommandEventRow {
  id: string;
  command_row_id: string;
  from_state: OfflineCommandState | null;
  to_state: OfflineCommandState;
  reason: string | null;
  detail: Record<string, unknown> | null;
  actor_id: string | null;
  actor_type: string;
  occurred_at: string;
}

export interface SyncSessionRow {
  id: string;
  device_row_id: string;
  actor_id: string;
  state: string;
  commands_submitted: number;
  commands_accepted: number;
  commands_rejected: number;
  commands_conflict: number;
  commands_deferred: number;
  duplicates_suppressed: number;
  clock_skew_ms: number | null;
  connectivity: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface SyncHealth {
  ok: boolean;
  server_time?: string;
  devices?: {
    total: number; active: number; stale: number; suspended: number; retired: number;
    max_clock_skew_ms: number | null;
  };
  queue?: {
    queued: number; retryable: number; conflict: number; rejected: number;
    permanent_failure: number; accepted_24h: number; total: number;
  };
  oldest_pending_at?: string | null;
  oldest_pending_age_minutes?: number | null;
  recent_sessions?: Record<string, unknown>[];
  data_available?: boolean;
  code?: string;
  message?: string;
}

async function rows<T>(table: string, build: (q: UntypedQuery) => UntypedQuery, limit = 200): Promise<T[]> {
  const { data, error } = await build(db.from(table).select("*")).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const listDevices = (filters: { state?: string; search?: string; limit?: number } = {}) =>
  rows<DeviceRow>("logistics_devices", (q: UntypedQuery) => {
    let out = q.order("last_seen_at", { ascending: false, nullsFirst: false });
    if (filters.state) out = out.eq("state", filters.state);
    if (filters.search) out = out.ilike("device_id", `%${filters.search}%`);
    return out;
  }, filters.limit ?? 200);

export const listCommands = (
  filters: { state?: OfflineCommandState; operation?: string; deviceId?: string; limit?: number } = {},
) =>
  rows<CommandRow>("logistics_offline_commands", (q: UntypedQuery) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.state) out = out.eq("state", filters.state);
    if (filters.operation) out = out.eq("operation", filters.operation);
    if (filters.deviceId) out = out.eq("device_id", filters.deviceId);
    return out;
  }, filters.limit ?? 200);

export const listCommandHistory = (commandRowId: string) =>
  rows<CommandEventRow>("logistics_offline_command_events",
    (q: UntypedQuery) => q.eq("command_row_id", commandRowId).order("occurred_at", { ascending: true }), 200);

export const listSyncSessions = (limit = 50) =>
  rows<SyncSessionRow>("logistics_sync_sessions",
    (q: UntypedQuery) => q.order("started_at", { ascending: false }), limit);

export const listCommandTypes = () =>
  rows<{
    operation: string; entity_type: string; target_rpc: string; required_keys: string[];
    requires_gps: boolean; offline_allowed: boolean; max_attempts: number; description: string;
  }>("logistics_offline_command_types", (q: UntypedQuery) => q.order("operation"), 100);

export async function syncHealth(): Promise<SyncHealth> {
  const { data, error } = await db.rpc("lg_sync_health", {});
  if (error) return { ok: false, code: "PROVIDER_UNAVAILABLE", message: error.message };
  return (data ?? { ok: false }) as SyncHealth;
}

export type ResolutionKind = "REPLAY" | "DISCARD" | "MANUALLY_APPLIED";

export async function resolveCommand(
  commandRowId: string,
  resolution: ResolutionKind,
  notes: string,
): Promise<{ ok: boolean; error?: OfflineError; apply?: Record<string, unknown> }> {
  const { data, error } = await db.rpc("lg_offline_resolve", {
    _command_row_id: commandRowId,
    _resolution: resolution,
    _notes: notes,
  });
  if (error) {
    return {
      ok: false,
      error: { code: "PROVIDER_UNAVAILABLE", category: "provider", message: error.message, retryable: true },
    };
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) {
    return {
      ok: false,
      error: {
        code: String(payload.code ?? "PERMANENT_FAILURE"),
        category: String(payload.category ?? "server"),
        message: String(payload.message ?? (payload.apply as Record<string, unknown>)?.message ?? "Resolution refused."),
        retryable: payload.retryable === true,
      },
      apply: payload.apply as Record<string, unknown> | undefined,
    };
  }
  return { ok: true, apply: payload.apply as Record<string, unknown> | undefined };
}

/** Device suspension is an authoritative write against the registry. */
export async function setDeviceState(
  deviceRowId: string,
  state: "ACTIVE" | "SUSPENDED" | "RETIRED",
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("logistics_devices")
    .update({ state, state_reason: reason })
    .eq("id", deviceRowId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ------------------------------------------------------------- presentation */

export const STATE_TONE: Record<OfflineCommandState, "ok" | "warn" | "danger" | "muted"> = {
  QUEUED: "muted",
  SYNCING: "muted",
  ACCEPTED: "ok",
  REPLAYED: "ok",
  ACKNOWLEDGED: "ok",
  RETRYABLE_FAILURE: "warn",
  CONFLICT: "warn",
  REJECTED: "danger",
  PERMANENT_FAILURE: "danger",
};

/** Age in whole minutes, or null when the timestamp is missing. */
export function ageMinutes(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 60_000));
}

/** A device is stale when it has not been seen for two hours. */
export function isStale(device: DeviceRow, now = Date.now()): boolean {
  const age = ageMinutes(device.last_seen_at, now);
  return device.state === "ACTIVE" && (age === null || age > 120);
}

/** CSV export of any offline dataset, escaping separators. */
export function toCsv(columns: string[], data: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...data.map((r) => r.map(cell).join(","))].join("\n");
}

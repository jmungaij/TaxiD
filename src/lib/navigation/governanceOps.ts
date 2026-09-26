/**
 * Navigation governance operations client.
 *
 * Staged (canary) publishing, draft-vs-published diffing, drift alert triage,
 * audit search/export and the versioned snapshot fetch. Every authority check
 * (author vs approver), the canary cohort resolution and the "no critical drift
 * before promotion" rule live in Postgres — this module only issues intents.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------------------- types -- */

export type DiffSectionKey = "routes" | "capabilities" | "rbac" | "navigation";

export interface DiffSection {
  added: Array<{ key: string; value: unknown }>;
  removed: Array<{ key: string; value: unknown }>;
  changed: Array<{ key: string; before: unknown; after: unknown }>;
  added_count: number;
  removed_count: number;
  changed_count: number;
}

export interface VersionRef {
  id: string;
  version: number;
  title: string;
  status: string;
  hash: string;
}

export interface RegistryDiff {
  base: VersionRef;
  target: VersionRef;
  sections: Record<DiffSectionKey, DiffSection>;
}

export type DriftKind =
  | "crawler_integrity" | "capability_drift" | "rbac_drift" | "snapshot_hash_drift" | "orphan_route";

export interface DriftAlert {
  id: string;
  fingerprint: string;
  kind: DriftKind;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: Record<string, unknown>;
  version_id: string | null;
  status: "open" | "acknowledged" | "resolved";
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface AuditRow {
  id: string;
  version_id: string | null;
  version: number | null;
  title: string | null;
  version_status: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AuditSearchResult {
  rows: AuditRow[];
  total: number;
  actions: string[];
}

export interface NavSnapshotResponse {
  ok: boolean;
  version_id: string;
  version: number;
  title: string;
  status: string;
  rollout_mode: "full" | "canary";
  snapshot_hash: string;
  published_at: string;
  is_canary: boolean;
  snapshot: Record<string, unknown>;
}

export const DRIFT_KIND_LABEL: Record<DriftKind, string> = {
  crawler_integrity: "Crawler integrity",
  capability_drift: "Capability drift",
  rbac_drift: "Access-rule drift",
  snapshot_hash_drift: "Snapshot drift",
  orphan_route: "Orphan route",
};

export const SEVERITY_TONE: Record<DriftAlert["severity"], string> = {
  info: "bg-primary/10 text-primary border-primary/30",
  warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

/* -------------------------------------------------------------------- diff -- */

export const diffVersions = (baseId: string, targetId: string) =>
  call<RegistryDiff>("nav_registry_diff", { p_base_id: baseId, p_target_id: targetId });

/* ----------------------------------------------------------------- canary -- */

export const publishCanary = (
  versionId: string,
  cohort: { roles?: string[]; userIds?: string[]; percent?: number },
) =>
  call<{ ok: boolean; status: string }>("nav_registry_publish_canary", {
    p_version_id: versionId,
    p_roles: cohort.roles ?? [],
    p_user_ids: cohort.userIds ?? [],
    p_percent: cohort.percent ?? 100,
  });

export const promoteCanary = (versionId: string) =>
  call<{ ok: boolean; status: string }>("nav_registry_promote_canary", { p_version_id: versionId });

export const abortCanary = (versionId: string, reason: string) =>
  call<{ ok: boolean; status: string }>("nav_registry_abort_canary", {
    p_version_id: versionId,
    p_reason: reason,
  });

/* ------------------------------------------------------------------ drift -- */

export async function listDriftAlerts(status?: DriftAlert["status"]): Promise<DriftAlert[]> {
  let query = supabase
    .from("nav_drift_alerts")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DriftAlert[];
}

export const triageDrift = (alertId: string, status: DriftAlert["status"], note?: string) =>
  call<{ ok: boolean; status: string }>("nav_drift_triage", {
    p_alert_id: alertId,
    p_status: status,
    p_note: note ?? null,
  });

/** Runs the server-side drift monitor and returns what it raised. */
export async function runDriftMonitor(runtime?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("nav-drift-monitor", {
    body: { runtime: runtime ?? {} },
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; raised: unknown[]; notified: number };
}

/* ------------------------------------------------------------------ audit -- */

export interface AuditFilters {
  action?: string | null;
  versionId?: string | null;
  actor?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export const searchAudit = (filters: AuditFilters = {}) =>
  call<AuditSearchResult>("nav_registry_audit_search", {
    p_action: filters.action ?? null,
    p_version_id: filters.versionId ?? null,
    p_actor: filters.actor ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_search: filters.search ?? null,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  });

const csvCell = (value: unknown) => {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function auditRowsToCsv(rows: AuditRow[]): string {
  const header = [
    "created_at", "version", "version_title", "version_status",
    "action", "from_status", "to_status", "actor", "detail",
  ];
  const lines = rows.map((r) =>
    [r.created_at, r.version, r.title, r.version_status, r.action, r.from_status, r.to_status, r.actor, r.detail]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function downloadAuditCsv(rows: AuditRow[], filename = "navigation-governance-audit.csv") {
  const blob = new Blob([auditRowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------- snapshot -- */

/**
 * Fetches the active published navigation snapshot (or the canary version the
 * signed-in user belongs to) through the cached snapshot endpoint.
 */
export async function fetchActiveSnapshot(): Promise<NavSnapshotResponse> {
  const { data, error } = await supabase.functions.invoke("nav-snapshot", { body: {} });
  if (error) throw new Error(error.message);
  return data as NavSnapshotResponse;
}

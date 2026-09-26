/**
 * OpsHub alert audit log — persists workspace-health threshold crossings to
 * the immutable `alerts_events` stream so every breach is auditable and
 * replayable alongside the executive alert engine.
 *
 * Dedupe is deterministic: `OpsAlert.idempotencyKey` is stable for a given
 * metric/threshold/observed bucket, and an in-memory guard prevents repeat
 * writes within a session while the DB row remains the source of truth.
 */
import { supabase } from "@/integrations/supabase/client";
import { OPS_ALERT_STREAM, type OpsAlert } from "./opsHubIntelligence";

const written = new Set<string>();

export interface OpsAlertEventRow {
  id: string;
  metric_key: string;
  severity: string;
  message: string;
  observed_value: number | null;
  threshold: number | null;
  created_at: string;
  acknowledged_at: string | null;
}

/** Writes any not-yet-logged breaches. Returns the keys actually persisted. */
export async function recordOpsAlerts(
  alerts: OpsAlert[],
  userId: string | null,
): Promise<string[]> {
  const pending = alerts.filter((a) => !written.has(a.idempotencyKey));
  if (pending.length === 0) return [];
  const rows = pending.map((a) => ({
    rule_name: `OpsHub · ${a.label}`,
    stream: OPS_ALERT_STREAM,
    metric_key: a.metricKey,
    observed_value: a.observed,
    threshold: a.threshold,
    operator: a.operator,
    severity: a.severity,
    message: a.message,
    triggered_by: userId,
    idempotency_key: a.idempotencyKey,
    context: {
      source: "ops_hub",
      surface: "/delivery/ops",
      workspace: "delivery_logistics",
      metric_key: a.metricKey,
    },
  }));
  const { error } = await supabase.from("alerts_events").insert(rows);
  if (error) {
    // Unique-violation means another session already logged this crossing.
    if (error.code !== "23505") {
       
      console.warn("[ELOS] OpsHub alert audit write failed", error.message);
      return [];
    }
  }
  for (const a of pending) written.add(a.idempotencyKey);
  return pending.map((a) => a.idempotencyKey);
}

/** Most recent OpsHub-authored alert events, newest first. */
export async function loadOpsAlertEvents(limit = 12): Promise<OpsAlertEventRow[]> {
  const { data, error } = await supabase
    .from("alerts_events")
    .select("id, metric_key, severity, message, observed_value, threshold, created_at, acknowledged_at")
    .eq("stream", OPS_ALERT_STREAM)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as OpsAlertEventRow[];
}

/** Test seam — clears the session dedupe guard. */
export function __resetOpsAlertGuard(): void {
  written.clear();
}

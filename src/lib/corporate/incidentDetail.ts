/**
 * Incident detail assembly.
 *
 * Given one row of `executive_alert_history`, gathers the full investigation
 * context an operator needs: every event in the same incident chain, the
 * affected integration's recent dispatch/alert events, the circuit-breaker
 * state for that integration, and every correlation id we can attach to the
 * incident (from alert events, analytics events and DLQ rows).
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { ALERT_KIND_LABEL } from "@/lib/corporate/userAlertPrefs";

const db = () => untypedDb;

export interface IncidentEvent {
  id: string;
  alert_key: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  metric_key: string | null;
  value: number | null;
  integration_key: string | null;
  channels: string[];
  incident_ref: string | null;
  created_at: string;
}

export interface IncidentAlertEvent {
  id: string;
  rule_name: string | null;
  severity: string | null;
  message: string | null;
  metric_key: string | null;
  observed_value: number | null;
  threshold: number | null;
  stream: string | null;
  channels_dispatched: unknown;
  context: Record<string, unknown> | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface BreakerState {
  service: string;
  state: string;
  failure_count: number;
  success_count: number;
  opened_at: string | null;
  reopens_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface IncidentContext {
  anchor: IncidentEvent;
  chain: IncidentEvent[];
  alertEvents: IncidentAlertEvent[];
  breakers: BreakerState[];
  correlationIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  severity: string;
  status: "active" | "acknowledged" | "cooled_down";
}

/** Best-effort extraction of correlation ids from arbitrary JSON context. */
export function extractCorrelationIds(blobs: Array<unknown>): string[] {
  const out = new Set<string>();
  const KEYS = ["correlation_id", "correlationId", "cid", "request_id", "trace_id", "idempotency_key"];
  const walk = (v: unknown, depth = 0) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (KEYS.includes(k) && typeof val === "string" && val.trim()) out.add(val.trim());
      else walk(val, depth + 1);
    }
  };
  blobs.forEach((b) => walk(b));
  return Array.from(out);
}

/** Derives incident status from the chain + acknowledgements. */
export function incidentStatus(
  chain: IncidentEvent[],
  alertEvents: IncidentAlertEvent[],
  now = Date.now(),
): IncidentContext["status"] {
  if (alertEvents.some((e) => e.acknowledged_at)) return "acknowledged";
  const last = chain[0]?.created_at;
  if (last && now - new Date(last).getTime() > 6 * 3_600_000) return "cooled_down";
  return "active";
}

export const incidentKindLabel = (kind: string): string =>
  (ALERT_KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/_/g, " ");

function normalise(rows: unknown[]): IncidentEvent[] {
  return (rows as IncidentEvent[]).map((r) => ({
    ...r,
    channels: Array.isArray(r.channels) ? r.channels.map(String) : [],
    value: r.value == null ? null : Number(r.value),
  }));
}

export async function loadIncidentContext(alertId: string): Promise<IncidentContext | null> {
  const { data: anchorRow, error } = await db()
    .from("executive_alert_history")
    .select("*")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!anchorRow) return null;

  const anchor = normalise([anchorRow])[0];

  const [chainRes, alertRes, breakerRes] = await Promise.all([
    db()
      .from("executive_alert_history")
      .select("*")
      .eq("alert_key", anchor.alert_key)
      .order("created_at", { ascending: false })
      .limit(100),
    db()
      .from("alerts_events")
      .select(
        "id,rule_name,severity,message,metric_key,observed_value,threshold,stream,channels_dispatched,context,acknowledged_at,created_at",
      )
      .eq("rule_name", `executive.${anchor.kind}`)
      .order("created_at", { ascending: false })
      .limit(50),
    db()
      .from("payment_circuit_breakers")
      .select("*")
      .order("updated_at", { ascending: false }),
  ]);

  const chain = normalise(chainRes.data ?? [anchorRow]);
  const alertEvents = (alertRes.data ?? []) as IncidentAlertEvent[];

  const allBreakers = (breakerRes.data ?? []) as BreakerState[];
  const breakers = anchor.integration_key
    ? allBreakers.filter((b) =>
        b.service.toLowerCase().includes(anchor.integration_key!.toLowerCase()) ||
        anchor.integration_key!.toLowerCase().includes(b.service.toLowerCase()),
      )
    : allBreakers;

  const correlationIds = extractCorrelationIds([
    ...alertEvents.map((e) => e.context),
    ...chain.map((c) => ({ alert_key: c.alert_key, incident_ref: c.incident_ref })),
  ]);
  if (anchor.incident_ref) correlationIds.unshift(anchor.incident_ref);

  const timestamps = chain.map((c) => c.created_at).sort();
  const severity = chain.some((c) => c.severity === "critical") ? "critical" : anchor.severity;

  return {
    anchor,
    chain,
    alertEvents,
    breakers: breakers.length ? breakers : allBreakers.slice(0, 3),
    correlationIds: Array.from(new Set(correlationIds)),
    firstSeenAt: timestamps[0] ?? anchor.created_at,
    lastSeenAt: timestamps[timestamps.length - 1] ?? anchor.created_at,
    occurrences: chain.length,
    severity,
    status: incidentStatus(chain, alertEvents),
  };
}

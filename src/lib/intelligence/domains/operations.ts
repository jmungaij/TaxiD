/**
 * Operations intelligence — deterministic read service.
 *
 * Reads the SLA projection over staff work and the live alert stream. Both are
 * already computed server-side, so this service only classifies and counts.
 */
import { supabase } from "@/integrations/supabase/client";
import { emptyReading, newestTimestamp, type Claim, type DomainReading } from "../contract";

export const OPERATIONS_PERMISSION = "staff.partners.read";

interface WorkRow {
  sla_status: string | null;
  lifecycle_state: string | null;
  ops_queue: string | null;
  remaining_minutes: number | null;
  created_at: string | null;
}

interface AlertRow {
  severity: string | null;
  stream: string | null;
  acknowledged_at: string | null;
  created_at: string | null;
}

export async function readOperations(authorised: boolean): Promise<DomainReading> {
  if (!authorised) {
    return emptyReading("operations", OPERATIONS_PERMISSION, "operations read permission not held", false);
  }

  const [work, alerts] = await Promise.all([
    supabase
      .from("v_ops_work_sla")
      .select("sla_status,lifecycle_state,ops_queue,remaining_minutes,created_at")
      .limit(1000),
    supabase
      .from("alerts_events")
      .select("severity,stream,acknowledged_at,created_at")
      .eq("is_test", false)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (work.error && alerts.error) {
    return emptyReading("operations", OPERATIONS_PERMISSION, `operational feeds unreadable: ${work.error.message}`);
  }

  const workRows = (work.data ?? []) as WorkRow[];
  const alertRows = (alerts.data ?? []) as AlertRow[];
  if (workRows.length === 0 && alertRows.length === 0) {
    return emptyReading("operations", OPERATIONS_PERMISSION, "no operational work or open alerts inside your scope");
  }

  const freshestAt = newestTimestamp([
    ...workRows.map((r) => r.created_at),
    ...alertRows.map((r) => r.created_at),
  ]);

  const open = workRows.filter((r) => r.lifecycle_state !== "closed" && r.lifecycle_state !== "completed");
  const breached = workRows.filter((r) => (r.sla_status ?? "").toLowerCase().includes("breach"));
  const dueSoon = open.filter((r) => typeof r.remaining_minutes === "number" && r.remaining_minutes! <= 60);
  const critical = alertRows.filter((r) => ["critical", "high"].includes((r.severity ?? "").toLowerCase()));

  const queues = new Map<string, number>();
  for (const row of open) queues.set(row.ops_queue ?? "unassigned", (queues.get(row.ops_queue ?? "unassigned") ?? 0) + 1);

  const claims: Claim[] = [
    {
      id: "operations.open_work",
      label: "Open operational work items",
      value: `${open.length}`,
      numeric: open.length,
      classification: "FACT",
      source: "v_ops_work_sla",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [...queues.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([queue, count]) => ({ label: `${count} in ${queue}`, path: "/staff/org/work" })),
    },
    {
      id: "operations.sla_breached",
      label: "Work past its SLA",
      value: `${breached.length}`,
      numeric: breached.length,
      classification: "FACT",
      source: "v_ops_work_sla.sla_status",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [{ label: `${dueSoon.length} item(s) due within the hour`, path: "/staff/board" }],
    },
    {
      id: "operations.open_alerts",
      label: "Unacknowledged alerts",
      value: `${alertRows.length}`,
      numeric: alertRows.length,
      classification: "FACT",
      source: "alerts_events",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [{ label: `${critical.length} at critical or high severity`, path: "/staff/control-tower" }],
    },
  ];

  if (open.length > 0 && breached.length > 0) {
    const breachRate = breached.length / open.length;
    claims.push({
      id: "operations.breach_pressure",
      label: "Projected SLA pressure over the next hour",
      value: `${Math.round(breachRate * dueSoon.length)} further breach(es) if nothing is worked`,
      numeric: Math.round(breachRate * dueSoon.length),
      classification: "PREDICTION",
      source: "v_ops_work_sla (breach rate × items due within the hour)",
      observedAt: freshestAt,
      confidence: 55,
      assumptions: [
        "The current breach rate continues unchanged.",
        "No additional staff capacity is applied to the queues in the next hour.",
      ],
      evidence: [{ label: `${dueSoon.length} item(s) due within the hour`, path: "/staff/org/work" }],
    });
  }

  return {
    domain: "operations",
    permission: OPERATIONS_PERMISSION,
    authorised: true,
    claims,
    freshestAt,
    rowsInspected: workRows.length + alertRows.length,
  };
}

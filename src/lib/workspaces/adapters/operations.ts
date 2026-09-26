/**
 * Operations workspace adapter — live from Supabase.
 *
 * KPIs:
 *   primary   = active trips (trip_bookings.status in in-progress states)
 *   secondary = dispatch queue depth (dispatch_requests pending)
 *   alerts    = open payment_alerts with severity ≥ high (surfaced to Ops NOC)
 * Health score is a composite of dispatch backlog + alert count.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { classifyStatus, makeLiveAdapter, type LiveMetrics } from "./live";

const ACTIVE_TRIP_STATES = ["accepted", "en_route", "arrived", "in_progress", "started"];
const PENDING_DISPATCH = ["pending", "searching", "offered"];

async function count(table: string, column: string, values: string[]): Promise<number> {
  const { count: c, error } = await (untypedDb)
    .from(table)
    .select("id", { count: "exact", head: true })
    .in(column, values);
  if (error) throw error;
  return c ?? 0;
}

async function compute(): Promise<LiveMetrics | null> {
  const [activeTrips, queueDepth, alertsRes] = await Promise.all([
    count("trip_bookings", "status", ACTIVE_TRIP_STATES),
    count("dispatch_requests", "status", PENDING_DISPATCH),
    (untypedDb)
      .from("payment_alerts")
      .select("id", { count: "exact", head: true })
      .in("severity", ["high", "critical"])
      .is("resolved_at", null),
  ]);

  const activeAlerts = alertsRes.count ?? 0;
  // Composite score: backlog + alerts penalise; cap 100.
  const backlogPenalty = Math.min(queueDepth * 0.5, 20);
  const alertPenalty = Math.min(activeAlerts * 3, 15);
  const healthScore = Math.max(50, Math.round(100 - backlogPenalty - alertPenalty));

  return {
    healthScore,
    status: classifyStatus(healthScore),
    activeAlerts,
    trend: 0, // trend requires a rolling window; wire in a later pass
    aiConfidence: 92,
    primaryKpi: { label: "Active trips", value: activeTrips.toLocaleString() },
    secondaryKpi: { label: "Dispatch queue", value: queueDepth.toLocaleString() },
  };
}

export function makeOperationsAdapter() {
  return makeLiveAdapter({
    key: "operations",
    compute,
    realtimeTables: ["dispatch_requests", "trip_bookings"],
    initial: {
      healthScore: 95,
      status: "healthy",
      activeAlerts: 0,
      trend: 0,
      aiConfidence: 90,
      primaryKpi: { label: "Active trips", value: "—" },
      secondaryKpi: { label: "Dispatch queue", value: "—" },
    },
  });
}

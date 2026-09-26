/**
 * Finance workspace adapter — live from Supabase.
 *
 * KPIs:
 *   primary   = payment success rate over the last hour (succeeded / attempted)
 *   secondary = settlement queue depth (payment_attempts stuck in in-flight states)
 *   alerts    = open payment_alerts with severity high|critical
 * Health score is anchored to success rate with an alert penalty.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { classifyStatus, makeLiveAdapter, type LiveMetrics } from "./live";

const INFLIGHT_STATES = ["initiated", "pending", "processing", "awaiting_callback"];
const TERMINAL_OK = ["succeeded", "success", "completed"];


async function compute(): Promise<LiveMetrics | null> {
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fromAttempts = (untypedDb).from("payment_attempts");

  const [totalRes, okRes, stuckRes, alertsRes] = await Promise.all([
    fromAttempts.select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    fromAttempts.select("id", { count: "exact", head: true }).gte("created_at", sinceIso).in("state", TERMINAL_OK),
    fromAttempts.select("id", { count: "exact", head: true }).in("state", INFLIGHT_STATES),
    (untypedDb)
      .from("payment_alerts")
      .select("id", { count: "exact", head: true })
      .in("severity", ["high", "critical"])
      .is("resolved_at", null),
  ]);

  const total = totalRes.count ?? 0;
  const ok = okRes.count ?? 0;
  const successRate = total > 0 ? (ok / total) * 100 : 100;
  const stuck = stuckRes.count ?? 0;
  const activeAlerts = alertsRes.count ?? 0;

  const alertPenalty = Math.min(activeAlerts * 3, 12);
  const healthScore = Math.max(40, Math.round(successRate - alertPenalty));

  return {
    healthScore,
    status: classifyStatus(healthScore),
    activeAlerts,
    trend: 0,
    aiConfidence: 94,
    primaryKpi: { label: "Success rate", value: `${successRate.toFixed(1)}%` },
    secondaryKpi: { label: "Settlement q", value: stuck.toLocaleString() },
  };
}

export function makeFinanceAdapter() {
  return makeLiveAdapter({
    key: "finance",
    compute,
    realtimeTables: ["payment_attempts", "payment_alerts"],
    initial: {
      healthScore: 97,
      status: "healthy",
      activeAlerts: 0,
      trend: 0,
      aiConfidence: 92,
      primaryKpi: { label: "Success rate", value: "—" },
      secondaryKpi: { label: "Settlement q", value: "—" },
    },
  });
}

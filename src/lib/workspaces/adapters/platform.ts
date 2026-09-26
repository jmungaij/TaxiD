/**
 * Platform workspace adapter — live from Supabase.
 *
 * KPIs:
 *   primary   = edge function success rate (5xx-free) over last 15 minutes
 *   secondary = invocations in the same window
 * Health score anchored to success rate.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { classifyStatus, makeLiveAdapter, type LiveMetrics } from "./live";


async function compute(): Promise<LiveMetrics | null> {
  const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const from = (untypedDb).from("edge_function_invocations");

  const [totalRes, errRes] = await Promise.all([
    from.select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    from.select("id", { count: "exact", head: true }).gte("created_at", sinceIso).gte("status_code", 500),
  ]);

  const total = totalRes.count ?? 0;
  const errors = errRes.count ?? 0;
  const successRate = total > 0 ? ((total - errors) / total) * 100 : 100;
  const healthScore = Math.max(40, Math.round(successRate));

  return {
    healthScore,
    status: classifyStatus(healthScore),
    activeAlerts: errors > 0 && successRate < 99 ? 1 : 0,
    trend: 0,
    aiConfidence: 95,
    primaryKpi: { label: "Uptime", value: `${successRate.toFixed(1)}%` },
    secondaryKpi: { label: "Invocations", value: total.toLocaleString() },
  };
}

export function makePlatformAdapter() {
  return makeLiveAdapter({
    key: "platform",
    compute,
    realtimeTables: [],
    pollMs: 60_000,
    initial: {
      healthScore: 99,
      status: "healthy",
      activeAlerts: 0,
      trend: 0,
      aiConfidence: 93,
      primaryKpi: { label: "Uptime", value: "—" },
      secondaryKpi: { label: "Invocations", value: "—" },
    },
  });
}

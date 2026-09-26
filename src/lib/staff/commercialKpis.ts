/**
 * COMMERCIAL PERFORMANCE FIGURES for My Dashboard.
 *
 * Every figure is computed by the database from the commercial records
 * themselves — revenue from won business, win rate from decided business,
 * lead-to-close from the recorded dates. Nothing is estimated in the browser,
 * and a figure with no underlying record returns null rather than a zero that
 * would read as a result.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type KpiScope = "mine" | "team";

export interface CommercialKpis {
  scope: KpiScope;
  can_view_team: boolean;
  window_days: number;
  people: number;
  revenue_kes: number;
  won_count: number;
  lost_count: number;
  open_count: number;
  open_pipeline_kes: number;
  win_rate_pct: number | null;
  avg_days_to_close: number | null;
  avg_deal_value_kes: number | null;
}

export async function fetchCommercialKpis(scope: KpiScope, days = 365): Promise<CommercialKpis> {
  const { data, error } = await db.rpc("commercial_my_kpis", { _scope: scope, _days: days });
  if (error) throw new Error(error.message);
  return data as CommercialKpis;
}

export const KES0 = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

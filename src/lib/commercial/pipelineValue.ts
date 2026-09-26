/**
 * PIPELINE VALUE ENGINE — client read layer.
 *
 * The engine itself is in the database (`pipeline_stage_weights`,
 * `pipeline_value_of`, `pipeline_work_apply`, `pipeline_value_dashboard`), so
 * one probability-adjusted value drives priority, workload and tomorrow's plan
 * everywhere. Nothing is recomputed here and no number is invented: a deal with
 * no recorded value stays at zero and is reported as such.
 */
import { supabase } from "@/integrations/supabase/client";

export interface PipelineStageRow {
  stage_key: string;
  stage_label: string;
  probability_pct: number;
  deals: number;
  gross_kes: number;
  weighted_kes: number;
}

export interface PipelineAccountRow {
  account_id: string | null;
  account_name: string;
  deals: number;
  gross_kes: number;
  weighted_kes: number;
  best_stage: string | null;
  best_probability_pct: number | null;
  contracted_kes: number;
  revenue_kes: number;
  next_action: string | null;
}

export interface PipelineOwnerRow {
  staff_id: string | null;
  staff_name: string | null;
  deals: number;
  gross_kes: number;
  weighted_kes: number;
  open_work_items: number;
  open_effort_minutes: number;
}

export interface PipelineValueDashboard {
  ok: boolean;
  error?: string;
  scope?: "all" | "mine";
  month?: string;
  totals?: {
    open_deals: number;
    gross_kes: number;
    weighted_kes: number;
    no_value_recorded: number;
    revenue_month_kes: number;
  };
  by_stage?: PipelineStageRow[];
  accounts?: PipelineAccountRow[];
  owners?: PipelineOwnerRow[];
}

export async function fetchPipelineValueDashboard(): Promise<PipelineValueDashboard> {
  const { data, error } = await supabase.rpc("pipeline_value_dashboard");
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "NO_DATA" }) as unknown as PipelineValueDashboard;
}

export const kes = (amount: number | null | undefined): string =>
  amount === null || amount === undefined
    ? "Not recorded"
    : `KES ${Math.round(amount).toLocaleString("en-KE")}`;

export const hours = (minutes: number | null | undefined): string =>
  !minutes ? "0 h" : `${(minutes / 60).toFixed(1)} h`;

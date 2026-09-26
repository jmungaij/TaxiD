/**
 * SALES KPI CASCADE — day, week, month, quarter and year against target.
 *
 * Every figure is computed in the database from the lead, contract and revenue
 * records, and frozen each evening at 7 PM Kenya time. A period with no target
 * on the register comes back as null rather than a zero that would read as a
 * result.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type KpiGrain = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export const GRAIN_LABEL: Record<KpiGrain, string> = {
  DAY: "Today",
  WEEK: "This week",
  MONTH: "This month",
  QUARTER: "This quarter",
  YEAR: "This year",
};

export interface KpiGrainRow {
  grain: KpiGrain;
  period_start: string;
  period_end: string;
  target_kes: number | null;
  revenue_kes: number;
  attainment_pct: number | null;
  remaining_kes: number | null;
  won_count: number;
  open_count: number;
  open_pipeline_kes: number;
  weighted_pipeline_kes: number;
  win_rate_pct: number | null;
  last_close_at: string | null;
}

export interface KpiCascade {
  staff_id: string;
  staff_name: string | null;
  position_code: string | null;
  as_of: string;
  revenue_basis: string;
  grains: KpiGrainRow[];
}

/** Reads one specialist's cascade. Leaders may pass another person's id. */
export async function fetchKpiCascade(staffId?: string | null): Promise<KpiCascade | null> {
  const { data, error } = await db.rpc("sales_kpi_cascade", { _staff: staffId ?? null });
  if (error) {
    if (/NO_STAFF_IDENTITY|NOT_IN_YOUR_REPORTING_LINE/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data as KpiCascade;
}

export interface ManagementPerson {
  staff_member_id: string;
  staff_name: string;
  position_code: string | null;
  target_kes: number | null;
  revenue_kes: number;
  attainment_pct: number | null;
  won_count: number;
  lost_count: number;
  win_rate_pct: number | null;
  open_count: number;
  open_pipeline_kes: number;
  weighted_pipeline_kes: number;
  stale_count: number;
  awaiting_customer_count: number;
  quarter_revenue_kes: number;
  quarter_target_kes: number | null;
  year_revenue_kes: number;
  year_target_kes: number | null;
  last_close_at: string | null;
}

export interface ManagementPeriod {
  period_start: string;
  revenue_kes: number;
  target_kes: number | null;
  attainment_pct: number | null;
  won_count?: number;
  lost_count?: number;
  open_count?: number;
  open_pipeline_kes?: number;
  weighted_pipeline_kes?: number;
  win_rate_pct?: number | null;
}

export interface ManagementCloseRow {
  grain: KpiGrain;
  period_start: string;
  period_end: string;
  closed_at: string;
  people: number;
  revenue_kes: number;
}

export interface ManagementDashboard {
  as_of: string;
  revenue_basis: string;
  month: ManagementPeriod;
  quarter: ManagementPeriod;
  year: ManagementPeriod;
  people: ManagementPerson[];
  closes: ManagementCloseRow[];
}

/** Reads the desk. Refused for anyone without desk leadership. */
export async function fetchManagementDashboard(): Promise<ManagementDashboard | null> {
  const { data, error } = await db.rpc("sales_management_dashboard");
  if (error) {
    if (/NOT_AUTHORISED_TO_VIEW_DESK/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data as ManagementDashboard;
}

export const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        maximumFractionDigits: 0,
      }).format(n);

export const shortDate = (iso: string | null | undefined) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export const shortDateTime = (iso: string | null | undefined) =>
  !iso
    ? "not frozen yet"
    : new Date(iso).toLocaleString("en-KE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

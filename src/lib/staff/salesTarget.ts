/**
 * SALES TARGET ENGINE — client contract.
 *
 * The monthly target (KSh 3,000,000 per eligible sales specialist by default)
 * lives in the targets register in the database, never in this file and never in
 * a component. Everything here is a read of `commercial_target_dashboard`, which
 * computes attainment, pacing, pipeline coverage and the team roster
 * server-side from the commercial records themselves.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type TargetScope = "mine" | "team" | "person";
export type TargetPeriod = "today" | "week" | "month" | "quarter" | "year" | "custom";

export const PERIOD_LABEL: Record<TargetPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom range",
};

export type TargetStatus =
  | "NO_TARGET"
  | "EXCEEDING_TARGET"
  | "ON_PACE"
  | "AT_RISK"
  | "BEHIND";

export const STATUS_LABEL: Record<TargetStatus, string> = {
  NO_TARGET: "No target set",
  EXCEEDING_TARGET: "Target exceeded",
  ON_PACE: "On pace",
  AT_RISK: "At risk",
  BEHIND: "Behind",
};

/** Presentation tone only — the classification itself is computed server-side. */
export const STATUS_TONE: Record<TargetStatus, string> = {
  NO_TARGET: "border-border text-muted-foreground",
  EXCEEDING_TARGET:
    "border-[hsl(var(--status-success)/0.45)] text-[hsl(var(--status-success))]",
  ON_PACE: "border-[hsl(var(--status-success)/0.45)] text-[hsl(var(--status-success))]",
  AT_RISK: "border-[hsl(var(--status-warning)/0.5)] text-[hsl(var(--status-warning))]",
  BEHIND: "border-destructive/50 text-destructive",
};

export interface TargetPacing {
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  /** Pace measured on working days when the engine is set that way. */
  business_days_only: boolean;
  selling_days_total: number;
  selling_days_elapsed: number;
  selling_days_remaining: number;
  expected_to_date_kes: number;
  pace_pct: number | null;
  required_daily_pace_kes: number;
  required_selling_day_pace_kes: number;
  projected_revenue_kes: number;
  projected_attainment_pct: number | null;
}

/** Open response commitments behind the figures. */
export interface TargetSla {
  open: number;
  approaching: number;
  breached: number;
  escalated: number;
}

export interface TargetPipeline {
  open_count: number;
  open_pipeline_kes: number;
  weighted_pipeline_kes: number;
  coverage_x: number | null;
  weighted_coverage_x: number | null;
  forecast_revenue_kes: number;
}

export interface TargetQuality {
  won_count: number;
  lost_count: number;
  decided_count: number;
  win_rate_pct: number | null;
  avg_deal_value_kes: number | null;
  lead_to_close_days: number | null;
}

export interface TargetActions {
  target_gap_kes: number;
  closing_soon_count: number;
  awaiting_customer_count: number;
  overdue_followups_count: number;
  sla_breach_count: number;
  forecast_revenue_kes: number;
  coverage_x: number | null;
}

export interface TargetRosterRow {
  staff_id: string;
  name: string | null;
  position: string | null;
  target_kes: number;
  revenue_won_kes: number;
  attainment_pct: number | null;
  remaining_kes: number;
  open_pipeline_kes: number;
  weighted_pipeline_kes: number;
  coverage_x: number | null;
  win_rate_pct: number | null;
  won_count: number;
  decided_count: number;
  lead_to_close_days: number | null;
  sales_cycle_days: number | null;
  awaiting_customer_count: number;
  stale_count: number;
  sla_open: number;
  sla_approaching: number;
  sla_breaches: number;
  sla_escalated: number;
  /** Plain reasons this person needs the manager's attention. */
  intervention_reasons: string[];
  needs_intervention: boolean;
  is_me: boolean;
}

export interface TargetDashboard {
  scope: TargetScope;
  can_view_team: boolean;
  people: number;
  /** Set when one salesperson is being looked at on their own. */
  person_staff_id: string | null;
  person_name: string | null;
  period: TargetPeriod;
  period_start: string;
  period_end: string;
  include_test: boolean;
  /** True when the period has ended and its figures are locked to the closing record. */
  frozen: boolean;
  frozen_at: string | null;
  target_kes: number;
  /** How the target for this period was derived from the monthly quota. */
  target_basis: string;
  revenue_won_kes: number;
  previous_revenue_kes: number;
  revenue_delta_pct: number | null;
  attainment_pct: number | null;
  remaining_kes: number;
  surplus_kes: number;
  status: TargetStatus;
  /** Why the engine reached that status, in plain words. */
  status_reason: string;
  pacing: TargetPacing;
  pipeline: TargetPipeline;
  quality: TargetQuality;
  sla: TargetSla;
  actions: TargetActions;
  roster: TargetRosterRow[];
}

/**
 * Lock every month that has finished and is not already closed. Idempotent, so it
 * is safe to call on every read: an already closed month is left exactly as it is.
 */
export async function ensureFinishedMonthsFrozen(): Promise<void> {
  const { error } = await db.rpc("sales_period_autoclose");
  if (error && !/NO_STAFF_IDENTITY/.test(error.message)) throw new Error(error.message);
}

export async function fetchTargetDashboard(
  scope: TargetScope,
  period: TargetPeriod,
  range?: { from: string; to: string },
  staffId?: string,
): Promise<TargetDashboard> {
  // Past periods are read from the closing record, so finish the locking first.
  try {
    await ensureFinishedMonthsFrozen();
  } catch {
    /* a read must still work even when locking is refused */
  }
  const { data, error } = await db.rpc("commercial_target_dashboard", {
    _scope: scope,
    _period: period,
    _from: range?.from ?? null,
    _to: range?.to ?? null,
    _include_test: false,
    _staff: staffId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as TargetDashboard;
}

export const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(n ?? 0));

/** Compact money for dense tiles: KSh 2.4M / KSh 640K. */
export const KESshort = (n: number) => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `KSh ${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `KSh ${Math.round(v / 1_000)}K`;
  return KES(v);
};

/** Attainment ranking, best first. A person with no target sorts last. */
export function rankRoster(rows: TargetRosterRow[]): TargetRosterRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.attainment_pct ?? -1) - (a.attainment_pct ?? -1) ||
      b.revenue_won_kes - a.revenue_won_kes,
  );
}

/** Per-person status, using the same thresholds the server applies in aggregate. */
export function rowStatus(row: TargetRosterRow, pacing: TargetPacing): TargetStatus {
  if (!row.target_kes) return "NO_TARGET";
  if (row.revenue_won_kes >= row.target_kes) return "EXCEEDING_TARGET";
  const projected =
    pacing.days_elapsed > 0
      ? (row.revenue_won_kes * pacing.days_total) / pacing.days_elapsed
      : 0;
  if (projected >= row.target_kes) return "ON_PACE";
  if (projected >= row.target_kes * 0.8) return "AT_RISK";
  return "BEHIND";
}

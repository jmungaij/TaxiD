/**
 * SALES GOVERNANCE — client contract for the target register, response-time
 * policies, month-end closing and the engine settings.
 *
 * Nothing here decides anything: every amount, policy and closure lives in the
 * database and every change is written to the target audit trail by the server.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const SLA_PROCESS_LABEL: Record<string, string> = {
  LEAD_RESPONSE: "First response to a new enquiry",
  QUALIFICATION: "Qualify the enquiry",
  INFORMATION_REQUEST: "Chase information asked of the customer",
  PROPOSAL_FOLLOWUP: "Follow up a proposal",
  CONTRACT_FOLLOWUP: "Follow up a contract",
  ACCOUNT_ACTIVATION: "Activate a new account",
};

export interface SlaClock {
  clock_id: string;
  process: string;
  entity_type: string;
  entity_id: string;
  entity_ref: string | null;
  staff_id: string;
  staff_name: string | null;
  due_at: string;
  started_at: string;
  paused: boolean;
  escalation_level: number;
  breached: boolean;
  minutes_remaining: number;
  organisation: string | null;
  stage: string | null;
}

export interface SlaBoard {
  scope: string;
  clocks: SlaClock[];
}

export async function fetchSlaBoard(scope: "mine" | "team"): Promise<SlaBoard> {
  const { data, error } = await db.rpc("sales_sla_board", { _scope: scope });
  if (error) throw new Error(error.message);
  return data as SlaBoard;
}

export async function runSlaSweep() {
  const { data, error } = await db.rpc("sales_sla_sweep");
  if (error) throw new Error(error.message);
  return data as { swept_at: string; approaching: number; breached: number; escalated: number };
}

/* ------------------------------------------------------------- governance */

export interface EngineSettings {
  business_days_only: boolean;
  warn_ratio: number;
  closing_soon_days: number;
  stale_followup_days: number;
  eligible_position_codes: string[];
}

export interface TargetRow {
  id: string;
  scope: string;
  period: string;
  currency: string;
  amount_kes: number;
  position_code: string | null;
  staff_member_id: string | null;
  staff_name: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  is_override: boolean;
  notes: string | null;
}

export interface PolicyRow {
  id: string;
  process: string;
  label: string | null;
  minutes: number;
  warn_ratio: number;
  pause_on_customer: boolean;
  is_active: boolean;
  effective_from: string;
}

export interface ClosureRow {
  period_start: string;
  period_end: string;
  staff_member_id: string;
  staff_name: string | null;
  target_kes: number;
  revenue_kes: number;
  /** Corrections recorded on top of the locked figure, if any. */
  adjustment_kes: number;
  attainment_pct: number | null;
  won_count: number;
  closed_at: string;
}

export interface GovernanceRosterRow {
  staff_id: string;
  name: string | null;
  position_code: string;
  position: string | null;
  target_kes: number | null;
  target_period: string | null;
  currency: string | null;
}

export interface AuditRow {
  action: string;
  scope: string | null;
  staff_member_id: string | null;
  before_value: Json | null;
  after_value: Json | null;
  note: string | null;
  created_at: string;
}

export interface GovernanceOverview {
  settings: EngineSettings;
  targets: TargetRow[];
  policies: PolicyRow[];
  closures: ClosureRow[];
  roster: GovernanceRosterRow[];
  positions: { code: string; title: string | null }[];
  audit: AuditRow[];
}

export async function fetchGovernance(): Promise<GovernanceOverview> {
  const { data, error } = await db.rpc("sales_governance_overview");
  if (error) throw new Error(error.message);
  return data as GovernanceOverview;
}

export const TARGET_PERIODS = ["MONTH", "QUARTER", "YEAR"] as const;
export type TargetSettingPeriod = (typeof TARGET_PERIODS)[number];

export const TARGET_PERIOD_LABEL: Record<TargetSettingPeriod, string> = {
  MONTH: "Per month",
  QUARTER: "Per quarter",
  YEAR: "Per year",
};

/** Currencies the register accepts. The amount is always stored as entered. */
export const TARGET_CURRENCIES = ["KES", "USD", "EUR", "GBP"] as const;

export async function setTarget(input: {
  scope: "COMPANY" | "POSITION" | "STAFF";
  amount_kes: number;
  period?: TargetSettingPeriod;
  currency?: string;
  staff_member_id?: string | null;
  position_code?: string | null;
  effective_from?: string;
  notes?: string;
}) {
  const { data, error } = await db.rpc("sales_target_set", { p: input as unknown as Json });
  if (error) throw new Error(error.message);
  return data as {
    target_id: string;
    amount_kes: number;
    period: string;
    currency: string;
    effective_from: string;
  };
}

export async function saveEngineSettings(input: Partial<EngineSettings> & { notes?: string }) {
  const { data, error } = await db.rpc("sales_engine_settings_set", {
    p: input as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as EngineSettings;
}

export async function closePeriod(periodStart: string) {
  const { data, error } = await db.rpc("sales_period_close", {
    p: { period_start: periodStart } as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as { period_start: string; period_end: string; people: number };
}

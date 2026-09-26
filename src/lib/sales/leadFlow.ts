/**
 * Lead-to-revenue flow readings.
 *
 * Every figure here is read from the database projections
 * `v_sales_lead_stage_flow` and `v_sales_stage_bottlenecks`, which derive the
 * step, the waiting time and the recognised revenue from the lead record and
 * the commercial lifecycle. Nothing is computed optimistically in the browser,
 * and revenue is the recognised value on the lifecycle — never "won".
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const FLOW_STEPS = ["NEW", "MEETING", "QUOTE", "CONTRACT", "WON", "LOST"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const STEP_LABEL: Record<FlowStep, string> = {
  NEW: "New lead",
  MEETING: "Meeting held",
  QUOTE: "Quote shared",
  CONTRACT: "Contract shared / signed",
  WON: "Won",
  LOST: "Lost",
};

export interface LeadFlowRow {
  lead_id: string;
  lead_ref: string;
  organisation_name: string;
  contact_name: string | null;
  service_interest: string | null;
  source: string | null;
  sales_staff_id: string | null;
  owner_name: string | null;
  estimated_value_kes: number | null;
  stage: string;
  step: FlowStep;
  created_at: string;
  step_entered_at: string;
  days_in_step: number | null;
  days_since_touched: number | null;
  won_revenue_kes: number | null;
  lifecycle_state: string | null;
  recognised_value_kes: number | null;
  collected_value_kes: number | null;
  lost_reason_code: string | null;
  waiting_on: string | null;
  awaiting_due_date: string | null;
  is_test: boolean | null;
  awaiting_item: string | null;
  contact_state: string | null;
  last_outreach_at: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

/**
 * The next action is whatever the lead record itself says is outstanding. If no
 * awaiting item has been recorded, the step decides the standing next action —
 * nothing is invented beyond the recorded stage.
 */
const STEP_NEXT_ACTION: Record<FlowStep, string> = {
  NEW: "Make first contact and agree a meeting",
  MEETING: "Share the rate card / quote",
  QUOTE: "Share the contract for signature",
  CONTRACT: "Secure the signed contract",
  WON: "Hand over to operations and invoice",
  LOST: "No further action — closed",
};

export function nextAction(row: LeadFlowRow): string {
  const recorded = (row.awaiting_item ?? "").trim();
  return recorded || STEP_NEXT_ACTION[row.step];
}

export interface StageBottleneck {
  step: FlowStep;
  leads: number;
  avg_days_in_step: number | null;
  longest_days_in_step: number | null;
  older_than_7_days: number;
  estimated_value_kes: number | null;
  recognised_value_kes: number | null;
}

export async function listLeadFlow(): Promise<LeadFlowRow[]> {
  const { data, error } = await untypedDb
    .from("v_sales_lead_stage_flow")
    .select("*")
    .order("days_in_step", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadFlowRow[];
}

export async function listStageBottlenecks(): Promise<StageBottleneck[]> {
  const { data, error } = await untypedDb.from("v_sales_stage_bottlenecks").select("*");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as StageBottleneck[];
  return FLOW_STEPS.map((s) => rows.find((r) => r.step === s)).filter(Boolean) as StageBottleneck[];
}

export const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "NOT STATED"
    : `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;

export const days = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toFixed(n < 1 ? 1 : 0)}d`;

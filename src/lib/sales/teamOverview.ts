/**
 * TEAM OVERVIEW — the team leader's read of the desk.
 *
 * Every figure comes from the database views, which are read under row-level
 * security: a specialist only ever sees themselves, a sales manager sees the
 * desk. Nothing is computed twice and nothing is estimated here.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface StageDetailRow {
  lead_id: string;
  lead_ref: string;
  organisation_name: string;
  contact_name: string | null;
  service_interest: string | null;
  sales_staff_id: string | null;
  staff_name: string;
  stage: string;
  estimated_value_kes: number | null;
  won_revenue_kes: number | null;
  meeting_held_at: string | null;
  quote_shared_at: string | null;
  contract_shared_at: string | null;
  contract_signed_at: string | null;
  waiting_on: string | null;
  awaiting_item: string | null;
  awaiting_due_date: string | null;
  lost_reason_code: string | null;
  lost_reason: string | null;
  lost_competitor: string | null;
  lost_expected_price_kes: number | null;
  lost_revisit_date: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listStageDetail(): Promise<StageDetailRow[]> {
  const { data, error } = await untypedDb
    .from("v_sales_lead_stage_detail")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StageDetailRow[];
}

export interface LossByOwnerRow {
  sales_staff_id: string | null;
  staff_name: string;
  reason_code: string;
  leads_lost: number;
  value_lost_kes: number;
  with_competitor_named: number;
  avg_expected_price_kes: number;
}

export async function listLossByOwner(): Promise<LossByOwnerRow[]> {
  const { data, error } = await untypedDb
    .from("v_sales_loss_detail_by_owner")
    .select("*")
    .order("leads_lost", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LossByOwnerRow[];
}

export const OPEN_STAGE_ORDER = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "BOOKED",
  "FULFILLED",
] as const;

/** Group one person's leads by the step they are actually sitting at. */
export function groupByStep(rows: StageDetailRow[]) {
  const step = (r: StageDetailRow) => {
    if (r.stage === "CLOSED_WON") return "Won";
    if (r.stage === "CLOSED_LOST" || r.stage === "DISQUALIFIED") return "Lost";
    if (r.contract_signed_at) return "Contract signed";
    if (r.contract_shared_at) return "Contract shared";
    if (r.quote_shared_at) return "Quote shared";
    if (r.meeting_held_at) return "Meeting held";
    return "New lead";
  };
  const order = [
    "New lead",
    "Meeting held",
    "Quote shared",
    "Contract shared",
    "Contract signed",
    "Won",
    "Lost",
  ];
  const map = new Map<string, StageDetailRow[]>();
  for (const r of rows) {
    const k = step(r);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return order.filter((k) => map.has(k)).map((k) => ({ step: k, rows: map.get(k)! }));
}

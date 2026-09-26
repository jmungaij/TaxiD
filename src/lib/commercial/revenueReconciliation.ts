/**
 * FINANCE RECONCILIATION + CONTRACT CONTROL — client read/write layer.
 *
 * Revenue history is append-only: finance approves, adjusts or rejects an
 * entry with a written reason, and adjustments post a compensating entry
 * instead of editing the original. The database enforces both the reason and
 * the one-decision-per-entry rule. Shapes below mirror the RPC output exactly.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RevenueQueueEvent {
  id: string;
  contract_id: string | null;
  contract_number: string | null;
  customer: string | null;
  owner_name: string | null;
  event_type: string;
  amount: number;
  currency: string;
  revenue_period: string | null;
  execution_date: string | null;
  created_at: string;
  contract_value: number | null;
  contract_status: string | null;
  variance: number | null;
  review_decision: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  adjusted_amount: number | null;
  delta_amount: number | null;
}

export interface RevenuePeriodRow {
  revenue_period: string | null;
  events: number;
  amount_kes: number;
  unreviewed: number;
}

export interface RevenueReconciliationQueue {
  ok: boolean;
  error?: string;
  can_decide?: boolean;
  totals?: {
    events: number;
    unreviewed: number;
    unreviewed_kes: number;
    approved_kes: number;
    adjusted_kes: number;
    rejected_kes: number;
    net_kes: number;
  };
  periods?: RevenuePeriodRow[];
  events?: RevenueQueueEvent[];
}

export type RevenueDecision = "APPROVED" | "ADJUSTED" | "REJECTED";

export interface RevenueReviewResult {
  ok: boolean;
  error?: string;
  detail?: string;
  review_id?: string;
  decision?: RevenueDecision;
  original_amount?: number;
  adjusted_amount?: number | null;
  delta?: number | null;
  correction_event_id?: string | null;
}

export async function fetchRevenueReconciliationQueue(): Promise<RevenueReconciliationQueue> {
  const { data, error } = await supabase.rpc("revenue_reconciliation_queue");
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "NO_DATA" }) as unknown as RevenueReconciliationQueue;
}

export async function reviewRevenueEvent(args: {
  revenueEventId: string;
  decision: RevenueDecision;
  reason: string;
  adjustedAmount?: number | null;
}): Promise<RevenueReviewResult> {
  const { data, error } = await supabase.rpc("revenue_event_review", {
    _event: args.revenueEventId,
    _decision: args.decision,
    _reason: args.reason,
    ...(args.adjustedAmount === null || args.adjustedAmount === undefined
      ? {}
      : { _adjusted_amount: args.adjustedAmount }),
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "NO_DATA" }) as unknown as RevenueReviewResult;
}

/** One row of any control-centre exception group. Fields present vary by group. */
export interface ControlException {
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
  owner_name: string | null;
  status?: string;
  value_amount?: number | null;
  currency?: string | null;
  execution_date?: string | null;
  blockers?: number;
  contract_value?: number | null;
  opportunity_value?: number | null;
  opportunity_ref?: string | null;
  variance?: number | null;
  variance_reason?: string | null;
}

export interface ContractControlExceptions {
  ok: boolean;
  error?: string;
  pending_activation?: ControlException[];
  value_mismatch?: ControlException[];
  missing_value?: ControlException[];
  missing_signed_copy?: ControlException[];
  contracted_without_revenue?: ControlException[];
  revenue_pending_activation_kes?: number;
  unreviewed_revenue?: number;
}

export async function fetchContractControlExceptions(): Promise<ContractControlExceptions> {
  const { data, error } = await supabase.rpc("contract_control_exceptions");
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "NO_DATA" }) as unknown as ContractControlExceptions;
}

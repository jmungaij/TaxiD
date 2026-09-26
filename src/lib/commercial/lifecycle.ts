/**
 * Commercial lifecycle (quote-to-cash) client layer.
 *
 * The single law this encodes: **won is not revenue**. A commercial record
 * walks a defined path — Lead → Opportunity → Won → Contracted → Ordered →
 * Delivered → Billable → Invoiced → Revenue recognised → Cash collected — and
 * only the state carrying `revenue_treatment === "qualifying"` counts towards
 * the monthly target. Every step has an entry condition, an exit condition and
 * the documents it requires; the database refuses to move a record forward
 * without them unless a manager overrides with a written reason.
 */
import { supabase } from "@/integrations/supabase/client";

export const COMMERCIAL_STATES = [
  "LEAD",
  "OPPORTUNITY",
  "WON",
  "CONTRACTED",
  "ORDERED",
  "DELIVERED",
  "BILLABLE",
  "INVOICED",
  "RECOGNISED",
  "COLLECTED",
  "LOST",
  "CANCELLED",
] as const;
export type CommercialState = (typeof COMMERCIAL_STATES)[number];

export type RevenueTreatment = "none" | "pipeline" | "contracted" | "qualifying";

export interface MissingEvidence {
  document_type: string;
  label: string;
}

export interface LifecycleStateView {
  state: CommercialState;
  label: string;
  seq: number;
  description: string;
  entry_condition: string;
  exit_condition: string;
  revenue_treatment: RevenueTreatment;
  position: "complete" | "current" | "pending";
  missing: MissingEvidence[];
}

export interface LifecycleEvidence {
  document_type: string;
  reference: string | null;
  recorded_at: string;
  note: string | null;
}

export interface LifecycleHistoryRow {
  from_state: CommercialState | null;
  to_state: CommercialState;
  amount_kes: number | null;
  reason: string | null;
  is_override: boolean;
  at: string;
}

export interface LifecycleDetail {
  exists: boolean;
  lifecycle_id?: string;
  lead_id?: string;
  lead_ref?: string | null;
  current_state?: CommercialState;
  current_label?: string;
  revenue_treatment?: RevenueTreatment;
  is_revenue?: boolean;
  values?: {
    opportunity_kes: number | null;
    contracted_kes: number | null;
    ordered_kes: number | null;
    delivered_kes: number | null;
    billable_kes: number | null;
    invoiced_kes: number | null;
    recognised_kes: number | null;
    collected_kes: number | null;
  };
  blocked_reason?: string | null;
  states?: LifecycleStateView[];
  next_state?: CommercialState | null;
  next_missing?: MissingEvidence[];
  evidence?: LifecycleEvidence[];
  history?: LifecycleHistoryRow[];
}

export interface AdvanceResult {
  ok: boolean;
  error?: string;
  state?: CommercialState;
  from?: CommercialState;
  amount_kes?: number | null;
  work_item_id?: string | null;
  revenue_treatment?: RevenueTreatment;
  missing?: MissingEvidence[];
  overridden_missing?: MissingEvidence[];
}

/** Plain-English document names, used when the registry label is unavailable. */
export const DOCUMENT_LABEL: Record<string, string> = {
  quotation_accepted: "Accepted quotation",
  mobility_service_contract: "Mobility Service Contract",
  purchase_order: "Customer purchase order / LPO",
  service_order: "Service order",
  service_completion: "Service completion record",
  pod: "Proof of delivery",
  invoice: "Invoice",
  payment: "Payment record",
};

/** Failure codes the engine raises, in the words a salesperson understands. */
export const ADVANCE_ERROR_MESSAGE: Record<string, string> = {
  DOCUMENTATION_INCOMPLETE: "The paperwork for that step is not on file yet.",
  ALREADY_IN_STATE: "This record is already at that step.",
  RECORD_IS_CLOSED: "This record is closed. A manager must reopen it.",
  BACKWARD_TRANSITION_REQUIRES_OVERRIDE: "Only a manager can move a record back a step.",
  STEP_SKIPPED_REQUIRES_OVERRIDE: "Steps cannot be skipped. Only a manager may jump ahead.",
  OVERRIDE_NOT_PERMITTED: "You are not permitted to override the required paperwork.",
  OVERRIDE_REASON_REQUIRED: "An override needs a written reason.",
  NO_STAFF_IDENTITY: "Your staff record is not linked to this account.",
  COMMERCIAL_RECORD_NOT_FOUND: "That commercial record no longer exists.",
};

export function advanceErrorMessage(code?: string | null): string {
  if (!code) return "That step could not be completed.";
  return ADVANCE_ERROR_MESSAGE[code] ?? code.replace(/_/g, " ").toLowerCase();
}

export async function fetchLifecycle(leadId: string): Promise<LifecycleDetail> {
  const { data, error } = await supabase.rpc("commercial_lifecycle_detail", { _lead: leadId });
  if (error) throw error;
  return (data ?? { exists: false }) as unknown as LifecycleDetail;
}

export async function advanceLifecycle(args: {
  leadId: string;
  toState: CommercialState;
  amountKes?: number | null;
  reason?: string | null;
  override?: boolean;
}): Promise<AdvanceResult> {
  const { data, error } = await supabase.rpc("commercial_lifecycle_advance", {
    _lead: args.leadId,
    _to_state: args.toState,
    _amount: args.amountKes ?? null,
    _reason: args.reason ?? null,
    _override: args.override ?? false,
  });
  if (error) return { ok: false, error: error.message.replace(/^.*?(?=[A-Z_]{5,})/, "") };
  return (data ?? { ok: false }) as unknown as AdvanceResult;
}

export async function recordEvidence(args: {
  leadId: string;
  documentType: string;
  reference?: string | null;
  documentId?: string | null;
  documentTable?: string | null;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("commercial_lifecycle_evidence_add", {
    _lead: args.leadId,
    _document_type: args.documentType,
    _reference: args.reference ?? null,
    _document_id: args.documentId ?? null,
    _document_table: args.documentTable ?? null,
    _note: args.note ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

export const KES = (n?: number | null) =>
  typeof n === "number"
    ? new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n)
    : "—";

/** True when reaching this state books qualifying revenue. */
export const isRevenueState = (t?: RevenueTreatment | null) => t === "qualifying";

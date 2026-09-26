/**
 * Phase 8.4.11–8.4.13 — capture at source, payment linkage, strict eligibility.
 *
 * This module is the only client-side path to the money fields on the
 * commercial transaction spine. It never computes a revenue figure in the
 * browser: every figure comes from `service_line_financial_terms` applied
 * server-side, and every eligibility verdict comes from
 * `check_revenue_eligibility`, which logs the exact missing fields.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const REQUIRED_CAPTURE_FIELDS = [
  "currency",
  "customer_charge_cents",
  "gross_transaction_value_cents",
  "tax_cents",
  "commission_platform_revenue_cents",
  "partner_entitlement_cents",
  "provider_ref",
  "payment_ref",
  "payment_status",
  "fulfilled_at",
] as const;
export type CaptureField = (typeof REQUIRED_CAPTURE_FIELDS)[number];

export const CAPTURE_FIELD_LABEL: Record<string, string> = {
  currency: "Currency",
  customer_charge_cents: "Customer charge",
  gross_transaction_value_cents: "Net (ex-tax) value",
  tax_cents: "Tax (VAT)",
  commission_platform_revenue_cents: "Platform commission",
  partner_entitlement_cents: "Partner entitlement",
  provider_ref: "Provider reference",
  payment_ref: "Payment reference",
  payment_status: "Payment status",
  fulfilled_at: "Fulfilment timestamp",
};

export type ReviewStatus = "pending" | "approved" | "rejected" | "not_required";

export interface EligibilityResult {
  ok: boolean;
  transactionRef: string | null;
  eligible: boolean;
  economicsComplete: boolean;
  missingFields: string[];
  blockers: string[];
  ruleKey: string | null;
  reason: string;
  error?: string;
}

export interface SpineTransactionRow {
  id: string;
  transaction_ref: string;
  service_line: string;
  status: string;
  origin_path: string;
  currency: string | null;
  customer_charge_cents: number | null;
  gross_transaction_value_cents: number | null;
  tax_cents: number | null;
  platform_revenue_cents: number | null;
  partner_entitlement_cents: number | null;
  payment_cost_cents: number | null;
  contribution_cents: number | null;
  payment_ref: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  provider_ref: string | null;
  booking_table: string | null;
  booking_id: string | null;
  economics_complete: boolean;
  missing_fields: unknown;
  financially_eligible: boolean;
  eligibility_reason: string | null;
  financial_review_status: ReviewStatus;
  financial_reviewed_at: string | null;
  financial_review_notes: string | null;
  financials_source: string | null;
  provenance: string;
  recognised_at: string | null;
  created_at: string;
}

export interface FinancialTermsRow {
  service_line: string;
  currency: string;
  tax_rate_bps: number;
  tax_inclusive: boolean;
  commission_bps: number;
  payment_cost_bps: number;
  principal_contract: boolean;
  notes: string | null;
  approved_at: string | null;
}

export interface RecognitionRuleRow {
  rule_key: string;
  service_line: string;
  description: string;
  requires_payment: boolean;
  requires_invoice: boolean;
  requires_settlement: boolean;
  recognise_gross: boolean;
  is_active: boolean;
  approved_at: string | null;
}

export interface EligibilityCheckRow {
  id: string;
  transaction_ref: string;
  rule_key: string | null;
  eligible: boolean;
  economics_complete: boolean;
  missing_fields: unknown;
  blockers: unknown;
  review_status: string | null;
  source: string;
  checked_at: string;
}

export interface BackfillRunRow {
  id: string;
  dry_run: boolean;
  attempted: number;
  populated: number;
  still_incomplete: number;
  report: unknown;
  started_at: string;
  finished_at: string | null;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function toEligibility(data: unknown): EligibilityResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: d.ok === true,
    transactionRef: typeof d.transaction_ref === "string" ? d.transaction_ref : null,
    eligible: d.eligible === true,
    economicsComplete: d.economics_complete === true,
    missingFields: asStringList(d.missing_fields),
    blockers: asStringList(d.blockers),
    ruleKey: typeof d.rule_key === "string" ? d.rule_key : null,
    reason: typeof d.reason === "string" ? d.reason : "",
    error: typeof d.error === "string" ? d.error : undefined,
  };
}

/** Capture money fields at source for a completed trip, then re-check eligibility. */
export async function captureTripFinancials(bookingId: string): Promise<EligibilityResult> {
  const { error } = await rpc("capture_trip_financials", { _booking_id: bookingId });
  if (error) return { ...toEligibility({}), reason: error.message, error: error.message };
  return checkEligibilityForBooking("trip_bookings", bookingId);
}

/** Capture money fields at source for a charter booking, then re-check eligibility. */
export async function captureCharterFinancials(bookingId: string): Promise<EligibilityResult> {
  const { error } = await rpc("capture_charter_financials", { _booking_id: bookingId });
  if (error) return { ...toEligibility({}), reason: error.message, error: error.message };
  return checkEligibilityForBooking("charter_bookings", bookingId);
}

/** Write an authoritative payment reference and status into the spine. */
export async function linkTransactionPayment(input: {
  bookingTable: "trip_bookings" | "charter_bookings";
  bookingId: string;
  paymentRef: string;
  paymentStatus: string;
  paymentProvider?: string | null;
  paidAt?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await rpc("link_transaction_payment", {
    _booking_table: input.bookingTable,
    _booking_id: input.bookingId,
    _payment_ref: input.paymentRef,
    _payment_status: input.paymentStatus,
    _payment_provider: input.paymentProvider ?? null,
    _paid_at: input.paidAt ?? new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  return { ok: d.ok === true, error: typeof d.error === "string" ? d.error : undefined };
}

export async function checkEligibility(transactionId: string, source = "manual"): Promise<EligibilityResult> {
  const { data, error } = await rpc("check_revenue_eligibility", {
    _transaction_id: transactionId,
    _source: source,
  });
  if (error) return { ...toEligibility({}), reason: error.message, error: error.message };
  return toEligibility(data);
}

async function checkEligibilityForBooking(table: string, bookingId: string): Promise<EligibilityResult> {
  const { data, error } = await (supabase as any)
    .from("commercial_transactions")
    .select("id")
    .eq("booking_table", table)
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error || !data?.id) {
    return { ...toEligibility({}), reason: "No commercial transaction is linked to this booking." };
  }
  return checkEligibility(data.id as string, "capture_at_source");
}

/** Finance decision on the captured figures for one transaction. */
export async function reviewTransactionFinancials(
  transactionId: string,
  decision: "approved" | "rejected" | "pending",
  notes?: string,
): Promise<EligibilityResult> {
  const { data, error } = await rpc("review_transaction_financials", {
    _transaction_id: transactionId,
    _decision: decision,
    _notes: notes ?? null,
  });
  if (error) return { ...toEligibility({}), reason: error.message, error: error.message };
  return toEligibility(data);
}

/** Finance sign-off on a recognition rule — a gate, not a formality. */
export async function approveRecognitionRule(
  ruleKey: string,
  approve = true,
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await rpc("approve_recognition_rule", {
    _rule_key: ruleKey,
    _approve: approve,
    _notes: notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  return { ok: d.ok === true, error: typeof d.error === "string" ? d.error : undefined };
}

export interface BackfillResult {
  ok: boolean;
  runId: string | null;
  dryRun: boolean;
  attempted: number;
  populated: number;
  stillIncomplete: number;
  gaps: Array<Record<string, unknown>>;
  error?: string;
}

/** Controlled backfill of the money fields on existing bookings. */
export async function runFinancialBackfill(dryRun = true, limit = 500): Promise<BackfillResult> {
  const { data, error } = await rpc("backfill_commercial_financials", {
    _dry_run: dryRun,
    _limit: limit,
  });
  if (error) {
    return { ok: false, runId: null, dryRun, attempted: 0, populated: 0, stillIncomplete: 0, gaps: [], error: error.message };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: d.ok === true,
    runId: typeof d.run_id === "string" ? d.run_id : null,
    dryRun: d.dry_run === true,
    attempted: Number(d.attempted ?? 0),
    populated: Number(d.populated ?? 0),
    stillIncomplete: Number(d.still_incomplete ?? 0),
    gaps: Array.isArray(d.gaps) ? (d.gaps as Array<Record<string, unknown>>) : [],
    error: typeof d.error === "string" ? d.error : undefined,
  };
}

export function formatCents(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents === null || cents === undefined) return "DATA NOT AVAILABLE";
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: currency || "KES",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

/** Aggregate capture health across the spine — the honest, unflattering view. */
export function summariseCapture(rows: readonly SpineTransactionRow[]) {
  const missingTally = new Map<string, number>();
  for (const row of rows) {
    for (const field of asStringList(row.missing_fields)) {
      missingTally.set(field, (missingTally.get(field) ?? 0) + 1);
    }
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.economics_complete).length,
    eligible: rows.filter((r) => r.financially_eligible).length,
    approved: rows.filter((r) => r.financial_review_status === "approved").length,
    awaitingReview: rows.filter((r) => r.financial_review_status === "pending").length,
    rejected: rows.filter((r) => r.financial_review_status === "rejected").length,
    missingPayment: rows.filter((r) => !r.payment_ref).length,
    missingTally: [...missingTally.entries()].sort((a, b) => b[1] - a[1]),
  };
}

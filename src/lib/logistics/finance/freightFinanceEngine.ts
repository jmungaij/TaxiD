/**
 * PHASE 7 — freight audit, billing & financial reconciliation client API.
 *
 * The console owns NO financial logic. Every amount, state change, allocation,
 * settlement and finding is produced by an authoritative database operation.
 * The client may not write to the financial tables directly, may not compute a
 * price, and may not decide who is allowed to act.
 *
 * INTEGRATION LAW: SAFARID's existing M-Pesa engine (`mpesa_transactions`,
 * `payment_attempts`, callbacks, idempotency keys, reconciliation runs) remains
 * the PAYMENT AUTHORITY. Nothing here initiates, mutates or re-implements a
 * payment. `allocatePayment` only records the relationship between money that
 * the existing payment authority already confirmed and a freight invoice, and
 * classifies the financial outcome (exact, partial, over, under, duplicate,
 * unmatched, reversed).
 *
 * Idempotency: every mutating call carries an `idempotency_key`. Replaying a key
 * returns `duplicate: true` and creates no second financial effect.
 */
import { supabase } from "@/integrations/supabase/client";

/* -------------------------------------------------------------- contracts */

export type ChargeParty = "CUSTOMER" | "CARRIER";

export type ChargeStatus =
  | "CALCULATED" | "PENDING_REVIEW" | "APPROVED" | "INVOICED" | "PAID" | "SETTLED" | "VOID";

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export type AllocationState =
  | "ALLOCATED" | "PARTIAL" | "OVERPAYMENT" | "UNDERPAYMENT"
  | "UNMATCHED" | "REVERSED" | "DUPLICATE";

export type SettlementStatus = "CALCULATED" | "PENDING_REVIEW" | "APPROVED" | "PAID" | "REVERSED";

export type FindingSeverity = "INFO" | "MINOR" | "MAJOR" | "CRITICAL";
export type FindingState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "WAIVED";

export type ConfigState =
  | "CONFIGURED" | "OWNER_CONFIGURATION_REQUIRED" | "PROVIDER_CONFIGURATION_REQUIRED";

/** Billing bases are owned by the versioned commercial architecture, never the UI. */
export const BILLING_BASES = [
  "PER_SHIPMENT", "PER_PACKAGE", "PER_KG", "PER_KM", "PER_LOAD",
  "PER_TRIP", "PER_PALLET", "PER_CONTAINER", "CONTRACT_RATE",
] as const;
export type BillingBasis = (typeof BILLING_BASES)[number];

/** Reason codes raised by the freight audit engine (server-owned taxonomy). */
export const AUDIT_REASON_CODES = [
  "RATE_MISMATCH",
  "DUPLICATE_CHARGE",
  "UNAPPROVED_RATE",
  "CHARGE_WITHOUT_OPERATIONAL_EVIDENCE",
  "MISSING_CARRIER_CHARGE",
  "DUPLICATE_PAYMENT_ALLOCATION",
] as const;

export const RECON_REASON_CODES = [
  "EXPECTED_VS_CHARGED_VARIANCE",
  "CHARGED_NOT_INVOICED",
  "INVOICED_NOT_PAID",
  "PAID_EXCEEDS_INVOICED",
  "CARRIER_OVERPAID",
] as const;

export interface ChargeRow {
  id: string;
  charge_number: string;
  party: ChargeParty;
  status: ChargeStatus;
  charge_code: string;
  basis: BillingBasis;
  quantity: number;
  unit_rate: number;
  amount: number;
  tax_amount: number;
  currency: string;
  customer_user_id: string | null;
  carrier_id: string | null;
  booking_id: string | null;
  package_id: string | null;
  manifest_id: string | null;
  order_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  settlement_id: string | null;
  approved_at: string | null;
  reason_code: string | null;
  operational_evidence: Record<string, unknown>;
  correlation_id: string;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  party: ChargeParty;
  status: InvoiceStatus;
  customer_user_id: string | null;
  carrier_id: string | null;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  paid_total: number;
  issued_at: string | null;
  due_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_no: number;
  charge_id: string;
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  tax_amount: number;
  lineage: Record<string, unknown>;
}

export interface AllocationRow {
  id: string;
  invoice_id: string | null;
  payment_attempt_id: string | null;
  mpesa_transaction_id: string | null;
  provider: string;
  provider_reference: string | null;
  provider_status: string | null;
  amount: number;
  currency: string;
  state: AllocationState;
  unmatched_reason: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface SettlementRow {
  id: string;
  settlement_number: string;
  carrier_id: string;
  status: SettlementStatus;
  currency: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  adjustments_amount: number;
  net_payable: number;
  carrier_claimed_amount: number | null;
  variance_amount: number;
  payout_reference: string | null;
  paid_at: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface SettlementLineRow {
  id: string;
  settlement_id: string;
  charge_id: string | null;
  booking_id: string | null;
  description: string;
  eligible_amount: number;
  adjustment_amount: number;
  net_amount: number;
  evidence: Record<string, unknown>;
}

export interface AuditRunRow {
  id: string;
  window_start: string;
  window_end: string;
  bookings_scanned: number;
  charges_scanned: number;
  invoices_scanned: number;
  findings: number;
  critical: number;
  balanced: boolean;
  created_at: string;
}

export interface AuditFindingRow {
  id: string;
  run_id: string | null;
  reason_code: string;
  severity: FindingSeverity;
  state: FindingState;
  booking_id: string | null;
  charge_id: string | null;
  invoice_id: string | null;
  carrier_id: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  variance_amount: number | null;
  currency: string;
  detail: string;
  source_records: Record<string, unknown>;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ReconRunRow {
  id: string;
  window_start: string;
  window_end: string;
  transactions_scanned: number;
  exceptions: number;
  critical: number;
  balanced: boolean;
  created_at: string;
}

export interface ReconExceptionRow {
  id: string;
  run_id: string | null;
  booking_id: string | null;
  order_id: string | null;
  carrier_id: string | null;
  reason_code: string;
  severity: FindingSeverity;
  state: FindingState;
  expected_amount: number;
  charged_amount: number;
  invoiced_amount: number;
  paid_amount: number;
  settled_amount: number;
  carrier_paid_amount: number;
  variance_amount: number;
  currency: string;
  detail: string;
  resolution_notes: string | null;
  created_at: string;
}

export interface AdjustmentRow {
  id: string;
  charge_id: string;
  kind: "CREDIT" | "DEBIT" | "REVERSAL";
  amount: number;
  currency: string;
  reason_code: string;
  reason_note: string | null;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
}

export interface BillingConfigRow {
  key: string;
  label: string;
  category: string;
  state: ConfigState;
  value: Record<string, unknown>;
  owner_role: string | null;
  guidance: string | null;
  updated_at: string;
}

export interface ChargeLineage {
  charge: ChargeRow;
  quote: Record<string, unknown> | null;
  rate_card: Record<string, unknown> | null;
  rate_line: Record<string, unknown> | null;
  booking: Record<string, unknown> | null;
  award: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  package: Record<string, unknown> | null;
  invoice: InvoiceRow | null;
  invoice_line: InvoiceLineRow | null;
  allocations: AllocationRow[];
  adjustments: AdjustmentRow[];
  events: Array<{
    id: string; from_status: string | null; to_status: string;
    reason_code: string | null; note: string | null; created_at: string;
  }>;
  settlement: SettlementRow | null;
}

export interface OpResult {
  ok: boolean;
  duplicate?: boolean;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ plumbing */

type AnyClient = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as AnyClient;

/** Deterministic idempotency key: the same operation replays as a duplicate. */
export function financeKey(operation: string, ...parts: (string | number | null | undefined)[]): string {
  return [operation, ...parts.map((p) => (p === null || p === undefined ? "-" : String(p)))].join(":");
}

async function call(fn: string, args: Record<string, unknown>): Promise<OpResult> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? { ok: false }) as OpResult;
}

async function rows<T>(
  table: string,
  build: (q: any) => any = (q) => q,
  limit = 200,
): Promise<T[]> {
  const { data, error } = await build(db.from(table).select("*")).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/* -------------------------------------------------------------------- reads */

export const listCharges = (filters: {
  party?: ChargeParty; status?: ChargeStatus; search?: string; limit?: number;
} = {}) =>
  rows<ChargeRow>("freight_charges", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.party) out = out.eq("party", filters.party);
    if (filters.status) out = out.eq("status", filters.status);
    if (filters.search) out = out.ilike("charge_number", `%${filters.search}%`);
    return out;
  }, filters.limit ?? 200);

export const listInvoices = (filters: { status?: InvoiceStatus; search?: string; limit?: number } = {}) =>
  rows<InvoiceRow>("freight_invoices", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.status) out = out.eq("status", filters.status);
    if (filters.search) out = out.ilike("invoice_number", `%${filters.search}%`);
    return out;
  }, filters.limit ?? 200);

export const listInvoiceLines = (invoiceId: string) =>
  rows<InvoiceLineRow>("freight_invoice_lines", (q) => q.eq("invoice_id", invoiceId).order("line_no"));

export const listAllocations = (filters: { state?: AllocationState; limit?: number } = {}) =>
  rows<AllocationRow>("freight_payment_allocations", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.state) out = out.eq("state", filters.state);
    return out;
  }, filters.limit ?? 200);

export const listSettlements = (filters: { status?: SettlementStatus; limit?: number } = {}) =>
  rows<SettlementRow>("freight_carrier_settlements", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.status) out = out.eq("status", filters.status);
    return out;
  }, filters.limit ?? 200);

export const listSettlementLines = (settlementId: string) =>
  rows<SettlementLineRow>("freight_settlement_lines", (q) => q.eq("settlement_id", settlementId));

export const listAuditRuns = (limit = 25) =>
  rows<AuditRunRow>("freight_audit_runs", (q) => q.order("created_at", { ascending: false }), limit);

export const listFindings = (filters: { state?: FindingState; severity?: FindingSeverity; limit?: number } = {}) =>
  rows<AuditFindingRow>("freight_audit_findings", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.state) out = out.eq("state", filters.state);
    if (filters.severity) out = out.eq("severity", filters.severity);
    return out;
  }, filters.limit ?? 200);

export const listReconRuns = (limit = 25) =>
  rows<ReconRunRow>("freight_recon_runs", (q) => q.order("created_at", { ascending: false }), limit);

export const listReconExceptions = (filters: { state?: FindingState; limit?: number } = {}) =>
  rows<ReconExceptionRow>("freight_recon_exceptions", (q) => {
    let out = q.order("created_at", { ascending: false });
    if (filters.state) out = out.eq("state", filters.state);
    return out;
  }, filters.limit ?? 200);

export const listAdjustments = (chargeId?: string) =>
  rows<AdjustmentRow>("freight_charge_adjustments", (q) =>
    chargeId ? q.eq("charge_id", chargeId).order("created_at", { ascending: false })
             : q.order("created_at", { ascending: false }));

export const listBillingConfig = () =>
  rows<BillingConfigRow>("freight_billing_config", (q) => q.order("category"), 100);

export async function chargeLineage(chargeId: string): Promise<ChargeLineage> {
  const { data, error } = await db.rpc("freight_charge_lineage", { _charge_id: chargeId });
  if (error) throw new Error(error.message);
  return data as unknown as ChargeLineage;
}

/* ---------------------------------------------------------------- mutations */

export interface CreateChargeInput {
  party: ChargeParty;
  basis: BillingBasis;
  chargeCode: string;
  quantity: number;
  unitRate?: number;
  taxAmount?: number;
  currency?: string;
  customerUserId?: string | null;
  corporateAccountId?: string | null;
  carrierId?: string | null;
  orderId?: string | null;
  packageId?: string | null;
  bookingId?: string | null;
  awardId?: string | null;
  manifestId?: string | null;
  quoteId?: string | null;
  rateCardId?: string | null;
  /** When supplied, the server-side rate line overrides any client rate. */
  rateLineId?: string | null;
  reasonCode?: string;
  operationalEvidence?: Record<string, unknown>;
  idempotencyKey: string;
}

export const createCharge = (input: CreateChargeInput) =>
  call("freight_charge_create", {
    p: {
      idempotency_key: input.idempotencyKey,
      party: input.party,
      basis: input.basis,
      charge_code: input.chargeCode,
      quantity: input.quantity,
      unit_rate: input.unitRate ?? 0,
      tax_amount: input.taxAmount ?? 0,
      currency: input.currency ?? "KES",
      customer_user_id: input.customerUserId ?? null,
      corporate_account_id: input.corporateAccountId ?? null,
      carrier_id: input.carrierId ?? null,
      order_id: input.orderId ?? null,
      package_id: input.packageId ?? null,
      booking_id: input.bookingId ?? null,
      award_id: input.awardId ?? null,
      manifest_id: input.manifestId ?? null,
      quote_id: input.quoteId ?? null,
      rate_card_id: input.rateCardId ?? null,
      rate_line_id: input.rateLineId ?? null,
      reason_code: input.reasonCode ?? null,
      operational_evidence: input.operationalEvidence ?? {},
    },
  });

export const transitionCharge = (
  chargeId: string, to: ChargeStatus, reasonCode?: string, note?: string,
) => call("freight_charge_transition", {
  _charge_id: chargeId, _to: to, _reason_code: reasonCode ?? null, _note: note ?? null,
});

export const requestAdjustment = (input: {
  chargeId: string; kind: "CREDIT" | "DEBIT" | "REVERSAL"; amount: number;
  reasonCode: string; reasonNote?: string; idempotencyKey?: string;
}) => call("freight_charge_adjust", {
  _charge_id: input.chargeId, _kind: input.kind, _amount: input.amount,
  _reason_code: input.reasonCode, _reason_note: input.reasonNote ?? null,
  _idempotency_key: input.idempotencyKey ?? null,
});

export const decideAdjustment = (adjustmentId: string, approve: boolean, note?: string) =>
  call("freight_adjustment_approve", {
    _adjustment_id: adjustmentId, _approve: approve, _note: note ?? null,
  });

export const buildInvoice = (input: {
  chargeIds: string[]; party?: ChargeParty; customerUserId?: string | null;
  corporateAccountId?: string | null; carrierId?: string | null; currency?: string;
  periodStart?: string; periodEnd?: string; dueAt?: string; idempotencyKey: string;
}) => call("freight_invoice_build", {
  p: {
    idempotency_key: input.idempotencyKey,
    charge_ids: input.chargeIds,
    party: input.party ?? "CUSTOMER",
    customer_user_id: input.customerUserId ?? null,
    corporate_account_id: input.corporateAccountId ?? null,
    carrier_id: input.carrierId ?? null,
    currency: input.currency ?? "KES",
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    due_at: input.dueAt ?? null,
  },
});

export const issueInvoice = (invoiceId: string, dueAt?: string) =>
  call("freight_invoice_issue", { _invoice_id: invoiceId, _due_at: dueAt ?? null });

export const voidInvoice = (invoiceId: string, reason: string) =>
  call("freight_invoice_void", { _invoice_id: invoiceId, _reason: reason });

/**
 * Records money the EXISTING payment authority already confirmed against a
 * freight invoice. Never initiates a payment and never mutates the M-Pesa
 * record. Omit `invoiceId` to register money that cannot yet be matched.
 */
export const allocatePayment = (input: {
  invoiceId?: string | null;
  invoiceLineId?: string | null;
  paymentAttemptId?: string | null;
  mpesaTransactionId?: string | null;
  provider?: string;
  providerReference?: string | null;
  amount: number;
  currency?: string;
  unmatchedReason?: string;
  correlationId?: string | null;
  requestId?: string | null;
  idempotencyKey: string;
}) => call("freight_payment_allocate", {
  p: {
    idempotency_key: input.idempotencyKey,
    invoice_id: input.invoiceId ?? null,
    invoice_line_id: input.invoiceLineId ?? null,
    payment_attempt_id: input.paymentAttemptId ?? null,
    mpesa_transaction_id: input.mpesaTransactionId ?? null,
    provider: input.provider ?? "mpesa",
    provider_reference: input.providerReference ?? null,
    amount: input.amount,
    currency: input.currency ?? "KES",
    unmatched_reason: input.unmatchedReason ?? null,
    correlation_id: input.correlationId ?? null,
    request_id: input.requestId ?? null,
  },
});

export const reverseAllocation = (allocationId: string, reason: string) =>
  call("freight_payment_allocation_reverse", { _allocation_id: allocationId, _reason: reason });

export const calculateSettlement = (input: {
  carrierId: string; periodStart: string; periodEnd: string;
  carrierClaimedAmount?: number | null; idempotencyKey?: string;
}) => call("freight_settlement_calculate", {
  _carrier_id: input.carrierId,
  _period_start: input.periodStart,
  _period_end: input.periodEnd,
  _carrier_claimed_amount: input.carrierClaimedAmount ?? null,
  _idempotency_key: input.idempotencyKey ?? null,
});

export const transitionSettlement = (
  settlementId: string, to: SettlementStatus, reason?: string, payoutReference?: string,
) => call("freight_settlement_transition", {
  _settlement_id: settlementId, _to: to,
  _reason: reason ?? null, _payout_reference: payoutReference ?? null,
});

export const runFreightAudit = (from: string, to: string) =>
  call("freight_audit_run", { _from: from, _to: to });

export const resolveFinding = (
  findingId: string, state: FindingState, notes: string, evidence: Record<string, unknown> = {},
) => call("freight_finding_resolve", {
  _finding_id: findingId, _state: state, _notes: notes, _evidence: evidence,
});

export const runThreeWayRecon = (from: string, to: string) =>
  call("freight_recon_run", { _from: from, _to: to });

export const resolveReconException = (exceptionId: string, state: FindingState, notes: string) =>
  call("freight_recon_exception_resolve", { _exception_id: exceptionId, _state: state, _notes: notes });

export const setBillingConfig = (key: string, value: Record<string, unknown>, state: ConfigState) =>
  call("freight_config_set", { _key: key, _value: value, _state: state });

/* ------------------------------------------------------------------ helpers */

export const money = (amount: number | null | undefined, currency = "KES") =>
  `${currency} ${Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Three-way position of one reconciliation exception, for display and export. */
export function threeWayPosition(e: ReconExceptionRow) {
  return [
    { label: "Expected", value: e.expected_amount },
    { label: "Charged", value: e.charged_amount },
    { label: "Invoiced", value: e.invoiced_amount },
    { label: "Paid", value: e.paid_amount },
    { label: "Settled", value: e.settled_amount },
    { label: "Paid to carrier", value: e.carrier_paid_amount },
  ];
}

/** CSV export of any row set, escaping quotes and separators. */
export function toCsv(columns: string[], data: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...data.map((r) => r.map(cell).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * TaxiD AUTHORITATIVE PAYMENT + CREDIT CLIENT.
 *
 * TaxiD rides are CASH-FIRST. Payment is made to TaxiD's designated M-Pesa
 * PayBill or approved bank account, and a ride is never "paid" until the
 * payment has been independently verified.
 *
 * Ride-on-credit is an exceptional facility. It exists only where a bank
 * guarantee has been uploaded, validated, verified, approved, activated and is
 * still within its validity and coverage, AND a separate credit facility has
 * been approved and activated, AND the company's own payment policy permits it.
 *
 * Nothing in this file decides anything. Every answer comes from the server
 * (corp_payment_decide / corp_credit_snapshot); the browser can only display
 * what the database returns. Credit reservation, release and utilisation are
 * deliberately NOT callable from the browser — they are server-role only.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { supabase } from "@/integrations/supabase/client";

export type PaymentMode = "CASH" | "CREDIT";

export type PaymentDecision =
  | "ALLOW_CASH_PAYMENT"
  | "ALLOW_GUARANTEED_CREDIT"
  | "PAYMENT_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "CREDIT_UNAVAILABLE"
  | "GUARANTEE_REQUIRED"
  | "GUARANTEE_NOT_VERIFIED"
  | "GUARANTEE_EXPIRED"
  | "GUARANTEE_REVOKED"
  | "CREDIT_LIMIT_EXCEEDED"
  | "POLICY_LIMIT_EXCEEDED"
  | "DENIED"
  | "SYSTEM_EXCEPTION";

export interface PaymentChannel {
  id: string;
  channel_type: "MPESA_PAYBILL" | "BANK_ACCOUNT";
  display_name: string;
  paybill_number: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  branch: string | null;
  reference_instructions: string;
  currency: string;
}

export interface CreditSnapshot {
  ok: boolean;
  credit_available: boolean;
  available_credit_cents: number;
  reserved_cents?: number;
  reason_codes: string[];
  guarantee: {
    id: string;
    state: string;
    expiry_date: string;
    amount_cents: number;
    currency: string;
    issuing_bank?: string;
  } | null;
  facility: {
    id: string;
    state: string;
    currency: string;
    approved_credit_limit_cents: number;
    utilized_credit_cents: number;
    expiry_date: string;
    max_transaction_cents: number | null;
  } | null;
}

export interface DecisionResult {
  ok: boolean;
  error?: string;
  decision?: PaymentDecision;
  requested_mode?: PaymentMode;
  requested_amount_cents?: number;
  available_credit_cents?: number | null;
  reason_codes?: string[];
  correlation_id?: string;
  policy_id?: string | null;
  policy_version?: number | null;
  cash_fallback?: string | null;
}

export interface BankGuaranteeRow {
  id: string;
  corporate_id: string;
  guarantee_number: string;
  issuing_bank: string;
  legal_entity_name: string;
  guaranteed_amount_cents: number;
  currency: string;
  issue_date: string;
  effective_date: string;
  expiry_date: string;
  state: string;
  external_verification_required: boolean;
  verification_note: string | null;
  rejection_reason: string | null;
  document_reference: string | null;
  created_at: string;
}

export const CREDIT_WARNING =
  "Ride-on-credit is available only against an active, verified and approved bank guarantee. " +
  "Without one, payment must be made through TaxiD's designated M-Pesa PayBill or bank account.";

export const CREDIT_UNAVAILABLE_MESSAGE =
  "Corporate credit is unavailable. Pay using TaxiD M-Pesa PayBill or bank transfer.";

export const DECISION_LABEL: Record<PaymentDecision, string> = {
  ALLOW_CASH_PAYMENT: "Pay now by M-Pesa PayBill or bank transfer",
  ALLOW_GUARANTEED_CREDIT: "Approved corporate credit may be used",
  PAYMENT_REQUIRED: "Payment required before the trip is confirmed",
  APPROVAL_REQUIRED: "An approval is required before credit can be used",
  CREDIT_UNAVAILABLE: "Corporate credit is not available",
  GUARANTEE_REQUIRED: "A verified bank guarantee is required for credit",
  GUARANTEE_NOT_VERIFIED: "The bank guarantee has not been verified",
  GUARANTEE_EXPIRED: "The bank guarantee has expired",
  GUARANTEE_REVOKED: "The bank guarantee has been revoked",
  CREDIT_LIMIT_EXCEEDED: "Not enough available credit for this amount",
  POLICY_LIMIT_EXCEEDED: "Above the amount this company's policy permits",
  DENIED: "Not permitted",
  SYSTEM_EXCEPTION: "The decision could not be completed",
};

export const REASON_LABEL: Record<string, string> = {
  CASH_IS_DEFAULT: "Cash is the default payment method",
  PAYMENT_VERIFICATION_REQUIRED: "Payment must be verified before the trip is confirmed",
  NO_ACTIVE_BANK_GUARANTEE: "No active bank guarantee",
  NO_ACTIVE_CREDIT_FACILITY: "No active credit facility",
  NO_ACTIVE_PAYMENT_POLICY: "No approved payment policy for this company",
  POLICY_FORBIDS_CREDIT: "This company's payment policy does not permit credit",
  DENY_CREDIT_INSUFFICIENT_COVERAGE: "Not enough guarantee-backed credit available",
  POLICY_MAX_TRANSACTION_EXCEEDED: "Above the largest amount the policy allows on credit",
  ABOVE_APPROVAL_THRESHOLD: "Above the amount that needs an approval",
  CORPORATE_ACCOUNT_NOT_ACTIVE: "The company account is not active",
  GUARANTEE_ACTIVE: "Bank guarantee active",
  FACILITY_ACTIVE: "Credit facility active",
  SUFFICIENT_AVAILABLE_CREDIT: "Enough available credit",
  POLICY_PERMITS_CREDIT: "Company policy permits credit",
};

export function reasonText(code: string): string {
  return REASON_LABEL[code] ?? code.split("_").join(" ").toLowerCase();
}

export function money(cents: number | null | undefined, currency = "KES"): string {
  const value = Math.round((cents ?? 0) / 100);
  return `${currency} ${value.toLocaleString("en-KE")}`;
}

/** TaxiD's designated cash-collection channels. */
export async function loadPaymentChannels(): Promise<PaymentChannel[]> {
  const { data, error } = await untypedDb
    .from("yalla_payment_channels")
    .select("*")
    .eq("is_active", true)
    .order("channel_type");
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentChannel[];
}

/** Authoritative credit position for a company. Never computed in the browser. */
export async function loadCreditSnapshot(corporateId: string): Promise<CreditSnapshot | null> {
  const { data, error } = await untypedDb.rpc("corp_credit_snapshot", { _corporate_id: corporateId });
  if (error) return null;
  const snap = data as CreditSnapshot | null;
  if (!snap || snap.ok === false) return null;
  return snap;
}

/**
 * The one authoritative payment decision. `mode` is only a request — the server
 * decides, logs the decision with its reasons, and the browser cannot override it.
 */
export async function decidePayment(
  corporateId: string,
  amountCents: number,
  mode: PaymentMode,
): Promise<DecisionResult> {
  const { data, error } = await untypedDb.rpc("corp_payment_decide", {
    _corporate_id: corporateId,
    _amount_cents: amountCents,
    _requested_mode: mode,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "no_decision" }) as DecisionResult;
}

/* ---------------- guarantee + facility administration ---------------- */

export async function loadGuarantees(corporateId?: string): Promise<BankGuaranteeRow[]> {
  let q = untypedDb.from("corporate_bank_guarantees").select("*").order("created_at", { ascending: false });
  if (corporateId) q = q.eq("corporate_id", corporateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as BankGuaranteeRow[];
}

export async function loadGuaranteeEvents(guaranteeId: string) {
  const { data, error } = await untypedDb
    .from("corporate_bank_guarantee_events")
    .select("*")
    .eq("guarantee_id", guaranteeId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type GuaranteeAction =
  | "SUBMIT_VERIFICATION"
  | "START_DOCUMENT_VERIFICATION"
  | "START_BANK_VERIFICATION"
  | "RECORD_EXTERNAL_VERIFICATION"
  | "VERIFY"
  | "APPROVE"
  | "ACTIVATE"
  | "SUSPEND"
  | "REINSTATE"
  | "REVOKE"
  | "REJECT";

export async function guaranteeTransition(guaranteeId: string, action: GuaranteeAction, reason?: string) {
  const { data, error } = await untypedDb.rpc("corp_guarantee_transition", {
    _guarantee_id: guaranteeId,
    _action: action,
    _reason: reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; state?: string; message?: string };
}

export async function facilityUpsert(input: {
  guaranteeId: string;
  approvedLimitCents: number;
  effectiveDate: string;
  expiryDate: string;
  riskMarginBps?: number;
  maxTransactionCents?: number | null;
  policyReference?: string | null;
}) {
  const { data, error } = await untypedDb.rpc("corp_credit_facility_upsert", {
    _guarantee_id: input.guaranteeId,
    _approved_limit_cents: input.approvedLimitCents,
    _effective_date: input.effectiveDate,
    _expiry_date: input.expiryDate,
    _risk_margin_bps: input.riskMarginBps ?? 3000,
    _max_transaction_cents: input.maxTransactionCents ?? null,
    _policy_reference: input.policyReference ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; facility_id?: string };
}

export async function facilityTransition(facilityId: string, action: "ACTIVATE" | "SUSPEND" | "CLOSE", reason?: string) {
  const { data, error } = await untypedDb.rpc("corp_credit_facility_transition", {
    _facility_id: facilityId,
    _action: action,
    _reason: reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; state?: string };
}

export async function proposePaymentPolicy(input: {
  corporateId: string;
  creditRule: "CASH_ONLY" | "CREDIT_NOT_ALLOWED" | "CREDIT_IF_GUARANTEED" | "CREDIT_ALLOWED_WITHIN_LIMIT";
  maxTransactionCents?: number | null;
  dailyCents?: number | null;
  monthlyCents?: number | null;
  approvalThresholdCents?: number | null;
}) {
  const { data, error } = await untypedDb.rpc("corp_payment_policy_propose", {
    _corporate_id: input.corporateId,
    _credit_rule: input.creditRule,
    _max_transaction_cents: input.maxTransactionCents ?? null,
    _daily_cents: input.dailyCents ?? null,
    _monthly_cents: input.monthlyCents ?? null,
    _approval_threshold_cents: input.approvalThresholdCents ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; policy_id?: string; version?: number };
}

export async function approvePaymentPolicy(policyId: string) {
  const { data, error } = await untypedDb.rpc("corp_payment_policy_approve", { _policy_id: policyId });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; status?: string };
}

export async function loadPaymentPolicies(corporateId?: string) {
  let q = untypedDb.from("corporate_payment_policies").select("*").order("version", { ascending: false });
  if (corporateId) q = q.eq("corporate_id", corporateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadPaymentDecisions(corporateId?: string, limit = 50) {
  let q = untypedDb
    .from("corporate_payment_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (corporateId) q = q.eq("corporate_id", corporateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface PaymentControlRow {
  code: string;
  control_group: string;
  title: string;
  expectation: string;
  verdict:
    | "IMPLEMENTED"
    | "PARTIALLY_IMPLEMENTED"
    | "BLOCKED"
    | "NOT_TESTED"
    | "EXTERNAL_EVIDENCE_REQUIRED"
    | "FAILED";
  observation: string | null;
  environment: string | null;
  last_run_at: string | null;
}

export async function loadPaymentControls(): Promise<PaymentControlRow[]> {
  const { data, error } = await untypedDb
    .from("payment_certification_controls")
    .select("code,control_group,title,expectation,verdict,observation,environment,last_run_at")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentControlRow[];
}

export const CONTROL_VERDICT_LABEL: Record<PaymentControlRow["verdict"], string> = {
  IMPLEMENTED: "Implemented",
  PARTIALLY_IMPLEMENTED: "Partly implemented",
  BLOCKED: "Blocked",
  NOT_TESTED: "Not tested",
  EXTERNAL_EVIDENCE_REQUIRED: "Awaiting external evidence",
  FAILED: "Failed",
};

/* ---------------- trip payment intents, receivables, ledger ---------------- */

export type IntentState =
  | "AWAITING_PAYMENT"
  | "PAYMENT_VERIFIED"
  | "CREDIT_AUTHORIZED"
  | "CREDIT_SETTLED"
  | "CANCELLED"
  | "FAILED";

export interface PaymentIntentRow {
  id: string;
  reference: string;
  corporate_id: string | null;
  booking_id: string | null;
  amount_cents: number;
  currency: string;
  mode: PaymentMode;
  state: IntentState;
  decision: string | null;
  decision_reasons: string[] | null;
  channel_id: string | null;
  invoice_id: string | null;
  receivable_id: string | null;
  mpesa_receipt: string | null;
  paid_amount_cents: number;
  verified_at: string | null;
  created_at: string;
}

export interface OpenIntentResult {
  ok: boolean;
  error?: string;
  detail?: unknown;
  idempotent?: boolean;
  intent_id?: string;
  reference?: string;
  mode?: PaymentMode;
  state?: IntentState;
  decision?: PaymentDecision;
  reason_codes?: string[];
  invoice_id?: string;
  receivable_id?: string;
  credit_refused?: boolean;
}

export const INTENT_STATE_LABEL: Record<IntentState, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PAYMENT_VERIFIED: "Paid and verified",
  CREDIT_AUTHORIZED: "Authorised on credit",
  CREDIT_SETTLED: "Credit settled",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

/** Opens the authoritative payment step for a trip. The server chooses cash or credit. */
export async function openPaymentIntent(input: {
  corporateId: string;
  amountCents: number;
  mode: PaymentMode;
  bookingId?: string | null;
  tripRequestId?: string | null;
  approvalId?: string | null;
  idempotencyKey?: string | null;
}): Promise<OpenIntentResult> {
  const { data, error } = await untypedDb.rpc("corp_payment_intent_open", {
    _corporate_id: input.corporateId,
    _amount_cents: input.amountCents,
    _requested_mode: input.mode,
    _booking_id: input.bookingId ?? null,
    _trip_request_id: input.tripRequestId ?? null,
    _approval_id: input.approvalId ?? null,
    _idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "no_result" }) as OpenIntentResult;
}

export async function loadPaymentIntents(corporateId?: string, limit = 50): Promise<PaymentIntentRow[]> {
  let q = untypedDb
    .from("ride_payment_intents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (corporateId) q = q.eq("corporate_id", corporateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentIntentRow[];
}

export interface ReceivableRow {
  id: string;
  corporate_id: string;
  intent_id: string;
  amount_cents: number;
  settled_cents: number;
  currency: string;
  state: string;
  due_date: string;
  invoice_id: string | null;
}

export async function loadReceivables(corporateId?: string): Promise<ReceivableRow[]> {
  let q = untypedDb.from("ride_receivables").select("*").order("due_date");
  if (corporateId) q = q.eq("corporate_id", corporateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ReceivableRow[];
}

export interface LedgerEntryRow {
  id: string;
  entry_group: string;
  kind: string;
  account_code: string;
  account_name: string;
  debit_cents: number;
  credit_cents: number;
  currency: string;
  reference: string | null;
  memo: string | null;
  created_at: string;
}

export async function loadLedger(limit = 120): Promise<LedgerEntryRow[]> {
  const { data, error } = await untypedDb
    .from("fin_ledger_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerEntryRow[];
}

export interface BankReceiptRow {
  id: string;
  channel_id: string;
  external_reference: string;
  payer_reference: string | null;
  amount_cents: number;
  currency: string;
  paid_at: string;
  statement_reference: string | null;
  evidence_note: string | null;
  created_at: string;
}

export async function loadBankReceipts(limit = 50): Promise<BankReceiptRow[]> {
  const { data, error } = await untypedDb
    .from("fin_bank_receipts")
    .select("*")
    .order("paid_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BankReceiptRow[];
}

export async function recordBankReceipt(input: {
  channelId: string;
  externalReference: string;
  amountCents: number;
  paidAt: string;
  payerReference?: string | null;
  statementReference?: string | null;
  evidenceNote?: string | null;
}) {
  const { data, error } = await untypedDb.rpc("fin_record_bank_receipt", {
    _channel_id: input.channelId,
    _external_reference: input.externalReference,
    _amount_cents: input.amountCents,
    _paid_at: input.paidAt,
    _payer_reference: input.payerReference ?? null,
    _statement_reference: input.statementReference ?? null,
    _evidence_note: input.evidenceNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; receipt_id?: string };
}

export async function reconcileIntent(intentId: string, receiptId: string, note?: string) {
  const { data, error } = await untypedDb.rpc("fin_reconcile_intent", {
    _intent_id: intentId,
    _receipt_id: receiptId,
    _note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as {
    ok: boolean;
    error?: string;
    state?: "MATCHED" | "VARIANCE";
    variance_cents?: number;
    intent_state?: IntentState;
  };
}

export async function loadReconciliationMatches(limit = 50) {
  const { data, error } = await untypedDb
    .from("fin_reconciliation_matches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ---------------- guarantee upload ---------------- */

export const GUARANTEE_BUCKET = "corporate-documents";

export async function uploadGuaranteeDocument(corporateId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${corporateId}/guarantees/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(GUARANTEE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function lodgeGuarantee(input: {
  corporateId: string;
  guaranteeNumber: string;
  issuingBank: string;
  legalEntityName: string;
  amountCents: number;
  issueDate: string;
  effectiveDate: string;
  expiryDate: string;
  documentStoragePath: string;
  documentSha256?: string | null;
  documentReference?: string | null;
}) {
  const { data, error } = await untypedDb.rpc("corp_guarantee_upload", {
    _corporate_id: input.corporateId,
    _guarantee_number: input.guaranteeNumber,
    _issuing_bank: input.issuingBank,
    _legal_entity_name: input.legalEntityName,
    _guaranteed_amount_cents: input.amountCents,
    _issue_date: input.issueDate,
    _effective_date: input.effectiveDate,
    _expiry_date: input.expiryDate,
    _document_storage_path: input.documentStoragePath,
    _document_sha256: input.documentSha256 ?? null,
    _document_reference: input.documentReference ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; error?: string; guarantee_id?: string; state?: string };
}

export async function sha256Hex(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

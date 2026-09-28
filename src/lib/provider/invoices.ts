/**
 * OPERATOR INVOICES (SELF-BILLING STATEMENTS).
 *
 * An operator opens a statement of the trips the platform recorded for a
 * period. Every figure — trip value, TaxiD's 15%, the operator's 85%, and the
 * 5% fee that applies when money is withdrawn — is recomputed in the database
 * from those trip records; nothing the browser sends can change an amount.
 *
 * Submitting numbers and freezes the statement. Finance then approves or
 * queries it, and only approved statements make money withdrawable, so an
 * operator can never pay themselves.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type InvoiceState = "DRAFT" | "SUBMITTED" | "APPROVED" | "QUERIED";

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  DRAFT: "Draft — not submitted",
  SUBMITTED: "Submitted — with finance",
  APPROVED: "Approved for payment",
  QUERIED: "Queried by finance",
};

export interface InvoiceLine {
  id: string;
  booking_reference: string;
  service_date: string | null;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
}

export interface OperatorInvoice {
  id: string;
  invoice_number: string | null;
  provider_user_id?: string;
  period_start: string;
  period_end: string;
  currency: string;
  lines_count: number;
  gross_cents: number;
  commission_bps: number;
  commission_cents: number;
  net_cents: number;
  withdrawal_fee_bps: number;
  estimated_fee_cents: number;
  state: InvoiceState;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  /** Finance view only: the total the platform's own trip records give. */
  recomputed_net_cents?: number;
  lines: InvoiceLine[];
}

export interface OperatorInvoicesSelf {
  commission_bps: number;
  withdrawal_fee_bps: number;
  require_invoice_approval: boolean;
  uninvoiced: { trips: number; gross_cents: number; net_cents: number };
  invoices: OperatorInvoice[];
}

export interface InvoiceQueue {
  can_decide: boolean;
  summary: {
    submitted: number;
    submitted_net_cents: number;
    approved: number;
    approved_net_cents: number;
    queried: number;
  };
  invoices: OperatorInvoice[];
}

const REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Sign in to open your statements.",
  NOT_AUTHORISED: "Only our finance settlement team can decide on a statement.",
  INVALID_PERIOD: "Choose a period that starts before it ends.",
  INVOICE_EMPTY: "There are no completed trips in this period to invoice.",
  INVOICE_NOT_EDITABLE: "This statement has already been submitted.",
  INVOICE_NOT_PENDING: "This statement is not waiting for a decision.",
  INVOICE_LINES_FROZEN: "A submitted statement cannot be changed.",
  INVOICE_AMOUNT_MISMATCH:
    "The statement total no longer matches the recorded trips — rebuild it before approving.",
  QUERY_REASON_REQUIRED: "Give a reason when querying a statement.",
  UNKNOWN_INVOICE: "That statement no longer exists.",
  INVOICE_APPROVAL_REQUIRED:
    "Finance has to approve an invoice covering this amount before it can be withdrawn.",
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const key = Object.keys(REFUSAL).find((k) => (error.message ?? "").includes(k));
    throw new Error(key ? REFUSAL[key] : (error.message ?? "That could not be completed."));
  }
  return data as T;
}

export const loadMyInvoices = () => rpc<OperatorInvoicesSelf>("provider_invoices_self");

/** Build (or rebuild) the draft statement for a period from recorded trips. */
export const prepareInvoice = (periodStart: string, periodEnd: string) =>
  rpc<{ ok: boolean; invoice_id: string; lines: number }>("provider_invoice_prepare", {
    _period_start: periodStart,
    _period_end: periodEnd,
  });

export const submitInvoice = (id: string) =>
  rpc<{ ok: boolean; invoice_number: string }>("provider_invoice_submit", { _invoice_id: id });

export const loadInvoiceQueue = () => rpc<InvoiceQueue>("provider_invoice_queue");

export const decideInvoice = (id: string, approve: boolean, note?: string) =>
  rpc<{ ok: boolean; state: InvoiceState }>("provider_invoice_decide", {
    _invoice_id: id,
    _approve: approve,
    _note: note?.trim() || null,
  });

/* ------------------------------ payout numbers ----------------------------- */

export interface PayoutNumber {
  id: string;
  msisdn: string;
  account_name: string;
  is_default: boolean;
  verification_state: "IN_REVIEW" | "VERIFIED" | "REJECTED";
  verification_note: string | null;
  verified_at: string | null;
  created_at: string;
}

export const loadMyPayoutNumbers = () => rpc<PayoutNumber[]>("provider_payout_accounts_self");

export const savePayoutNumber = (msisdn: string, accountName: string, makeDefault: boolean) =>
  rpc<{ ok: boolean; id: string; msisdn: string }>("provider_payout_account_save", {
    p: { msisdn, account_name: accountName, make_default: makeDefault },
  });

export const setDefaultPayoutNumber = (id: string) =>
  rpc<{ ok: boolean }>("provider_payout_account_set_default", { _account_id: id });

/* --------------------------------- reading -------------------------------- */

export const money = (cents: number, currency = "KES") =>
  `${currency} ${(Math.round(cents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const periodLabel = (i: OperatorInvoice) =>
  `${new Date(i.period_start).toLocaleDateString()} – ${new Date(i.period_end).toLocaleDateString()}`;

/** True when finance's own recomputation disagrees with the submitted total. */
export const invoiceDisputed = (i: OperatorInvoice) =>
  typeof i.recomputed_net_cents === "number" && i.recomputed_net_cents !== i.net_cents;

/** Default period: the calendar month that has just been trading. */
export function defaultPeriod(now: Date = new Date()): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

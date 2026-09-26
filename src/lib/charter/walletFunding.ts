/**
 * Corporate wallet funding state machine (client mirror of the database).
 *
 * The authoritative rules live in Postgres:
 *   - `charter_wallet_funding_requests` holds the lifecycle,
 *   - `charter_wallet_apply_funding_callback` is the ONLY path that may
 *     increase `charter_corporate_wallets.balance_kes`, and it runs solely
 *     from a verified M-Pesa STK callback,
 *   - `charter_wallet_ledger` is append-only (UPDATE/DELETE blocked by trigger).
 *
 * This module exists so the UI can reason about the same states without ever
 * inferring that a balance changed. Nothing here mutates money.
 */
import { isValidKenyanMsisdn, normalizeKenyanMsisdn } from "@/lib/kenyaPhone";

export const FUNDING_STATUSES = [
  "draft",
  "stk_requested",
  "awaiting_callback",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "reversed",
  "refunded",
] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const TERMINAL_STATUSES: FundingStatus[] = [
  "paid", "failed", "cancelled", "expired", "reversed", "refunded",
];

export const FUNDING_STATUS_LABEL: Record<FundingStatus, string> = {
  draft: "Pending funding",
  stk_requested: "STK sent",
  awaiting_callback: "Awaiting M-Pesa confirmation",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  reversed: "Reversed",
  refunded: "Refunded",
};

/** Only `paid` reflects cleared funds — everything else is KSh 0 spendable. */
export function isCleared(status: FundingStatus): boolean {
  return status === "paid";
}

export function isPending(status: FundingStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

const ALLOWED: Record<FundingStatus, FundingStatus[]> = {
  draft: ["stk_requested", "awaiting_callback", "cancelled", "expired", "failed"],
  stk_requested: ["awaiting_callback", "paid", "failed", "cancelled", "expired"],
  awaiting_callback: ["paid", "failed", "cancelled", "expired"],
  paid: ["reversed", "refunded"],
  failed: [],
  cancelled: [],
  expired: [],
  reversed: [],
  refunded: [],
};

export function canTransition(from: FundingStatus, to: FundingStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export interface FundingRequestRow {
  id: string;
  wallet_id: string;
  amount_kes: number;
  cost_center: string;
  purpose: string | null;
  approver_name: string | null;
  approver_title: string | null;
  reference: string;
  idempotency_key: string | null;
  phone: string | null;
  status: FundingStatus;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  mpesa_receipt: string | null;
  result_code: number | null;
  result_desc: string | null;
  ledger_entry_id: string | null;
  requires_approval: boolean;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
}

export interface FundingDraft {
  amountKes: number;
  costCenter: string;
  purpose: string;
  approverName: string;
  approverTitle: string;
  phone: string;
}

/** Regulatory M-Pesa ceiling for a single STK transaction (not a price). */
export const MPESA_SINGLE_TXN_CAP_KES = 250_000;

/** Blockers for step 1 (Fund Wallet) — nothing is sent while any exist. */
export function fundingBlockers(d: Pick<FundingDraft, "amountKes" | "costCenter" | "approverName">): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isFinite(d.amountKes) || Math.round(d.amountKes) <= 0) {
    e.amountKes = "Enter a funding amount greater than zero.";
  } else if (Math.round(d.amountKes) > MPESA_SINGLE_TXN_CAP_KES) {
    e.amountKes = `M-Pesa caps a single transaction at ${new Intl.NumberFormat("en-KE", {
      style: "currency", currency: "KES", maximumFractionDigits: 0,
    }).format(MPESA_SINGLE_TXN_CAP_KES)}. Split the funding.`;
  }
  if (!d.costCenter.trim()) e.costCenter = "Select the cost centre carrying this funding.";
  if (!d.approverName.trim()) e.approverName = "Name the approving authority.";
  return e;
}

/** Blockers for step 2 (Payment) — validated before any STK push. */
export function paymentBlockers(phone: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!isValidKenyanMsisdn(phone)) e.phone = "Enter a valid Kenyan M-Pesa number, e.g. 0712 345 678.";
  return e;
}

export function msisdn(phone: string): string {
  return normalizeKenyanMsisdn(phone) ?? phone;
}

/**
 * Deterministic idempotency key. Repeat clicks, refreshes and retries within
 * the same minute collapse onto one funding request instead of creating a
 * second one.
 */
export function fundingIdempotencyKey(walletId: string, amountKes: number, minuteEpoch = Math.floor(Date.now() / 60_000)): string {
  return `cwf:${walletId}:${Math.round(amountKes)}:${minuteEpoch}`;
}

/**
 * Wallet types the M-Pesa STK function accepts (`wallets.wallet_type` enum).
 * Validated client-side so an unsupported domain label never reaches Daraja.
 */
export const STK_WALLET_TYPES = ["personal", "driver", "corporate"] as const;
export type StkWalletType = (typeof STK_WALLET_TYPES)[number];

const STK_WALLET_ALIASES: Record<string, StkWalletType> = {
  corporate_charter: "corporate", charter: "corporate", corporate_wallet: "corporate",
  business: "corporate", company: "corporate", rider: "personal", user: "personal",
};

export function normalizeStkWalletType(value: string): StkWalletType | null {
  const v = (value ?? "").trim().toLowerCase();
  if ((STK_WALLET_TYPES as readonly string[]).includes(v)) return v as StkWalletType;
  return STK_WALLET_ALIASES[v] ?? null;
}

export function isValidStkWalletType(value: string): boolean {
  return normalizeStkWalletType(value) !== null;
}

/**
 * STK-attempt idempotency key.
 *
 * The server hashes { user, phone, amount, wallet_type, reference } against the
 * stored key. Reusing the funding-request key after the customer edits the
 * M-Pesa number therefore returns HTTP 409 IDEMPOTENCY_CONFLICT. Binding the
 * key to the *payload* (phone + amount) and an attempt counter keeps duplicate
 * clicks collapsed while making a legitimate retry a genuinely new request.
 */
export function stkIdempotencyKey(
  reference: string,
  phoneMsisdn: string,
  amountKes: number,
  attempt = 0,
): string {
  return `stk:${reference}:${phoneMsisdn}:${Math.round(amountKes)}:${attempt}`;
}

/** True when an edge-function error is the idempotency-conflict signal. */
export function isIdempotencyConflict(message: string): boolean {
  return /idempotency[_ -]?conflict|409/i.test(message ?? "");
}


/**
 * Reference model of the server-side callback verification, used by the
 * reconciliation and fraud-simulation tests. Returns whether the callback may
 * credit the wallet and, if not, why.
 */
export interface CallbackInput {
  checkoutRequestId: string;
  merchantRequestId?: string | null;
  amountKes: number;
  receipt?: string | null;
  resultCode: number;
}

export type CallbackVerdict =
  | { credit: true; amountKes: number }
  | { credit: false; reason:
      | "no_funding_request" | "duplicate_ignored" | "already_terminal" | "non_success"
      | "merchant_request_id_mismatch" | "amount_mismatch" | "missing_receipt" | "receipt_replay" };

export function verifyFundingCallback(
  request: Pick<FundingRequestRow, "status" | "amount_kes" | "merchant_request_id" | "checkout_request_id"> | null,
  cb: CallbackInput,
  seenReceipts: ReadonlySet<string> = new Set(),
): CallbackVerdict {
  if (!request || request.checkout_request_id !== cb.checkoutRequestId) {
    return { credit: false, reason: "no_funding_request" };
  }
  if (["paid", "reversed", "refunded"].includes(request.status)) {
    return { credit: false, reason: "duplicate_ignored" };
  }
  if (cb.resultCode !== 0) return { credit: false, reason: "non_success" };
  if (["failed", "cancelled", "expired"].includes(request.status)) {
    return { credit: false, reason: "already_terminal" };
  }
  if (cb.merchantRequestId && request.merchant_request_id && cb.merchantRequestId !== request.merchant_request_id) {
    return { credit: false, reason: "merchant_request_id_mismatch" };
  }
  if (Math.round(cb.amountKes) !== Math.round(request.amount_kes)) {
    return { credit: false, reason: "amount_mismatch" };
  }
  if (!cb.receipt) return { credit: false, reason: "missing_receipt" };
  if (seenReceipts.has(cb.receipt)) return { credit: false, reason: "receipt_replay" };
  return { credit: true, amountKes: Math.round(request.amount_kes) };
}

/** Ledger sum must equal the wallet balance at all times. */
export function ledgerBalance(entries: ReadonlyArray<{ direction: string; amount_kes: number }>): number {
  return entries.reduce((s, e) => s + (e.direction === "credit" ? Number(e.amount_kes) : -Number(e.amount_kes)), 0);
}

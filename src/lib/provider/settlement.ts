/**
 * PROVIDER SETTLEMENT — the 15% / 85% split, and how the 85% leaves the app.
 *
 * SAFARID collects the customer's money into its M-Pesa paybill and
 * retains a 15% platform commission there. The remaining 85% is disbursed to
 * the mobility service provider's own M-Pesa number (their "M-Pesa account")
 * over the same Daraja rail used for collections.
 *
 * Nothing here moves money by itself: the database owns the split, finance
 * approves each payout, and only Safaricom's result callback can mark a payout
 * paid. Every figure below is read from the earnings ledger.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type EarningState =
  | "ACCRUED"
  | "HELD"
  | "CREDITED"
  | "PAYABLE"
  | "RESERVED"
  | "PAID"
  | "CANCELLED";
export type PayoutState =
  | "PENDING_SCREENING"
  | "ON_HOLD"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "CANCELLED";
export type AccountState = "IN_REVIEW" | "VERIFIED" | "REJECTED";

export const EARNING_STATE_LABEL: Record<EarningState, string> = {
  ACCRUED: "Awaiting customer payment",
  HELD: "Held — awaiting trip fulfilment",
  CREDITED: "In your wallet balance",
  PAYABLE: "In your wallet balance",
  RESERVED: "In a withdrawal",
  PAID: "Withdrawn to M-Pesa",
  CANCELLED: "Cancelled",
};

export type WalletEntryType =
  | "HOLD"
  | "RELEASE"
  | "WITHDRAWAL_RESERVED"
  | "WITHDRAWAL_FEE"
  | "WITHDRAWAL_PAID"
  | "WITHDRAWAL_RETURNED";

export const WALLET_ENTRY_LABEL: Record<WalletEntryType, string> = {
  HOLD: "Client paid — held until fulfilment",
  RELEASE: "Trip fulfilled — released to your balance",
  WITHDRAWAL_RESERVED: "Withdrawal requested",
  WITHDRAWAL_FEE: "Withdrawal fee",
  WITHDRAWAL_PAID: "Sent to your M-Pesa",
  WITHDRAWAL_RETURNED: "Withdrawal returned to your balance",
};

export const PAYOUT_STATE_LABEL: Record<PayoutState, string> = {
  PENDING_SCREENING: "Being checked",
  ON_HOLD: "On hold — checks failed",
  PENDING_APPROVAL: "Awaiting finance approval",
  APPROVED: "Approved — awaiting release",
  PROCESSING: "Sent to M-Pesa",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Rejected / cancelled",
};

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  IN_REVIEW: "Awaiting verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export interface EarningRow {
  id: string;
  provider_user_id?: string;
  booking_reference: string;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  currency: string;
  state: EarningState;
  customer_paid_at: string | null;
  paid_at?: string | null;
  created_at: string;
}

export interface PayoutRow {
  id: string;
  reference: string;
  provider_user_id?: string;
  msisdn: string;
  /** Net amount actually sent to M-Pesa, after the withdrawal fee. */
  amount_cents: number;
  /** Amount taken out of the wallet balance. */
  gross_cents: number | null;
  fee_cents: number | null;
  fee_bps: number | null;
  currency: string;
  state: PayoutState;
  earnings_count: number;
  provider_transaction_id: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  approved_at?: string | null;
  created_at: string;
}

export interface PayoutAccount {
  id: string;
  provider_user_id?: string;
  msisdn: string;
  account_name: string;
  verification_state: AccountState;
  verification_note: string | null;
  verified_at: string | null;
  created_at?: string;
}

export interface ProviderWallet {
  currency: string;
  available_cents: number;
  held_cents: number;
  reserved_cents: number;
  lifetime_earned_cents: number;
  lifetime_withdrawn_cents: number;
  lifetime_fees_cents: number;
}

export interface WalletLedgerRow {
  id: string;
  entry_type: WalletEntryType;
  amount_cents: number;
  available_after: number;
  held_after: number;
  currency: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ProviderSettlementSelf {
  commission_bps: number;
  withdrawal_fee_bps: number;
  platform_paybill: string;
  min_payout_cents: number;
  requires_finance_approval: boolean;
  account: PayoutAccount | null;
  wallet: ProviderWallet;
  totals: {
    accrued_cents: number;
    held_cents: number;
    payable_cents: number;
    reserved_cents: number;
    paid_cents: number;
    commission_cents: number;
  };
  earnings: EarningRow[];
  wallet_ledger: WalletLedgerRow[];
  payouts: PayoutRow[];
}

export interface ProviderSettlementConsole {
  settings: {
    commission_bps: number;
    withdrawal_fee_bps: number;
    platform_paybill: string;
    min_payout_cents: number;
    requires_finance_approval: boolean;
    auto_prepare: boolean;
  };
  summary: {
    commission_cents: number;
    withdrawal_fee_cents: number;
    accrued_cents: number;
    held_cents: number;
    payable_cents: number;
    reserved_cents: number;
    paid_cents: number;
    awaiting_approval: number;
    accounts_in_review: number;
  };
  accounts: PayoutAccount[];
  wallets: (ProviderWallet & { provider_user_id: string })[];
  payouts: PayoutRow[];
  postings: {
    id: string;
    posting_type: "COMMISSION" | "WITHDRAWAL_FEE";
    provider_user_id: string;
    amount_cents: number;
    currency: string;
    paybill: string;
    rate_bps: number;
    reference: string;
    created_at: string;
  }[];
  earnings: EarningRow[];
}

const SETTLEMENT_REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in first.",
  NOT_AUTHORISED: "You cannot manage payouts.",
  ACCOUNT_NAME_REQUIRED: "Give the name registered on the M-Pesa number.",
  INVALID_MPESA_NUMBER: "Enter a valid Kenyan M-Pesa number, e.g. 0712 345 678.",
  UNKNOWN_ACCOUNT: "That M-Pesa account no longer exists.",
  UNKNOWN_REQUEST: "That payout no longer exists.",
  UNKNOWN_STATE: "That is not a status we recognise.",
  PAYOUT_NOT_APPROVED: "The payout must be approved before it can be sent.",
  DESTINATION_NOT_VERIFIED: "Verify the operator's M-Pesa number before sending money.",
  DESTINATION_NOT_FOUND: "No M-Pesa number is saved for this operator.",
  NO_RESERVED_EARNINGS: "There are no earnings held against this payout.",
  VERIFIED_MPESA_ACCOUNT_REQUIRED:
    "Save your M-Pesa number and wait for our team to verify it before withdrawing.",
  NO_WITHDRAWABLE_BALANCE:
    "Your wallet has nothing available yet. Funds are released once the trip is fulfilled.",
  AMOUNT_REQUIRED: "Enter the amount you want to withdraw.",
  AMOUNT_EXCEEDS_AVAILABLE_BALANCE: "That is more than your available balance.",
  BELOW_MINIMUM_PAYOUT: "After the withdrawal fee this is below the smallest amount M-Pesa accepts.",
  WITHDRAWAL_ALREADY_IN_PROGRESS: "You already have a withdrawal in progress.",
  FINANCE_CLEARANCE_REQUIRED:
    "Our finance team still has to approve your new driver account before your first withdrawal.",
  PROVIDER_CONFIGURATION_REQUIRED:
    "M-Pesa payout credentials are not set up yet, so no money was sent.",
};

export const explainSettlementRefusal = (m: string) =>
  SETTLEMENT_REFUSAL[m] ?? SETTLEMENT_REFUSAL[m?.replace(/^.*?:\s*/, "")] ?? m;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(explainSettlementRefusal(error.message));
  return data as T;
}

export const loadProviderSettlementSelf = () =>
  rpc<ProviderSettlementSelf>("provider_settlement_self");

export const loadProviderSettlementConsole = () =>
  rpc<ProviderSettlementConsole>("provider_settlement_console");

export const savePayoutAccount = (msisdn: string, accountName: string) =>
  rpc<{ ok: boolean; msisdn: string }>("provider_payout_account_save", {
    p: { msisdn, account_name: accountName },
  });

export const decidePayoutAccount = (accountId: string, state: AccountState, note?: string) =>
  rpc<{ ok: boolean }>("provider_payout_account_decide", {
    _account_id: accountId,
    _state: state,
    _note: note ?? null,
  });

export const decidePayout = (requestId: string, approve: boolean, note?: string) =>
  rpc<{ ok: boolean; state: PayoutState }>("provider_payout_decide", {
    _request_id: requestId,
    _approve: approve,
    _note: note ?? null,
  });

/** Accrue the split and release earnings whose customer invoice is now paid. */
export const syncEarnings = () =>
  rpc<{ ok: boolean; accrued: number; held: number; credited: number; made_payable: number }>(
    "provider_earnings_sync",
  );

/** Re-run the wallet policy: hold on payment, release on fulfilment. */
export const preparePayouts = () =>
  rpc<{ ok: boolean; created: number; held?: number; credited?: number; note?: string }>(
    "provider_payout_prepare",
  );

/**
 * Operator-initiated withdrawal from their own wallet balance. The 5%
 * withdrawal fee is deducted here and posted to the SAFARID paybill; the
 * remainder is what leaves for their M-Pesa number once finance approves.
 */
export const requestWithdrawal = (amountCents: number) =>
  rpc<{
    ok: boolean;
    id: string;
    reference: string;
    gross_cents: number;
    fee_cents: number;
    net_cents: number;
    fee_bps: number;
    msisdn: string;
  }>("provider_withdrawal_request", { p: { amount_cents: String(Math.round(amountCents)) } });

/** Send an approved payout to the operator's M-Pesa number (real B2C). */
export async function sendPayout(requestId: string) {
  const { data, error } = await db.functions.invoke("provider-payout-disburse", {
    body: { request_id: requestId },
  });
  if (error) {
    const message =
      error?.context?.error?.message ?? error?.message ?? "Unable to send the payout";
    throw new Error(explainSettlementRefusal(message));
  }
  return data as { state: string; reference?: string; message?: string };
}

export const settlementMoney = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

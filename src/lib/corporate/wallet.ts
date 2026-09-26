/**
 * ENTERPRISE ACCOUNT BALANCE — real money, not a recorded figure.
 *
 * Two authoritative moves, both server-side:
 *   1. Top up  — an M-Pesa prompt to the payer's own phone via the same
 *      `mpesa-stkpush` rails every other collection uses. The balance is only
 *      credited by `corporate_wallet_apply_mpesa`, which reads the CONFIRMED
 *      provider record (result code 0) and refuses to credit twice.
 *   2. Settle  — `corporate_invoice_pay_from_balance` applies the funded
 *      balance to an issued invoice and updates paid / outstanding / status.
 *
 * Completed rides are already debited to the append-only cash ledger by the
 * trip settlement trigger, so settling an invoice never double-charges.
 */
import { supabase } from "@/integrations/supabase/client";
import { runMpesaCheckout, type CheckoutProgress } from "@/lib/payments/checkout";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface WalletLedgerRow {
  id: string;
  entry_type: string;
  amount_cents: number;
  balance_after_cents: number;
  currency: string;
  reference: string | null;
  description: string | null;
  source_kind: string | null;
  occurred_at: string;
}

export const ENTRY_LABEL: Record<string, string> = {
  top_up: "Top-up",
  ride_charge: "Ride charge",
  refund: "Refund",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

export const money = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Available funded balance for the organisation, from the cash ledger. */
export async function loadWalletBalanceCents(corporateId: string): Promise<number> {
  const { data, error } = await db.rpc("corporate_wallet_balance_cents", {
    _corporate_id: corporateId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Recent movements on the account, newest first. */
export async function loadWalletLedger(corporateId: string, limit = 20): Promise<WalletLedgerRow[]> {
  const { data, error } = await db
    .from("corporate_cash_ledger")
    .select("id,entry_type,amount_cents,balance_after_cents,currency,reference,description,source_kind,occurred_at")
    .eq("corporate_id", corporateId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WalletLedgerRow[];
}

export type TopUpResult =
  | { state: "credited"; amountCents: number; receipt: string | null; balanceCents: number }
  | { state: "already_credited"; balanceCents: number }
  | { state: "failed"; message: string }
  | { state: "pending"; message: string };

/**
 * Charges the payer's phone by M-Pesa and credits the organisation balance from
 * the confirmed payment. The payer number is always supplied at run time.
 */
export async function topUpByMpesa(
  input: { amountKes: number; phone: string; reference: string },
  onProgress?: (p: CheckoutProgress) => void,
): Promise<TopUpResult> {
  const outcome = await runMpesaCheckout(
    {
      amountKes: input.amountKes,
      phone: input.phone,
      reference: input.reference,
      method: "mpesa",
      walletType: "corporate",
    },
    onProgress,
  );

  if (outcome.state === "failed") return { state: "failed", message: outcome.message };
  if (outcome.state === "duplicate") return { state: "pending", message: outcome.message };
  if (outcome.state === "timeout") return { state: "pending", message: outcome.message };

  const { data, error } = await db.rpc("corporate_wallet_apply_mpesa", {
    _checkout_request_id: outcome.checkoutRequestId,
  });
  if (error) {
    return {
      state: "pending",
      message:
        "M-Pesa confirmed the payment but the balance has not been credited yet: " +
        (error.message ?? "please refresh in a moment."),
    };
  }

  const applied = Boolean(data?.applied);
  const balanceCents = Number(data?.balance_cents ?? 0);
  return applied
    ? {
        state: "credited",
        amountCents: Number(data?.amount_cents ?? 0),
        receipt: (data?.receipt as string | null) ?? outcome.receipt,
        balanceCents,
      }
    : { state: "already_credited", balanceCents };
}

export interface SettlementResult {
  appliedCents: number;
  paidCents: number;
  outstandingCents: number;
  status: string;
  balanceCents: number;
}

/**
 * Charges an invoice end to end: it settles what the funded balance covers and,
 * when the balance is short, collects the shortfall with a live M-Pesa prompt to
 * the payer's own phone before applying it. Nothing is applied until M-Pesa has
 * confirmed the collection.
 */
export type ChargeInvoiceResult =
  | { state: "settled"; settlement: SettlementResult; collectedCents: number; receipt: string | null }
  | { state: "part_settled"; settlement: SettlementResult; collectedCents: number }
  | { state: "needs_phone"; shortfallCents: number }
  | { state: "collection_pending"; message: string }
  | { state: "failed"; message: string };

export async function chargeInvoice(
  input: { invoiceId: string; phone?: string },
  onProgress?: (message: string) => void,
): Promise<ChargeInvoiceResult> {
  onProgress?.("Checking the invoice and the account balance…");

  const { data: invoice, error: invErr } = await db
    .from("corporate_invoices")
    .select("id,invoice_number,corporate_id,balance_cents,currency,status")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (invErr) return { state: "failed", message: invErr.message };
  if (!invoice) return { state: "failed", message: "That invoice is no longer available." };
  if (invoice.status === "PAID") return { state: "failed", message: "This invoice is already paid in full." };
  if (invoice.status === "VOIDED") return { state: "failed", message: "This invoice has been cancelled." };

  const outstanding = Number(invoice.balance_cents ?? 0);
  if (outstanding <= 0) return { state: "failed", message: "There is nothing outstanding on this invoice." };

  let balance = 0;
  try {
    balance = await loadWalletBalanceCents(invoice.corporate_id as string);
  } catch (e) {
    return { state: "failed", message: (e as Error).message };
  }

  const shortfall = outstanding - Math.max(balance, 0);
  let collectedCents = 0;
  let receipt: string | null = null;

  if (shortfall > 0) {
    if (!input.phone) return { state: "needs_phone", shortfallCents: shortfall };

    const topUp = await topUpByMpesa(
      {
        amountKes: Math.ceil(shortfall / 100),
        phone: input.phone,
        reference: `INV-${String(invoice.invoice_number ?? "").slice(-12) || invoice.id.slice(0, 8).toUpperCase()}`,
      },
      (p) => onProgress?.(p.message),
    );

    if (topUp.state === "failed") return { state: "failed", message: topUp.message };
    if (topUp.state === "pending") return { state: "collection_pending", message: topUp.message };
    if (topUp.state === "credited") {
      collectedCents = topUp.amountCents;
      receipt = topUp.receipt;
    }
  }

  onProgress?.("Applying the payment to the invoice…");
  let settlement: SettlementResult;
  try {
    settlement = await settleInvoiceFromBalance(input.invoiceId);
  } catch (e) {
    return {
      state: "collection_pending",
      message:
        "The payment is on the account but the invoice was not updated: " +
        ((e as Error).message ?? "please try again in a moment."),
    };
  }

  return settlement.status === "PAID"
    ? { state: "settled", settlement, collectedCents, receipt }
    : { state: "part_settled", settlement, collectedCents };
}

/** Applies the funded balance to an invoice. Throws with a readable reason. */
export async function settleInvoiceFromBalance(invoiceId: string): Promise<SettlementResult> {
  const { data, error } = await db.rpc("corporate_invoice_pay_from_balance", {
    _invoice_id: invoiceId,
  });
  if (error) throw new Error(error.message ?? "The invoice could not be settled.");
  return {
    appliedCents: Number(data?.applied_cents ?? 0),
    paidCents: Number(data?.paid_cents ?? 0),
    outstandingCents: Number(data?.outstanding_cents ?? 0),
    status: String(data?.status ?? ""),
    balanceCents: Number(data?.balance_cents ?? 0),
  };
}

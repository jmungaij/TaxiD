/**
 * YALLA MOBILITY WALLET — the platform's own custody account.
 *
 * Every shilling a client pays lands here first and is locked (custody) until the
 * job is fulfilled. Only fulfilment releases the operator's 85% into their own
 * wallet and recognises Yalla's 15% as income. The 5% withdrawal fee is earned
 * only when an operator withdrawal actually succeeds; a failed or cancelled
 * withdrawal returns the full amount to the operator with no fee.
 *
 * Funding uses the same M-Pesa rails as every other collection and is credited
 * only from a CONFIRMED payment record, never from client-side input.
 */
import { supabase } from "@/integrations/supabase/client";
import { runMpesaCheckout, type CheckoutProgress } from "@/lib/payments/checkout";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Default funding phone for the Yalla Mobility wallet. */
export const YALLA_WALLET_FUNDING_MSISDN = "254710100090";

export interface PlatformWallet {
  currency: string;
  float_cents: number;
  custody_cents: number;
  liability_cents: number;
  income_cents: number;
  lifetime_funded_cents: number;
  lifetime_client_cents: number;
  lifetime_released_cents: number;
  lifetime_paid_out_cents: number;
  funding_msisdn: string;
  paybill: string;
  updated_at: string;
}

export interface PlatformWalletEntry {
  id: string;
  entry_type:
    | "FUNDING"
    | "CLIENT_PAYMENT"
    | "FULFILMENT_RELEASE"
    | "WITHDRAWAL_PAID"
    | "WITHDRAWAL_FEE_INCOME";
  amount_cents: number;
  float_after: number;
  custody_after: number;
  liability_after: number;
  income_after: number;
  currency: string;
  reference: string;
  source_kind: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface PendingCustodyRow {
  earning_id: string;
  booking_reference: string | null;
  provider_user_id: string;
  gross_cents: number;
  net_cents: number;
  commission_cents: number;
  held_at: string | null;
}

export interface PlatformWalletConsole {
  wallet: PlatformWallet;
  ledger: PlatformWalletEntry[];
  pending_custody: PendingCustodyRow[];
}

export const WALLET_ENTRY_LABEL: Record<PlatformWalletEntry["entry_type"], string> = {
  FUNDING: "Wallet funded",
  CLIENT_PAYMENT: "Client payment held",
  FULFILMENT_RELEASE: "Released on fulfilment",
  WITHDRAWAL_PAID: "Operator withdrawal paid",
  WITHDRAWAL_FEE_INCOME: "Withdrawal fee earned",
};

export const walletMoney = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export async function loadPlatformWallet(): Promise<PlatformWalletConsole> {
  const { data, error } = await db.rpc("platform_wallet_console", {});
  if (error) throw new Error(error.message);
  return data as PlatformWalletConsole;
}

export type FundWalletResult =
  | { state: "funded"; amountCents: number; receipt: string | null; wallet: Partial<PlatformWallet> }
  | { state: "already_funded" }
  | { state: "pending"; message: string }
  | { state: "failed"; message: string };

/**
 * Funds the Yalla Mobility wallet by charging the funding phone through M-Pesa
 * and crediting the wallet from the confirmed collection.
 */
export async function fundPlatformWallet(
  input: { amountKes: number; phone: string; reference?: string },
  onProgress?: (p: CheckoutProgress) => void,
): Promise<FundWalletResult> {
  const reference = input.reference?.trim() || `YALLA-WALLET-${Date.now().toString(36).toUpperCase()}`;
  const outcome = await runMpesaCheckout(
    { amountKes: input.amountKes, phone: input.phone, reference, method: "mpesa", walletType: "platform" },
    onProgress,
  );

  if (outcome.state === "failed") return { state: "failed", message: outcome.message };
  if (outcome.state === "duplicate" || outcome.state === "timeout") {
    return { state: "pending", message: outcome.message };
  }

  const { data, error } = await db.rpc("platform_wallet_fund_apply_mpesa", {
    _checkout_request_id: outcome.checkoutRequestId,
  });
  if (error) {
    return {
      state: "pending",
      message: `M-Pesa confirmed the payment but the wallet has not been credited yet: ${error.message}`,
    };
  }

  if (!data?.applied) return { state: "already_funded" };
  return {
    state: "funded",
    amountCents: Number(data.amount_cents ?? 0),
    receipt: (data.receipt as string | null) ?? outcome.receipt,
    wallet: {
      float_cents: Number(data.float_cents ?? 0),
      custody_cents: Number(data.custody_cents ?? 0),
      liability_cents: Number(data.liability_cents ?? 0),
      income_cents: Number(data.income_cents ?? 0),
    },
  };
}

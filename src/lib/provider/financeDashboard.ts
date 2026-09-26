/**
 * FINANCE FIGURES FOR OPERATOR SETTLEMENT.
 *
 * One authoritative read: withdrawals by stage, Yalla's 15% commission income
 * and 5% withdrawal-fee income, wallet position, statements awaiting a
 * decision, a six-month trend and an operator-by-operator breakdown. Every
 * figure is summed in the database from posted records — nothing is estimated
 * in the browser, and a period with no activity is reported as such rather than
 * shown as a zero that looks like a result.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface FinanceDashboard {
  generated_at: string;
  withdrawals: {
    pending_count: number;
    pending_cents: number;
    approved_count: number;
    approved_cents: number;
    in_flight_count: number;
    in_flight_cents: number;
    paid_count: number;
    paid_cents: number;
    failed_count: number;
    rejected_count: number;
  };
  income: {
    commission_cents: number;
    commission_month_cents: number;
    fee_cents: number;
    fee_month_cents: number;
  };
  wallets: {
    operators: number;
    held_cents: number;
    available_cents: number;
    reserved_cents: number;
    lifetime_earned_cents: number;
    lifetime_withdrawn_cents: number;
  };
  invoices: {
    submitted: number;
    submitted_net_cents: number;
    approved: number;
    queried: number;
  };
  trend: {
    month: string;
    commission_cents: number;
    fee_cents: number;
    paid_out_cents: number;
    earned_cents: number;
  }[];
  operators: {
    provider_user_id: string;
    currency: string;
    earned_cents: number;
    withdrawn_cents: number;
    fees_cents: number;
    held_cents: number;
    available_cents: number;
    reserved_cents: number;
    invoice_cover_cents: number;
  }[];
}

export async function loadFinanceDashboard(): Promise<FinanceDashboard> {
  const { data, error } = await db.rpc("provider_finance_dashboard");
  if (error) {
    throw new Error(
      (error.message ?? "").includes("NOT_AUTHORISED")
        ? "Only our finance settlement team can read these figures."
        : (error.message ?? "The figures could not be loaded."),
    );
  }
  return data as FinanceDashboard;
}

/** Whether any money has moved at all — used to say "nothing yet" honestly. */
export const hasActivity = (d: FinanceDashboard) =>
  d.wallets.lifetime_earned_cents > 0 ||
  d.income.commission_cents > 0 ||
  d.withdrawals.paid_count > 0 ||
  d.withdrawals.pending_count > 0;

export const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

/**
 * BILLING INSIDE THE COMMERCIAL BOOK.
 *
 * This is a projection of the existing invoice register — it creates no second
 * set of invoices. `sales_billing_board` reads the same `tax_invoices` and
 * `payment_receipts` the finance surfaces read, scoped to one person, and adds
 * the signed contracts that have never been billed. Money collected is what
 * counts towards the monthly target; invoiced-but-unpaid is stated separately so
 * the two are never confused.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import type { InvoiceStatus } from "@/lib/commercial/invoice";

export interface BillingInvoice {
  invoice_id: string;
  invoice_no: string | null;
  status: InvoiceStatus;
  customer: string;
  account_id: string | null;
  contract_id: string | null;
  contract_reference: string | null;
  currency: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  issue_date: string | null;
  due_date: string | null;
  overdue: boolean;
}

export interface BillableContract {
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
  account_id: string | null;
  value_amount: number | null;
  currency: string | null;
  signed_on: string | null;
}

export interface BillingBoard {
  staff_id: string;
  generated_at: string;
  month_start: string;
  invoiced_month_cents: number;
  collected_month_cents: number;
  collected_today_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  invoices: BillingInvoice[];
  contracts_awaiting_invoice: BillableContract[];
}

export const BILLING_REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to read your invoices.",
  NO_STAFF_IDENTITY: "Your staff record is not linked yet, so there is no billing to show.",
  NOT_AUTHORISED: "You can only read your own invoices unless you manage the customer records.",
  CONTRACT_NOT_FOUND: "That contract no longer exists.",
  CONTRACT_NOT_SIGNED: "The signed copy is not recorded yet, so this contract cannot be invoiced.",
  CONTRACT_VALUE_REQUIRED: "Record the contract value first — an invoice cannot be raised without it.",
};

export function billingRefusal(message: string): string {
  const hit = Object.keys(BILLING_REFUSALS).find((k) => message.includes(k));
  return hit ? BILLING_REFUSALS[hit] : message;
}

export async function loadBillingBoard(staffId?: string | null): Promise<BillingBoard> {
  const { data, error } = await untypedDb.rpc("sales_billing_board", {
    p: { staff: staffId ?? null },
  });
  if (error) throw new Error(billingRefusal(error.message));
  return data as unknown as BillingBoard;
}

/** Raises one draft invoice from a signed contract. Calling twice returns the same invoice. */
export async function invoiceFromContract(
  contractId: string,
): Promise<{ invoice_id: string; already_existed: boolean; total_cents?: number }> {
  const { data, error } = await untypedDb.rpc("sales_invoice_from_contract", {
    p: { contract_id: contractId },
  });
  if (error) throw new Error(billingRefusal(error.message));
  return data as unknown as { invoice_id: string; already_existed: boolean; total_cents?: number };
}

export interface AwaitingSignatureContract {
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
  account_id: string | null;
  status: string;
  value_amount: number | null;
  currency: string | null;
  shared_on: string | null;
  awaiting: string;
  awaiting_since: string | null;
  signature_recorded: boolean;
}

/**
 * Contracts the customer has been sent but has not signed and returned. These
 * are pending, never revenue: no invoice can be raised and nothing is counted
 * towards the target until the signed copy is on file.
 */
export async function loadContractsAwaitingSignature(
  staffId?: string | null,
): Promise<AwaitingSignatureContract[]> {
  const { data, error } = await untypedDb.rpc("sales_contracts_awaiting_signature", {
    p: { staff: staffId ?? null },
  });
  if (error) throw new Error(billingRefusal(error.message));
  return ((data as { contracts?: AwaitingSignatureContract[] })?.contracts ?? []) as AwaitingSignatureContract[];
}

export const KESc = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(
        cents / 100,
      );

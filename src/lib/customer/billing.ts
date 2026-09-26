/**
 * CUSTOMER BILLING — the documents a signed-in company contact may see about
 * their own money: issued proforma invoices, issued tax invoices and the
 * payments recorded against them.
 *
 * The database assembles everything under the caller's own identity. Drafts,
 * cancelled documents, internal notes and ownership never reach here. A
 * customer may confirm receipt of a document once; the confirmation is
 * permanent.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface BillingLine {
  description: string | null;
  qty: number | null;
  unit_rate_cents: number | null;
  amount_cents: number | null;
}

/** The next collections step SAFARID has planned on an unpaid invoice. */
export interface CustomerNextStep {
  action_type: string | null;
  due_on: string | null;
  promised_on: string | null;
  promised_amount_cents: number | null;
}

/** Live account totals — the same figures the internal team sees. */
export interface CustomerBillingSummary {
  invoice_count: number;
  invoiced_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  overdue_count: number;
  overdue_cents: number;
  due_soon_cents: number;
  next_due_date: string | null;
  receipts_count: number;
  last_payment_on: string | null;
}

export interface CustomerInvoice {
  id: string;
  document_no: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  service_from: string | null;
  service_to: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  payment_terms: string | null;
  lpo_reference: string | null;
  status: string;
  overdue?: boolean;
  next_step?: CustomerNextStep | null;
  lines: BillingLine[];
  confirmed_at: string | null;
}

export interface CustomerProforma {
  id: string;
  document_no: string;
  currency: string;
  issue_date: string | null;
  valid_until: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  status: string;
  lines: BillingLine[];
  confirmed_at: string | null;
}

export interface CustomerReceipt {
  id: string;
  document_no: string;
  amount_cents: number;
  currency: string;
  received_on: string | null;
  method: string | null;
  invoice_no: string | null;
}

/** The agreement record behind the billing: contract, service order, delivery. */
export interface CustomerAgreement {
  id: string;
  kind: string;
  reference: string | null;
  note: string | null;
  recorded_at: string | null;
}

export interface CustomerBilling {
  generated_at: string;
  email: string | null;
  summary: CustomerBillingSummary;
  invoices: CustomerInvoice[];
  proformas: CustomerProforma[];
  receipts: CustomerReceipt[];
  agreements: CustomerAgreement[];
}

export type ConfirmableKind = "invoice" | "proforma" | "receipt";

const REFUSALS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in again to see your documents.",
  DOCUMENT_NOT_AVAILABLE: "That document is not available on your account.",
  UNKNOWN_DOCUMENT_KIND: "That document type is not recognised.",
  CONFIRMATION_IS_PERMANENT: "A confirmation cannot be changed once it is recorded.",
};

export function billingRefusal(message: string): string {
  const hit = Object.keys(REFUSALS).find((k) => message.includes(k));
  return hit ? REFUSALS[hit] : message;
}

export async function fetchCustomerBilling(): Promise<CustomerBilling> {
  const { data, error } = await db.rpc("customer_billing_overview");
  if (error) throw new Error(billingRefusal(error.message));
  const d = (data ?? {}) as Partial<CustomerBilling>;
  return {
    generated_at: d.generated_at ?? new Date().toISOString(),
    email: d.email ?? null,
    summary: {
      invoice_count: 0,
      invoiced_cents: 0,
      paid_cents: 0,
      outstanding_cents: 0,
      overdue_count: 0,
      overdue_cents: 0,
      due_soon_cents: 0,
      next_due_date: null,
      receipts_count: 0,
      last_payment_on: null,
      ...(d.summary ?? {}),
    },
    invoices: d.invoices ?? [],
    proformas: d.proformas ?? [],
    receipts: d.receipts ?? [],
    agreements: d.agreements ?? [],
  };
}

export async function confirmDocumentReceipt(
  kind: ConfirmableKind,
  id: string,
  note?: string,
): Promise<{ ok: boolean; document_no: string; already_confirmed: boolean }> {
  const { data, error } = await db.rpc("customer_document_confirm", {
    _kind: kind,
    _id: id,
    _note: note?.trim() || null,
  });
  if (error) throw new Error(billingRefusal(error.message));
  return data as { ok: boolean; document_no: string; already_confirmed: boolean };
}

/** Money held in cents, shown the way a Kenyan invoice reads. */
export const cents = (v: number | null | undefined, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    (v ?? 0) / 100,
  );

export const totalOutstanding = (invoices: CustomerInvoice[]) =>
  invoices.reduce((s, i) => s + Math.max(0, i.balance_cents), 0);

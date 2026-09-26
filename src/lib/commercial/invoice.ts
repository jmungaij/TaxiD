/**
 * Tax invoices and payment receipts — client contract for the register.
 *
 * The same laws as the proforma register apply: staff key the customer and the
 * priced items, the database recomputes every figure, an approver signs the
 * document off before it can be issued, and the official number is assigned by
 * the database. Money received is recorded as a receipt against the invoice,
 * never by editing the invoice, and a receipt can never exceed the balance.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { Json } from "@/integrations/supabase/types";

export const INVOICE_STATUSES = [
  "draft", "pending_approval", "approved", "issued", "sent", "part_paid", "paid", "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  issued: "Issued",
  sent: "Sent to customer",
  part_paid: "Part paid",
  paid: "Paid in full",
  cancelled: "Cancelled",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  issued: "info",
  sent: "info",
  part_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

export const PAYMENT_METHODS = ["MPESA", "BANK_TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

export interface InvoiceLine {
  id?: string;
  line_no?: number;
  description: string;
  service_date?: string | null;
  vehicle_category?: string | null;
  qty: number;
  unit_rate_cents: number;
  amount_cents?: number;
}

export interface InvoiceEvent {
  id: string;
  event: string;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface PaymentReceipt {
  id: string;
  receipt_no: string | null;
  status: "issued" | "sent" | "void";
  invoice_id: string;
  amount_cents: number;
  currency: string;
  method: PaymentMethod;
  payment_reference: string | null;
  received_on: string;
  received_from: string | null;
  notes: string | null;
  authorised_name: string | null;
  authorised_title: string | null;
  sent_to: string | null;
  sent_at: string | null;
  pdf_sha256: string | null;
  created_at: string;
  invoice_no?: string | null;
  customer_company?: string | null;
  invoice?: {
    id: string;
    invoice_no: string | null;
    status: InvoiceStatus;
    total_cents: number;
    paid_cents: number;
    customer_company: string;
    customer_email: string | null;
    customer_address: string | null;
    customer_pin: string | null;
  };
  events?: InvoiceEvent[];
}

export interface Invoice {
  id: string;
  invoice_no: string | null;
  status: InvoiceStatus;
  lead_id: string | null;
  proforma_id: string | null;
  customer_company: string;
  customer_address: string | null;
  customer_pin: string | null;
  customer_contact_person: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_ref: string | null;
  quote_reference: string | null;
  contract_reference: string | null;
  lpo_reference: string | null;
  service_from: string | null;
  service_to: string | null;
  payment_terms: string;
  currency: string;
  vat_rate: number;
  vat_inclusive: boolean;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  authorised_name: string | null;
  authorised_title: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents?: number;
  submitted_at: string | null;
  approved_at: string | null;
  approval_note: string | null;
  sole_approver: boolean;
  issued_at: string | null;
  sent_to: string | null;
  sent_at: string | null;
  pdf_sha256: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  can_write?: boolean;
  line_count?: number;
  lines: InvoiceLine[];
  receipts?: PaymentReceipt[];
  events: InvoiceEvent[];
}

export interface InvoiceList {
  generated_at: string;
  scope: "all" | "mine";
  can_create: boolean;
  can_approve: boolean;
  outstanding_cents: number;
  invoices: Invoice[];
}

export interface ReceiptList {
  generated_at: string;
  scope: "all" | "mine";
  collected_cents: number;
  receipts: PaymentReceipt[];
}

/** Plain-language versions of every refusal the database can raise. */
export const INVOICE_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "You do not have permission to work on invoices.",
  INVOICE_NOT_FOUND: "That invoice no longer exists.",
  RECEIPT_NOT_FOUND: "That receipt no longer exists.",
  ONLY_A_DRAFT_CAN_BE_EDITED: "This invoice has been issued, so its figures are locked.",
  ONLY_A_DRAFT_CAN_BE_SENT_FOR_REVIEW: "Only a draft can be sent for approval.",
  NOT_AUTHORISED_TO_APPROVE: "You are not permitted to approve invoices.",
  ONLY_AN_INVOICE_IN_REVIEW_CAN_BE_DECIDED: "This invoice is not waiting for a decision.",
  FOUR_EYES_REQUIRED: "You prepared this invoice, so someone else must approve it.",
  MUST_BE_SENT_FOR_APPROVAL_FIRST: "Send this invoice for approval before issuing it.",
  APPROVAL_REQUIRED_BEFORE_ISSUE: "This invoice is still awaiting approval.",
  ALREADY_ISSUED: "This invoice has already been issued.",
  ALREADY_CANCELLED: "This invoice is already cancelled.",
  CANNOT_CANCEL_A_PAID_INVOICE: "Money has been received against this invoice, so it cannot be cancelled.",
  CUSTOMER_NAME_REQUIRED: "Enter the customer's name first.",
  CUSTOMER_EMAIL_REQUIRED: "Enter a valid customer email address first.",
  AT_LEAST_ONE_LINE_REQUIRED: "Add at least one priced item first.",
  TOTAL_MUST_BE_GREATER_THAN_ZERO: "The total must be greater than zero.",
  ISSUE_THE_INVOICE_FIRST: "Issue the invoice before sending it or recording money against it.",
  AMOUNT_MUST_BE_GREATER_THAN_ZERO: "Enter the amount received.",
  AMOUNT_EXCEEDS_THE_BALANCE: "That is more than the outstanding balance on this invoice.",
  REASON_REQUIRED: "Give a reason first.",
  RECEIPT_IS_VOID: "This receipt has been voided.",
  FILE_TOO_LARGE: "The generated file is too large to email.",
  SEND_FAILED: "The email could not be sent. Please try again.",
};

export function invoiceRefusal(message: string): string {
  const hit = Object.keys(INVOICE_REFUSALS).find((k) => message.includes(k));
  return hit ? INVOICE_REFUSALS[hit] : message;
}

export const money = (cents: number, currency = "KES") =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

 
const rpc = (name: string, args?: Record<string, unknown>) => untypedDb.rpc(name, args);

export async function listInvoices(): Promise<InvoiceList> {
  const { data, error } = await rpc("invoice_list");
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as InvoiceList;
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data, error } = await rpc("invoice_get", { _id: id });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export interface InvoiceDraftInput {
  id?: string | null;
  lead_id?: string | null;
  proforma_id?: string | null;
  customer_company?: string;
  customer_address?: string;
  customer_pin?: string;
  customer_contact_person?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_ref?: string;
  quote_reference?: string;
  contract_reference?: string;
  lpo_reference?: string;
  service_from?: string | null;
  service_to?: string | null;
  payment_terms?: string;
  currency?: string;
  vat_rate?: number;
  vat_inclusive?: boolean;
  due_date?: string | null;
  notes?: string;
  authorised_name?: string;
  authorised_title?: string;
  lines?: InvoiceLine[];
}

export async function saveInvoice(input: InvoiceDraftInput): Promise<Invoice> {
  const { data, error } = await rpc("invoice_save", { p: input as unknown as Json });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export async function submitInvoice(id: string, note?: string): Promise<Invoice> {
  const { data, error } = await rpc("invoice_submit", { _id: id, _note: note?.trim() || null });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export async function decideInvoice(id: string, approve: boolean, note?: string): Promise<Invoice> {
  const { data, error } = await rpc("invoice_decide", { _id: id, _approve: approve, _note: note?.trim() || null });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export async function issueInvoice(id: string, dueDays = 14): Promise<Invoice> {
  const { data, error } = await rpc("invoice_issue", { _id: id, _due_days: dueDays });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export async function cancelInvoice(id: string, reason: string): Promise<Invoice> {
  const { data, error } = await rpc("invoice_cancel", { _id: id, _reason: reason });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as Invoice;
}

export async function recordReceipt(input: {
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  payment_reference?: string;
  received_on?: string;
  received_from?: string;
  notes?: string;
  authorised_name?: string;
  authorised_title?: string;
}): Promise<PaymentReceipt> {
  const { data, error } = await rpc("receipt_record", { p: input as unknown as Json });
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as PaymentReceipt;
}

export async function listReceipts(): Promise<ReceiptList> {
  const { data, error } = await rpc("receipt_list");
  if (error) throw new Error(invoiceRefusal(error.message));
  return data as ReceiptList;
}

const base64 = (bytes: Uint8Array): string => {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
};

/** Emails the exact rendered bytes and records the dispatch fingerprint. */
export async function sendDocument(args: {
  kind: "invoice" | "receipt";
  id: string;
  pdf: Uint8Array;
  sha256: string;
  filename: string;
  to: string;
  cc?: string[];
  subject?: string;
  message?: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("invoice-send", {
    body: {
      kind: args.kind,
      document_id: args.id,
      to: args.to,
      cc: args.cc ?? [],
      subject: args.subject,
      message: args.message,
      filename: args.filename,
      pdf_base64: base64(args.pdf),
      pdf_sha256: args.sha256,
    },
  });
  if (error) {
    const detail = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(invoiceRefusal(detail));
  }
  const body = data as { error?: string } | null;
  if (body?.error) throw new Error(invoiceRefusal(body.error));
}

/** Server-side arithmetic mirrored for live on-screen totals only. */
export function computeTotals(lines: InvoiceLine[], vatRate: number, inclusive: boolean) {
  const gross = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.qty) || 0) * (Number(l.unit_rate_cents) || 0)),
    0,
  );
  if (inclusive) {
    const subtotal = Math.round(gross / (1 + vatRate / 100));
    return { subtotal_cents: subtotal, vat_cents: gross - subtotal, total_cents: gross };
  }
  const vat = Math.round((gross * vatRate) / 100);
  return { subtotal_cents: gross, vat_cents: vat, total_cents: gross + vat };
}

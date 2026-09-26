/**
 * Proforma invoices — client contract for the keyed-and-sent proforma register.
 *
 * Staff key the customer details and the priced lines; the database recomputes
 * every figure, assigns the official number on issue, and refuses to let an
 * issued document be edited. Transmission goes through the `proforma-send`
 * function so the recorded fingerprint belongs to the file the customer
 * actually received.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export const PROFORMA_STATUSES = [
  "draft", "pending_approval", "approved", "issued", "sent", "accepted", "expired", "void",
] as const;
export type ProformaStatus = (typeof PROFORMA_STATUSES)[number];

export const PROFORMA_STATUS_LABEL: Record<ProformaStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  issued: "Issued",
  sent: "Sent to customer",
  accepted: "Accepted",
  expired: "Expired",
  void: "Voided",
};

export const PROFORMA_STATUS_TONE: Record<ProformaStatus, string> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  issued: "info",
  sent: "success",
  accepted: "success",
  expired: "warning",
  void: "danger",
};


export interface ProformaLine {
  id?: string;
  line_no?: number;
  description: string;
  service_date?: string | null;
  vehicle_category?: string | null;
  qty: number;
  unit_rate_cents: number;
  amount_cents?: number;
}

export interface ProformaEvent {
  id: string;
  event: string;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Proforma {
  id: string;
  proforma_no: string | null;
  status: ProformaStatus;
  customer_company: string;
  customer_address: string | null;
  customer_pin: string | null;
  customer_contact_person: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  booked_for: string | null;
  booked_by: string | null;
  customer_ref: string | null;
  quote_reference: string | null;
  contract_reference: string | null;
  service_from: string | null;
  service_to: string | null;
  payment_terms: string;
  currency: string;
  vat_rate: number;
  vat_inclusive: boolean;
  issue_date: string | null;
  valid_until: string | null;
  notes: string | null;
  authorised_name: string | null;
  authorised_title: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  sent_to: string | null;
  sent_at: string | null;
  recipient_flagged?: boolean;
  recipient_flag_reason?: string | null;
  issued_at: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  sole_approver?: boolean;
  pdf_sha256: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  can_write?: boolean;
  line_count?: number;
  lines: ProformaLine[];
  events: ProformaEvent[];
}

export interface ProformaList {
  generated_at: string;
  can_create: boolean;
  can_approve?: boolean;
  scope?: "all" | "mine";
  invoices: Proforma[];
}

/** Plain-language versions of every refusal the database can raise. */
export const PROFORMA_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "You do not have permission to work on proforma invoices.",
  PROFORMA_NOT_FOUND: "That proforma invoice no longer exists.",
  ONLY_A_DRAFT_CAN_BE_EDITED: "This proforma has already been issued, so its figures are locked. Void it and start a new one.",
  ALREADY_ISSUED: "This proforma has already been issued.",
  CUSTOMER_NAME_REQUIRED: "Enter the customer's name before issuing.",
  CUSTOMER_EMAIL_REQUIRED: "Enter a valid customer email address before issuing.",
  CUSTOMER_EMAIL_NOT_VERIFIED: "This email isn't verified. It must match the email on the customer's lead or a contact saved on their account.",
  RECIPIENT_MUST_BE_CUSTOMER_EMAIL: "Proforma invoices only go to the customer email on the record.",
  RECIPIENT_CHECK_FAILED: "Couldn't check the customer email. Try again shortly.",
  AT_LEAST_ONE_LINE_REQUIRED: "Add at least one priced item before issuing.",
  TOTAL_MUST_BE_GREATER_THAN_ZERO: "The total must be greater than zero.",
  ISSUE_THE_PROFORMA_FIRST: "Issue the proforma before sending it to the customer.",
  ALREADY_VOID: "This proforma is already voided.",
  REASON_REQUIRED: "Give a reason before sending this back or voiding it.",
  ONLY_A_DRAFT_CAN_BE_SENT_FOR_REVIEW: "Only a draft can be sent for approval.",
  NOT_AUTHORISED_TO_APPROVE: "You are not permitted to approve proforma invoices.",
  ONLY_A_PROFORMA_IN_REVIEW_CAN_BE_DECIDED: "This proforma is not waiting for a decision.",
  FOUR_EYES_REQUIRED: "You prepared this proforma, so someone else must approve it.",
  MUST_BE_SENT_FOR_APPROVAL_FIRST: "Send this proforma for approval before issuing it.",
  APPROVAL_REQUIRED_BEFORE_ISSUE: "This proforma is still awaiting approval.",
  FILE_TOO_LARGE: "The generated file is too large to email.",
  SEND_FAILED: "The email could not be sent. Please try again.",
};

export function proformaRefusal(message: string): string {
  const hit = Object.keys(PROFORMA_REFUSALS).find((k) => message.includes(k));
  return hit ? PROFORMA_REFUSALS[hit] : message;
}

export const money = (cents: number, currency = "KES") =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

export async function listProformas(): Promise<ProformaList> {
  const { data, error } = await supabase.rpc("proforma_list");
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as ProformaList;
}

export async function getProforma(id: string): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_get", { _id: id });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

export interface ProformaDraftInput {
  id?: string | null;
  customer_company?: string;
  customer_address?: string;
  customer_pin?: string;
  customer_contact_person?: string;
  customer_email?: string;
  customer_phone?: string;
  booked_for?: string;
  booked_by?: string;
  customer_ref?: string;
  quote_reference?: string;
  contract_reference?: string;
  service_from?: string | null;
  service_to?: string | null;
  payment_terms?: string;
  currency?: string;
  vat_rate?: number;
  vat_inclusive?: boolean;
  valid_until?: string | null;
  notes?: string;
  authorised_name?: string;
  authorised_title?: string;
  lines?: ProformaLine[];
}

export async function saveProforma(input: ProformaDraftInput): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_save", { p: input as unknown as Json });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

export async function issueProforma(id: string, validDays = 14): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_issue", { _id: id, _valid_days: validDays });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

/** Sends a completed draft for approval. Nothing may be issued before this. */
export async function submitProforma(id: string, note?: string): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_submit", { _id: id, _note: note?.trim() || null });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

/** Approves a proforma, or sends it back to the preparer with a reason. */
export async function decideProforma(id: string, approve: boolean, note?: string): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_decide", {
    _id: id, _approve: approve, _note: note?.trim() || null,
  });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

export async function voidProforma(id: string, reason: string): Promise<Proforma> {
  const { data, error } = await supabase.rpc("proforma_void", { _id: id, _reason: reason });
  if (error) throw new Error(proformaRefusal(error.message));
  return data as unknown as Proforma;
}

const base64 = (bytes: Uint8Array): string => {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
};

/** Emails the exact rendered bytes to the customer and records the dispatch. */
export async function sendProforma(args: {
  proforma: Proforma;
  pdf: Uint8Array;
  sha256: string;
  filename: string;
  to: string;
  cc?: string[];
  subject?: string;
  message?: string;
}): Promise<Proforma> {
  const { data, error } = await supabase.functions.invoke("proforma-send", {
    body: {
      proforma_id: args.proforma.id,
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
    // Surface the function's own refusal text where the platform gives it to us.
    const detail = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(proformaRefusal(detail));
  }
  const body = data as { sent?: boolean; recorded?: boolean; error?: string; proforma?: Proforma };
  if (body?.error) throw new Error(proformaRefusal(body.error));
  return body?.proforma ?? (await getProforma(args.proforma.id));
}

/** Server-side arithmetic mirrored for live on-screen totals only. */
export function computeTotals(lines: ProformaLine[], vatRate: number, inclusive: boolean) {
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

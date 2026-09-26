/**
 * Payment collections — client contract for the receivables register.
 *
 * The database owns every figure: the balance on an invoice is always the
 * issued total less the payments recorded against it, the ageing band is
 * computed from the due date, and revenue recognition follows the payment
 * rather than the other way round. This module only reads the register and
 * books or closes the agreed next step with the customer.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const COLLECTION_ACTIONS = [
  "call", "email", "visit", "reminder", "promise_to_pay", "escalation", "legal", "write_off_request",
] as const;
export type CollectionActionType = (typeof COLLECTION_ACTIONS)[number];

export const COLLECTION_ACTION_LABEL: Record<CollectionActionType, string> = {
  call: "Phone call",
  email: "Email reminder",
  visit: "Customer visit",
  reminder: "Statement reminder",
  promise_to_pay: "Promise to pay",
  escalation: "Escalate to manager",
  legal: "Refer for legal demand",
  write_off_request: "Request write-off",
};

export const AGEING_LABEL: Record<string, string> = {
  current: "Not yet due",
  "1_30": "1–30 days late",
  "31_60": "31–60 days late",
  "61_90": "61–90 days late",
  "90_plus": "Over 90 days late",
};

export const AGEING_TONE: Record<string, string> = {
  current: "info",
  "1_30": "warning",
  "31_60": "warning",
  "61_90": "danger",
  "90_plus": "danger",
};

export interface CollectionAction {
  id: string;
  invoice_id: string;
  action_type: CollectionActionType;
  status: "open" | "done" | "cancelled";
  due_on: string;
  note: string | null;
  outcome: string | null;
  promised_amount_cents: number | null;
  promised_on: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface CollectionsInvoice {
  id: string;
  invoice_no: string | null;
  status: string;
  customer_company: string;
  customer_email: string | null;
  currency: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  issue_date: string | null;
  due_date: string | null;
  days_overdue: number;
  ageing_band: keyof typeof AGEING_LABEL;
  owner_staff_id: string | null;
  owner_name: string | null;
  is_test: boolean;
  lead_id: string | null;
  lifecycle_state: string | null;
  next_action: Pick<CollectionAction, "id" | "action_type" | "due_on" | "note" | "promised_amount_cents" | "promised_on"> | null;
  last_action: { action_type: CollectionActionType; outcome: string | null; closed_at: string | null; note: string | null } | null;
  open_action_count: number;
  actions: CollectionAction[];
  receipts: { receipt_no: string | null; amount_cents: number; received_on: string; method: string; status: string }[];
}

export interface CollectionsTotals {
  outstanding_cents: number;
  overdue_cents: number;
  invoice_count: number;
  overdue_count: number;
  bucket_current_cents: number;
  bucket_1_30_cents: number;
  bucket_31_60_cents: number;
  bucket_61_90_cents: number;
  bucket_90_plus_cents: number;
}

export interface CollectionsRegister {
  generated_at: string;
  scope: "all" | "mine";
  can_act: boolean;
  totals: CollectionsTotals;
  invoices: CollectionsInvoice[];
}

const REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "You do not have access to the collections register.",
  INVOICE_NOT_FOUND: "That invoice no longer exists.",
  ACTION_NOT_FOUND: "That collection step no longer exists.",
  ACTION_ALREADY_CLOSED: "That step has already been closed.",
  ACTION_TYPE_REQUIRED: "Choose what the next step is.",
  OUTCOME_REQUIRED: "Record what happened before closing the step.",
};

export function refusal(message: string): string {
  const hit = Object.keys(REFUSALS).find((k) => message.includes(k));
  return hit ? REFUSALS[hit] : message;
}

export async function fetchCollections(): Promise<CollectionsRegister> {
  const { data, error } = await db.rpc("collections_register");
  if (error) throw new Error(refusal(error.message));
  return data as CollectionsRegister;
}

export async function bookCollectionAction(input: {
  invoice_id: string;
  action_type: CollectionActionType;
  due_on: string;
  note?: string | null;
  promised_amount_cents?: number | null;
  promised_on?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("collection_action_save", { p: input });
  if (error) throw new Error(refusal(error.message));
  return data as string;
}

export async function closeCollectionAction(
  id: string,
  outcome: string,
  note?: string | null,
  cancel = false,
): Promise<void> {
  const { error } = await db.rpc("collection_action_close", {
    _id: id,
    _outcome: outcome,
    _note: note ?? null,
    _cancel: cancel,
  });
  if (error) throw new Error(refusal(error.message));
}

export const money = (cents: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

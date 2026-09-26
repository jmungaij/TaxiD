/**
 * CUSTOMER SERVICE REQUESTS — the customer-facing side of the Commercial Book.
 *
 * A corporate contact submits a requirement and tracks it. The record created is
 * the same canonical commercial lead the sales desk works from; the customer is
 * only ever shown the customer-safe lifecycle translated by the database, never
 * internal stage names, values, notes or ownership intelligence.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CUSTOMER_STATES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFORMATION_REQUIRED",
  "QUALIFICATION",
  "COMMERCIAL_REVIEW",
  "CONTRACTING",
  "ACCOUNT_SETUP",
  "ACTIVE",
  "CLOSED",
] as const;
export type CustomerState = (typeof CUSTOMER_STATES)[number];

export const CUSTOMER_STATE_LABEL: Record<CustomerState, string> = {
  SUBMITTED: "Request submitted",
  UNDER_REVIEW: "Under review",
  INFORMATION_REQUIRED: "Information required",
  QUALIFICATION: "Qualification",
  COMMERCIAL_REVIEW: "Commercial review",
  CONTRACTING: "Contracting",
  ACCOUNT_SETUP: "Account setup",
  ACTIVE: "Active",
  CLOSED: "Closed",
};

/** What the customer is told happens next, in plain words. */
export const CUSTOMER_STATE_MEANING: Record<CustomerState, string> = {
  SUBMITTED: "We have your request and it is queued for review.",
  UNDER_REVIEW: "Your SAFARID contact is reviewing what you need.",
  INFORMATION_REQUIRED: "We need something from you before we can continue.",
  QUALIFICATION: "We are confirming the detail of your requirement.",
  COMMERCIAL_REVIEW: "Your pricing and terms are being prepared.",
  CONTRACTING: "Your agreement is being put in place.",
  ACCOUNT_SETUP: "Your account is being set up for service.",
  ACTIVE: "Your service is live.",
  CLOSED: "This request is closed.",
};

export interface CustomerRequestTimelineEntry {
  at: string;
  status: CustomerState;
  customer_note: string | null;
}

export interface CustomerRequest {
  id: string;
  reference: string;
  organisation_name: string;
  service_interest: string;
  origin_label: string | null;
  destination_label: string | null;
  service_date: string | null;
  status: CustomerState;
  information_request: string | null;
  relationship_contact: string | null;
  relationship_email: string | null;
  submitted_at: string;
  last_update: string;
  timeline: CustomerRequestTimelineEntry[];
}

export interface NewCustomerRequest {
  organisation_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  service_interest: string;
  origin_label?: string;
  destination_label?: string;
  service_date?: string;
  requirement?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export async function listMyRequests(): Promise<CustomerRequest[]> {
  const { data, error } = await db.rpc("customer_my_requests");
  if (error) fail(error.message);
  return (data ?? []) as CustomerRequest[];
}

export async function submitRequest(input: NewCustomerRequest) {
  const { data, error } = await db.rpc("customer_request_submit", {
    p: input as unknown as Json,
  });
  if (error) fail(error.message);
  return data as { lead_id: string; lead_ref: string; duplicate: boolean };
}

export async function respondToRequest(requestId: string, note: string) {
  const { data, error } = await db.rpc("customer_request_respond", {
    p: { request_id: requestId, note } as unknown as Json,
  });
  if (error) fail(error.message);
  return data as { request_id: string; recorded: boolean };
}

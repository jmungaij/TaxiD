/**
 * SALES PIPELINE — client contract for the Corporate Sales Specialist portal.
 *
 * Every mutation goes through a database RPC that owns the stage graph,
 * attribution and audit trail. The client never writes a stage directly, so a
 * lead cannot skip qualification and a booking cannot appear without the
 * specialist it belongs to.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export const LEAD_STAGES = [
  "NEW",
  "QUALIFIED",
  "OPPORTUNITY",
  "QUOTED",
  "ACCEPTED",
  "BOOKED",
  "FULFILLED",
  "CLOSED_WON",
  "CLOSED_LOST",
  "DISQUALIFIED",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  OPPORTUNITY: "Opportunity",
  QUOTED: "Quoted",
  ACCEPTED: "Accepted",
  BOOKED: "Booked",
  FULFILLED: "Fulfilled",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
  DISQUALIFIED: "Disqualified",
};

/** Onward stages the database will accept from a given stage. */
export const NEXT_STAGES: Record<LeadStage, LeadStage[]> = {
  NEW: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["OPPORTUNITY", "CLOSED_LOST"],
  OPPORTUNITY: ["QUOTED", "CLOSED_LOST"],
  QUOTED: ["ACCEPTED", "CLOSED_LOST"],
  ACCEPTED: ["BOOKED", "CLOSED_LOST"],
  BOOKED: ["FULFILLED", "CLOSED_LOST"],
  FULFILLED: ["CLOSED_WON"],
  CLOSED_WON: [],
  CLOSED_LOST: [],
  DISQUALIFIED: [],
};

export interface SalesLead {
  id: string;
  lead_ref: string;
  sales_staff_id: string;
  organisation_name: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  service_interest: string;
  origin_label: string | null;
  destination_label: string | null;
  service_date: string | null;
  estimated_value_kes: number | null;
  currency: string;
  stage: LeadStage;
  qualification_notes: string | null;
  lost_reason: string | null;
  opportunity_id: string | null;
  order_id: string | null;
  booking_ref: string | null;
  notes: string | null;
  /** Where the lead came from: captured by the desk, or submitted by the customer. */
  source: string | null;
  /** Set when the desk has asked the customer for something and is waiting. */
  information_request: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesLeadEvent {
  id: string;
  lead_id: string;
  action: string;
  stage_from: string | null;
  stage_to: string | null;
  note: string | null;
  created_at: string;
}

export interface NewLeadInput {
  organisation_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  service_interest: string;
  origin_label?: string;
  destination_label?: string;
  service_date?: string;
  estimated_value_kes?: number;
  notes?: string;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("NO_RESULT");
  return data;
}

export async function listMyLeads(): Promise<SalesLead[]> {
  const { data, error } = await supabase
    .from("sales_leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SalesLead[];
}

export async function listLeadEvents(leadId: string): Promise<SalesLeadEvent[]> {
  const { data, error } = await supabase
    .from("sales_lead_events")
    .select("id,lead_id,action,stage_from,stage_to,note,created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SalesLeadEvent[];
}

export async function createLead(input: NewLeadInput) {
  const { data, error } = await supabase.rpc("sales_lead_create", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

export async function moveLeadStage(leadId: string, stage: LeadStage, note?: string) {
  const { data, error } = await supabase.rpc("sales_lead_stage", {
    p: { lead_id: leadId, stage, note } as unknown as Json,
  });
  return unwrap(data, error);
}

export async function convertLeadToOpportunity(leadId: string) {
  const { data, error } = await supabase.rpc("sales_lead_to_opportunity", {
    p: { lead_id: leadId } as unknown as Json,
  });
  return unwrap(data, error);
}

export async function attachBooking(leadId: string, bookingRef: string, orderId?: string) {
  const { data, error } = await supabase.rpc("sales_lead_attach_booking", {
    p: { lead_id: leadId, booking_ref: bookingRef, order_id: orderId } as unknown as Json,
  });
  return unwrap(data, error);
}

/**
 * Ask the customer for something. The request is stored on the lead and shown on
 * the customer's own request page until they reply, so nothing is chased by memory.
 */
export async function requestLeadInformation(leadId: string, note: string) {
  const { data, error } = await supabase.rpc("sales_lead_request_information", {
    p: { lead_id: leadId, note } as unknown as Json,
  });
  return unwrap(data, error);
}

/** Pipeline totals. Absence of activity is stated, never shown as a zero target. */
export function pipelineSummary(leads: SalesLead[]) {
  const open = leads.filter(
    (l) => !["CLOSED_WON", "CLOSED_LOST", "DISQUALIFIED"].includes(l.stage),
  );
  const qualified = leads.filter((l) =>
    ["QUALIFIED", "OPPORTUNITY", "QUOTED", "ACCEPTED"].includes(l.stage),
  );
  const booked = leads.filter((l) => ["BOOKED", "FULFILLED", "CLOSED_WON"].includes(l.stage));
  const decided = leads.filter((l) =>
    ["CLOSED_WON", "CLOSED_LOST", "DISQUALIFIED"].includes(l.stage),
  );
  const estimatedOpenValue = open.reduce((sum, l) => sum + (l.estimated_value_kes ?? 0), 0);
  return {
    total: leads.length,
    open: open.length,
    qualified: qualified.length,
    booked: booked.length,
    conversionRate: leads.length ? (booked.length / leads.length) * 100 : null,
    estimatedOpenValue: open.length ? estimatedOpenValue : null,
    decided: decided.length,
  };
}

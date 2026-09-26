/**
 * LEAD DESK — allocation, outreach, replies and follow-ups.
 *
 * Contact state is deliberately separate from the pipeline stage: a reply proves
 * the contact answered, never that the lead qualified. Stage movement stays with
 * `sales_lead_stage`. Every write here goes through a database function that
 * checks the caller owns the lead (or holds desk-wide permission) and writes an
 * audit event, so nothing about a lead's engagement can be edited quietly.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export const CONTACT_STATES = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "NOT_INTERESTED"] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const CONTACT_STATE_LABEL: Record<ContactState, string> = {
  NOT_CONTACTED: "Not contacted",
  CONTACTED: "Awaiting reply",
  REPLIED: "Replied",
  NOT_INTERESTED: "Not interested",
};

export interface LeadMessage {
  id: string;
  lead_id: string;
  direction: "OUTBOUND" | "INBOUND";
  channel: string;
  subject: string | null;
  body: string;
  recipient_email: string | null;
  sender_name: string | null;
  intent: string | null;
  created_at: string;
}

export interface LeadFollowUp {
  id: string;
  lead_id: string;
  logged_note: string;
  contact_date: string;
  next_action: string;
  due_date: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  outcome: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface DeskKpi {
  sales_staff_id: string | null;
  staff_name: string;
  allocated: number;
  not_contacted: number;
  contacted: number;
  awaiting_reply: number;
  replied: number;
  not_interested: number;
  reply_rate: number | null;
  avg_days_to_first_reply: number | null;
  avg_hours_to_first_reply: number | null;
  median_hours_to_first_reply: number | null;
  replies_measured: number;
  awaiting_over_72h: number;
  longest_wait_hours: number | null;
  followups_open: number;
  followups_overdue: number;
  open_client_requests: number;
  /** Allocated leads that produced a movement record. */
  booked_movements: number;
  /** Of those, the ones the movement register itself marks delivered. */
  deliveries_completed: number;
  deliveries_in_progress: number;
  /** Delivered movements as a share of allocated leads; null before any. */
  delivery_conversion_rate: number | null;
  no_email: number;
}

export const CLIENT_REQUEST_STATUSES = [
  "SUBMITTED",
  "RECEIVED",
  "IN_REVIEW",
  "QUOTED",
  "SCHEDULED",
  "COMPLETED",
  "DECLINED",
  "CANCELLED",
] as const;
export type ClientRequestStatus = (typeof CLIENT_REQUEST_STATUSES)[number];

export const CLIENT_REQUEST_STATUS_LABEL: Record<ClientRequestStatus, string> = {
  SUBMITTED: "Submitted",
  RECEIVED: "Received",
  IN_REVIEW: "In review",
  QUOTED: "Quoted",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

export const CLIENT_SERVICE_TYPES = [
  { id: "DELIVERY", label: "Delivery / courier" },
  { id: "STAFF_TRANSPORT", label: "Staff transport" },
  { id: "AIRPORT_TRANSFER", label: "Airport transfer" },
  { id: "CHARTER", label: "Charter / group movement" },
  { id: "OTHER", label: "Something else" },
] as const;
export type ClientServiceType = (typeof CLIENT_SERVICE_TYPES)[number]["id"];

export const SERVICE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CLIENT_SERVICE_TYPES.map((s) => [s.id, s.label]),
);

export interface ClientRequest {
  id: string;
  lead_id: string;
  request_ref: string;
  service_type: string;
  pickup_location: string;
  dropoff_location: string;
  requested_date: string | null;
  requested_time: string | null;
  goods_description: string | null;
  weight_kg: number | null;
  vehicle_preference: string | null;
  passengers: number | null;
  notes: string | null;
  submitted_by_name: string | null;
  contact_phone: string | null;
  status: ClientRequestStatus;
  status_note: string | null;
  created_at: string;
  updated_at: string;
}

/** The client's own view of a request (no internal identifiers). */
export type ClientRequestPublic = Omit<ClientRequest, "id" | "lead_id" | "submitted_by_name" | "contact_phone">;

/**
 * Response time in plain words. Only ever printed when it was actually measured:
 * from the first message we sent to that lead's first reply.
 */
export function formatWaitHours(v: number | null | undefined): string {
  if (v === null || v === undefined) return "NOT MEASURED YET";
  if (v < 1) return `${Math.max(1, Math.round(v * 60))} min`;
  if (v < 48) return `${Math.round(v * 10) / 10} h`;
  return `${Math.round((v / 24) * 10) / 10} days`;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("NO_RESULT");
  return data;
}

export async function listLeadMessages(leadId: string): Promise<LeadMessage[]> {
  const { data, error } = await supabase
    .from("sales_lead_messages")
    .select("id,lead_id,direction,channel,subject,body,recipient_email,sender_name,intent,created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadMessage[];
}

export async function listFollowUps(opts?: { openOnly?: boolean }): Promise<LeadFollowUp[]> {
  let q = supabase
    .from("sales_lead_followups")
    .select("id,lead_id,logged_note,contact_date,next_action,due_date,status,outcome,closed_at,created_at")
    .order("due_date", { ascending: true });
  if (opts?.openOnly) q = q.eq("status", "OPEN");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadFollowUp[];
}

/** Issues (or returns) the lead's private contact link token. */
export async function leadContactToken(leadId: string): Promise<string> {
  const { data, error } = await supabase.rpc("sales_lead_contact_link", {
    p: { lead_id: leadId } as unknown as Json,
  });
  const res = unwrap(data, error) as { token?: string };
  if (!res.token) throw new Error("NO_TOKEN");
  return res.token;
}

export function contactLinkUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/lead/reply?token=${token}`;
}

export async function logOutreach(input: {
  lead_id: string;
  subject: string;
  body: string;
  channel?: string;
  recipient_email?: string | null;
  contact_link?: string;
  intent?: string;
}) {
  const { data, error } = await supabase.rpc("sales_lead_outreach_log", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

export async function logReply(input: {
  lead_id: string;
  body: string;
  channel?: string;
  sender_name?: string;
  intent?: string;
}) {
  const { data, error } = await supabase.rpc("sales_lead_reply_log", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

export async function addFollowUp(input: {
  lead_id: string;
  logged_note: string;
  next_action: string;
  due_date: string;
  contact_date?: string;
}) {
  const { data, error } = await supabase.rpc("sales_lead_followup_upsert", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

export async function closeFollowUp(input: {
  followup_id: string;
  outcome: string;
  status?: "DONE" | "CANCELLED";
}) {
  const { data, error } = await supabase.rpc("sales_lead_followup_close", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

export async function deskKpis(): Promise<{ scope: "DESK" | "SELF"; desks: DeskKpi[] }> {
  const { data, error } = await supabase.rpc("sales_lead_desk_kpis");
  const res = unwrap(data, error) as unknown as { scope: "DESK" | "SELF"; desks: DeskKpi[] };
  return { scope: res.scope, desks: res.desks ?? [] };
}

/**
 * DELIVERY TRACKING — one row per allocated lead, with the movement it produced.
 *
 * The delivery status comes from the movement record itself (and its legs and
 * proof of delivery), never from a status a person typed on the lead.
 */
export interface LeadDeliveryRow {
  lead_id: string;
  lead_ref: string | null;
  organisation_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_state: ContactState;
  stage: string;
  sales_staff_id: string | null;
  staff_name: string;
  first_outreach_at: string | null;
  first_reply_at: string | null;
  last_reply_at: string | null;
  booking_ref: string | null;
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  payment_status: string | null;
  order_total: number | null;
  currency: string | null;
  sla_deadline: string | null;
  delivered_at: string | null;
  legs_total: number;
  legs_completed: number;
  open_followups: Array<{
    id: string;
    next_action: string;
    due_date: string;
    logged_note: string;
    contact_date: string;
  }>;
  requests_total: number;
  open_requests: number;
}

export const DELIVERED_ORDER_STATUSES = ["delivered", "closed"] as const;

export async function leadDeliveryTracking(): Promise<{
  scope: "DESK" | "SELF";
  leads: LeadDeliveryRow[];
}> {
  const { data, error } = await supabase.rpc("sales_lead_delivery_tracking");
  const res = unwrap(data, error) as unknown as {
    scope: "DESK" | "SELF";
    leads: LeadDeliveryRow[];
  };
  return { scope: res.scope, leads: res.leads ?? [] };
}

export interface LeadThreadEntry {
  created_at: string;
  direction: "OUTBOUND" | "INBOUND";
  subject: string | null;
  body: string;
  author: string;
}

export interface LeadContactViewResult {
  ok: boolean;
  reason?: string;
  lead_ref?: string;
  organisation_name?: string;
  contact_name?: string;
  service_interest?: string;
  contact_state?: ContactState;
  last_outreach_at?: string | null;
  last_reply_at?: string | null;
  information_request?: string | null;
  thread?: LeadThreadEntry[];
  requests?: ClientRequestPublic[];
}

/** Staff view: the requests a company submitted from its own portal. */
export async function listClientRequests(leadId?: string): Promise<ClientRequest[]> {
  let q = supabase
    .from("sales_lead_service_requests")
    .select(
      "id,lead_id,request_ref,service_type,pickup_location,dropoff_location,requested_date,requested_time,goods_description,weight_kg,vehicle_preference,passengers,notes,submitted_by_name,contact_phone,status,status_note,created_at,updated_at",
    )
    .order("created_at", { ascending: false });
  if (leadId) q = q.eq("lead_id", leadId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ClientRequest[];
}

export async function setClientRequestStatus(input: {
  request_id: string;
  status: Exclude<ClientRequestStatus, "SUBMITTED">;
  status_note?: string;
}) {
  const { data, error } = await supabase.rpc("sales_lead_request_status", {
    p: input as unknown as Json,
  });
  return unwrap(data, error);
}

/** Client portal: the company submits its own delivery or transport request. */
export async function submitClientRequest(input: {
  token: string;
  service_type: ClientServiceType;
  pickup_location: string;
  dropoff_location: string;
  requested_date?: string;
  requested_time?: string;
  goods_description?: string;
  weight_kg?: string;
  vehicle_preference?: string;
  passengers?: string;
  notes?: string;
  submitted_by_name?: string;
  contact_phone?: string;
}): Promise<{ ok: boolean; reason?: string; request_ref?: string }> {
  const { data, error } = await supabase.rpc("sales_lead_request_submit", {
    p: input as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; reason?: string; request_ref?: string };
}

/** Public contact link: the contact's own conversation, status and reply box. */
export async function contactLinkView(token: string): Promise<LeadContactViewResult> {
  const { data, error } = await supabase.rpc("sales_lead_contact_view", {
    p: { token } as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as unknown as LeadContactViewResult;
}

/** Public contact link: the contact's own reply. */
export async function contactLinkReply(input: {
  token: string;
  body: string;
  sender_name?: string;
  intent?: "REPLIED" | "INTERESTED" | "NOT_INTERESTED" | "INFORMATION";
}) {
  const { data, error } = await supabase.rpc("sales_lead_contact_reply", {
    p: input as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; reason?: string; lead_ref?: string };
}

/** Message templates. The specialist edits the text before anything is sent. */
export const OUTREACH_TEMPLATES: {
  id: string;
  label: string;
  subject: string;
  body: (v: { organisation: string; contact: string; link: string; sender: string }) => string;
}[] = [
  {
    id: "introduction",
    label: "Introduction",
    subject: "Corporate mobility for {organisation}",
    body: ({ contact, organisation, link, sender }) =>
      `Dear ${contact || "Sir/Madam"},\n\nI am ${sender} from SAFARID. We provide corporate staff transport, airport transfers, chartered movements and last-mile delivery for organisations in Kenya, billed to one monthly corporate account with full trip records.\n\nI would value a short conversation about how ${organisation} moves its people and goods today, and where we could take cost or admin work off your desk.\n\nYou can reply to me directly here: ${link}\n\nKind regards,\n${sender}\nSAFARID`,
  },
  {
    id: "follow_up",
    label: "Follow-up",
    subject: "Following up — corporate mobility for {organisation}",
    body: ({ contact, organisation, link, sender }) =>
      `Dear ${contact || "Sir/Madam"},\n\nI wrote to you recently about corporate mobility for ${organisation}. I appreciate how full your week is, so I will keep this short: if staff transport, airport transfers or deliveries are on your agenda this quarter, I can share indicative rates for your own routes.\n\nReply here and I will pick it up: ${link}\n\nKind regards,\n${sender}\nSAFARID`,
  },
  {
    id: "proposal_chase",
    label: "Proposal chase",
    subject: "Your SAFARID proposal — {organisation}",
    body: ({ contact, organisation, link, sender }) =>
      `Dear ${contact || "Sir/Madam"},\n\nI am checking in on the proposal we shared for ${organisation}. If anything in the scope, rates or terms needs adjusting, tell me what to change and I will reissue it.\n\nYou can reply here: ${link}\n\nKind regards,\n${sender}\nSAFARID`,
  },
  {
    id: "meeting_request",
    label: "Meeting request",
    subject: "15 minutes on mobility — {organisation}",
    body: ({ contact, organisation, link, sender }) =>
      `Dear ${contact || "Sir/Madam"},\n\nWould you have fifteen minutes this week or next to talk through mobility at ${organisation}? I will come with route options and indicative pricing rather than a general presentation.\n\nTell me a time that suits you here: ${link}\n\nKind regards,\n${sender}\nSAFARID`,
  },
];

export function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

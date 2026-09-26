/**
 * Recruitment 360 — Communications & Official Letter Engine (client surface).
 *
 * Every consequential transition goes through a governed database function, so
 * this module never writes lifecycle columns directly. Reads are RLS-filtered;
 * the letter PDF itself is only reachable through a signed storage URL.
 */
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/* --------------------------------- types -------------------------------- */

export type LetterState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "generating"
  | "generated"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "cancelled"
  | "superseded";

export interface LetterRequest {
  id: string;
  document_ref: string;
  comm_type: string;
  state: LetterState | string;
  state_reason: string | null;
  revision: number;
  candidate_id: string;
  application_id: string | null;
  interview_id: string | null;
  offer_id: string | null;
  template_key: string;
  template_version: number;
  recipient_email: string;
  recipient_name: string;
  event_at: string | null;
  event_timezone: string | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  queued_at: string | null;
  provider_accepted_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface LetterTemplate {
  id: string;
  template_key: string;
  version: number;
  comm_type: string;
  title: string;
  subject: string;
  classification: string;
  requires_approval: boolean;
  status: string;
}

export interface LetterDocument {
  id: string;
  request_id: string;
  document_ref: string;
  verification_code: string;
  storage_bucket: string;
  storage_path: string;
  byte_size: number | null;
  sha256: string;
  classification: string | null;
  page_count: number | null;
  issued_at: string;
}

export interface LetterAttempt {
  id: string;
  request_id: string;
  attempt: number;
  outcome: string;
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
}

export interface LetterProviderEvent {
  id: string;
  request_id: string | null;
  provider: string;
  event_type: string;
  provider_message_id: string | null;
  occurred_at: string;
}

export interface CandidateAction {
  id: string;
  request_id: string;
  interview_id: string | null;
  action: string | null;
  note: string | null;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
}

/** States that still need the worker to move them forward. */
export const IN_FLIGHT_STATES: LetterState[] = [
  "approved",
  "generating",
  "generated",
  "queued",
  "sent",
];

export const TERMINAL_STATES: LetterState[] = [
  "delivered",
  "failed",
  "cancelled",
  "superseded",
];

export const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved — generating",
  generating: "Rendering document",
  generated: "Document sealed",
  queued: "Queued for dispatch",
  sent: "Sent — awaiting provider",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
  superseded: "Superseded",
};

export const COMM_TYPE_LABEL: Record<string, string> = {
  interview_invitation: "Interview invitation",
  reschedule_notice: "Reschedule notice",
  regret: "Regret letter",
  appointment_letter: "Appointment letter",
  onboarding_pack: "Onboarding pack",
};

/* --------------------------------- reads -------------------------------- */

export async function listLetterRequests(limit = 200): Promise<LetterRequest[]> {
  return unwrap<LetterRequest[]>(
    await db.from("rec_comm_requests").select("*").order("created_at", { ascending: false }).limit(limit),
  );
}

export async function listLetterTemplates(): Promise<LetterTemplate[]> {
  return unwrap<LetterTemplate[]>(
    await db.from("rec_letter_templates").select("*").order("template_key").order("version", { ascending: false }),
  );
}

export async function listLetterDocuments(requestIds?: string[]): Promise<LetterDocument[]> {
  let q = db.from("rec_comm_documents").select("*").order("issued_at", { ascending: false }).limit(300);
  if (requestIds?.length) q = q.in("request_id", requestIds);
  return unwrap<LetterDocument[]>(await q);
}

export async function listLetterAttempts(requestId: string): Promise<LetterAttempt[]> {
  return unwrap<LetterAttempt[]>(
    await db.from("rec_comm_dispatch_attempts").select("*").eq("request_id", requestId)
      .order("attempt", { ascending: true }),
  );
}

export async function listProviderEvents(requestId: string): Promise<LetterProviderEvent[]> {
  return unwrap<LetterProviderEvent[]>(
    await db.from("rec_comm_provider_events").select("id, request_id, provider, event_type, provider_message_id, occurred_at")
      .eq("request_id", requestId).order("occurred_at", { ascending: true }),
  );
}

export async function listCandidateActions(requestId: string): Promise<CandidateAction[]> {
  return unwrap<CandidateAction[]>(
    await db.from("rec_comm_candidate_actions")
      .select("id, request_id, interview_id, action, note, expires_at, responded_at, created_at")
      .eq("request_id", requestId).order("created_at", { ascending: false }),
  );
}

/** Time-boxed signed URL for a sealed letter — never a public object URL. */
export async function signedLetterUrl(doc: LetterDocument, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------ transitions ----------------------------- */

export interface CreateLetterInput {
  comm_type: string;
  template_key?: string | null;
  application_id?: string | null;
  interview_id?: string | null;
  offer_id?: string | null;
  onboarding_case_id?: string | null;
  /** Stable key so a repeated submission never issues a second letter. */
  idempotency_key?: string | null;
}

export async function createLetterRequest(input: CreateLetterInput): Promise<string> {
  const { data, error } = await db.rpc("rec_comm_request_create", {
    p_comm_type: input.comm_type,
    p_template_key: input.template_key ?? null,
    p_application_id: input.application_id ?? null,
    p_interview_id: input.interview_id ?? null,
    p_offer_id: input.offer_id ?? null,
    p_onboarding_case_id: input.onboarding_case_id ?? null,
    p_idempotency_key: input.idempotency_key ?? null,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : (data?.request_id ?? data?.id ?? "");
}

export async function approveLetterRequest(requestId: string, note?: string) {
  const { error } = await db.rpc("rec_comm_approve", { p_request_id: requestId, p_note: note ?? null });
  if (error) throw new Error(error.message);
}

export async function cancelLetterRequest(requestId: string, reason: string) {
  if (!reason.trim()) throw new Error("A cancellation reason is required.");
  const { error } = await db.rpc("rec_comm_cancel", { p_request_id: requestId, p_reason: reason.trim() });
  if (error) throw new Error(error.message);
}

/**
 * Supersession — an issued letter is never rewritten. A replacement letter is
 * created and the original is closed out against it, preserving both revisions.
 */
export async function supersedeLetterRequest(input: {
  request_id: string;
  reason: string;
  replacement: CreateLetterInput;
}): Promise<string> {
  if (!input.reason.trim()) throw new Error("A supersession reason is required.");
  const replacementId = await createLetterRequest(input.replacement);
  const { error } = await db.rpc("rec_comm_supersede", {
    p_request_id: input.request_id,
    p_replacement_id: replacementId,
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message);
  return replacementId;
}

/* -------------------------------- worker -------------------------------- */

export type WorkerAction = "generate" | "dispatch" | "reconcile" | "all";

export async function runLetterWorker(action: WorkerAction = "all", limit = 25) {
  const { data, error } = await supabase.functions.invoke("rec-comm-worker", {
    body: { action, limit },
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/* ------------------------------- analytics ------------------------------ */

export interface LetterHealth {
  total: number;
  awaiting_approval: number;
  in_flight: number;
  delivered: number;
  failed: number;
  superseded: number;
  stalled: number;
  delivery_rate: number;
}

/** Health is derived only from authoritative request state — nothing inferred. */
export function letterHealth(rows: LetterRequest[], stallMinutes = 20): LetterHealth {
  const now = Date.now();
  const inFlight = rows.filter((r) => IN_FLIGHT_STATES.includes(r.state as LetterState));
  const issued = rows.filter((r) => ["sent", "delivered", "failed"].includes(r.state));
  const delivered = rows.filter((r) => r.state === "delivered").length;
  return {
    total: rows.length,
    awaiting_approval: rows.filter((r) => r.state === "pending_approval").length,
    in_flight: inFlight.length,
    delivered,
    failed: rows.filter((r) => r.state === "failed").length,
    superseded: rows.filter((r) => r.state === "superseded").length,
    stalled: inFlight.filter(
      (r) => now - new Date(r.created_at).getTime() > stallMinutes * 60_000,
    ).length,
    delivery_rate: issued.length ? Math.round((delivered / issued.length) * 100) : 0,
  };
}

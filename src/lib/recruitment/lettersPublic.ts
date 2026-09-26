/**
 * Public (unauthenticated) letter surfaces.
 *
 * Both capabilities are deliberately narrow and served by the `rec-comm-public`
 * edge function: verification returns no personal data, and responding requires
 * a single-use token that exists only as a hash in the database.
 */
import { supabase } from "@/integrations/supabase/client";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("rec-comm-public", { body });
  if (error) {
    // Edge errors carry a JSON body; surface its reason when present.
    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail ?? error.message);
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

/** Raw shape returned by `rec_comm_verify_document`. */
interface RawVerification {
  verified: boolean;
  document_ref?: string;
  document_type?: string;
  issued_at?: string;
  classification?: string;
  integrity_hash?: string;
  issuer?: string;
  lifecycle_state?: string;
}

export interface LetterVerification {
  valid: boolean;
  reason?: string;
  document_ref?: string;
  comm_type?: string;
  issued_at?: string;
  classification?: string;
  issuer?: string;
  superseded?: boolean;
  cancelled?: boolean;
  fingerprint?: string;
  lifecycle_state?: string;
}

export async function verifyLetter(reference: string, code: string): Promise<LetterVerification> {
  const raw = await call<RawVerification>({ action: "verify", reference, code });
  if (!raw.verified) return { valid: false, reason: "not_found" };
  const superseded = raw.lifecycle_state === "superseded";
  const cancelled = raw.lifecycle_state === "cancelled";
  return {
    // A cancelled letter is not a valid instrument, even though it was issued.
    valid: !cancelled,
    reason: cancelled ? "cancelled" : undefined,
    document_ref: raw.document_ref,
    comm_type: raw.document_type,
    issued_at: raw.issued_at,
    classification: raw.classification,
    issuer: raw.issuer,
    superseded,
    cancelled,
    fingerprint: raw.integrity_hash,
    lifecycle_state: raw.lifecycle_state,
  };
}

export interface CandidateActionContext {
  valid: boolean;
  reason?: string;
  already_responded?: boolean;
  previous_action?: string | null;
  document_ref?: string | null;
  comm_type?: string | null;
  candidate_name?: string | null;
  vacancy_title?: string | null;
  interview?: {
    scheduled_at?: string;
    timezone?: string;
    duration_minutes?: number;
    mode?: string;
    location?: string | null;
    meeting_link?: string | null;
    interview_stage?: string;
  } | null;
}

export function inspectCandidateToken(token: string) {
  return call<CandidateActionContext>({ action: "inspect", token });
}

export type CandidateResponse = "confirmed" | "reschedule_requested" | "declined";

export function respondToInvitation(token: string, response: CandidateResponse, note?: string) {
  return call<{ ok?: boolean; status?: string; interview_status?: string }>({
    action: "respond",
    token,
    response,
    note: note ?? null,
  });
}

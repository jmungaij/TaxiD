/**
 * INTERVIEW MEETING INVITATIONS (client side)
 * -------------------------------------------
 * Sends the calendar invitation for a scheduled interview and reads the history
 * of what was actually sent. The server owns every detail of the invitation —
 * this module only names the interview.
 */
import { supabase } from "@/integrations/supabase/client";

export interface InvitationResult {
  ok: boolean;
  interview_id: string;
  sequence: number;
  to: string;
  cc: string[];
  calendar_attached: boolean;
  meeting_link: string | null;
}

export interface InvitationRecord {
  id: string;
  interview_id: string;
  sequence: number;
  method: string;
  scheduled_at: string;
  mode: string;
  meeting_link: string | null;
  recipient_email: string;
  cc_emails: string[];
  status: string;
  failure_reason: string | null;
  created_at: string;
}

/** Plain-language refusals, so a recruiter is never left with a raw code. */
export const INVITATION_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "Only recruitment staff can send interview invitations.",
  INTERVIEW_ID_REQUIRED: "Choose the interview to invite for.",
  INTERVIEW_NOT_FOUND: "That interview no longer exists.",
  CANDIDATE_EMAIL_MISSING: "The candidate record has no email address, so no invitation can be delivered.",
  VIRTUAL_INTERVIEW_REQUIRES_LINK:
    "Add the Google Meet joining link before inviting — an online interview cannot be sent without it.",
  EMAIL_PROVIDER_NOT_CONFIGURED: "The email provider is not configured, so nothing can be sent.",
  INVITATION_NOT_DELIVERED: "The email provider refused the invitation. Nothing was delivered.",
};

export function invitationRefusal(message: string): string {
  const hit = Object.keys(INVITATION_REFUSALS).find((k) => message.includes(k));
  return hit ? INVITATION_REFUSALS[hit] : message;
}

export async function sendInterviewInvitation(
  interviewId: string,
  method: "REQUEST" | "CANCEL" = "REQUEST",
): Promise<InvitationResult> {
  const { data, error } = await supabase.functions.invoke("send-interview-invitation", {
    body: { interview_id: interviewId, method },
  });
  if (error) {
    // The invoke error hides the real refusal; read it from the response body.
    let detail = error.message;
    const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
    if (ctx?.text) {
      try {
        const body = await ctx.text();
        const parsed = JSON.parse(body) as { error?: string; detail?: string };
        detail = parsed.error ?? parsed.detail ?? body;
      } catch { /* keep the original message */ }
    }
    throw new Error(invitationRefusal(detail));
  }
  const result = data as InvitationResult & { error?: string };
  if (result?.error) throw new Error(invitationRefusal(result.error));
  return result;
}

export async function listInterviewInvitations(interviewId: string): Promise<InvitationRecord[]> {
  const { data, error } = await supabase
    .from("meeting_invitations")
    .select(
      "id, interview_id, sequence, method, scheduled_at, mode, meeting_link, recipient_email, cc_emails, status, failure_reason, created_at",
    )
    .eq("interview_id", interviewId)
    .order("sequence", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvitationRecord[];
}

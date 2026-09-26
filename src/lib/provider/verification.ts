/**
 * OPERATOR VERIFICATION — the standing of each mobility operator.
 *
 * Documents are uploaded by the operator and verified one by one. This layer
 * records the operator's overall standing: not verified, in review, verified,
 * suspended or blocked. Only a verified operator can have listings live in the
 * marketplace; suspending or blocking one immediately withdraws their listings.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type VerificationState =
  | "UNVERIFIED"
  | "IN_REVIEW"
  | "VERIFIED"
  | "SUSPENDED"
  | "BLOCKED";

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  UNVERIFIED: "Not verified",
  IN_REVIEW: "In review",
  VERIFIED: "Verified",
  SUSPENDED: "Suspended",
  BLOCKED: "Blocked",
};

/** States that need a written reason before we record them. */
export const REASON_REQUIRED: VerificationState[] = [
  "UNVERIFIED",
  "IN_REVIEW",
  "SUSPENDED",
  "BLOCKED",
];

export interface OperatorVerificationRow {
  provider_user_id: string;
  state: VerificationState;
  reason: string | null;
  decided_at: string | null;
  operator_name: string | null;
  docs_awaiting: number;
  docs_verified: number;
  docs_rejected: number;
  missing_docs: string[] | null;
  listings_live: number;
  listings_awaiting: number;
  bookings_active: number;
}

export interface VerificationEvent {
  id: string;
  from_state: VerificationState | null;
  to_state: VerificationState;
  reason: string | null;
  created_at: string;
}

const REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in first.",
  NOT_AUTHORISED: "You do not have authority to review operators.",
  VERIFICATION_NOT_PERMITTED: "You do not have authority to verify operators.",
  VERIFICATION_REASON_REQUIRED: "Please give a reason for this decision.",
  SELF_VERIFICATION_NOT_PERMITTED: "You cannot decide your own operator account.",
  OPERATOR_REQUIRED: "Choose an operator first.",
  INVALID_STATE: "That decision is not recognised.",
};

export function explainVerificationRefusal(message: string): string {
  if (message.includes("PROVIDER_DOCUMENTS_REQUIRED")) {
    return "This operator cannot be verified yet — a licence, insurance certificate and vehicle inspection must all be verified and in date.";
  }
  for (const key of Object.keys(REFUSAL)) {
    if (message.includes(key)) return REFUSAL[key];
  }
  return message;
}

/** Every operator we hold evidence for, with their current standing. */
export async function loadOperatorVerifications(): Promise<OperatorVerificationRow[]> {
  const { data, error } = await db.rpc("provider_verification_console", {});
  if (error) throw new Error(explainVerificationRefusal(error.message));
  const rows = (data?.operators ?? []) as OperatorVerificationRow[];
  return rows;
}

/** Records a verification decision against an operator. */
export async function setOperatorVerification(input: {
  providerUserId: string;
  state: VerificationState;
  reason?: string;
}): Promise<{ state: VerificationState; listings_withdrawn: number }> {
  const { data, error } = await db.rpc("provider_verification_set", {
    _provider_user_id: input.providerUserId,
    _state: input.state,
    _reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(explainVerificationRefusal(error.message));
  return data as { state: VerificationState; listings_withdrawn: number };
}

/** The permanent decision trail for one operator. */
export async function loadVerificationHistory(
  providerUserId: string,
): Promise<VerificationEvent[]> {
  const { data, error } = await db.rpc("provider_verification_history", {
    _provider_user_id: providerUserId,
  });
  if (error) throw new Error(explainVerificationRefusal(error.message));
  return (data ?? []) as VerificationEvent[];
}

/** The signed-in operator's own standing, if one has been recorded. */
export async function loadMyVerification(): Promise<{
  state: VerificationState;
  reason: string | null;
} | null> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return null;
  const { data, error } = await db
    .from("provider_verification")
    .select("state,reason")
    .eq("provider_user_id", uid)
    .maybeSingle();
  if (error) return null;
  if (!data) return { state: "UNVERIFIED", reason: null };
  return data as { state: VerificationState; reason: string | null };
}

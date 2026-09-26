/**
 * PARTNER APPLICATION → FLEET OWNER ONBOARDING — client surface.
 *
 * The public partner application (`partner_applications`) is interest, not an
 * onboarded carrier. Staff review it and, when it qualifies, convert it into a
 * Fleet Owner application (`carrier_applications`) which then walks the existing
 * approval → compliance → activation chain untouched.
 *
 * Both routines are SECURITY DEFINER and demand `staff.partners.manage`. The
 * conversion is idempotent: a second call returns the same Fleet Owner
 * application instead of creating another one. Nothing here decides an outcome.
 */
import { supabase } from "@/integrations/supabase/client";

export type PartnerReviewStatus =
  | "UNDER_REVIEW" | "INFO_REQUESTED" | "REJECTED" | "QUALIFIED" | "ONBOARDING";

export interface PartnerApplicationCase {
  id: string;
  reference: string;
  organisation_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string | null;
  city: string | null;
  partner_type: string | null;
  network_category: string | null;
  maturity_level: string | null;
  intent_bring: string | null;
  requirements: string | null;
  status: string;
  review_status: PartnerReviewStatus | null;
  review_notes: string | null;
  reviewed_at: string | null;
  carrier_application_id: string | null;
  carrier_id: string | null;
  converted_at: string | null;
  created_at: string;
}

export interface PartnerApplicationEvent {
  id: string;
  application_id: string;
  action: string;
  status_from: string | null;
  status_to: string | null;
  note: string | null;
  created_at: string;
}

export interface Outcome {
  ok?: boolean;
  error?: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<Outcome> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message };
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as Outcome;
}

export async function listPartnerApplicationCases(): Promise<PartnerApplicationCase[]> {
  const { data, error } = await supabase
    .from("partner_applications" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerApplicationCase[];
}

export async function listPartnerApplicationEvents(applicationId: string): Promise<PartnerApplicationEvent[]> {
  const { data, error } = await supabase
    .from("partner_application_events" as never)
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerApplicationEvent[];
}

export type PartnerReviewAction = "REVIEW" | "REQUEST_INFO" | "REJECT" | "QUALIFY";

export const REVIEW_ACTION_LABEL: Record<PartnerReviewAction, string> = {
  REVIEW: "Mark under review",
  REQUEST_INFO: "Request information",
  REJECT: "Reject",
  QUALIFY: "Qualify for Fleet Owner onboarding",
};

export const reviewPartnerApplication = (
  applicationId: string,
  action: PartnerReviewAction,
  note?: string | null,
) => rpc("partner_application_review", { p: { application_id: applicationId, action, note: note ?? null } });

export const convertToFleetOwner = (applicationId: string) =>
  rpc("partner_application_to_fleet_owner", { p: { application_id: applicationId } });

/** Refusal copy for the codes the two routines can return. */
export const CONVERSION_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "Your account does not carry partner management permission.",
  UNKNOWN_APPLICATION: "That partner application no longer exists.",
  UNKNOWN_ACTION: "That review action is not recognised.",
  NOTE_REQUIRED: "An information request needs a note explaining what is missing.",
  REASON_REQUIRED: "A rejection needs a written reason.",
  APPLICATION_CLOSED: "This application is already rejected.",
  NOT_QUALIFIED: "Qualify the application before converting it to Fleet Owner onboarding.",
  INCOMPLETE_APPLICANT_CONTRACT:
    "The application is missing the organisation name, contact email or phone required for onboarding.",
  RPC_FAILED: "The server refused the request.",
  EMPTY_RESPONSE: "The server returned no decision.",
};

export const refusalText = (o: Outcome): string =>
  CONVERSION_REFUSALS[String(o.code ?? "")] ?? String(o.message ?? o.code ?? "Refused");

/**
 * Recruitment 360 — vacancy mandatory requirements and their evidence.
 *
 * A requirement is defined once, on a versioned requirement contract
 * (`rec_document_requirement_rules`), and carries three extra facts beyond the
 * document rule itself:
 *
 *   requirement_text        — the requirement as the candidate reads it
 *   hard_requirement        — a candidate who does not satisfy it is not eligible
 *   accepted_evidence_types — what we will accept as proof
 *
 * Candidates answer the requirement (a declaration) AND file evidence against
 * it. Neither the declaration nor the upload makes a requirement satisfied:
 * only staff verification of the evidence (or acceptance of a declaration-only
 * requirement) does. That asymmetry is the whole point — it is computed
 * server-side by `rec_requirement_eligibility` and only shaped here.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type EvidenceKind = "document" | "declaration" | "document_or_declaration";

export type RequirementResponseStatus = "not_answered" | "pending" | "accepted" | "rejected";

export type EligibilityState =
  | "SATISFIED"
  | "AWAITING_VERIFICATION"
  | "AWAITING_REVIEW"
  | "EVIDENCE_MISSING"
  | "DECLARATION_OUTSTANDING"
  | "NOT_SATISFIED";

export type EligibilityVerdict =
  | "ELIGIBLE" | "EVIDENCE_PENDING" | "NOT_ELIGIBLE" | "NO_HARD_REQUIREMENTS";

export interface EligibilityItem {
  requirement_key: string;
  rule_id: string | null;
  label: string;
  requirement_text: string | null;
  evidence_kind: EvidenceKind | null;
  accepted_evidence_types: string[];
  document_id: string | null;
  file_name: string | null;
  verification_status: string | null;
  response_required: boolean;
  response_id: string | null;
  declared: boolean | null;
  declared_detail: string | null;
  response_status: RequirementResponseStatus;
  response_note: string | null;
  state: EligibilityState;
}

export interface EligibilityReport {
  application_id: string;
  requirement_version: number | null;
  hard_total: number;
  hard_satisfied: number;
  hard_blocked: number;
  hard_pending: number;
  verdict: EligibilityVerdict;
  items: EligibilityItem[];
  evaluated_at: string;
}

/** Staff read: hard-requirement eligibility for one application. */
export async function requirementEligibility(applicationId: string): Promise<EligibilityReport> {
  const { data, error } = await db.rpc("rec_requirement_eligibility", {
    p_application_id: applicationId,
  });
  if (error) throw new Error(error.message);
  return data as EligibilityReport;
}

export type ResponseReviewAction = "accept" | "reject" | "reset";

/** Staff decision on a candidate's requirement declaration. */
export async function reviewRequirementResponse(
  responseId: string, action: ResponseReviewAction, note?: string | null,
): Promise<{ response_id: string; staff_status: RequirementResponseStatus }> {
  const { data, error } = await db.rpc("rec_requirement_response_review", {
    p_response_id: responseId, p_action: action, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export interface RequirementDeclaration {
  requirement_key: string;
  rule_id?: string | null;
  doc_key?: string | null;
  declared: boolean;
  declared_detail?: string | null;
}

/**
 * Candidate declarations, recorded immediately after the application has been
 * created. The server refuses the call once the submission window has closed
 * and never overwrites a declaration a recruiter has already decided on.
 */
export async function recordRequirementDeclarations(
  applicationId: string, responses: RequirementDeclaration[],
): Promise<{ recorded: number }> {
  if (responses.length === 0) return { recorded: 0 };
  const { data, error } = await db.rpc("rec_public_requirement_responses", {
    p_application_id: applicationId,
    p_responses: responses,
  });
  if (error) throw new Error(error.message);
  return data as { recorded: number };
}

/* ------------------------------------------------------------------ *
 * Presentation — a declaration is never shown as satisfied evidence.
 * ------------------------------------------------------------------ */

export function eligibilityStateLabel(state: EligibilityState): string {
  switch (state) {
    case "SATISFIED": return "Satisfied — evidence accepted";
    case "AWAITING_VERIFICATION": return "Evidence filed — awaiting verification";
    case "AWAITING_REVIEW": return "Declaration filed — awaiting review";
    case "EVIDENCE_MISSING": return "No evidence filed";
    case "DECLARATION_OUTSTANDING": return "Candidate has not confirmed this requirement";
    case "NOT_SATISFIED": return "Not satisfied";
    default: return state;
  }
}

export function eligibilityStateTone(
  state: EligibilityState,
): "success" | "warning" | "destructive" {
  if (state === "SATISFIED") return "success";
  if (state === "NOT_SATISFIED") return "destructive";
  return "warning";
}

export function verdictLabel(verdict: EligibilityVerdict): string {
  switch (verdict) {
    case "ELIGIBLE": return "Meets every mandatory requirement";
    case "EVIDENCE_PENDING": return "Mandatory requirements not yet evidenced";
    case "NOT_ELIGIBLE": return "Does not meet a mandatory requirement";
    case "NO_HARD_REQUIREMENTS": return "This vacancy declares no mandatory requirements";
    default: return verdict;
  }
}

export function verdictTone(
  verdict: EligibilityVerdict,
): "success" | "warning" | "destructive" | "neutral" {
  if (verdict === "ELIGIBLE") return "success";
  if (verdict === "NOT_ELIGIBLE") return "destructive";
  if (verdict === "NO_HARD_REQUIREMENTS") return "neutral";
  return "warning";
}

/**
 * A candidate can never be advanced on an unmet hard requirement, whatever the
 * match score says. This caps a suggestion — it does not make the decision.
 */
export function gateRecommendation(
  recommendation: "advance" | "review" | "reject",
  verdict: EligibilityVerdict,
): "advance" | "review" | "reject" {
  if (verdict === "NOT_ELIGIBLE") return "reject";
  if (verdict === "EVIDENCE_PENDING" && recommendation === "advance") return "review";
  return recommendation;
}

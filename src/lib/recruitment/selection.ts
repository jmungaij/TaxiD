/**
 * Recruitment 360 — selection intelligence client.
 *
 * Every function here is a thin wrapper over a governed server RPC. Nothing in
 * this file scores, gates, or decides: eligibility, weighted scores and
 * authority checks live in Postgres so the browser cannot be the workflow, and
 * so a score is reproducible from the evidence that produced it.
 *
 * The two rules this module exists to protect:
 *   1. AI ranks and recommends; a human decides, and the override is recorded.
 *   2. Nothing is displayed that was not derived from persisted state.
 */
import { supabase } from "@/integrations/supabase/client";

export const CRITERION_TYPES = ["hard_gate", "scored", "preferred", "evidence"] as const;
export type CriterionType = (typeof CRITERION_TYPES)[number];

export const SCORING_METHODS = ["threshold", "presence", "ratio", "manual"] as const;
export type ScoringMethod = (typeof SCORING_METHODS)[number];

export const CRITERION_TYPE_LABEL: Record<CriterionType, string> = {
  hard_gate: "Hard gate",
  scored: "Scored",
  preferred: "Preferred",
  evidence: "Evidence only",
};

export const CRITERION_TYPE_HELP: Record<CriterionType, string> = {
  hard_gate: "Essential requirement. Failure blocks progression; missing evidence sends the candidate to human review — never an automatic rejection.",
  scored: "Earns weighted points towards the 100-point vacancy score.",
  preferred: "Competitive advantage. Adds points but never disqualifies.",
  evidence: "Recorded for the reviewer. Carries no weight.",
};

export interface ScorecardCriterion {
  id?: string;
  code: string;
  label: string;
  criterion_type: CriterionType;
  weight: number;
  min_threshold: number | null;
  evidence_source: string;
  scoring_method: ScoringMethod;
  guidance?: string | null;
  sort_order?: number;
}

export interface Scorecard {
  id: string;
  vacancy_id: string;
  version: number;
  status: "draft" | "active" | "archived";
  notes: string | null;
  activated_at: string | null;
  created_at: string;
}

export type Eligibility = "eligible" | "not_eligible" | "requires_review";
export type Recommendation = "advance" | "review" | "do_not_advance";

export interface CriterionResult {
  code: string;
  label: string;
  type: CriterionType;
  weight: number;
  earned: number | null;
  status: "pass" | "fail" | "partial" | "requires_review" | "missing_evidence";
  evidence: string;
  source_kind: string | null;
  source_ref: string | null;
  confidence: number | null;
}

export interface Evaluation {
  id: string;
  application_id: string;
  vacancy_id: string;
  scorecard_version: number;
  eligibility: Eligibility;
  weighted_score: number;
  criterion_results: CriterionResult[];
  gate_failures: string[];
  missing_evidence: string[];
  recommendation: Recommendation;
  confidence: number | null;
  engine: string;
  computed_at: string;
}

export interface VacancyFunnel {
  received: number;
  valid: number;
  evaluated: number;
  eligible: number;
  review: number;
  ineligible: number;
  recommended: number;
  screened: number;
  assessment: number;
  shortlist: number;
  interview: number;
  offer: number;
  hired: number;
  not_selected: number;
  talent_pool: number;
}

export const QUEUES = [
  { key: "new", label: "New", help: "Applications awaiting evaluation." },
  { key: "eligibility_review", label: "Eligibility review", help: "Essential requirement could not be confirmed from evidence." },
  { key: "ai_recommended", label: "Recommended", help: "Evidence supports progression — awaiting a human decision." },
  { key: "human_review", label: "Human review", help: "Evaluated and waiting on a recruiter decision." },
  { key: "shortlist", label: "Shortlist", help: "Shortlisted candidates." },
  { key: "interview", label: "Interview", help: "At interview stage." },
  { key: "final_decision", label: "Final decision", help: "Awaiting authorised selection." },
  { key: "ineligible", label: "Not eligible", help: "Failed an essential requirement." },
] as const;
export type QueueKey = (typeof QUEUES)[number]["key"];

export interface QueueRow {
  id: string;
  application_no: string;
  stage: string;
  priority: string;
  applied_at: string;
  stage_entered_at: string;
  full_name: string;
  location: string | null;
  years_experience: number | null;
  eligibility: Eligibility | null;
  weighted_score: number | null;
  recommendation: Recommendation | null;
  confidence: number | null;
  gate_failures: string[] | null;
  missing_evidence: string[] | null;
  evaluation_id: string | null;
}

export interface QueuePage {
  total: number;
  rows: QueueRow[];
  limit: number;
  offset: number;
  queue: string;
}

export interface RejectionReason {
  code: string;
  label: string;
  category: string;
  template_key: string | null;
  requires_approval: boolean;
  exposes_comparative: boolean;
  candidate_message: string | null;
  sort_order: number;
}

export interface SelectionDecision {
  id: string;
  application_id: string;
  decision: "advance" | "not_selected" | "selected" | "hold";
  stage_at_decision: string;
  ai_recommendation: Recommendation | null;
  ai_confidence: number | null;
  is_override: boolean;
  reason_code: string | null;
  reason_notes: string | null;
  decision_role: string | null;
  decided_at: string;
}

export const BULK_ACTIONS = [
  { key: "screen", label: "Move to screening", consequential: false },
  { key: "shortlist", label: "Shortlist", consequential: false },
  { key: "invite_assessment", label: "Invite to assessment", consequential: true },
  { key: "invite_interview", label: "Invite to interview", consequential: true },
  { key: "talent_pool", label: "Add to talent pool", consequential: false },
  { key: "not_selected", label: "Do not progress", consequential: true },
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number]["key"];

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------------------ reads -- */

export async function getScorecard(
  vacancyId: string,
): Promise<{ scorecard: Scorecard | null; criteria: ScorecardCriterion[] }> {
  const { data, error } = await supabase
    .from("rec_scorecards")
    .select("*")
    .eq("vacancy_id", vacancyId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { scorecard: null, criteria: [] };
  const { data: criteria, error: cErr } = await supabase
    .from("rec_scorecard_criteria")
    .select("*")
    .eq("scorecard_id", (data as Scorecard).id)
    .order("sort_order");
  if (cErr) throw new Error(cErr.message);
  return { scorecard: data as unknown as Scorecard, criteria: (criteria ?? []) as unknown as ScorecardCriterion[] };
}

export const getFunnel = (vacancyId: string) =>
  call<VacancyFunnel>("rec_vacancy_funnel", { p_vacancy_id: vacancyId });

export const getQueue = (
  vacancyId: string,
  queue: QueueKey,
  limit = 25,
  offset = 0,
  search?: string,
) =>
  call<QueuePage>("rec_review_queue", {
    p_vacancy_id: vacancyId,
    p_queue: queue,
    p_limit: limit,
    p_offset: offset,
    p_search: search ?? null,
  });

export async function listRejectionReasons(): Promise<RejectionReason[]> {
  const { data, error } = await supabase
    .from("rec_rejection_reasons")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RejectionReason[];
}

export async function getEvaluation(applicationId: string): Promise<Evaluation | null> {
  const { data, error } = await supabase
    .from("rec_application_evaluations")
    .select("*")
    .eq("application_id", applicationId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as Evaluation | null;
}

export async function listDecisions(applicationId: string): Promise<SelectionDecision[]> {
  const { data, error } = await supabase
    .from("rec_selection_decisions")
    .select("*")
    .eq("application_id", applicationId)
    .order("decided_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SelectionDecision[];
}

/* ----------------------------------------------------------------- writes -- */

export const saveScorecard = (vacancyId: string, criteria: ScorecardCriterion[], notes?: string) =>
  call<{ scorecard_id: string; version: number }>("rec_scorecard_save", {
    p_vacancy_id: vacancyId,
    p_criteria: criteria.map((c) => ({
      code: c.code,
      label: c.label,
      criterion_type: c.criterion_type,
      weight: c.weight,
      min_threshold: c.min_threshold ?? "",
      evidence_source: c.evidence_source,
      scoring_method: c.scoring_method,
      guidance: c.guidance ?? null,
    })),
    p_notes: notes ?? null,
  });

export const evaluateApplication = (applicationId: string) =>
  call<{ eligibility: Eligibility; score: number; recommendation: Recommendation }>(
    "rec_evaluate_application",
    { p_application_id: applicationId },
  );

export const evaluateVacancyBatch = (vacancyId: string, limit = 200) =>
  call<{ evaluated: number; failed: number; remaining: number }>("rec_evaluate_vacancy_batch", {
    p_vacancy_id: vacancyId,
    p_limit: limit,
  });

export const bulkDecide = (
  applicationIds: string[],
  action: BulkAction,
  reasonCode?: string | null,
  notes?: string | null,
  sendFeedback = true,
) =>
  call<{ applied: number; skipped: number; feedback_queued: number; errors: unknown[] }>(
    "rec_bulk_decide",
    {
      p_application_ids: applicationIds,
      p_action: action,
      p_reason_code: reasonCode ?? null,
      p_notes: notes ?? null,
      p_send_feedback: sendFeedback,
    },
  );

export const finalSelection = (
  applicationId: string,
  decision: "selected" | "not_selected",
  reasonCode?: string | null,
  notes?: string | null,
) =>
  call<{ decision_id: string; decision: string }>("rec_final_selection", {
    p_application_id: applicationId,
    p_decision: decision,
    p_reason_code: reasonCode ?? null,
    p_notes: notes ?? null,
  });

export const recordEvidence = (
  applicationId: string,
  facts: Array<{
    attribute: string;
    value_text?: string;
    value_numeric?: number;
    source_kind: string;
    source_ref: string;
    source_locator?: string;
    confidence: number;
    extracted_by?: string;
  }>,
) => call<number>("rec_record_evidence", { p_application_id: applicationId, p_facts: facts });

/* ------------------------------------------------------------ presentation -- */

/** A default 100-point scorecard so a recruiter never starts from a blank page. */
export function defaultCriteria(minYears = 3): ScorecardCriterion[] {
  return [
    { code: "minimum_education", label: "Minimum education", criterion_type: "hard_gate", weight: 0, min_threshold: null, evidence_source: "document", scoring_method: "presence" },
    { code: "required_certification", label: "Required professional certification", criterion_type: "hard_gate", weight: 0, min_threshold: null, evidence_source: "document", scoring_method: "presence" },
    { code: "relevant_experience", label: "Relevant experience", criterion_type: "scored", weight: 25, min_threshold: minYears, evidence_source: "cv", scoring_method: "threshold" },
    { code: "technical_competencies", label: "Technical competencies", criterion_type: "scored", weight: 20, min_threshold: null, evidence_source: "cv", scoring_method: "presence" },
    { code: "role_competencies", label: "Role-specific competencies", criterion_type: "scored", weight: 20, min_threshold: null, evidence_source: "cv", scoring_method: "presence" },
    { code: "achievements", label: "Demonstrated achievements", criterion_type: "scored", weight: 15, min_threshold: null, evidence_source: "cv", scoring_method: "presence" },
    { code: "assessment_result", label: "Assessment result", criterion_type: "scored", weight: 10, min_threshold: 60, evidence_source: "assessment", scoring_method: "threshold" },
    { code: "sector_exposure", label: "Mobility sector exposure", criterion_type: "preferred", weight: 10, min_threshold: null, evidence_source: "cv", scoring_method: "presence" },
  ];
}

export const scoredWeight = (criteria: ScorecardCriterion[]) =>
  criteria
    .filter((c) => c.criterion_type === "scored" || c.criterion_type === "preferred")
    .reduce((s, c) => s + (Number(c.weight) || 0), 0);

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  eligible: "Eligible",
  not_eligible: "Not eligible",
  requires_review: "Requires review",
};

export const ELIGIBILITY_TONE: Record<Eligibility, string> = {
  eligible: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  not_eligible: "bg-destructive/10 text-destructive border-destructive/30",
  requires_review: "bg-status-warning/10 text-status-warning border-status-warning/30",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  advance: "Advance",
  review: "Human review",
  do_not_advance: "Do not advance",
};

/**
 * Whether a human decision contradicts the recommendation the system produced.
 * Mirrors the server's override rule so the UI can warn before the write.
 */
export function isOverride(action: BulkAction, recommendation: Recommendation | null): boolean {
  if (!recommendation) return false;
  if (action === "not_selected") return recommendation === "advance";
  return recommendation === "do_not_advance";
}

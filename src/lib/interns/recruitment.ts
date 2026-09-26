/**
 * INTERNS 360 — internship recruitment pipeline access.
 *
 * Every stage move, evaluation, track recommendation and activation runs through
 * a governed database routine. The UI never computes a score, never invents an
 * eligibility verdict and never writes the transition ledger directly: that
 * ledger is append-only and is the audit record of the whole funnel.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const PIPELINE_STAGES = [
  "DRAFT",
  "PUBLISHED",
  "APPLICATION_OPEN",
  "APPLICATION_RECEIVED",
  "ELIGIBILITY_SCREENING",
  "ACADEMIC_PROFILE_VALIDATION",
  "CURRICULUM_MATCH",
  "EVIDENCE_REVIEW",
  "CAPABILITY_ASSESSMENT",
  "SHORTLIST_REVIEW",
  "INTERVIEW_INVITED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_COMPLETED",
  "SELECTION_REVIEW",
  "SELECTED",
  "OFFER_GENERATED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "DOCUMENT_COLLECTION",
  "ONBOARDING",
  "INTERN_ACTIVATED",
  "INTERNS_360",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const TERMINAL_STAGES = [
  "REJECTED",
  "WITHDRAWN",
  "DECLINED",
  "EXPIRED",
  "NO_SHOW",
  "INELIGIBLE",
  "POSITION_FILLED",
] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export type AnyStage = PipelineStage | TerminalStage;

export const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  APPLICATION_OPEN: "Applications open",
  APPLICATION_RECEIVED: "Application received",
  ELIGIBILITY_SCREENING: "Eligibility screening",
  ACADEMIC_PROFILE_VALIDATION: "Academic validation",
  CURRICULUM_MATCH: "Curriculum match",
  EVIDENCE_REVIEW: "Evidence review",
  CAPABILITY_ASSESSMENT: "Capability assessment",
  SHORTLIST_REVIEW: "Shortlist review",
  INTERVIEW_INVITED: "Interview invited",
  INTERVIEW_SCHEDULED: "Interview scheduled",
  INTERVIEW_COMPLETED: "Interview completed",
  SELECTION_REVIEW: "Selection review",
  SELECTED: "Selected",
  OFFER_GENERATED: "Offer generated",
  OFFER_SENT: "Offer sent",
  OFFER_ACCEPTED: "Offer accepted",
  DOCUMENT_COLLECTION: "Document collection",
  ONBOARDING: "Onboarding",
  INTERN_ACTIVATED: "Intern activated",
  INTERNS_360: "Live in Interns 360",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  DECLINED: "Offer declined",
  EXPIRED: "Expired",
  NO_SHOW: "No show",
  INELIGIBLE: "Ineligible",
  POSITION_FILLED: "Position filled",
};

/** Board columns: the stages an operator actively works, in funnel order. */
export const BOARD_STAGES: PipelineStage[] = [
  "APPLICATION_RECEIVED",
  "ELIGIBILITY_SCREENING",
  "ACADEMIC_PROFILE_VALIDATION",
  "CURRICULUM_MATCH",
  "EVIDENCE_REVIEW",
  "CAPABILITY_ASSESSMENT",
  "SHORTLIST_REVIEW",
  "INTERVIEW_INVITED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_COMPLETED",
  "SELECTION_REVIEW",
  "SELECTED",
  "OFFER_GENERATED",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "DOCUMENT_COLLECTION",
  "ONBOARDING",
  "INTERN_ACTIVATED",
  "INTERNS_360",
];

export const isTerminal = (stage: string): boolean =>
  (TERMINAL_STAGES as readonly string[]).includes(stage);

/** The one legal forward step from a stage, or null at the end of the funnel. */
export function nextStage(stage: string): PipelineStage | null {
  const i = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  if (i < 0 || i === PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[i + 1];
}

export function previousStage(stage: string): PipelineStage | null {
  const i = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  return i > 0 ? PIPELINE_STAGES[i - 1] : null;
}

export interface ScoreDimension {
  score: number;
  weight?: number;
  evidence?: string;
  source?: string;
}

export interface PipelineRow {
  id: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string | null;
  cohort_id: string | null;
  intern_id: string | null;
  primary_track_id: string | null;
  secondary_track_id: string | null;
  development_track_id: string | null;
  stage: string;
  stage_entered_at: string;
  last_action_at: string | null;
  sla_target_hours: number | null;
  eligibility_status: string | null;
  eligibility_reasons: string[] | null;
  curriculum_score: number | null;
  evidence_score: number | null;
  assessment_score: number | null;
  interview_score: number | null;
  match_score: number | null;
  score_breakdown: Record<string, ScoreDimension> | null;
  screening_recommendation: string | null;
  selection_decision: string | null;
  selection_reason: string | null;
  risk_flags: unknown;
  created_at: string;
}

export interface TransitionRow {
  id: string;
  pipeline_id: string;
  from_stage: string | null;
  to_stage: string;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
  context: Record<string, unknown> | null;
}

const anyClient = untypedDb;

const unwrap = <T>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as unknown as T;
};

export async function listPipeline(): Promise<PipelineRow[]> {
  return unwrap(
    await anyClient
      .from("intern_recruitment_pipeline")
      .select("*")
      .order("stage_entered_at", { ascending: true })
      .limit(500),
  ) as PipelineRow[];
}

export async function getPipeline(id: string): Promise<PipelineRow | null> {
  const { data, error } = await anyClient
    .from("intern_recruitment_pipeline")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as PipelineRow | null;
}

export async function listTransitions(pipelineId: string): Promise<TransitionRow[]> {
  return unwrap(
    await anyClient
      .from("intern_recruitment_transitions")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("created_at", { ascending: false }),
  ) as TransitionRow[];
}

/** Idempotent: opens the pipeline for an application, or returns the existing one. */
export async function openPipeline(applicationId: string): Promise<string> {
  const { data, error } = await anyClient.rpc("intern_pipeline_open", { p_application: applicationId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function transitionPipeline(
  pipelineId: string,
  toStage: AnyStage,
  reason: string,
  context?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ stage: string }> {
  const { data, error } = await anyClient.rpc("intern_pipeline_transition", {
    p_pipeline: pipelineId,
    p_to: toStage,
    p_reason: reason,
    p_context: context ?? {},
    p_idempotency_key: idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { stage: string };
}

export interface EvaluationResult {
  eligibility: string;
  eligibility_reasons: string[];
  match_score: number;
  breakdown: Record<string, ScoreDimension>;
  recommendation?: string | null;
  weight_set?: string | null;
}

/** Server-computed eligibility and explainable match score. */
export async function evaluatePipeline(pipelineId: string): Promise<EvaluationResult> {
  const { data, error } = await anyClient.rpc("intern_pipeline_evaluate", { p_pipeline: pipelineId });
  if (error) throw new Error(error.message);
  return data as EvaluationResult;
}

/** Track recommendation derived from matched course evidence, never degree title alone. */
export async function recommendTracks(pipelineId: string): Promise<{
  ok: boolean;
  primary_track_id: string | null;
  secondary_track_id: string | null;
  development_track_id: string | null;
  ranking?: Array<{ track_id: string; code?: string; score: number; evidence?: string }>;
}> {
  const { data, error } = await anyClient.rpc("intern_pipeline_recommend_tracks", { p_pipeline: pipelineId });
  if (error) throw new Error(error.message);
  return data as never;
}

export async function decidePipeline(
  pipelineId: string,
  decision: "SELECT" | "REJECT" | "HOLD" | "TALENT_POOL",
  reason: string,
): Promise<void> {
  const { error } = await anyClient.rpc("intern_pipeline_decide", {
    p_pipeline: pipelineId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** Hand-over to Interns 360: creates or reuses one intern identity, never a duplicate. */
export async function activatePipeline(
  pipelineId: string,
  cohortId: string,
  mentorId?: string | null,
  supervisorId?: string | null,
): Promise<{ ok: boolean; intern_id: string }> {
  const { data, error } = await anyClient.rpc("intern_pipeline_activate", {
    p_pipeline: pipelineId,
    p_cohort: cohortId,
    p_mentor: mentorId ?? null,
    p_supervisor: supervisorId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; intern_id: string };
}

export interface CertificationResult {
  verdict: "CERTIFIED" | "GAPS";
  total_checks: number;
  passed_checks: number;
  checks: Array<{ check: string; pass: boolean }>;
  gaps: string[];
}

export async function runRecruitmentCertification(): Promise<CertificationResult> {
  const { data, error } = await anyClient.rpc("intern_recruitment_certify");
  if (error) throw new Error(error.message);
  return data as CertificationResult;
}

export async function listCertificationRuns(): Promise<
  Array<{ id: string; verdict: string; total_checks: number; passed_checks: number; created_at: string; gaps: string[] }>
> {
  return unwrap(
    await anyClient
      .from("intern_recruitment_certification_runs")
      .select("id, verdict, total_checks, passed_checks, created_at, gaps")
      .order("created_at", { ascending: false })
      .limit(10),
  ) as never;
}

/** Hours a pipeline has been sitting in its current stage. */
export const hoursInStage = (row: PipelineRow, now = Date.now()): number =>
  Math.max(0, Math.round((now - new Date(row.stage_entered_at).getTime()) / 3_600_000));

export const slaBreached = (row: PipelineRow, now = Date.now()): boolean =>
  !!row.sla_target_hours && hoursInStage(row, now) > row.sla_target_hours;

export interface CandidateBrief {
  id: string;
  candidate_no: string | null;
  full_name: string | null;
  email: string | null;
}

/** Display identity for the board; candidate PII stays RLS-scoped server-side. */
export async function listCandidateBriefs(ids: string[]): Promise<Record<string, CandidateBrief>> {
  if (!ids.length) return {};
  const rows = unwrap(
    await anyClient
      .from("rec_candidates")
      .select("id, candidate_no, full_name, email")
      .in("id", Array.from(new Set(ids))),
  ) as CandidateBrief[];
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/* ------------------ academic profile completeness triage ----------------- */

/** Academic facts that may legitimately be undeclared at application time. */
export const ACADEMIC_GAP_FIELDS = ["qualification_level", "programme", "institution"] as const;
export type AcademicGapField = (typeof ACADEMIC_GAP_FIELDS)[number];

export const ACADEMIC_GAP_LABEL: Record<AcademicGapField, string> = {
  qualification_level: "Qualification level missing",
  programme: "Programme of study missing",
  institution: "Institution missing",
};

export interface AcademicProfileGap {
  id: string;
  application_id: string;
  candidate_id: string | null;
  qualification_level: string | null;
  programme: string | null;
  institution: string | null;
  created_at: string;
  /** Which declared-optional fields are absent on this row. */
  gaps: AcademicGapField[];
}

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

/**
 * Academic profiles carrying at least one undeclared field. The columns are
 * nullable by design — an applicant is never blocked — so recruiters triage
 * the gap here instead of the submission failing.
 */
export async function listAcademicProfileGaps(): Promise<AcademicProfileGap[]> {
  const rows = unwrap(
    await anyClient
      .from("intern_academic_profiles")
      .select("id, application_id, candidate_id, qualification_level, programme, institution, created_at")
      .or(
        "qualification_level.is.null,programme.is.null,institution.is.null," +
          "qualification_level.eq.,programme.eq.,institution.eq.",
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ) as Omit<AcademicProfileGap, "gaps">[];

  return rows
    .map((r) => ({ ...r, gaps: ACADEMIC_GAP_FIELDS.filter((f) => blank(r[f])) }))
    .filter((r) => r.gaps.length > 0);
}

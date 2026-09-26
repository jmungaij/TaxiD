/**
 * Recruitment 360 — assessment engine data access.
 *
 * Everything consequential runs through governed database functions:
 * `rec_assessment_open`, `rec_assessment_save_answer`, `rec_assessment_submit`,
 * `rec_assessment_amend`, `rec_claim_record`, `rec_claim_validate`. The client
 * never writes assessments or scores directly, and never calculates a total that
 * is then stored.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EvidenceConfidence, VerificationStatus } from "./assessmentScoring";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface RecQuestionSnapshot {
  prompt: string;
  scenario: string | null;
  question_type: string;
  probes: string[] | null;
  good_indicators: string[] | null;
  weak_indicators: string[] | null;
  scoring_anchors: { range: string; meaning: string }[] | null;
  expected_evidence: string | null;
  max_marks: number;
  critical_min: number | null;
}

export interface RecAssessmentAnswer {
  id: string;
  assessment_id: string;
  question_id: string;
  question_key: string;
  question_version: number;
  question_snapshot: RecQuestionSnapshot;
  competency_code: string;
  competency_label: string;
  max_marks: number;
  critical_min: number | null;
  mandatory: boolean;
  sort_order: number;
  answer_text: string | null;
  evidence_text: string | null;
  verification_status: VerificationStatus;
  evidence_confidence: EvidenceConfidence;
  score: number | null;
  rationale: string | null;
}

export interface RecAssessment {
  id: string;
  interview_id: string;
  application_id: string;
  vacancy_id: string;
  candidate_id: string;
  template_id: string;
  template_key: string;
  template_version: number;
  assessor_user_id: string;
  assessor_name: string | null;
  status: "draft" | "submitted" | "amended";
  total_score: number | null;
  max_score: number;
  percentage: number | null;
  band: string | null;
  gate_status: { competency: string; label: string; score: number | null; minimum: number; passed: boolean }[];
  gates_passed: boolean | null;
  recommendation: string | null;
  strengths: string | null;
  concerns: string | null;
  risks: string | null;
  submitted_at: string | null;
  amended_at: string | null;
}

export interface RecCvClaim {
  id: string;
  application_id: string | null;
  claim_type: string;
  claim_text: string;
  source_document: string | null;
  verification_status: VerificationStatus;
  confidence: EvidenceConfidence;
  created_at: string;
}

export interface RecClaimValidation {
  id: string;
  claim_id: string;
  question_text: string;
  response_text: string | null;
  evidence_text: string | null;
  verification_status: VerificationStatus;
  confidence: EvidenceConfidence;
  created_at: string;
}

/* --------------------------------------------------------------- templates */

export async function listTemplates() {
  return unwrap<{ id: string; template_key: string; version: number; title: string; role_family: string; status: string; total_marks: number; vacancy_id: string | null }[]>(
    await db.from("rec_assessment_templates").select("*").order("template_key").order("version", { ascending: false }),
  );
}

export async function resolveTemplate(vacancyId: string): Promise<string | null> {
  const { data, error } = await db.rpc("rec_assessment_template_resolve", { p_vacancy_id: vacancyId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* ------------------------------------------------------------- assessments */

/** Opens (or returns) this interviewer's draft assessment for an interview. */
export async function openAssessment(interviewId: string, templateId?: string): Promise<string> {
  const { data, error } = await db.rpc("rec_assessment_open", {
    p_interview_id: interviewId,
    p_template_id: templateId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getAssessment(assessmentId: string) {
  return unwrap<RecAssessment>(
    await db.from("rec_assessments").select("*").eq("id", assessmentId).maybeSingle(),
  );
}

export async function listAnswers(assessmentId: string) {
  return unwrap<RecAssessmentAnswer[]>(
    await db.from("rec_assessment_answers").select("*").eq("assessment_id", assessmentId).order("sort_order"),
  );
}

export async function listAssessmentsForApplication(applicationId: string) {
  return unwrap<RecAssessment[]>(
    await db.from("rec_assessments").select("*").eq("application_id", applicationId).order("created_at"),
  );
}

export async function saveAnswer(input: {
  answer_id: string;
  answer_text?: string;
  evidence_text?: string;
  verification_status?: VerificationStatus;
  evidence_confidence?: EvidenceConfidence;
  score?: number | null;
  rationale?: string;
}) {
  const { error } = await db.rpc("rec_assessment_save_answer", {
    p_answer_id: input.answer_id,
    p_answer: input.answer_text ?? null,
    p_evidence: input.evidence_text ?? null,
    p_verification: input.verification_status ?? null,
    p_confidence: input.evidence_confidence ?? null,
    p_score: input.score ?? null,
    p_rationale: input.rationale ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface SubmitResult {
  ok: boolean;
  total_score: number;
  max_score: number;
  band: string;
  gates_passed: boolean;
}

export async function submitAssessment(input: {
  assessment_id: string;
  recommendation: string;
  strengths?: string;
  concerns?: string;
  risks?: string;
}): Promise<SubmitResult> {
  const { data, error } = await db.rpc("rec_assessment_submit", {
    p_assessment_id: input.assessment_id,
    p_recommendation: input.recommendation,
    p_strengths: input.strengths ?? null,
    p_concerns: input.concerns ?? null,
    p_risks: input.risks ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SubmitResult;
}

/** Controlled amendment of a locked assessment. Hiring authority only. */
export async function amendAnswer(input: {
  answer_id: string;
  reason: string;
  score?: number | null;
  answer_text?: string;
  evidence_text?: string;
  verification_status?: VerificationStatus;
  evidence_confidence?: EvidenceConfidence;
  rationale?: string;
}) {
  const { error } = await db.rpc("rec_assessment_amend", {
    p_answer_id: input.answer_id,
    p_reason: input.reason,
    p_score: input.score ?? null,
    p_answer: input.answer_text ?? null,
    p_evidence: input.evidence_text ?? null,
    p_verification: input.verification_status ?? null,
    p_confidence: input.evidence_confidence ?? null,
    p_rationale: input.rationale ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function listAmendments(assessmentId: string) {
  return unwrap<{ id: string; answer_id: string | null; before_value: Record<string, unknown>; after_value: Record<string, unknown>; reason: string; created_at: string }[]>(
    await db.from("rec_assessment_amendments").select("*").eq("assessment_id", assessmentId)
      .order("created_at", { ascending: false }),
  );
}

/* ---------------------------------------------------------------- CV claims */

export async function listClaims(applicationId: string) {
  return unwrap<RecCvClaim[]>(
    await db.from("rec_cv_claims").select("*").eq("application_id", applicationId).order("created_at"),
  );
}

export async function listClaimValidations(claimIds: string[]) {
  if (claimIds.length === 0) return [];
  return unwrap<RecClaimValidation[]>(
    await db.from("rec_claim_validations").select("*").in("claim_id", claimIds).order("created_at"),
  );
}

export async function recordClaim(input: {
  application_id: string;
  claim_type: string;
  claim_text: string;
  source_document?: string;
}): Promise<string> {
  const { data, error } = await db.rpc("rec_claim_record", {
    p_application_id: input.application_id,
    p_claim_type: input.claim_type,
    p_claim_text: input.claim_text,
    p_source_document: input.source_document ?? null,
    p_source_reference: null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function validateClaim(input: {
  claim_id: string;
  question_text: string;
  response_text?: string;
  evidence_text?: string;
  verification_status: VerificationStatus;
  confidence: EvidenceConfidence;
  assessment_id?: string;
}) {
  const { error } = await db.rpc("rec_claim_validate", {
    p_claim_id: input.claim_id,
    p_question: input.question_text,
    p_response: input.response_text ?? null,
    p_evidence: input.evidence_text ?? null,
    p_verification: input.verification_status,
    p_confidence: input.confidence,
    p_assessment_id: input.assessment_id ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ----------------------------------------------------- panel + comparison */

export interface PanelSummary {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  scale: number | null;
  spread: number;
  discrepancy: boolean;
  assessors: {
    assessment_id: string;
    assessor: string;
    total_score: number | null;
    max_score: number | null;
    band: string | null;
    gates_passed: boolean | null;
    recommendation: string | null;
    submitted_at: string | null;
  }[];
}

export async function panelSummary(applicationId: string): Promise<PanelSummary> {
  const { data, error } = await db.rpc("rec_assessment_panel_summary", { p_application_id: applicationId });
  if (error) throw new Error(error.message);
  return data as PanelSummary;
}

export interface ComparisonRow {
  application_id: string;
  application_no: string | null;
  candidate_id: string;
  candidate_name: string;
  application_status: string;
  assessed: boolean;
  assessment_count: number;
  total_score: number | null;
  max_score: number | null;
  percentage: number | null;
  band: string;
  gates_passed: boolean | null;
  recommendation: string | null;
  competencies: Record<string, { score: number | null; max: number; verification: string }>;
  evidence_confidence: string;
  tie_break: Record<string, number | null>;
}

export async function candidateComparison(vacancyId: string): Promise<ComparisonRow[]> {
  const { data, error } = await db.rpc("rec_candidate_comparison", { p_vacancy_id: vacancyId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ComparisonRow[];
}

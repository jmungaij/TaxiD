/**
 * Role suitability — reads the role's published requirement set (the active
 * assessment template) and every submitted competency assessment against it,
 * then presents who is suitable.
 *
 * Nothing here computes or stores a verdict: totals, bands and critical gates
 * are produced by `rec_assessment_submit` in the database. This module only
 * reads them and states plainly when a candidate has no assessment on file.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export interface RoleRequirement {
  sort_order: number;
  competency_code: string;
  competency_label: string;
  prompt: string;
  max_marks: number;
  critical_min: number | null;
  mandatory: boolean;
}

export interface RoleRequirementSet {
  template_id: string;
  template_key: string;
  version: number;
  title: string;
  status: string;
  total_marks: number;
  requirements: RoleRequirement[];
}

export async function loadRequirementSet(vacancyId: string): Promise<RoleRequirementSet | null> {
  const { data: templateId, error } = await db.rpc("rec_assessment_template_resolve", { p_vacancy_id: vacancyId });
  if (error) throw new Error(error.message);
  if (!templateId) return null;

  const template = unwrap<{ id: string; template_key: string; version: number; title: string; status: string; total_marks: number }>(
    await db.from("rec_assessment_templates").select("id, template_key, version, title, status, total_marks").eq("id", templateId).single(),
  );

  const items = unwrap<{ question_id: string; sort_order: number; max_marks: number; critical_min: number | null; mandatory: boolean }[]>(
    await db
      .from("rec_assessment_template_items")
      .select("question_id, sort_order, max_marks, critical_min, mandatory")
      .eq("template_id", templateId)
      .order("sort_order"),
  );

  const questions = items.length
    ? unwrap<{ id: string; competency_code: string; competency_label: string; prompt: string }[]>(
        await db.from("rec_question_bank").select("id, competency_code, competency_label, prompt").in("id", items.map((i) => i.question_id)),
      )
    : [];
  const byId = new Map(questions.map((q) => [q.id, q]));

  return {
    template_id: template.id,
    template_key: template.template_key,
    version: template.version,
    title: template.title,
    status: template.status,
    total_marks: template.total_marks,
    requirements: items.map((i) => {
      const q = byId.get(i.question_id);
      return {
        sort_order: i.sort_order,
        competency_code: q?.competency_code ?? "unknown",
        competency_label: q?.competency_label ?? "Unknown requirement",
        prompt: q?.prompt ?? "",
        max_marks: i.max_marks,
        critical_min: i.critical_min,
        mandatory: i.mandatory,
      };
    }),
  };
}

export interface CandidateAssessment {
  id: string;
  application_id: string;
  interview_id: string;
  status: string;
  total_score: number | null;
  max_score: number;
  percentage: number | null;
  band: string | null;
  gates_passed: boolean | null;
  gate_status: { competency: string; label: string; score: number | null; minimum: number; passed: boolean }[] | null;
  recommendation: string | null;
  submitted_at: string | null;
  assessor_name: string | null;
}

export interface RoleCandidate {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  stage: string;
  status: string;
  interview_id: string | null;
  assessment: CandidateAssessment | null;
  /** Score per requirement, keyed by competency code, from the saved answers. */
  scores: Record<string, { score: number | null; max_marks: number; verification_status: string | null }>;
}

export async function loadRoleCandidates(vacancyId: string): Promise<RoleCandidate[]> {
  const apps = unwrap<{ id: string; candidate_id: string; stage: string; status: string }[]>(
    await db.from("rec_applications").select("id, candidate_id, stage, status").eq("vacancy_id", vacancyId).limit(500),
  );
  if (!apps.length) return [];

  const [candidates, interviews, assessments] = await Promise.all([
    db.from("rec_candidates").select("id, full_name").in("id", apps.map((a) => a.candidate_id)),
    db.from("rec_interviews").select("id, application_id, scheduled_at").in("application_id", apps.map((a) => a.id)),
    db
      .from("rec_assessments")
      .select("id, application_id, interview_id, status, total_score, max_score, percentage, band, gates_passed, gate_status, recommendation, submitted_at, assessor_name")
      .in("application_id", apps.map((a) => a.id)),
  ]);

  const names = new Map((unwrap<{ id: string; full_name: string }[]>(candidates)).map((c) => [c.id, c.full_name]));
  const interviewRows = unwrap<{ id: string; application_id: string; scheduled_at: string | null }[]>(interviews);
  const assessmentRows = unwrap<CandidateAssessment[]>(assessments);

  const answers = assessmentRows.length
    ? unwrap<{ assessment_id: string; competency_code: string; score: number | null; max_marks: number; verification_status: string | null }[]>(
        await db
          .from("rec_assessment_answers")
          .select("assessment_id, competency_code, score, max_marks, verification_status")
          .in("assessment_id", assessmentRows.map((a) => a.id)),
      )
    : [];

  return apps
    .map((a) => {
      const assessment =
        assessmentRows.find((r) => r.application_id === a.id && r.status !== "draft") ??
        assessmentRows.find((r) => r.application_id === a.id) ??
        null;
      const scores: RoleCandidate["scores"] = {};
      for (const row of answers.filter((r) => r.assessment_id === assessment?.id)) {
        scores[row.competency_code] = { score: row.score, max_marks: row.max_marks, verification_status: row.verification_status };
      }
      return {
        application_id: a.id,
        candidate_id: a.candidate_id,
        candidate_name: names.get(a.candidate_id) ?? "Unnamed candidate",
        stage: a.stage,
        status: a.status,
        interview_id: assessment?.interview_id ?? interviewRows.find((i) => i.application_id === a.id)?.id ?? null,
        assessment,
        scores,
      };
    })
    .sort((x, y) => x.candidate_name.localeCompare(y.candidate_name));
}

export type SuitabilityVerdict = "SUITABLE" | "NOT_SUITABLE" | "NOT_ASSESSED" | "IN_PROGRESS";

export interface SuitabilityView {
  verdict: SuitabilityVerdict;
  reason: string;
}

/**
 * Presentation of the server's own result. A candidate is suitable only when a
 * submitted assessment passed every critical requirement and the assessor
 * recommended advancing. Anything less is stated as-is — never inferred.
 */
export function suitabilityOf(c: RoleCandidate): SuitabilityView {
  if (!c.assessment) return { verdict: "NOT_ASSESSED", reason: "No competency assessment on file for this role." };
  if (c.assessment.status === "draft") return { verdict: "IN_PROGRESS", reason: "Assessment started but not yet submitted." };
  const failed = (c.assessment.gate_status ?? []).filter((g) => !g.passed);
  if (failed.length) {
    return { verdict: "NOT_SUITABLE", reason: `Below the minimum on: ${failed.map((g) => g.label).join(", ")}.` };
  }
  if (c.assessment.recommendation && ["reject", "strong_reject"].includes(c.assessment.recommendation)) {
    return { verdict: "NOT_SUITABLE", reason: "Assessor recommended not advancing." };
  }
  if (c.assessment.recommendation === "hold") {
    return { verdict: "IN_PROGRESS", reason: "Assessor placed the candidate on hold pending further evidence." };
  }
  return { verdict: "SUITABLE", reason: "All required minimums met and the assessor recommended advancing." };
}

/* ------------------------------------------------------------------ *
 * Hiring approval
 *
 * The decision itself is governed by `rec_hiring_approval` in the
 * database: it refuses an approval unless a submitted assessment passed
 * every required minimum and the assessor recommended advancing, and it
 * records the evidence it relied on. This module only reads the record
 * and forwards the request.
 * ------------------------------------------------------------------ */

export interface HiringDecision {
  id: string;
  application_id: string;
  decision: "selected" | "not_selected" | string;
  reason_code: string | null;
  reason_notes: string | null;
  decided_at: string | null;
  decision_role: string | null;
}

export interface RoleOffer {
  id: string;
  application_id: string;
  offer_no: string;
  status: string;
}

export async function loadHiringDecisions(vacancyId: string): Promise<HiringDecision[]> {
  return unwrap<HiringDecision[]>(
    await db
      .from("rec_selection_decisions")
      .select("id, application_id, decision, reason_code, reason_notes, decided_at, decision_role")
      .eq("vacancy_id", vacancyId)
      .order("decided_at", { ascending: false })
      .limit(500),
  );
}

export async function loadRoleOffers(vacancyId: string): Promise<RoleOffer[]> {
  return unwrap<RoleOffer[]>(
    await db.from("rec_offers").select("id, application_id, offer_no, status").eq("vacancy_id", vacancyId).limit(500),
  );
}

/** Latest decision for an application, if any. */
export const decisionFor = (decisions: HiringDecision[], applicationId: string): HiringDecision | null =>
  decisions.find((d) => d.application_id === applicationId) ?? null;

export const DECLINE_REASONS = [
  { value: "below_required_standard", label: "Below the required standard on the role requirements" },
  { value: "evidence_not_verified", label: "Required evidence could not be verified" },
  { value: "stronger_candidate_selected", label: "A stronger candidate was selected" },
  { value: "role_withdrawn", label: "The role or requisition was withdrawn" },
  { value: "candidate_unavailable", label: "Candidate unavailable for the role terms" },
] as const;

export async function approveForOffer(applicationId: string, notes: string): Promise<{ decision_id: string }> {
  const { data, error } = await db.rpc("rec_hiring_approval", {
    p_application_id: applicationId,
    p_decision: "selected",
    p_notes: notes || null,
    p_reason_code: null,
  });
  if (error) throw new Error(error.message);
  return data as { decision_id: string };
}

export async function declineCandidate(
  applicationId: string,
  reasonCode: string,
  notes: string,
): Promise<{ decision_id: string }> {
  const { data, error } = await db.rpc("rec_hiring_approval", {
    p_application_id: applicationId,
    p_decision: "not_selected",
    p_notes: notes || null,
    p_reason_code: reasonCode,
  });
  if (error) throw new Error(error.message);
  return data as { decision_id: string };
}

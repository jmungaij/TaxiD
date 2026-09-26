/**
 * Recruitment 360 — Wave 2B: assessment blueprint + versioned paper snapshot.
 *
 * Authority model (all enforced in the database, mirrored here for the UI):
 *  - A vacancy declares the competencies it assesses in `rec_vacancy_competencies`,
 *    referencing the canonical `rec_competencies` register. Free-text competency
 *    labels on the vacancy are marketing copy, never assessment inputs.
 *  - A paper (`rec_assessment_templates`) is *composed* from that map and may only
 *    draw questions whose `publication_status = 'published'`. A mandatory
 *    competency with no published question is a coverage GAP and blocks activation.
 *  - Activation is a version snapshot: the previous active paper is retired, the
 *    item list is frozen by trigger, and a different person from the composer must
 *    activate it (four-eyes).
 *  - Issuing an attempt copies each question into `rec_profession_responses`, so a
 *    sitting is immune to later question-bank edits.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const DIFFICULTIES = ["foundation", "intermediate", "advanced", "expert"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type PaperStatus = "draft" | "pilot" | "active" | "retired";

export interface Competency {
  code: string;
  label: string;
  description: string | null;
  role_family: string;
  is_active: boolean;
}

export interface VacancyCompetency {
  competency_code: string;
  weight: number;
  min_marks: number | null;
  mandatory: boolean;
  sort_order: number;
}

export interface CoverageLine {
  competency_code: string;
  competency_label: string;
  weight: number;
  min_marks: number | null;
  mandatory: boolean;
  published_questions: number;
  available_marks: number;
}

export interface Coverage {
  vacancy_id: string;
  competencies: CoverageLine[];
  gaps: string[];
}

export interface PaperSummary {
  template_id: string;
  template_key: string;
  version: number;
  title: string;
  status: PaperStatus;
  total_marks: number;
  vacancy_id: string | null;
  vacancy_title: string | null;
  vacancy_no: string | null;
  blueprint_id: string | null;
  blueprint_version: number | null;
  coverage: Coverage | null;
  created_by: string | null;
  activated_by: string | null;
  activated_at: string | null;
  created_at: string;
  question_count: number;
  attempts: number;
}

export interface PaperItem {
  item_id: string;
  question_id: string;
  question_no: string | null;
  question_key: string;
  question_version: number;
  question_type: string;
  competency_code: string;
  competency_label: string;
  difficulty: Difficulty;
  prompt: string;
  max_marks: number;
  critical_min: number | null;
  mandatory: boolean;
  sort_order: number;
  has_answer_key: boolean;
  rubric: unknown;
}

export interface PaperDetail extends Omit<PaperSummary, "question_count" | "attempts" | "vacancy_title" | "vacancy_no" | "created_by" | "activated_by" | "activated_at" | "created_at"> {
  items: PaperItem[];
}

export interface AttemptReviewResponse {
  response_id: string;
  question_key: string;
  question_no: string | null;
  question_type: string;
  difficulty: string | null;
  prompt: string | null;
  expected_evidence: string | null;
  rubric: unknown;
  competency_code: string;
  competency_label: string;
  max_marks: number;
  critical_min: number | null;
  mandatory: boolean;
  scoring_mode: string;
  response_text: string | null;
  selected_options: string[] | null;
  work_sample_document_id: string | null;
  auto_score: number | null;
  score: number | null;
  anchor_level: string | null;
  rationale: string | null;
  scored_at: string | null;
}

export interface CompetencyBreakdownLine {
  competency_code: string;
  competency_label: string;
  questions: number;
  max_marks: number;
  score: number | null;
  critical_min: number | null;
  unscored: number;
}

export interface AttemptReview {
  attempt_id: string;
  application_id: string;
  status: string;
  attempt_no: number;
  template_key: string;
  template_version: number;
  issued_at: string;
  expires_at: string;
  submitted_at: string | null;
  total_score: number | null;
  max_score: number | null;
  percentage: number | null;
  band: string | null;
  gates_passed: boolean | null;
  gate_status: unknown;
  reviewed_at: string | null;
  candidate_name: string | null;
  candidate_no: string | null;
  responses: AttemptReviewResponse[];
  competency_breakdown: CompetencyBreakdownLine[];
}

export interface ApplicationReviewRecord {
  application_id: string;
  application_no: string;
  stage: string;
  status: string;
  applied_at: string;
  review_flagged: boolean;
  review_flag_reason: string | null;
  knockout_flagged: boolean;
  vacancy: {
    vacancy_id: string; vacancy_no: string; title: string; public_slug: string | null;
    employment_type: string | null; qualification_level: string | null;
  };
  candidate: {
    candidate_id: string; candidate_no: string; full_name: string;
    email: string | null; phone: string | null; location: string | null;
  };
  education: {
    status: string | null;
    completed_years: number | null;
    consolidated_transcript: boolean;
    qualification_level: string | null;
    qualifications: { qualification: string; institution: string | null; award_year: number | null; kind: string | null; verified: boolean }[];
    gate_events: { stage: string; allowed: boolean; code: string | null; outstanding: unknown; created_at: string }[];
  };
  attachment: Record<string, { answer: string | null; classification: string | null; knockout_failed: boolean }>;
  answers: { question_key: string; prompt: string | null; kind: string | null; classification: string | null; answer: string | null; score: number | null; knockout_failed: boolean }[];
  documents: {
    document_id: string; doc_key: string | null; doc_type: string; file_name: string;
    academic_year: number | null; consolidated: boolean; version_no: number;
    upload_status: string | null; verification_status: string | null;
    review_reason: string | null; created_at: string;
  }[];
  assessments: AttemptReview[];
  active_paper: { template_id: string; template_key: string; version: number; total_marks: number } | null;
}

/* --------------------------------- reads --------------------------------- */

export async function listCompetencies(): Promise<Competency[]> {
  const { data, error } = await supabase
    .from("rec_competencies")
    .select("code,label,description,role_family,is_active")
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Competency[];
}

export async function listVacancyCompetencies(vacancyId: string): Promise<VacancyCompetency[]> {
  const { data, error } = await db
    .from("rec_vacancy_competencies")
    .select("competency_code,weight,min_marks,mandatory,sort_order")
    .eq("vacancy_id", vacancyId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as VacancyCompetency[];
}

export async function coverageFor(vacancyId: string): Promise<Coverage> {
  return unwrap(await db.rpc("rec_assessment_coverage", { p_vacancy: vacancyId }));
}

export async function listPapers(vacancyId?: string): Promise<PaperSummary[]> {
  return (await unwrap(await db.rpc("rec_assessment_papers", { p_vacancy: vacancyId ?? null }))) ?? [];
}

export async function paperDetail(templateId: string): Promise<PaperDetail | null> {
  return unwrap(await db.rpc("rec_assessment_paper_detail", { p_template: templateId }));
}

export async function attemptReview(attemptId: string): Promise<AttemptReview | null> {
  return unwrap(await db.rpc("rec_profession_attempt_review", { p_attempt: attemptId }));
}

export async function applicationReviewRecord(applicationId: string): Promise<ApplicationReviewRecord | null> {
  return unwrap(await db.rpc("rec_application_review_record", { p_application: applicationId }));
}

/* --------------------------------- writes -------------------------------- */

export async function setVacancyCompetencies(vacancyId: string, items: VacancyCompetency[]) {
  return unwrap(await db.rpc("rec_vacancy_competencies_set", {
    p_vacancy: vacancyId,
    p_items: items.map((i, idx) => ({ ...i, sort_order: i.sort_order ?? idx })),
  }));
}

export async function composePaper(
  vacancyId: string,
  opts: { perCompetency?: number | null; difficulties?: Difficulty[] | null } = {},
): Promise<{ template_id: string; version: number; total_marks: number; question_count: number; coverage: Coverage }> {
  return unwrap(await db.rpc("rec_assessment_blueprint_compose", {
    p_vacancy: vacancyId,
    p_per_competency: opts.perCompetency ?? null,
    p_difficulties: opts.difficulties?.length ? opts.difficulties : null,
  }));
}

export async function activatePaper(templateId: string) {
  return unwrap(await db.rpc("rec_assessment_template_activate", { p_template: templateId }));
}

/* ------------------------------ pure helpers ----------------------------- */

/** Mandatory competencies with no published question — activation blockers. */
export function coverageGaps(coverage: Coverage | null | undefined): string[] {
  if (!coverage) return [];
  return coverage.competencies
    .filter((c) => c.mandatory && c.published_questions === 0)
    .map((c) => c.competency_code);
}

/** Coverage is only ready when every mandatory competency has publishable marks. */
export function canActivatePaper(
  paper: Pick<PaperSummary, "status" | "question_count" | "coverage">,
  opts: { composedBySelf?: boolean } = {},
): { allowed: boolean; reason?: string } {
  if (paper.status !== "draft") return { allowed: false, reason: `Only a draft paper can be activated (this one is ${paper.status}).` };
  if (paper.question_count === 0) return { allowed: false, reason: "This paper has no questions." };
  const gaps = coverageGaps(paper.coverage);
  if (gaps.length > 0) return { allowed: false, reason: `No published question for: ${gaps.join(", ")}.` };
  if (opts.composedBySelf) return { allowed: false, reason: "Four-eyes control: you composed this paper, so another reviewer must activate it." };
  return { allowed: true };
}

/** Marks a competency contributes, weighted by the vacancy's declared weight. */
export function weightedShare(lines: CoverageLine[]): { competency_code: string; share: number }[] {
  const total = lines.reduce((s, l) => s + (Number(l.weight) || 0), 0);
  if (total <= 0) return lines.map((l) => ({ competency_code: l.competency_code, share: 0 }));
  return lines.map((l) => ({
    competency_code: l.competency_code,
    share: Math.round(((Number(l.weight) || 0) / total) * 1000) / 10,
  }));
}

/** Per-competency attainment, never inventing a figure for unscored work. */
export function competencyAttainment(line: CompetencyBreakdownLine): number | null {
  if (line.score === null || !line.max_marks) return null;
  return Math.round((Number(line.score) / Number(line.max_marks)) * 1000) / 10;
}

/** A competency fails when it is scored and falls under its critical minimum. */
export function competencyGateFailed(line: CompetencyBreakdownLine): boolean {
  if (line.critical_min === null || line.score === null) return false;
  return Number(line.score) < Number(line.critical_min);
}

/** Which HR action the attempt is waiting for. */
export function attemptNextAction(attempt: Pick<AttemptReview, "status" | "responses">): string {
  switch (attempt.status) {
    case "issued": return "Awaiting the candidate to start";
    case "in_progress": return "Candidate is answering";
    case "submitted": {
      const unscored = attempt.responses.filter((r) => r.score === null).length;
      return unscored > 0 ? `Score ${unscored} response(s)` : "Finalise the score";
    }
    case "scored": return "Scored — ready for panel review";
    case "expired": return "Link expired — reissue if still required";
    default: return "No action";
  }
}

export function difficultyLabel(d: string | null | undefined): string {
  switch (d) {
    case "foundation": return "Foundation";
    case "intermediate": return "Intermediate";
    case "advanced": return "Advanced";
    case "expert": return "Expert";
    default: return "Unclassified";
  }
}

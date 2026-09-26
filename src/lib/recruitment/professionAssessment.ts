/**
 * Recruitment 360 — Profession assessment (sat *after* application).
 *
 * Architecture decisions closed in Wave 1.5 discovery:
 *  - `rec_assessments` is assessor/interview-bound (`interview_id` and
 *    `assessor_user_id` are NOT NULL) — it models a panel scorecard, not a
 *    candidate sitting. Candidate-sat attempts therefore live in their own
 *    aggregate: `rec_profession_attempts` + `rec_profession_responses`.
 *  - The attempt link (single-use token) is the candidate credential, so the
 *    load/save/submit RPCs are anon-executable and token-scoped; issuing and
 *    scoring stay staff-only.
 *  - Work samples reuse the existing candidate document control storage
 *    (`rec_candidate_documents` + the private `recruitment-applications`
 *    bucket) — no new bucket, no parallel evidence store.
 *  - Questions may be AI-drafted but must pass SME approval and a separate
 *    publication step (four-eyes) before they can be placed on a paper.
 *
 * The client never computes a stored score: totals, bands and critical gates
 * are produced by `rec_profession_attempt_score` / `_submit` on the server.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Document key used when a work sample is stored in candidate document control. */
export const workSampleDocKey = (questionKey: string) => `work_sample:${questionKey}`;

export type QuestionPublicationStatus =
  | "draft" | "sme_review" | "sme_approved" | "published" | "rejected" | "retired";

export type QuestionReviewAction = "submit" | "sme_approve" | "publish" | "reject" | "retire";

export type AttemptStatus =
  | "issued" | "in_progress" | "submitted" | "scored" | "expired" | "void";

export interface ProfessionQuestion {
  question_id: string;
  question_key: string;
  question_type: string;
  competency_code: string;
  competency_label: string;
  max_marks: number;
  mandatory: boolean;
  sort_order: number;
  prompt: string;
  scenario: string | null;
  expected_evidence: string | null;
  options: { key: string; label: string }[] | null;
  response_text: string | null;
  selected_options: string[] | null;
  work_sample_document_id: string | null;
}

export interface ProfessionAttempt {
  found: boolean;
  attempt_id?: string;
  status?: AttemptStatus;
  template_key?: string;
  template_version?: number;
  max_score?: number;
  expires_at?: string;
  submitted_at?: string | null;
  questions?: ProfessionQuestion[];
}

export interface AttemptGate {
  question_key: string;
  competency: string;
  minimum: number;
  score: number | null;
  passed: boolean;
}

export interface AttemptScoreResult {
  attempt_id: string;
  status: AttemptStatus;
  total_score: number;
  max_score: number;
  percentage: number | null;
  band: string | null;
  gates_passed: boolean | null;
  gate_status: AttemptGate[];
  unscored: number;
}

/* ------------------------------- staff side ------------------------------ */

/** Governs one question through draft → SME review → approval → publication. */
export async function reviewQuestion(
  questionId: string, action: QuestionReviewAction, note?: string,
) {
  return unwrap(await db.rpc("rec_question_review_action", {
    p_question: questionId, p_action: action, p_note: note ?? null,
  }));
}

/** Issues a paper for a submitted application and returns the candidate link token. */
export async function issueAttempt(
  applicationId: string, templateId?: string, validDays = 7,
): Promise<{ attempt_id: string; attempt_token: string; attempt_no: number; max_score: number; expires_at: string }> {
  return unwrap(await db.rpc("rec_profession_attempt_issue", {
    p_application: applicationId,
    p_template: templateId ?? null,
    p_valid_days: validDays,
  }));
}

/** Records rubric scores. `finalise` refuses while any answer is unscored. */
export async function scoreAttempt(
  attemptId: string,
  scores: { question_key: string; score: number; anchor_level?: string; rationale: string }[],
  finalise = false,
): Promise<AttemptScoreResult> {
  return unwrap(await db.rpc("rec_profession_attempt_score", {
    p_attempt: attemptId, p_scores: scores, p_finalise: finalise,
  }));
}

/* ----------------------------- candidate side ---------------------------- */

export async function loadAttempt(token: string): Promise<ProfessionAttempt> {
  return unwrap(await db.rpc("rec_profession_attempt_load", { p_token: token }));
}

export async function saveAttempt(
  token: string,
  responses: {
    question_key: string;
    response_text?: string | null;
    selected_options?: string[] | null;
    work_sample_document_id?: string | null;
  }[],
): Promise<{ saved: number; status: AttemptStatus }> {
  return unwrap(await db.rpc("rec_profession_attempt_save", {
    p_token: token, p_responses: responses,
  }));
}

export async function submitAttempt(
  token: string,
): Promise<{ status: AttemptStatus; submitted_at?: string; awaiting_review?: boolean; already_submitted?: boolean }> {
  return unwrap(await db.rpc("rec_profession_attempt_submit", { p_token: token }));
}

/* ------------------------------ pure helpers ----------------------------- */

/** A question is answered when it carries text, a selection, or a work sample. */
export function isAnswered(q: Pick<ProfessionQuestion, "response_text" | "selected_options" | "work_sample_document_id">) {
  return (
    (q.response_text ?? "").trim().length > 0 ||
    (Array.isArray(q.selected_options) && q.selected_options.length > 0) ||
    !!q.work_sample_document_id
  );
}

/** Mandatory question keys still unanswered — mirrors the server's submit check. */
export function outstandingQuestions(questions: ProfessionQuestion[]): string[] {
  return questions.filter((q) => q.mandatory && !isAnswered(q)).map((q) => q.question_key);
}

export function canSubmitAttempt(attempt: ProfessionAttempt): { allowed: boolean; reason?: string } {
  if (!attempt.found) return { allowed: false, reason: "This assessment link is not recognised." };
  if (attempt.status === "expired") return { allowed: false, reason: "This assessment link has expired." };
  if (attempt.status === "submitted" || attempt.status === "scored") {
    return { allowed: false, reason: "This assessment has already been submitted." };
  }
  const missing = outstandingQuestions(attempt.questions ?? []);
  if (missing.length > 0) {
    return { allowed: false, reason: `${missing.length} required question(s) still unanswered.` };
  }
  return { allowed: true };
}

/** Presentation-only band mapping; the stored band always comes from the server. */
export function bandLabel(band: string | null | undefined): string {
  switch (band) {
    case "exceptional": return "Exceptional";
    case "strong": return "Strong";
    case "competent": return "Competent";
    case "borderline": return "Borderline";
    case "not_recommended": return "Not recommended";
    default: return "Not scored";
  }
}

export function questionStatusLabel(status: QuestionPublicationStatus): string {
  switch (status) {
    case "draft": return "Draft";
    case "sme_review": return "Awaiting subject-matter review";
    case "sme_approved": return "Approved — awaiting publication";
    case "published": return "Published";
    case "rejected": return "Returned for rework";
    case "retired": return "Retired";
  }
}

/** Which lifecycle actions a viewer may take next, given the question's state. */
export function availableActions(
  status: QuestionPublicationStatus,
): QuestionReviewAction[] {
  switch (status) {
    case "draft":
    case "rejected": return ["submit"];
    case "sme_review": return ["sme_approve", "reject"];
    case "sme_approved": return ["publish", "reject"];
    case "published": return ["retire"];
    case "retired": return [];
  }
}

/**
 * Recruitment 360 — import reconciliation data layer.
 *
 * Reads the import audit trail (runs + per-document items), the idempotency
 * report RPC, the evaluation completeness view, and the conflict adjudication
 * register. Writes go through governed surfaces only: the AI adjudication edge
 * function (recommendation) and the rec_adjudication_decide RPC (human decision).
 */
import { supabase } from "@/integrations/supabase/client";
import type { CompletenessRow } from "./completeness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* --------------------------------- types --------------------------------- */

export interface ImportRun {
  id: string;
  run_no: string;
  kind: string;
  label: string;
  initiated_by: string | null;
  initiated_by_label: string;
  source_description: string | null;
  vacancy_id: string | null;
  status: "running" | "completed" | "completed_with_conflicts" | "failed";
  stats: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface ImportRunItem {
  id: string;
  run_id: string;
  item_no: string;
  item_kind: string;
  extracted_name: string | null;
  extracted_id_number: string | null;
  extracted_payload: Record<string, unknown>;
  match_outcome: "created" | "updated" | "matched" | "skipped" | "conflict" | "ambiguous";
  match_confidence: number | null;
  matched_candidate_id: string | null;
  matched_application_id: string | null;
  target_table: string | null;
  target_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface IdempotencyReport {
  run: ImportRun;
  summary: {
    created: number;
    updated: number;
    matched: number;
    skipped: number;
    conflicts: number;
    ambiguous: number;
  };
  by_kind: Record<string, number>;
  items: ImportRunItem[];
  constraint_conflicts: ImportRunItem[];
}

export interface Adjudication {
  id: string;
  application_id: string;
  candidate_id: string | null;
  candidate_name?: string;
  subject: string;
  conflict_summary: string;
  evaluation_ids: string[];
  ai_recommendation: string | null;
  ai_rationale: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  ai_generated_at: string | null;
  hr_decision: string | null;
  hr_rationale: string | null;
  decided_by_label: string | null;
  decided_at: string | null;
  status: "pending" | "ai_recommended" | "decided";
  created_at: string;
}

export const HR_DECISIONS: { value: string; label: string }[] = [
  { value: "uphold_advance", label: "Uphold advance recommendation" },
  { value: "uphold_reject", label: "Uphold reject recommendation" },
  { value: "blend_scores", label: "Blend panel scores" },
  { value: "re_interview", label: "Order a fresh interview" },
  { value: "request_evidence", label: "Request further evidence" },
];

/* -------------------------------- loaders -------------------------------- */

export async function listImportRuns(): Promise<ImportRun[]> {
  const { data, error } = await db
    .from("rec_import_runs")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportRun[];
}

export async function loadIdempotencyReport(runId: string): Promise<IdempotencyReport> {
  const { data, error } = await db.rpc("rec_import_idempotency_report", { p_run_id: runId });
  if (error) throw new Error(error.message);
  return data as IdempotencyReport;
}

export async function listCompleteness(vacancyId?: string): Promise<CompletenessRow[]> {
  let q = db.from("rec_evaluation_completeness").select("*");
  if (vacancyId) q = q.eq("vacancy_id", vacancyId);
  const { data, error } = await q.order("candidate_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CompletenessRow[];
}

export async function listAdjudications(): Promise<Adjudication[]> {
  const { data, error } = await db
    .from("rec_conflict_adjudications")
    .select("*, rec_candidates(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as Adjudication),
    candidate_name: (row.rec_candidates as { full_name?: string } | null)?.full_name ?? undefined,
  }));
}

/* -------------------------------- actions -------------------------------- */

/** Ask the AI HR practitioner to reason over an open conflict (server-side). */
export async function requestAiAdjudication(adjudicationId: string) {
  const { data, error } = await supabase.functions.invoke("rec-adjudicate-conflict", {
    body: { adjudication_id: adjudicationId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as {
    ok: boolean;
    recommendation: string;
    confidence: number;
    rationale: string;
    key_factors: string[];
  };
}

/** Record the final human decision on a conflict. */
export async function decideAdjudication(
  id: string,
  decision: string,
  rationale: string,
  decidedByLabel?: string,
) {
  const { data, error } = await db.rpc("rec_adjudication_decide", {
    p_id: id,
    p_decision: decision,
    p_rationale: rationale,
    p_decided_by_label: decidedByLabel ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------- resumable import jobs ------------------------- */

export interface ImportJobStep {
  id: string;
  run_id: string;
  step_no: number;
  step_key: string;
  label: string;
  handler: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ResumePlan {
  run: ImportRun & { locked_until: string | null; paused_reason: string | null };
  steps: ImportJobStep[];
  next_step_key: string | null;
  resumable: boolean;
  counts: { total: number; completed: number; pending: number; failed: number; running: number; skipped: number };
}

/** Resume plan for a run: steps, counts and the next actionable step. */
export async function loadResumePlan(runId: string): Promise<ResumePlan> {
  const { data, error } = await db.rpc("rec_import_resume_plan", { p_run_id: runId });
  if (error) throw new Error(error.message);
  return data as ResumePlan;
}

/** Reset failed steps to pending and clear any pause so the worker can resume. */
export async function retryFailedSteps(runId: string) {
  const { data, error } = await db.rpc("rec_import_retry_failed", { p_run_id: runId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; steps_reset: number };
}

export interface WorkerOutcome {
  ok: boolean;
  paused?: boolean;
  throttled?: boolean;
  processed: number;
  remaining: number;
  exhausted: number;
  run_status: string;
  outcomes: { step_key: string; ok: boolean; error?: string; paused?: boolean; throttled?: boolean }[];
}

/** Invoke the resumable worker (bounded batch, single-flight). */
export async function runImportWorker(runId: string, resume = false): Promise<WorkerOutcome> {
  const { data, error } = await supabase.functions.invoke("rec-import-worker", {
    body: { run_id: runId, resume },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as WorkerOutcome;
}

/* ---------------------- enrichment status & audit ------------------------ */

export interface EnrichmentStatusRow {
  candidate_id: string;
  candidate_no: string;
  full_name: string;
  has_email: boolean;
  has_phone: boolean;
  has_headline: boolean;
  has_summary: boolean;
  has_location: boolean;
  has_experience_years: boolean;
  has_current_employer: boolean;
  experience_count: number;
  skills_count: number;
  qualifications_count: number;
  has_cover_letter: boolean;
  enrichment_verified_at: string | null;
  profile_updated_at: string;
  last_enriched_at: string | null;
  audit_events: number;
}

/** Per-candidate CV/cover-letter enrichment status (server-computed view). */
export async function listEnrichmentStatus(): Promise<EnrichmentStatusRow[]> {
  const { data, error } = await db.from("rec_candidate_enrichment_status").select("*").order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrichmentStatusRow[];
}

export interface EnrichmentAuditRow {
  id: string;
  created_at: string;
  table_name: string;
  record_id: string | null;
  candidate_id: string | null;
  action: "insert" | "update";
  changes: Record<string, unknown>;
  actor_user_id: string | null;
  actor_label: string | null;
  source: string;
  run_id: string | null;
  step_key: string | null;
}

/** Enrichment audit trail, newest first; optionally scoped to one candidate. */
export async function listEnrichmentAudit(candidateId?: string, limit = 200): Promise<EnrichmentAuditRow[]> {
  let q = db.from("rec_enrichment_audit").select("*").order("created_at", { ascending: false }).limit(limit);
  if (candidateId) q = q.eq("candidate_id", candidateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrichmentAuditRow[];
}

/** Mark a candidate's enriched profile as human-verified. */
export async function markEnrichmentVerified(candidateId: string) {
  const { data, error } = await db.rpc("rec_enrichment_mark_verified", { p_candidate_id: candidateId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; verified_at: string };
}

/* ------------------------- conflict resolution --------------------------- */

/** Load one adjudication with the candidate's name. */
export async function getAdjudication(id: string): Promise<Adjudication> {
  const { data, error } = await db
    .from("rec_conflict_adjudications")
    .select("*, rec_candidates(full_name)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as Adjudication),
    candidate_name: (row.rec_candidates as { full_name?: string } | null)?.full_name ?? undefined,
  };
}

export interface ConflictEvaluation {
  id: string;
  overall_score: number | null;
  recommendation: string | null;
  strengths: string | null;
  concerns: string | null;
  evidence: string | null;
  comments: string | null;
  status: string;
  submitted_at: string | null;
  criteria_scores: { criterion?: string; score?: number; note?: string }[];
  evaluator_name: string | null;
  interview_stage: string | null;
  interview_at: string | null;
  interview_location: string | null;
  interview_mode: string | null;
}

/** The competing evaluation forms behind a conflict, with panelist + interview context. */
export async function loadConflictEvaluations(adjudicationId: string): Promise<ConflictEvaluation[]> {
  const adj = await getAdjudication(adjudicationId);
  const ids = adj.evaluation_ids ?? [];
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("rec_evaluations")
    .select(
      "*, staff_members!rec_evaluations_evaluator_staff_id_fkey(full_name), rec_interviews!rec_evaluations_interview_id_fkey(scheduled_at, location, interview_stage, mode)",
    )
    .in("id", ids)
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const staff = row.staff_members as { full_name?: string } | null;
    const interview = row.rec_interviews as {
      scheduled_at?: string; location?: string; interview_stage?: string; mode?: string;
    } | null;
    return {
      id: row.id as string,
      overall_score: (row.overall_score as number | null) ?? null,
      recommendation: (row.recommendation as string | null) ?? null,
      strengths: (row.strengths as string | null) ?? null,
      concerns: (row.concerns as string | null) ?? null,
      evidence: (row.evidence as string | null) ?? null,
      comments: (row.comments as string | null) ?? null,
      status: row.status as string,
      submitted_at: (row.submitted_at as string | null) ?? null,
      criteria_scores: Array.isArray(row.criteria_scores) ? (row.criteria_scores as ConflictEvaluation["criteria_scores"]) : [],
      evaluator_name: staff?.full_name ?? null,
      interview_stage: interview?.interview_stage ?? null,
      interview_at: interview?.scheduled_at ?? null,
      interview_location: interview?.location ?? null,
      interview_mode: interview?.mode ?? null,
    };
  });
}

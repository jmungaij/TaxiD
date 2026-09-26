/**
 * Recruitment 360 — data access.
 *
 * Every mutation that changes a candidate's position in the pipeline also
 * writes an audit event, so the trail is produced by the same code path that
 * produced the change. RLS remains the enforcement boundary: this module only
 * decides what the interface asks for.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  RecApplication,
  RecAuditEvent,
  RecCandidate,
  RecEvaluation,
  RecInterview,
  RecOffer,
  RecOnboardingCase,
  RecOnboardingTask,
  RecRequisition,
  RecVacancy,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

async function audit(
  action: string,
  objectType: string,
  objectId: string | null,
  context: Record<string, unknown> = {},
) {
  // Audit failures must never silently swallow a successful mutation, but they
  // also must not roll back the user's work — surface via console for ops.
  const { error } = await db.from("rec_audit_events").insert({
    action,
    object_type: objectType,
    object_id: objectId,
    context,
  });
  if (error) console.warn("[recruitment] audit write failed:", error.message);
}

function nextRef(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

/* ----------------------------- requisitions ----------------------------- */

export async function listRequisitions(): Promise<RecRequisition[]> {
  return unwrap<RecRequisition[]>(
    await db.from("rec_requisitions").select("*").order("created_at", { ascending: false }),
  );
}

export async function createRequisition(input: Partial<RecRequisition> & { title: string }) {
  const payload = { ...input, requisition_no: input.requisition_no ?? nextRef("REQ") };
  const { data, error } = await db.from("rec_requisitions").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  await audit("requisition_created", "requisition", data.id, { title: data.title });
  return data as RecRequisition;
}

export async function setRequisitionStatus(id: string, status: string, notes?: string) {
  const patch: Record<string, unknown> = { status, decision_notes: notes ?? null };
  if (status === "submitted") patch.submitted_at = new Date().toISOString();
  if (status === "approved") patch.approved_at = new Date().toISOString();
  const { error } = await db.from("rec_requisitions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("requisition_status_changed", "requisition", id, { status });
}

/* ------------------------------- vacancies ------------------------------ */

export async function listVacancies(): Promise<RecVacancy[]> {
  return unwrap<RecVacancy[]>(
    await db.from("rec_vacancies").select("*").order("opened_at", { ascending: false }),
  );
}

export async function getVacancy(id: string): Promise<RecVacancy | null> {
  const { data, error } = await db.from("rec_vacancies").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RecVacancy) ?? null;
}

export async function createVacancy(input: Partial<RecVacancy> & { title: string }) {
  const payload = { ...input, vacancy_no: input.vacancy_no ?? nextRef("VAC") };
  const { data, error } = await db.from("rec_vacancies").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  await audit("vacancy_created", "vacancy", data.id, { title: data.title });
  return data as RecVacancy;
}

export async function updateVacancy(id: string, patch: Partial<RecVacancy>) {
  const { error } = await db.from("rec_vacancies").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("vacancy_updated", "vacancy", id, patch as Record<string, unknown>);
}

/** Active org positions a vacancy can be linked to before publication. */
export interface RecPositionOption {
  id: string;
  title: string;
  code: string;
  unit_id: string | null;
}

export async function listPositionOptions(): Promise<RecPositionOption[]> {
  return unwrap<RecPositionOption[]>(
    await db.from("org_positions").select("id, title, code, unit_id").eq("status", "active").order("title"),
  );
}

export interface PublicationResult {
  ok: boolean;
  status: "PUBLISHED" | "PAUSED" | "PUBLICATION_FAILED" | "PUBLISHED_WITH_RECONCILIATION_PENDING";
  careers_visible?: boolean;
  blockers?: string[];
}

/**
 * Publication is a server-authoritative transition: `rec_vacancy_set_publication`
 * validates every public-eligibility gate (approved + open + slug + org position),
 * writes the publication audit chain and confirms the vacancy is actually visible
 * to the public careers projection before reporting PUBLISHED. The client never
 * writes `publication_status` directly — that is what previously allowed a
 * "Published" badge on a vacancy the public API legitimately excluded.
 */
export async function publishVacancy(id: string, publish: boolean): Promise<PublicationResult> {
  const { data, error } = await db.rpc("rec_vacancy_set_publication", {
    p_vacancy: id,
    p_publish: publish,
    p_reason: "",
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as PublicationResult;
  if (!result.ok) {
    throw new Error(
      `Cannot publish this vacancy yet: ${(result.blockers ?? []).join(" | ") || "publication gates not satisfied."}`,
    );
  }
  return result;
}

/** Governed approval — required before a vacancy can ever become public. */
export async function approveVacancy(id: string, note = ""): Promise<void> {
  const { error } = await db.rpc("rec_vacancy_approve", { p_vacancy: id, p_note: note });
  if (error) throw new Error(error.message);
}


/* ------------------------------- candidates ----------------------------- */

export async function listCandidates(): Promise<RecCandidate[]> {
  return unwrap<RecCandidate[]>(
    await db.from("rec_candidates").select("*").order("updated_at", { ascending: false }).limit(400),
  );
}

export async function createCandidate(input: Partial<RecCandidate> & { full_name: string }) {
  const payload = { ...input, candidate_no: input.candidate_no ?? nextRef("CAN") };
  const { data, error } = await db.from("rec_candidates").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  await audit("candidate_created", "candidate", data.id, { source: data.source });
  return data as RecCandidate;
}

export async function updateCandidate(id: string, patch: Partial<RecCandidate>) {
  const { error } = await db.from("rec_candidates").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("candidate_updated", "candidate", id, patch as Record<string, unknown>);
}

export async function listCandidateSkills(candidateId: string) {
  return unwrap<{ id: string; skill: string; proficiency: string | null; years: number | null }[]>(
    await db.from("rec_candidate_skills").select("*").eq("candidate_id", candidateId),
  );
}

export async function addCandidateSkill(candidateId: string, skill: string, proficiency?: string) {
  const { error } = await db
    .from("rec_candidate_skills")
    .insert({ candidate_id: candidateId, skill, proficiency: proficiency ?? null });
  if (error) throw new Error(error.message);
}

/* ------------------------------ applications ---------------------------- */

export async function listApplications(vacancyId?: string): Promise<RecApplication[]> {
  let q = db.from("rec_applications").select("*").order("last_activity_at", { ascending: false });
  if (vacancyId) q = q.eq("vacancy_id", vacancyId);
  return unwrap<RecApplication[]>(await q);
}

export async function createApplication(input: {
  candidate_id: string;
  vacancy_id: string;
  source?: string;
  cover_letter?: string;
  ai_match_score?: number;
}) {
  const payload = { ...input, application_no: nextRef("APP") };
  const { data, error } = await db.from("rec_applications").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  await audit("application_created", "application", data.id, { vacancy_id: input.vacancy_id });
  return data as RecApplication;
}

/**
 * Single writer of application stage. Stage timestamps and the audit entry move
 * together so pipeline analytics and the trail can never disagree.
 */
export async function moveApplicationStage(
  id: string,
  stage: string,
  opts: { reason?: string; nextAction?: string; nextActionDue?: string | null } = {},
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    stage,
    stage_entered_at: now,
    last_activity_at: now,
    next_action: opts.nextAction ?? null,
    next_action_due: opts.nextActionDue ?? null,
  };
  if (stage === "rejected" || stage === "withdrawn") {
    patch.rejection_reason = opts.reason ?? null;
    patch.status = "closed";
  }
  const { error } = await db.from("rec_applications").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("application_stage_changed", "application", id, { stage, reason: opts.reason ?? null });
}

export async function recordScreening(input: {
  application_id: string;
  human_decision: "advance" | "reject" | "hold";
  human_score?: number;
  decision_notes?: string;
  ai_score?: number;
  ai_recommendation?: "advance" | "review" | "reject";
  ai_rationale?: string;
  ai_evidence?: unknown[];
}) {
  const { error } = await db.from("rec_screenings").insert({
    ...input,
    ai_evidence: input.ai_evidence ?? [],
    human_decision_at: new Date().toISOString(),
    status: "completed",
  });
  if (error) throw new Error(error.message);
  await audit("screening_recorded", "application", input.application_id, {
    human_decision: input.human_decision,
    ai_recommendation: input.ai_recommendation ?? null,
  });
  if (input.human_decision === "advance") await moveApplicationStage(input.application_id, "shortlisted");
  if (input.human_decision === "reject")
    await moveApplicationStage(input.application_id, "rejected", { reason: input.decision_notes });
}

/* ------------------------------- interviews ----------------------------- */

export interface RecPanelMember {
  staff_id: string;
  panel_role?: string;
}

export interface RecPanelRow {
  id: string;
  interview_id: string;
  staff_id: string;
  panel_role: string;
}

export interface RecStaffOption {
  id: string;
  full_name: string;
  work_email: string | null;
}

export interface RecInterviewConflicts {
  candidate: string[];
  panel: string[];
}

/** Friendly message for the `scheduling_conflict: {...}` error the RPCs raise. */
export const CONFLICT_PREFIX = "scheduling_conflict";

export function isConflictError(message: string) {
  return message.includes(CONFLICT_PREFIX);
}

export async function listInterviews(): Promise<RecInterview[]> {
  return unwrap<RecInterview[]>(
    await db.from("rec_interviews").select("*").order("scheduled_at", { ascending: true }).limit(300),
  );
}

export async function listInterviewPanel(): Promise<RecPanelRow[]> {
  return unwrap<RecPanelRow[]>(
    await db.from("rec_interview_panel").select("id, interview_id, staff_id, panel_role").limit(1000),
  );
}

export async function listPanelStaff(): Promise<RecStaffOption[]> {
  const rows = unwrap<RecStaffOption[]>(
    await db
      .from("staff_members")
      .select("id, full_name, work_email")
      .eq("employment_status", "active")
      .order("full_name", { ascending: true })
      .limit(300),
  );
  return rows;
}

export interface ScheduleInterviewInput {
  application_id: string;
  scheduled_at: string;
  timezone?: string;
  interview_stage?: string;
  interview_type?: string;
  mode?: string;
  duration_minutes?: number;
  location?: string | null;
  meeting_link?: string | null;
  instructions?: string | null;
  panel?: RecPanelMember[];
  override_reason?: string | null;
}

/**
 * Scheduling is server-authoritative: `rec_schedule_interview_v2` validates the
 * stage, the vacancy, the mode requirements, and panel/candidate double-booking,
 * then writes the panel, the invitation job and the audit event in one call.
 */
export async function scheduleInterview(input: ScheduleInterviewInput) {
  const { data, error } = await db.rpc("rec_schedule_interview_v2", {
    p_application_id: input.application_id,
    p_scheduled_at: input.scheduled_at,
    p_timezone: input.timezone ?? "Africa/Nairobi",
    p_interview_stage: input.interview_stage ?? "first",
    p_interview_type: input.interview_type ?? "competency",
    p_mode: input.mode ?? "virtual",
    p_duration_minutes: input.duration_minutes ?? 45,
    p_location: input.location ?? null,
    p_meeting_link: input.meeting_link ?? null,
    p_instructions: input.instructions ?? null,
    p_panel: input.panel ?? [],
    p_override_reason: input.override_reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; interview_id: string; conflicts: RecInterviewConflicts };
}

export async function setInterviewStatus(id: string, status: string, reason?: string) {
  const { error } = await db.rpc("rec_interview_transition", {
    p_interview_id: id,
    p_next_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function rescheduleInterview(input: {
  interview_id: string;
  scheduled_at: string;
  reason: string;
  timezone?: string;
  duration_minutes?: number;
  override_reason?: string | null;
}) {
  const { error } = await db.rpc("rec_interview_reschedule", {
    p_interview_id: input.interview_id,
    p_scheduled_at: input.scheduled_at,
    p_reason: input.reason,
    p_timezone: input.timezone ?? null,
    p_duration_minutes: input.duration_minutes ?? null,
    p_override_reason: input.override_reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function recordCandidateResponse(
  interviewId: string,
  response: "confirmed" | "reschedule_requested" | "declined",
  note?: string,
) {
  const { error } = await db.rpc("rec_interview_candidate_response", {
    p_interview_id: interviewId,
    p_response: response,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setInterviewPanel(interviewId: string, panel: RecPanelMember[]) {
  const { error } = await db.rpc("rec_interview_set_panel", {
    p_interview_id: interviewId,
    p_panel: panel,
  });
  if (error) throw new Error(error.message);
}


export async function listEvaluations(applicationId?: string): Promise<RecEvaluation[]> {
  let q = db.from("rec_evaluations").select("*").order("created_at", { ascending: false });
  if (applicationId) q = q.eq("application_id", applicationId);
  return unwrap<RecEvaluation[]>(await q);
}

/**
 * Assessment submission. The server records the scorecard, completes the
 * interview and moves the application to evaluation in one transaction.
 */
export async function submitEvaluation(input: {
  interview_id: string;
  application_id: string;
  overall_score?: number;
  recommendation: "advance" | "hold" | "reject" | string;
  criteria_scores?: unknown[];
  strengths?: string;
  concerns?: string;
  comments?: string;
}) {
  const { error } = await db.rpc("rec_submit_interview_evaluation", {
    p_interview_id: input.interview_id,
    p_criteria_scores: input.criteria_scores ?? [],
    p_overall_score: input.overall_score ?? null,
    p_recommendation: input.recommendation,
    p_strengths: input.strengths ?? null,
    p_concerns: input.concerns ?? null,
    p_comments: input.comments ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ panel review ---------------------------- */

export interface RecPanelReviewSummary {
  application_id: string;
  stage: string;
  evaluation_count: number;
  average_score: number | null;
  recommendation_mix: Record<string, number>;
  evaluations: {
    evaluation_id: string;
    interview_id: string;
    interview_stage: string | null;
    evaluator_staff_id: string | null;
    overall_score: number | null;
    recommendation: string | null;
    strengths: string | null;
    concerns: string | null;
    submitted_at: string | null;
  }[];
  review: {
    id: string;
    status: "locked" | "decided";
    panel_decision: string | null;
    decision_notes: string | null;
    reason_code: string | null;
    evaluation_count: number;
    average_score: number | null;
    recommendation_mix: Record<string, number>;
    evidence_hash: string | null;
    opened_at: string;
    decided_at: string | null;
  } | null;
}

/** Aggregated assessments plus the current panel review, if any. */
export async function panelReviewSummary(applicationId: string): Promise<RecPanelReviewSummary> {
  const { data, error } = await db.rpc("rec_panel_review_summary", { p_application_id: applicationId });
  if (error) throw new Error(error.message);
  return data as RecPanelReviewSummary;
}

/** Lock the assessment evidence and open the panel review. */
export async function openPanelReview(applicationId: string) {
  const { data, error } = await db.rpc("rec_panel_review_open", { p_application_id: applicationId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; review_id: string; evaluation_count?: number; idempotent?: boolean };
}

/** Record the panel decision against locked evidence (hiring authority only). */
export async function decidePanelReview(input: {
  review_id: string;
  decision: "advance" | "hold" | "reject";
  notes?: string;
  reason_code?: string | null;
}) {
  const { error } = await db.rpc("rec_panel_review_decide", {
    p_review_id: input.review_id,
    p_decision: input.decision,
    p_notes: input.notes ?? null,
    p_reason_code: input.reason_code ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------- final selection --------------------------- */

export async function recordFinalSelection(input: {
  application_id: string;
  decision: "selected" | "not_selected";
  reason_code?: string | null;
  notes?: string;
}) {
  const { data, error } = await db.rpc("rec_final_selection", {
    p_application_id: input.application_id,
    p_decision: input.decision,
    p_reason_code: input.reason_code ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { decision_id: string; decision: string };
}

export async function listRejectionReasons(): Promise<{ code: string; label: string }[]> {
  return unwrap<{ code: string; label: string }[]>(
    await db.from("rec_rejection_reasons").select("code,label").order("label", { ascending: true }),
  );
}

export async function listSelectionDecisions(applicationId?: string) {
  let q = db.from("rec_selection_decisions").select("*").order("decided_at", { ascending: false }).limit(200);
  if (applicationId) q = q.eq("application_id", applicationId);
  return unwrap<
    { id: string; application_id: string; decision: string; reason_code: string | null; reason_notes: string | null; decided_at: string }[]
  >(await q);
}

/* --------------------------------- offers ------------------------------- */

export async function listOffers(): Promise<RecOffer[]> {
  return unwrap<RecOffer[]>(
    await db.from("rec_offers").select("*").order("created_at", { ascending: false }),
  );
}

export async function listOfferApprovals(offerId?: string) {
  let q = db.from("rec_offer_approvals").select("*").order("step_order", { ascending: true });
  if (offerId) q = q.eq("offer_id", offerId);
  return unwrap<
    { id: string; offer_id: string; step_order: number; approver_role: string; decision: string; notes: string | null; decided_at: string | null }[]
  >(await q);
}

/** Offers may only be raised against a recorded final selection. */
export async function createOffer(input: {
  application_id: string;
  base_salary_cents: number;
  start_date: string;
  employment_type?: string;
  currency?: string;
  allowances_cents?: number;
  benefits?: string[];
  terms?: string;
  expiry_date?: string;
}) {
  const { data, error } = await db.rpc("rec_offer_create", {
    p_application_id: input.application_id,
    p_base_salary_cents: input.base_salary_cents,
    p_start_date: input.start_date,
    p_employment_type: input.employment_type ?? "permanent",
    p_currency: input.currency ?? "KES",
    p_allowances_cents: input.allowances_cents ?? 0,
    p_benefits: input.benefits ?? [],
    p_terms: input.terms ?? null,
    p_expiry_date: input.expiry_date ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; offer_id: string; offer_no: string };
}

export async function submitOfferForApproval(offerId: string) {
  const { error } = await db.rpc("rec_offer_submit_for_approval", { p_offer_id: offerId, p_approver_role: "hiring_authority" });
  if (error) throw new Error(error.message);
}

export async function decideOfferApproval(offerId: string, decision: "approved" | "rejected", notes?: string) {
  const { error } = await db.rpc("rec_offer_approve", {
    p_offer_id: offerId,
    p_decision: decision,
    p_notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function sendOffer(offerId: string) {
  const { error } = await db.rpc("rec_offer_send", { p_offer_id: offerId });
  if (error) throw new Error(error.message);
}

/** Candidate response. Acceptance opens onboarding, checks and tasks server-side. */
export async function respondToOffer(offerId: string, response: "accepted" | "declined", reason?: string) {
  const { data, error } = await db.rpc("rec_offer_respond", {
    p_offer_id: offerId,
    p_response: response,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; status: string; onboarding_case_id?: string };
}

export async function expireDueOffers() {
  const { data, error } = await db.rpc("rec_offer_expire_due", {});
  if (error) throw new Error(error.message);
  return data as { ok: boolean; expired: number };
}

/* ------------------------------- onboarding ----------------------------- */

export async function listOnboardingCases(): Promise<RecOnboardingCase[]> {
  return unwrap<RecOnboardingCase[]>(
    await db.from("rec_onboarding_cases").select("*").order("created_at", { ascending: false }),
  );
}

export async function listOnboardingTasks(caseId?: string): Promise<RecOnboardingTask[]> {
  let q = db.from("rec_onboarding_tasks").select("*").order("created_at", { ascending: true });
  if (caseId) q = q.eq("case_id", caseId);
  return unwrap<RecOnboardingTask[]>(await q);
}

export interface RecPreemploymentCheck {
  id: string;
  application_id: string;
  offer_id: string | null;
  onboarding_case_id: string | null;
  check_type: string;
  status: string;
  is_blocking: boolean;
  provider: string | null;
  reference: string | null;
  notes: string | null;
  decided_at: string | null;
}

export async function listPreemploymentChecks(applicationId?: string): Promise<RecPreemploymentCheck[]> {
  let q = db.from("rec_preemployment_checks").select("*").order("check_type", { ascending: true });
  if (applicationId) q = q.eq("application_id", applicationId);
  return unwrap<RecPreemploymentCheck[]>(await q);
}

export async function decidePreemploymentCheck(input: {
  check_id: string;
  status: "in_progress" | "passed" | "failed" | "waived";
  notes?: string;
  provider?: string;
  reference?: string;
}) {
  const { error } = await db.rpc("rec_preemployment_decide", {
    p_check_id: input.check_id,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_provider: input.provider ?? null,
    p_reference: input.reference ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setOnboardingTaskStatus(id: string, notes?: string) {
  const { error } = await db.rpc("rec_onboarding_task_complete", { p_task_id: id, p_notes: notes ?? null });
  if (error) throw new Error(error.message);
}

/** Closes the case, provisions the Staff 360 record exactly once and marks hired. */
export async function completeOnboarding(caseId: string) {
  const { data, error } = await db.rpc("rec_onboarding_complete", { p_case_id: caseId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; created: boolean; staff_member_id: string; staff_no: string; idempotent?: boolean };
}


/* --------------------------------- audit -------------------------------- */

export async function listAuditEvents(objectId?: string): Promise<RecAuditEvent[]> {
  let q = db.from("rec_audit_events").select("*").order("created_at", { ascending: false }).limit(200);
  if (objectId) q = q.eq("object_id", objectId);
  return unwrap<RecAuditEvent[]>(await q);
}

export async function listTalentPool() {
  return unwrap<{ id: string; candidate_id: string; tags: string[]; status: string; rating: number | null }[]>(
    await db.from("rec_talent_pool").select("*").order("updated_at", { ascending: false }),
  );
}

export async function addToTalentPool(candidateId: string, tags: string[], reason: string) {
  const { error } = await db
    .from("rec_talent_pool")
    .upsert({ candidate_id: candidateId, tags, entry_reason: reason }, { onConflict: "candidate_id" });
  if (error) throw new Error(error.message);
  await audit("talent_pool_added", "candidate", candidateId, { reason });
}

/* ------------------------------- screenings ----------------------------- */

export interface RecScreening {
  id: string;
  application_id: string;
  criteria: unknown[];
  knockout_failed: boolean;
  ai_score: number | null;
  ai_recommendation: string | null;
  ai_rationale: string | null;
  ai_evidence: unknown[];
  human_score: number | null;
  human_decision: string | null;
  human_decision_by: string | null;
  human_decision_at: string | null;
  decision_notes: string | null;
  status: string;
  created_at: string;
}

export async function listScreenings(applicationId?: string): Promise<RecScreening[]> {
  let q = db.from("rec_screenings").select("*").order("created_at", { ascending: false }).limit(400);
  if (applicationId) q = q.eq("application_id", applicationId);
  return unwrap<RecScreening[]>(await q);
}

/* ------------------------------- shortlist ------------------------------ */

export interface RecShortlistEntry {
  id: string;
  vacancy_id: string;
  application_id: string;
  rank: number | null;
  reviewer_staff_id: string | null;
  reason: string | null;
  decision: string | null;
  added_by: string | null;
  created_at: string;
}

export async function listShortlist(vacancyId?: string): Promise<RecShortlistEntry[]> {
  let q = db.from("rec_shortlist_entries").select("*").order("rank", { ascending: true }).limit(400);
  if (vacancyId) q = q.eq("vacancy_id", vacancyId);
  return unwrap<RecShortlistEntry[]>(await q);
}

export async function addToShortlist(input: {
  vacancy_id: string;
  application_id: string;
  rank?: number;
  reason?: string;
}) {
  const { data, error } = await db
    .from("rec_shortlist_entries")
    .insert({ ...input, decision: "shortlisted" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await audit("shortlist_added", "application", input.application_id, {
    vacancy_id: input.vacancy_id,
    rank: input.rank ?? null,
    reason: input.reason ?? null,
  });
  await moveApplicationStage(input.application_id, "shortlisted", {
    nextAction: "Confirm shortlist with hiring manager",
  });
  return data as RecShortlistEntry;
}

/**
 * Hiring-manager decision on a shortlisted application. The UI-level verbs map
 * onto the persisted decision vocabulary enforced by the table check
 * constraint: advanced | removed | second_opinion | shortlisted.
 */
const SHORTLIST_DECISION_DB: Record<"approved" | "rejected" | "hold", string> = {
  approved: "advanced",
  rejected: "removed",
  hold: "second_opinion",
};

export async function decideShortlist(
  entry: RecShortlistEntry,
  decision: "approved" | "rejected" | "hold",
  reason: string,
) {
  const { error } = await db
    .from("rec_shortlist_entries")
    .update({ decision: SHORTLIST_DECISION_DB[decision], reason })
    .eq("id", entry.id);
  if (error) throw new Error(error.message);
  await audit("shortlist_decision", "application", entry.application_id, { decision, reason });
  if (decision === "approved")
    await moveApplicationStage(entry.application_id, "interview", { nextAction: "Schedule interview" });
  if (decision === "rejected")
    await moveApplicationStage(entry.application_id, "rejected", { reason });
}


/** Move an application to the evaluation stage once interviews are complete. */
export async function openEvaluation(applicationId: string) {
  await moveApplicationStage(applicationId, "evaluation", { nextAction: "Collect scorecards" });
}

/** Governed evaluation outcome: proceed to offer, reject, or park in talent pool. */
export async function decideEvaluation(input: {
  application_id: string;
  candidate_id: string;
  decision: "proceed_to_offer" | "reject" | "talent_pool";
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("An evaluation decision needs a reason so it can be audited.");
  await audit("evaluation_decision", "application", input.application_id, {
    decision: input.decision,
    reason,
  });
  if (input.decision === "proceed_to_offer")
    await moveApplicationStage(input.application_id, "offer", { nextAction: "Prepare offer" });
  if (input.decision === "reject")
    await moveApplicationStage(input.application_id, "rejected", { reason });
  if (input.decision === "talent_pool") {
    await addToTalentPool(input.candidate_id, ["evaluated"], reason);
    await moveApplicationStage(input.application_id, "talent_pool", { reason });
  }
}

/* ------------------------------ talent pool ----------------------------- */

export interface RecTalentPoolEntry {
  id: string;
  candidate_id: string;
  tags: string[];
  potential_roles: string[];
  availability: string | null;
  desired_location: string | null;
  desired_salary_cents: number | null;
  rating: number | null;
  entry_reason: string | null;
  last_engaged_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listTalentPoolEntries(): Promise<RecTalentPoolEntry[]> {
  return unwrap<RecTalentPoolEntry[]>(
    await db.from("rec_talent_pool").select("*").order("updated_at", { ascending: false }).limit(400),
  );
}

export async function updateTalentPoolEntry(id: string, patch: Partial<RecTalentPoolEntry>) {
  const { error } = await db.from("rec_talent_pool").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("talent_pool_updated", "talent_pool", id, patch as Record<string, unknown>);
}

/** Records an engagement touch so re-engagement cadence is measurable. */
export async function markTalentPoolEngaged(entry: RecTalentPoolEntry) {
  const now = new Date().toISOString();
  await updateTalentPoolEntry(entry.id, { last_engaged_at: now, status: "engaged" } as Partial<RecTalentPoolEntry>);
  await audit("talent_pool_engaged", "candidate", entry.candidate_id, { entry_id: entry.id });
}

/* ----------------------------- communications --------------------------- */

export interface RecCommunication {
  id: string;
  candidate_id: string;
  application_id: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  template_key: string | null;
  status: string;
  sent_at: string | null;
  actor_id: string | null;
  created_at: string;
}

export async function listCommunications(candidateId?: string): Promise<RecCommunication[]> {
  let q = db.from("rec_communications").select("*").order("created_at", { ascending: false }).limit(300);
  if (candidateId) q = q.eq("candidate_id", candidateId);
  return unwrap<RecCommunication[]>(await q);
}

export async function logCommunication(input: {
  candidate_id: string;
  application_id?: string | null;
  channel: string;
  direction?: string;
  subject?: string;
  body?: string;
  template_key?: string | null;
  status?: string;
}) {
  const payload = {
    ...input,
    direction: input.direction ?? "outbound",
    status: input.status ?? "sent",
    sent_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("rec_communications").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  await audit("communication_logged", "candidate", input.candidate_id, {
    channel: payload.channel,
    template_key: input.template_key ?? null,
    application_id: input.application_id ?? null,
  });
  if (input.candidate_id) {
    await db
      .from("rec_candidates")
      .update({ last_contact_at: payload.sent_at })
      .eq("id", input.candidate_id);
  }
  return data as RecCommunication;
}

/* -------------------------------- templates ----------------------------- */

export interface RecTemplate {
  id: string;
  template_key: string;
  name: string;
  kind: string;
  subject: string | null;
  body: string | null;
  variables: string[];
  is_active: boolean;
  created_at: string;
}

export async function listTemplates(): Promise<RecTemplate[]> {
  return unwrap<RecTemplate[]>(
    await db.from("rec_templates").select("*").order("kind", { ascending: true }),
  );
}

export async function saveTemplate(input: Partial<RecTemplate> & { template_key: string; name: string; kind: string }) {
  const { error } = await db
    .from("rec_templates")
    .upsert({ ...input, variables: input.variables ?? [] }, { onConflict: "template_key" });
  if (error) throw new Error(error.message);
  await audit("template_saved", "template", null, { template_key: input.template_key });
}

export async function setTemplateActive(id: string, isActive: boolean) {
  const { error } = await db.from("rec_templates").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("template_activation_changed", "template", id, { is_active: isActive });
}

/** Fills {{variable}} placeholders from a flat context map. */
export function renderTemplate(text: string | null, context: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => context[key] ?? `{{${key}}}`);
}

/* -------------------------------- workflows ----------------------------- */

export interface RecWorkflow {
  id: string;
  workflow_key: string;
  name: string;
  trigger_event: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  is_active: boolean;
}

export async function listWorkflows(): Promise<RecWorkflow[]> {
  return unwrap<RecWorkflow[]>(
    await db.from("rec_workflows").select("*").order("trigger_event", { ascending: true }),
  );
}

export async function saveWorkflow(input: Partial<RecWorkflow> & { workflow_key: string; name: string; trigger_event: string }) {
  const { error } = await db
    .from("rec_workflows")
    .upsert(
      { ...input, conditions: input.conditions ?? {}, actions: input.actions ?? {} },
      { onConflict: "workflow_key" },
    );
  if (error) throw new Error(error.message);
  await audit("workflow_saved", "workflow", null, { workflow_key: input.workflow_key });
}

export async function setWorkflowActive(id: string, isActive: boolean) {
  const { error } = await db.from("rec_workflows").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("workflow_activation_changed", "workflow", id, { is_active: isActive });
}

/* ------------------------------ SLA policies ---------------------------- */

export interface RecSlaPolicy {
  id: string;
  sla_key: string;
  label: string;
  target_hours: number;
  applies_to: string;
  is_active: boolean;
}

export async function listSlaPolicies(): Promise<RecSlaPolicy[]> {
  return unwrap<RecSlaPolicy[]>(
    await db.from("rec_sla_policies").select("*").order("applies_to", { ascending: true }),
  );
}

export async function saveSlaPolicy(input: Partial<RecSlaPolicy> & { sla_key: string; label: string; target_hours: number; applies_to: string }) {
  const { error } = await db.from("rec_sla_policies").upsert(input, { onConflict: "sla_key" });
  if (error) throw new Error(error.message);
  await audit("sla_policy_saved", "sla_policy", null, { sla_key: input.sla_key, target_hours: input.target_hours });
}

export async function setSlaPolicyActive(id: string, isActive: boolean) {
  const { error } = await db.from("rec_sla_policies").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  await audit("sla_policy_activation_changed", "sla_policy", id, { is_active: isActive });
}

/* -------------------------------- settings ------------------------------ */

export interface RecSetting {
  id: string;
  setting_key: string;
  value: Record<string, unknown>;
  description: string | null;
  updated_at: string;
}

export async function listSettings(): Promise<RecSetting[]> {
  return unwrap<RecSetting[]>(
    await db.from("rec_settings").select("*").order("setting_key", { ascending: true }),
  );
}

export async function saveSetting(key: string, value: Record<string, unknown>, description?: string) {
  const { error } = await db
    .from("rec_settings")
    .upsert({ setting_key: key, value, description: description ?? null }, { onConflict: "setting_key" });
  if (error) throw new Error(error.message);
  await audit("setting_saved", "setting", null, { setting_key: key, value });
}

/* --------------------------- AI recommendations -------------------------- */

export interface RecAiRecommendation {
  id: string;
  subject_type: string;
  subject_id: string | null;
  kind: string;
  recommendation: string;
  rationale: string | null;
  evidence: unknown[];
  confidence: number | null;
  model: string | null;
  human_decision: string | null;
  human_decision_at: string | null;
  override_reason: string | null;
  created_at: string;
}

export async function listAiRecommendations(limit = 60): Promise<RecAiRecommendation[]> {
  return unwrap<RecAiRecommendation[]>(
    await db.from("rec_ai_recommendations").select("*").order("created_at", { ascending: false }).limit(limit),
  );
}

export async function recordAiRecommendation(input: {
  subject_type: string;
  subject_id?: string | null;
  kind: string;
  recommendation: string;
  rationale?: string;
  evidence?: unknown[];
  confidence?: number;
  model?: string;
}) {
  const { data, error } = await db
    .from("rec_ai_recommendations")
    .insert({
      ...input,
      subject_id: input.subject_id ?? null,
      evidence: input.evidence ?? [],
      model: input.model ?? "yalla-deterministic-v1",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await audit("ai_recommendation_created", input.subject_type, input.subject_id ?? null, {
    kind: input.kind,
    recommendation: input.recommendation,
    model: input.model ?? "yalla-deterministic-v1",
  });
  return data as RecAiRecommendation;
}

/** Canonical stored values allowed by the rec_ai_recommendations check constraint. */
const AI_DECISION_MAP = {
  accepted: "accepted",
  rejected: "rejected",
  modified: "overridden",
  overridden: "overridden",
  review_requested: "review_requested",
} as const;

/** Human review of an AI recommendation — nothing acts without this. */
export async function reviewAiRecommendation(
  rec: RecAiRecommendation,
  decision: keyof typeof AI_DECISION_MAP,
  overrideReason?: string,
) {
  if (decision !== "accepted" && !overrideReason?.trim()) {
    throw new Error("Rejecting or modifying an AI recommendation needs a reason.");
  }
  const stored = AI_DECISION_MAP[decision];
  const { error } = await db
    .from("rec_ai_recommendations")
    .update({
      human_decision: stored,
      human_decision_at: new Date().toISOString(),
      override_reason: overrideReason?.trim() || null,
    })
    .eq("id", rec.id);
  if (error) throw new Error(error.message);
  await audit("ai_recommendation_reviewed", rec.subject_type, rec.subject_id, {
    decision,
    kind: rec.kind,
    override_reason: overrideReason?.trim() || null,
  });
}

/* ---------------------------- attention queue ---------------------------- */

/** Assigns the owning recruiter for an application. */
export async function assignApplicationRecruiter(applicationId: string, staffId: string) {
  const { error } = await db
    .from("rec_applications")
    .update({ recruiter_staff_id: staffId, last_activity_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) throw new Error(error.message);
  await audit("application_assigned", "application", applicationId, { recruiter_staff_id: staffId });
}

/**
 * Records an operator action on a derived attention item. The attention key is
 * stored in the audit context so the queue can replay cleared items.
 */
export async function recordAttentionAction(
  action: string,
  item: { key: string; kind: string; objectType: string; objectId: string },
  context: Record<string, unknown> = {},
) {
  const { error } = await db.from("rec_audit_events").insert({
    action,
    object_type: item.objectType,
    object_id: item.objectId,
    context: { ...context, attention_key: item.key, attention_kind: item.kind },
  });
  if (error) throw new Error(error.message);
}

/* ------------------- paper interview forms & suitability ----------------- */

export interface RecPaperAssessment {
  id: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string;
  form_reference: string;
  scan_path: string | null;
  name_as_written: string;
  position_as_written: string | null;
  interview_date: string | null;
  id_no_as_written: string | null;
  highest_education_as_written: string | null;
  experience_as_written: string | null;
  location_as_written: string | null;
  criteria_ratings: { criterion: string; rating: number; scale?: string; comment?: string }[];
  unrated_criteria: string[];
  recommendation_as_marked: string | null;
  interviewer_comments: string | null;
  interviewer_signature_present: boolean;
  transcription_confidence: string;
  transcription_notes: string | null;
  created_at: string;
}

export interface RecSuitabilityDetermination {
  id: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string;
  verdict: "SUITABLE" | "NOT_SUITABLE" | "EVIDENCE_INSUFFICIENT" | "CONFLICTING_EVIDENCE";
  evidence_status: "COMPLETE" | "INCOMPLETE" | "ASSESSMENT_DATA_MISSING";
  average_form_score: number | null;
  score_scale: string | null;
  evidence_basis: Record<string, unknown>[];
  missing_evidence: string[];
  conflicts: string[];
  rationale: string;
  requires_hr_action: string | null;
  determined_at: string;
  is_current: boolean;
}

/** Physical interview evaluation forms transcribed into the portal. */
export async function listPaperAssessments(applicationId?: string): Promise<RecPaperAssessment[]> {
  let q = db.from("rec_paper_assessments").select("*").order("interview_date", { ascending: false });
  if (applicationId) q = q.eq("application_id", applicationId);
  return unwrap<RecPaperAssessment[]>(await q);
}

/** Current suitability determinations (one per application). */
export async function listSuitabilityDeterminations(vacancyId?: string): Promise<RecSuitabilityDetermination[]> {
  let q = db
    .from("rec_suitability_determinations")
    .select("*")
    .eq("is_current", true)
    .order("determined_at", { ascending: false });
  if (vacancyId) q = q.eq("vacancy_id", vacancyId);
  return unwrap<RecSuitabilityDetermination[]>(await q);
}

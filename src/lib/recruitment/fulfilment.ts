/**
 * Recruitment 360 — fulfilment client.
 *
 * Thin wrappers over the governed pipeline RPCs. Nothing here decides anything:
 * every gate (evidence before validation, evaluation before selection, human
 * selection before an offer, blocking checks before a hire, exactly-once staff
 * creation) is enforced in Postgres. The browser only issues intents and renders
 * persisted state.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------------------- types -- */

export type PipelineStageKey =
  | "applied" | "received" | "screening" | "shortlisted" | "evaluation"
  | "interview" | "offer" | "accepted" | "onboarding" | "hired"
  | "rejected" | "withdrawn" | "talent_pool";

export interface PipelineState {
  vacancy_id: string;
  stages: Partial<Record<PipelineStageKey, number>>;
  validation: { awaiting_evaluation: number; requires_review: number; eligible: number };
  interviews: { scheduled: number; completed: number; awaiting_feedback: number };
  selection: { selected: number; not_selected: number; overrides: number };
  offers: Record<string, number>;
  checks: Record<string, number>;
  onboarding: Record<string, number>;
  hires: number;
  notifications: { queued: number; delivered: number; failed: number };
}

export interface EvidenceFact {
  id: string;
  attribute: string;
  value_text: string | null;
  value_numeric: number | null;
  source_kind: string;
  source_ref: string;
  source_locator: string | null;
  confidence: number;
  extracted_by: string;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface AiRecommendationRecord {
  id: string;
  kind: string;
  recommendation: string;
  rationale: string | null;
  evidence: unknown[];
  confidence: number | null;
  model: string | null;
  human_decision: string | null;
  human_decision_by: string | null;
  human_decision_at: string | null;
  override_reason: string | null;
  created_at: string;
}

export interface GovernanceAuditEntry {
  action: string;
  object_type: string | null;
  actor_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  source: string | null;
  created_at: string;
}

export interface NotificationJobRecord {
  id: string;
  transition_key: string;
  channel: "email" | "sms" | "in_app";
  template_key: string;
  recipient: string;
  subject: string | null;
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";
  attempts: number;
  provider_message_id: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface PreEmploymentCheck {
  id: string;
  check_type: string;
  status: "pending" | "in_progress" | "passed" | "failed" | "waived";
  is_blocking: boolean;
  provider: string | null;
  reference: string | null;
  notes: string | null;
  decided_at: string | null;
}

export interface OnboardingTask {
  id: string;
  title: string;
  category: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
}

export interface OfferRecord {
  id: string;
  offer_no: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "withdrawn";
  base_salary_cents: number | null;
  allowances_cents: number | null;
  currency: string;
  employment_type: string;
  start_date: string | null;
  expiry_date: string | null;
  sent_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

export interface ApplicationGovernance {
  application_id: string;
  evaluation:
    | (Record<string, unknown> & {
        process_id: string;
        model: string;
        scorecard_ref: string;
        confidence: number | null;
        weighted_score: number | null;
        eligibility: string;
        recommendation: string;
        criterion_results: unknown[];
        computed_at: string;
      })
    | null;
  evidence: EvidenceFact[];
  ai_recommendations: AiRecommendationRecord[];
  decisions: Array<Record<string, unknown> & {
    id: string; decision: string; is_override: boolean; ai_recommendation: string | null;
    ai_confidence: number | null; reason_code: string | null; reason_notes: string | null;
    decision_maker: string | null; decision_role: string | null; decided_at: string;
  }>;
  interviews: Array<{ interview: Record<string, unknown>; evaluations: Array<Record<string, unknown>> }>;
  offers: OfferRecord[];
  checks: PreEmploymentCheck[];
  onboarding: Array<{ case: Record<string, unknown>; tasks: OnboardingTask[] }>;
  notifications: Array<{ job: NotificationJobRecord; attempts: Array<Record<string, unknown>> }>;
  audit: GovernanceAuditEntry[];
  provisioning: { staff_member_id: string; staff_no: string; provisioned_at: string } | null;
}

/* -------------------------------------------------------------------- reads -- */

export const getPipelineState = (vacancyId: string) =>
  call<PipelineState>("rec_pipeline_state", { p_vacancy_id: vacancyId });

export const getApplicationGovernance = (applicationId: string) =>
  call<ApplicationGovernance>("rec_application_governance", { p_application_id: applicationId });

/* ------------------------------------------------------------------- writes -- */

export const validateApplication = (
  applicationId: string,
  decision: "validated" | "rejected",
  notes?: string | null,
) =>
  call<{ ok: boolean; decision: string }>("rec_validate_application", {
    p_application_id: applicationId,
    p_decision: decision,
    p_notes: notes ?? null,
  });

export interface ScheduleInterviewInput {
  scheduledAt: string;
  interviewStage?: "first" | "second" | "final" | "panel";
  interviewType?: string;
  mode?: "virtual" | "onsite" | "phone";
  durationMinutes?: number;
  location?: string | null;
  meetingLink?: string | null;
  instructions?: string | null;
}

export const scheduleInterview = (applicationId: string, input: ScheduleInterviewInput) =>
  call<{ ok: boolean; interview_id: string }>("rec_schedule_interview", {
    p_application_id: applicationId,
    p_scheduled_at: input.scheduledAt,
    p_interview_stage: input.interviewStage ?? "first",
    p_interview_type: input.interviewType ?? "competency",
    p_mode: input.mode ?? "virtual",
    p_duration_minutes: input.durationMinutes ?? 45,
    p_location: input.location ?? null,
    p_meeting_link: input.meetingLink ?? null,
    p_instructions: input.instructions ?? null,
  });

export const submitInterviewEvaluation = (
  interviewId: string,
  input: {
    criteriaScores?: Array<{ code: string; label?: string; score: number }>;
    overallScore: number;
    recommendation: "advance" | "hold" | "reject";
    strengths?: string | null;
    concerns?: string | null;
    comments?: string | null;
  },
) =>
  call<{ ok: boolean; evaluation_id: string }>("rec_submit_interview_evaluation", {
    p_interview_id: interviewId,
    p_criteria_scores: input.criteriaScores ?? [],
    p_overall_score: input.overallScore,
    p_recommendation: input.recommendation,
    p_strengths: input.strengths ?? null,
    p_concerns: input.concerns ?? null,
    p_comments: input.comments ?? null,
  });

export const createOffer = (
  applicationId: string,
  input: {
    baseSalaryCents: number;
    startDate: string;
    employmentType?: string;
    currency?: string;
    allowancesCents?: number;
    benefits?: string[];
    terms?: string | null;
    expiryDate?: string | null;
  },
) =>
  call<{ ok: boolean; offer_id: string; offer_no: string }>("rec_offer_create", {
    p_application_id: applicationId,
    p_base_salary_cents: input.baseSalaryCents,
    p_start_date: input.startDate,
    p_employment_type: input.employmentType ?? "permanent",
    p_currency: input.currency ?? "KES",
    p_allowances_cents: input.allowancesCents ?? 0,
    p_benefits: input.benefits ?? [],
    p_terms: input.terms ?? null,
    p_expiry_date: input.expiryDate ?? null,
  });

export const sendOffer = (offerId: string) =>
  call<{ ok: boolean; status: string }>("rec_offer_send", { p_offer_id: offerId });

export const recordOfferResponse = (
  offerId: string,
  response: "accepted" | "declined",
  reason?: string | null,
) =>
  call<{ ok: boolean; status: string; onboarding_case_id?: string }>("rec_offer_respond", {
    p_offer_id: offerId,
    p_response: response,
    p_reason: reason ?? null,
  });

export const decidePreEmploymentCheck = (
  checkId: string,
  status: "in_progress" | "passed" | "failed" | "waived",
  input?: { notes?: string | null; provider?: string | null; reference?: string | null },
) =>
  call<{ ok: boolean; status: string }>("rec_preemployment_decide", {
    p_check_id: checkId,
    p_status: status,
    p_notes: input?.notes ?? null,
    p_provider: input?.provider ?? null,
    p_reference: input?.reference ?? null,
  });

export const completeOnboardingTask = (taskId: string, notes?: string | null) =>
  call<{ ok: boolean }>("rec_onboarding_task_complete", { p_task_id: taskId, p_notes: notes ?? null });

export const completeOnboarding = (caseId: string) =>
  call<{ ok: boolean; created: boolean; staff_member_id: string; staff_no: string; idempotent?: boolean }>(
    "rec_onboarding_complete",
    { p_case_id: caseId },
  );

/* ------------------------------------------------------------ presentation -- */

export const CHECK_LABEL: Record<string, string> = {
  identity_verification: "Identity verification",
  reference_check: "Reference checks",
  education_verification: "Education verification",
  criminal_record_certificate: "Certificate of good conduct",
  medical_fitness: "Medical fitness",
};

export const CHECK_TONE: Record<PreEmploymentCheck["status"], string> = {
  pending: "bg-muted text-muted-foreground border-border",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  passed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  waived: "bg-status-warning/10 text-status-warning border-status-warning/30",
};

export const DELIVERY_TONE: Record<NotificationJobRecord["status"], string> = {
  queued: "bg-muted text-muted-foreground border-border",
  sending: "bg-primary/10 text-primary border-primary/30",
  sent: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  delivered: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  suppressed: "bg-status-warning/10 text-status-warning border-status-warning/30",
};

/** Ordered fulfilment ladder rendered by the Vacancy 360 pipeline strip. */
export const FULFILMENT_LADDER: Array<{ key: PipelineStageKey; label: string; note: string }> = [
  { key: "applied", label: "Applied", note: "Received from the careers site or a sourced channel." },
  { key: "screening", label: "Validation", note: "Evidence extracted and evaluated against the published scorecard." },
  { key: "shortlisted", label: "Shortlisted", note: "Validated by a recruiter; eligible for interview." },
  { key: "interview", label: "Interview", note: "Interview scheduled; candidate notified once." },
  { key: "evaluation", label: "Evaluation", note: "Panel scores submitted with a recommendation." },
  { key: "offer", label: "Offer", note: "Human final selection recorded, offer issued." },
  { key: "accepted", label: "Accepted", note: "Offer accepted; onboarding case and checks opened." },
  { key: "onboarding", label: "Onboarding", note: "Pre-employment checks and Day-1 tasks in progress." },
  { key: "hired", label: "Hired", note: "Staff record created exactly once in the Staff Register." },
];

export const money = (cents: number | null | undefined, currency = "KES") =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

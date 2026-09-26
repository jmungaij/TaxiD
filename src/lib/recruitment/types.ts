/**
 * Recruitment 360 — domain taxonomy.
 *
 * The pipeline stages here are the single client-side truth for ordering,
 * labelling and stage progression. The database enforces the same vocabulary
 * with CHECK constraints, so a stage that is not listed here cannot be written.
 */

export const APPLICATION_STAGES = [
  "applied",
  "screening",
  "shortlisted",
  "interview",
  "evaluation",
  "offer",
  "accepted",
  "onboarding",
  "hired",
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** Terminal states that leave the forward pipeline. */
export const CLOSED_STAGES = ["rejected", "withdrawn", "talent_pool"] as const;

export const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  received: "Received",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview: "Interview",
  evaluation: "Evaluation",
  offer: "Offer",
  accepted: "Accepted",
  onboarding: "Onboarding",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  talent_pool: "Talent pool",
};

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EMPLOYMENT_TYPES = [
  "permanent",
  "contract",
  "fixed_term",
  "internship",
  "consultant",
  "part_time",
] as const;

export const WORK_ARRANGEMENTS = ["onsite", "hybrid", "remote", "field"] as const;

export const CANDIDATE_SOURCES = [
  "careers_site",
  "referral",
  "agency",
  "direct_sourcing",
  "talent_pool",
  "linkedin",
  "walk_in",
] as const;

export const INTERVIEW_STAGES = [
  "screening_call",
  "first",
  "technical",
  "panel",
  "final",
  "other",
] as const;

export const REQUISITION_STATUSES = [
  "draft",
  "submitted",
  "department_review",
  "budget_review",
  "approval",
  "approved",
  "recruitment_open",
  "closed",
  "cancelled",
] as const;

export const OFFER_STATUSES = [
  "draft",
  "approval",
  "approved",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
  "closed",
] as const;

/* --------------------------------- rows --------------------------------- */

export interface RecRequisition {
  id: string;
  requisition_no: string;
  title: string;
  unit_id: string | null;
  hiring_manager_staff_id: string | null;
  headcount: number;
  employment_type: string;
  location: string | null;
  justification: string | null;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  currency: string;
  priority: Priority;
  target_hire_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RecVacancy {
  id: string;
  vacancy_no: string;
  requisition_id: string | null;
  title: string;
  unit_id: string | null;
  /** Authoritative org position this vacancy fills. Required before publication. */
  position_id: string | null;
  /** Recorded justification when a vacancy is published without a linked position. */
  position_exception_reason: string | null;
  hiring_manager_staff_id: string | null;
  recruiter_staff_id: string | null;
  employment_type: string;
  work_arrangement: string;
  location: string | null;
  headcount: number;
  salary_min_cents: number | null;
  salary_max_cents: number | null;
  currency: string;
  required_skills: string[];
  preferred_skills: string[];
  qualifications: string[];
  min_years_experience: number | null;
  responsibilities: string[];
  priority: Priority;
  target_hire_date: string | null;
  opened_at: string;
  closed_at: string | null;
  sla_days: number;
  approval_status: string;
  publication_status: string;
  status: string;
  /** Stable public web address; authoritative identity for the public Careers page. */
  public_slug: string;
  public_summary: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecCandidate {
  id: string;
  candidate_no: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  years_experience: number | null;
  current_employer: string | null;
  current_title: string | null;
  source: string;
  owner_recruiter_staff_id: string | null;
  engagement_status: string;
  consent_given: boolean;
  record_state: string;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecApplication {
  id: string;
  application_no: string;
  candidate_id: string;
  vacancy_id: string;
  source: string;
  applied_at: string;
  cover_letter: string | null;
  stage: string;
  status: string;
  score: number | null;
  ai_match_score: number | null;
  priority: Priority;
  recruiter_staff_id: string | null;
  hiring_manager_staff_id: string | null;
  next_action: string | null;
  next_action_due: string | null;
  stage_entered_at: string;
  last_activity_at: string;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecInterview {
  id: string;
  application_id: string;
  vacancy_id: string;
  interview_stage: string;
  interview_type: string;
  mode: string;
  scheduled_at: string | null;
  duration_minutes: number;
  location: string | null;
  meeting_link: string | null;
  instructions: string | null;
  objectives: string[];
  suggested_questions: string[];
  status: string;
  feedback_due_at: string | null;
  timezone?: string;
  candidate_response?: string | null;
  candidate_responded_at?: string | null;
  candidate_response_note?: string | null;
  previous_scheduled_at?: string | null;
  reschedule_count?: number;
  cancellation_reason?: string | null;
  conflict_override_reason?: string | null;
}


export interface RecEvaluation {
  id: string;
  interview_id: string;
  application_id: string;
  evaluator_staff_id: string | null;
  overall_score: number | null;
  recommendation: string | null;
  strengths: string | null;
  concerns: string | null;
  evidence: string | null;
  comments: string | null;
  status: string;
  submitted_at: string | null;
}

export interface RecOffer {
  id: string;
  offer_no: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string;
  version: number;
  base_salary_cents: number | null;
  currency: string;
  allowances_cents: number | null;
  benefits: string[];
  employment_type: string;
  terms: string | null;
  start_date: string | null;
  expiry_date: string | null;
  status: string;
  sent_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
}

export interface RecOnboardingCase {
  id: string;
  case_no: string;
  offer_id: string;
  application_id: string;
  candidate_id: string;
  vacancy_id: string | null;
  staff_member_id: string | null;
  start_date: string | null;
  manager_staff_id: string | null;
  status: string;
}

export interface RecOnboardingTask {
  id: string;
  case_id: string;
  title: string;
  category: string;
  owner_staff_id: string | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  notes: string | null;
}

export interface RecAuditEvent {
  id: string;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  context: Record<string, unknown>;
  created_at: string;
}

/* ------------------------------- helpers -------------------------------- */

export function titleise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(cents: number | null | undefined, currency = "KES"): string {
  if (cents == null) return "—";
  return `${currency} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Days a record has been sitting in its current stage. */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** Vacancy time-to-fill risk against its own SLA. */
export function vacancySlaState(v: Pick<RecVacancy, "opened_at" | "sla_days" | "status">) {
  if (v.status !== "open") return { state: "closed" as const, daysOpen: daysSince(v.opened_at) };
  const daysOpen = daysSince(v.opened_at);
  if (daysOpen > v.sla_days) return { state: "breached" as const, daysOpen };
  if (daysOpen > v.sla_days * 0.75) return { state: "at_risk" as const, daysOpen };
  return { state: "on_track" as const, daysOpen };
}

export const STAGE_TONE: Record<string, string> = {
  applied: "bg-muted text-muted-foreground border-border",
  screening: "bg-info/10 text-info border-info/30",
  shortlisted: "bg-info/10 text-info border-info/30",
  interview: "bg-primary/10 text-primary border-primary/30",
  evaluation: "bg-primary/10 text-primary border-primary/30",
  offer: "bg-warning/10 text-warning-foreground border-warning/30",
  accepted: "bg-success/10 text-success border-success/30",
  onboarding: "bg-success/10 text-success border-success/30",
  hired: "bg-success/10 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  withdrawn: "bg-destructive/10 text-destructive border-destructive/30",
  talent_pool: "bg-secondary text-secondary-foreground border-border",
};

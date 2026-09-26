/**
 * INTERNS 360 — domain contract.
 *
 * Interns 360 lives under Staff 360 and reuses the canonical people spine:
 * Recruitment 360 supplies candidates and applications, the staff register
 * supplies mentors and supervisors. Nothing here creates a second HR database.
 *
 * Scoring rule of the programme: a number only exists if a record produced it.
 * Commercial contribution is only credited when it is verified against an
 * authoritative source system — never on a declaration alone.
 */

export const INTERN_STATUSES = [
  "APPLICANT",
  "ELIGIBLE",
  "ASSESSED",
  "SHORTLISTED",
  "INTERVIEWED",
  "SELECTED",
  "OFFERED",
  "ACCEPTED",
  "ONBOARDING",
  "ACTIVE",
  "COMPLETED",
  "WITHDRAWN",
  "TERMINATED",
] as const;
export type InternStatus = (typeof INTERN_STATUSES)[number];

export const TALENT_LEVELS = [
  "APPLICANT",
  "APPRENTICE",
  "OPERATOR",
  "PRODUCER",
  "YALLA_TALENT",
] as const;
export type TalentLevel = (typeof TALENT_LEVELS)[number];

/** Evidence bar each talent level must clear (mirrors intern_promote_level). */
export const TALENT_LEVEL_THRESHOLD: Record<TalentLevel, number> = {
  APPLICANT: 0,
  APPRENTICE: 0,
  OPERATOR: 55,
  PRODUCER: 70,
  YALLA_TALENT: 85,
};

export const TALENT_LEVEL_LABEL: Record<TalentLevel, string> = {
  APPLICANT: "Applicant",
  APPRENTICE: "Apprentice",
  OPERATOR: "Operator",
  PRODUCER: "Producer",
  YALLA_TALENT: "Yalla Talent",
};

export const CONVERSION_OUTCOMES = [
  "NONE",
  "HIGH_POTENTIAL",
  "TALENT_REVIEW",
  "EXTENSION",
  "PAID_ENGAGEMENT",
  "FIXED_TERM",
  "PERMANENT",
  "TALENT_POOL",
  "NOT_PROGRESSED",
] as const;
export type ConversionOutcome = (typeof CONVERSION_OUTCOMES)[number];

export const CONVERSION_LABEL: Record<string, string> = {
  NONE: "Not reviewed",
  HIGH_POTENTIAL: "High potential",
  TALENT_REVIEW: "Talent review",
  EXTENSION: "Extension",
  PAID_ENGAGEMENT: "Paid engagement",
  FIXED_TERM: "Fixed term",
  PERMANENT: "Permanent",
  TALENT_POOL: "Talent pool",
  NOT_PROGRESSED: "Not progressed",
};

export const WORK_STATUSES = [
  "BACKLOG",
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REWORK",
  "COMPLETED",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const ATTRIBUTION_TYPES = [
  "LEAD_CREATED",
  "LEAD_QUALIFIED",
  "OPPORTUNITY_CREATED",
  "SALES_ASSIST",
  "BOOKING_ASSIST",
  "CONVERSION_ASSIST",
  "REVENUE_ATTRIBUTED",
] as const;
export type AttributionType = (typeof ATTRIBUTION_TYPES)[number];

export const ATTRIBUTION_LABEL: Record<AttributionType, string> = {
  LEAD_CREATED: "Lead created",
  LEAD_QUALIFIED: "Lead qualified",
  OPPORTUNITY_CREATED: "Opportunity created",
  SALES_ASSIST: "Sales assist",
  BOOKING_ASSIST: "Booking assist",
  CONVERSION_ASSIST: "Conversion assist",
  REVENUE_ATTRIBUTED: "Attributed revenue",
};

/** The six performance dimensions, in reporting order. */
export const PERFORMANCE_DIMENSIONS = [
  { key: "learning_score", label: "Learning" },
  { key: "productivity_score", label: "Productivity" },
  { key: "quality_score", label: "Quality" },
  { key: "commercial_score", label: "Commercial" },
  { key: "operational_score", label: "Operational" },
  { key: "conduct_score", label: "Conduct" },
] as const;

export interface InternProgramme {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
}

export interface InternTrack {
  id: string;
  programme_id: string;
  code: string;
  name: string;
  focus: string | null;
  sequence: number;
  performance_weights: Record<string, number>;
  kpis: string[];
}

export interface InternCohort {
  id: string;
  programme_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  duration_weeks: number | null;
  intake_size: number | null;
  status: string;
  supervisor_staff_id: string | null;
  target_outcomes: string | null;
}

export interface InternProfile {
  id: string;
  candidate_id: string | null;
  application_id: string | null;
  staff_id: string | null;
  user_id: string | null;
  cohort_id: string | null;
  track_id: string | null;
  full_name: string;
  work_email: string | null;
  institution: string | null;
  programme_of_study: string | null;
  qualification: string | null;
  qualification_level: string | null;
  year_of_study: string | null;
  graduation_date: string | null;
  availability: string | null;
  location: string | null;
  work_arrangement: string | null;
  mentor_staff_id: string | null;
  supervisor_staff_id: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  actual_end_date: string | null;
  status: InternStatus;
  talent_level: TalentLevel;
  conversion_status: ConversionOutcome;
  created_at: string;
}

export interface InternScoreboardRow {
  intern_id: string;
  full_name: string;
  status: InternStatus;
  talent_level: TalentLevel;
  conversion_status: ConversionOutcome;
  cohort_id: string | null;
  cohort_name: string | null;
  track_id: string | null;
  track_code: string | null;
  track_name: string | null;
  institution: string | null;
  programme_of_study: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  performance_index: number | null;
  learning_score: number | null;
  productivity_score: number | null;
  quality_score: number | null;
  commercial_score: number | null;
  operational_score: number | null;
  conduct_score: number | null;
  evidence_confidence: number | null;
  period_start: string | null;
  period_end: string | null;
  accepted_work: number;
  validated_modules: number;
  verified_revenue_kes: number;
  open_integrity_flags: number;
}

export interface CohortHealthRow {
  cohort_id: string;
  cohort_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  intake_size: number | null;
  enrolled: number;
  active: number;
  completed: number;
  exited: number;
  yalla_talent: number;
  avg_performance_index: number | null;
  avg_evidence_confidence: number | null;
  verified_revenue_kes: number;
  open_integrity_flags: number;
}

export interface InternSkill {
  id: string;
  intern_id: string;
  category: string;
  skill: string;
  classification: "required" | "preferred" | "developmental";
  level: number;
  evidence: string | null;
  source: string | null;
  confidence: number;
  last_verified_at: string | null;
}

export interface InternLearningModule {
  id: string;
  track_id: string;
  code: string;
  title: string;
  competency: string;
  sequence: number;
  hours: number;
  requires_practical: boolean;
}

export interface InternLearningProgress {
  id: string;
  intern_id: string;
  module_id: string;
  status: "assigned" | "in_progress" | "submitted" | "validated" | "failed";
  assessment_score: number | null;
  attempts: number;
  application_evidence: string | null;
  validated_at: string | null;
  intern_learning_modules?: InternLearningModule | null;
}

export interface InternWorkItem {
  id: string;
  intern_id: string;
  title: string;
  description: string | null;
  work_kind: string;
  priority: "low" | "medium" | "high" | "critical";
  status: WorkStatus;
  deadline: string | null;
  deliverable_url: string | null;
  quality_criteria: string | null;
  quality_score: number | null;
  complexity: number;
  impact: number;
  rework_count: number;
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface InternAttribution {
  id: string;
  intern_id: string;
  attribution_type: AttributionType;
  channel: string | null;
  product_line: string | null;
  subject_ref: string | null;
  amount_kes: number | null;
  source_system: string;
  verified: boolean;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface InternPerformanceScore {
  id: string;
  intern_id: string;
  period_start: string;
  period_end: string;
  learning_score: number;
  productivity_score: number;
  quality_score: number;
  commercial_score: number;
  operational_score: number;
  conduct_score: number;
  performance_index: number;
  evidence_confidence: number;
  breakdown: Record<string, unknown>;
  computed_at: string;
}

export interface InternCapstone {
  id: string;
  intern_id: string;
  title: string;
  problem: string | null;
  solution: string | null;
  measured_impact: string | null;
  recommendation: string | null;
  evidence_url: string | null;
  status: "draft" | "submitted" | "under_review" | "scored" | "returned";
  total_score: number | null;
  scored_at: string | null;
}

export interface InternIntegrityFlag {
  id: string;
  intern_id: string;
  signal: string;
  severity: "low" | "medium" | "high";
  detail: Record<string, unknown>;
  status: "REVIEW_REQUIRED" | "CLEARED" | "SUBSTANTIATED";
  created_at: string;
}

export interface InternAuditEntry {
  id: string;
  intern_id: string | null;
  actor_id: string | null;
  action: string;
  entity: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface InternReview {
  id: string;
  intern_id: string;
  review_type: string;
  period_label: string | null;
  strengths: string | null;
  concerns: string | null;
  coaching: string | null;
  subjective_rating: number | null;
  created_at: string;
}

export const INTEGRITY_SIGNAL_LABEL: Record<string, string> = {
  duplicate_commercial_claim: "Duplicate commercial claim",
  unverified_revenue_claim: "Revenue claimed without an authoritative source",
  completed_work_without_deliverable: "Work accepted without deliverable evidence",
  learning_validated_without_practical_evidence: "Competency validated without applied evidence",
};

export const money = (kes: number | null | undefined) =>
  `KES ${Math.round(Number(kes ?? 0)).toLocaleString("en-KE")}`;

export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}`;

export function talentTone(level: TalentLevel): "default" | "secondary" | "outline" {
  return level === "YALLA_TALENT" ? "default" : level === "PRODUCER" ? "secondary" : "outline";
}

/** The next level an intern could reach, or null when already at the top. */
export function nextTalentLevel(level: TalentLevel): TalentLevel | null {
  const i = TALENT_LEVELS.indexOf(level);
  return i < 0 || i === TALENT_LEVELS.length - 1 ? null : TALENT_LEVELS[i + 1];
}

/** Default reporting period: the trailing 28 days, aligned to whole days. */
export function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 27 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

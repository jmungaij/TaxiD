/**
 * TaxiD Staff 360 — Organisation & Workforce types.
 *
 * These types mirror the persisted tables exactly. Staff 360 is the human
 * organisation and work-orchestration layer: it owns organisation structure,
 * people, capability, objectives and work assignment. It never owns sales,
 * booking, fulfilment, payment or revenue truth — those stay in their
 * authoritative systems and are referenced by `staff_work_items`.
 */
import type { LooseDatabase } from "@/integrations/supabase/loose-types";

// The generated types only cover Cloud-created tables; the Staff 360 schema
// is not recreated in the backend yet, so rows are typed loosely here.
type T = LooseDatabase["public"]["Tables"];

export type OrgEntity = T["org_entities"]["Row"];
export type OrgUnit = T["org_units"]["Row"];
export type OrgPosition = T["org_positions"]["Row"];
export type OrgCompetency = T["org_competencies"]["Row"];
export type PositionRequirement = T["org_position_requirements"]["Row"];
export type StaffMember = T["staff_members"]["Row"];
export type StaffDocument = T["staff_documents"]["Row"];
export type StaffQualification = T["staff_qualifications"]["Row"];
export type StaffCompetency = T["staff_competencies"]["Row"];
export type StaffGap = T["staff_gaps"]["Row"];
export type TrainingNeed = T["staff_training_needs"]["Row"];
export type OrgObjective = T["org_objectives"]["Row"];
export type StaffWorkItem = T["staff_work_items"]["Row"];
export type OrgPolicy = T["org_policies"]["Row"];
export type OrgPolicyVersion = T["org_policy_versions"]["Row"];
export type OrgPolicyAssignment = T["org_policy_assignments"]["Row"];
export type OrgPolicyAck = T["org_policy_acknowledgements"]["Row"];
export type StaffLifecycleEvent = T["staff_lifecycle_events"]["Row"];
export type OrgAuditEntry = T["org_audit_log"]["Row"];

export type UnitType = OrgUnit["unit_type"];
export type EmploymentStatus = StaffMember["employment_status"];
export type WorkKind = StaffWorkItem["work_kind"];
export type PolicyStatus = OrgPolicy["status"];

export const UNIT_TYPES = ["division", "department", "team"] as const;

export const EMPLOYMENT_STATUSES = [
  "onboarding", "active", "on_leave", "suspended", "transferred", "offboarding", "exited",
] as const;

export const EMPLOYMENT_TYPES = [
  "permanent", "contract", "intern", "consultant", "part_time",
] as const;

export const DOCUMENT_TYPES = [
  "cv", "national_id", "passport", "contract", "offer_letter", "academic_certificate",
  "professional_certificate", "licence", "training_certificate", "performance_review",
  "policy_acknowledgement", "tax_document", "bank_details", "other",
] as const;

export const QUALIFICATION_KINDS = [
  "academic", "professional", "certification", "licence", "membership",
] as const;

export const REQUIREMENT_KINDS = [
  "qualification", "competency", "training", "certification",
] as const;

export const TRAINING_ORIGINS = [
  "position_requirement", "qualification_gap", "competency_gap", "performance_gap",
  "policy_requirement", "compliance_requirement", "new_product", "new_technology",
  "manager_recommendation", "development_objective",
] as const;

export const TRAINING_LIFECYCLE = [
  "identified", "assigned", "enrolled", "attended", "assessed",
  "completed", "certified", "applied", "closed",
] as const;

export const OBJECTIVE_LEVELS = ["company", "division", "department", "team", "employee"] as const;

/**
 * The only KPI units the database accepts (`org_objectives_kpi_unit_check`).
 * Free-text units such as "KES" or "%" are rejected — currency amounts use
 * `currency` plus a currency code, percentages use `percent`.
 */
export const OBJECTIVE_KPI_UNITS = [
  "count", "percent", "currency", "ratio", "days", "hours", "score",
] as const;
export type ObjectiveKpiUnit = (typeof OBJECTIVE_KPI_UNITS)[number];

export const OBJECTIVE_KPI_UNIT_LABEL: Record<ObjectiveKpiUnit, string> = {
  count: "Count (whole numbers)",
  percent: "Percent (0–100)",
  currency: "Currency amount",
  ratio: "Ratio",
  days: "Days",
  hours: "Hours",
  score: "Score",
};

export const WORK_KINDS = [
  "sales_opportunity", "customer_case", "approval", "reconciliation",
  "operations_task", "document_review", "training", "admin_task",
] as const;

export const POLICY_CATEGORIES = [
  "human_capital", "recruitment", "conduct", "performance", "sales", "revenue",
  "customer_experience", "finance", "procurement", "information_security",
  "data_protection", "ai_usage", "delegation_of_authority", "travel", "leave",
  "remote_work", "expense", "risk_compliance",
] as const;

export const POLICY_STATUS_FLOW: Record<PolicyStatus, PolicyStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "draft"],
  approved: ["published", "in_review"],
  published: ["archived", "draft"],
  archived: ["draft"],
};

/** Human labels shared across the organisation surfaces. */
export const LABEL: Record<string, string> = {
  qualification: "Qualification",
  competency: "Competency",
  training: "Training",
  certification: "Certification",
  sales_opportunity: "Sales opportunity",
  customer_case: "Customer case",
  approval: "Approval",
  reconciliation: "Reconciliation",
  operations_task: "Operations task",
  document_review: "Document review",
  admin_task: "Admin task",
};

export const titleise = (v: string | null | undefined) =>
  !v ? "—" : v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export type StaffWorkReview = T["staff_work_reviews"]["Row"];
export type CorrectiveAction = T["staff_corrective_actions"]["Row"];

export const REVIEW_DECISIONS = ["approved", "returned", "changes_requested"] as const;

export const CORRECTIVE_TRIGGERS = ["rework", "blocked", "escalated", "sla_breach"] as const;

export const CAUSE_CATEGORIES = [
  "missing_information", "system_defect", "process_gap", "dependency_delay", "capability_gap",
  "customer_delay", "pricing_approval", "data_quality", "third_party", "other",
] as const;

export const CORRECTIVE_STATUSES = ["open", "in_progress", "resolved", "ineffective", "closed"] as const;

/**
 * Commercial CRM types — the customer-relationship STATE layer.
 *
 * Execution stays in `staff_work_items`, opportunity truth in
 * `commercial_opportunities`, money in `commercial_transactions`. Nothing here
 * duplicates those objects: an account carries relationship state, a next
 * action is only a pointer at a real work item.
 */

export const ACCOUNT_LIFECYCLE_STAGES = [
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "negotiation",
  "won",
  "onboarding",
  "active",
  "expansion",
  "renewal",
  "lost",
] as const;
export type AccountLifecycleStage = (typeof ACCOUNT_LIFECYCLE_STAGES)[number];

export const ACCOUNT_SIZE_BANDS = ["unknown", "micro", "small", "mid", "large", "enterprise"] as const;
export const ACCOUNT_IMPORTANCE_TIERS = ["standard", "key", "strategic"] as const;

export const CONTACT_ROLES = [
  "primary",
  "decision_maker",
  "procurement",
  "finance",
  "operations",
  "exec_sponsor",
  "other",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const INTERACTION_TYPES = [
  "email",
  "call",
  "meeting",
  "document_shared",
  "proposal",
  "customer_response",
  "note",
  "visit",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const NEXT_ACTION_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export interface CrmAccount {
  id: string;
  account_ref: string;
  name: string;
  legal_name: string | null;
  industry: string | null;
  country: string;
  city: string | null;
  size_band: (typeof ACCOUNT_SIZE_BANDS)[number];
  lifecycle_stage: AccountLifecycleStage;
  importance_tier: (typeof ACCOUNT_IMPORTANCE_TIERS)[number];
  owner_staff_id: string | null;
  corporate_id: string | null;
  source: string;
  website: string | null;
  notes: string | null;
  provenance: string;
  created_at: string;
  updated_at: string;
}

export interface CrmContact {
  id: string;
  account_id: string;
  full_name: string;
  contact_role: ContactRole;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  influence_level: "low" | "medium" | "high";
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface CrmInteraction {
  id: string;
  account_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  work_item_id: string | null;
  staff_id: string | null;
  interaction_type: InteractionType;
  direction: (typeof INTERACTION_DIRECTIONS)[number];
  subject: string;
  summary: string | null;
  outcome: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  occurred_at: string;
  created_at: string;
}

export interface CrmMeetingOutcome {
  id: string;
  interaction_id: string;
  account_id: string;
  opportunity_id: string | null;
  needs: string | null;
  commercial_position: string | null;
  operational_requirements: string | null;
  decision_process: string | null;
  decision_timeline: string | null;
  competition: string | null;
  risks: string | null;
  agreed_next_steps: string | null;
  capture_completeness_pct: number;
}

export interface CrmNextAction {
  id: string;
  account_id: string;
  opportunity_id: string | null;
  interaction_id: string | null;
  work_item_id: string;
  staff_id: string | null;
  title: string;
  due_at: string | null;
  priority: (typeof NEXT_ACTION_PRIORITIES)[number];
  status: "open" | "in_progress" | "done" | "cancelled";
  created_at: string;
}

export interface CrmOpportunityLink {
  id: string;
  opportunity_id: string;
  account_id: string;
  primary_contact_id: string | null;
  owner_staff_id: string | null;
}

/** Structured-capture fields scored by the meeting-outcome completeness meter. */
export const MEETING_CAPTURE_FIELDS: (keyof CrmMeetingOutcome)[] = [
  "needs",
  "commercial_position",
  "operational_requirements",
  "decision_process",
  "decision_timeline",
  "competition",
  "risks",
  "agreed_next_steps",
];

export function meetingCaptureCompleteness(outcome: Partial<CrmMeetingOutcome>): number {
  const filled = MEETING_CAPTURE_FIELDS.filter((f) => {
    const v = outcome[f];
    return typeof v === "string" && v.trim().length > 0;
  }).length;
  return Math.round((filled / MEETING_CAPTURE_FIELDS.length) * 100);
}

export function titleise(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

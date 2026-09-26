/**
 * Recruitment 360 — attention queue.
 *
 * Every item is DERIVED from authoritative rows (vacancies, applications,
 * interviews, offers) plus the configured SLA policies. Nothing here invents a
 * figure: if the underlying record does not breach a configured target, no item
 * is produced. Operator actions (resolve / assign / dismiss) are recorded in the
 * append-only recruitment audit trail, and dismissals are replayed from that
 * same trail so the queue is reproducible for anyone with read access.
 */
import * as rec from "./api";
import { daysSince, type RecApplication, type RecInterview, type RecOffer, type RecVacancy } from "./types";

export type AttentionSeverity = "critical" | "high" | "medium";

export interface AttentionItem {
  /** Stable key — audit dismissals/resolutions are recorded against this. */
  key: string;
  kind: "vacancy_sla" | "application_stalled" | "interview_feedback" | "offer_expiring";
  severity: AttentionSeverity;
  title: string;
  detail: string;
  /** Where the work is actually done. */
  to: string;
  objectType: string;
  objectId: string;
  /** Only application-backed items can be assigned to a recruiter. */
  applicationId?: string;
  ageDays: number;
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2 };

export interface AttentionInputs {
  vacancies: RecVacancy[];
  applications: RecApplication[];
  interviews: RecInterview[];
  offers: RecOffer[];
  slaPolicies: rec.RecSlaPolicy[];
  /** Audit trail used to replay resolved/dismissed keys. */
  auditEvents: { action: string; context: Record<string, unknown> }[];
}

/** Target days for a configured SLA key, falling back to a stated default. */
function targetDays(policies: rec.RecSlaPolicy[], key: string, fallbackDays: number): number {
  const policy = policies.find((p) => p.sla_key === key && p.is_active);
  return policy ? Math.max(1, Math.round(policy.target_hours / 24)) : fallbackDays;
}

export const CLEARED_ACTIONS = ["attention_resolved", "attention_dismissed"];

/** Keys the operator has already cleared, newest decision wins. */
export function clearedKeys(auditEvents: AttentionInputs["auditEvents"]): Set<string> {
  const cleared = new Set<string>();
  for (const e of auditEvents) {
    if (!CLEARED_ACTIONS.includes(e.action)) continue;
    const key = typeof e.context?.attention_key === "string" ? e.context.attention_key : null;
    if (key) cleared.add(key);
  }
  return cleared;
}

export function buildAttentionQueue(input: AttentionInputs): AttentionItem[] {
  const cleared = clearedKeys(input.auditEvents);
  const items: AttentionItem[] = [];

  const stallDays = targetDays(input.slaPolicies, "stage_progression", 7);
  const feedbackDays = targetDays(input.slaPolicies, "interview_feedback", 2);
  const offerDays = targetDays(input.slaPolicies, "offer_response", 5);

  for (const v of input.vacancies) {
    if (v.status !== "open") continue;
    const daysOpen = daysSince(v.opened_at);
    if (daysOpen <= v.sla_days) continue;
    items.push({
      key: `vacancy_sla:${v.id}`,
      kind: "vacancy_sla",
      severity: daysOpen > v.sla_days * 1.5 ? "critical" : "high",
      title: `${v.title} is past its time-to-fill target`,
      detail: `${daysOpen} days open against a ${v.sla_days}-day target.`,
      to: `/staff/recruitment/pipeline?vacancy=${v.id}`,
      objectType: "vacancy",
      objectId: v.id,
      ageDays: daysOpen - v.sla_days,
    });
  }

  for (const a of input.applications) {
    if (a.status !== "active") continue;
    const inStage = daysSince(a.stage_entered_at);
    if (inStage < stallDays) continue;
    items.push({
      key: `application_stalled:${a.id}:${a.stage}`,
      kind: "application_stalled",
      severity: inStage >= stallDays * 2 ? "critical" : "high",
      title: `${a.application_no} has not moved out of ${a.stage.replace(/_/g, " ")}`,
      detail: `${inStage} days in stage against a ${stallDays}-day progression target.`,
      to: stageRoute(a.stage, a.vacancy_id),
      objectType: "application",
      objectId: a.id,
      applicationId: a.id,
      ageDays: inStage,
    });
  }

  for (const i of input.interviews) {
    if (i.status !== "completed") continue;
    const due = i.feedback_due_at ?? i.scheduled_at;
    if (!due) continue;
    const overdue = daysSince(due);
    if (overdue < feedbackDays) continue;
    items.push({
      key: `interview_feedback:${i.id}`,
      kind: "interview_feedback",
      severity: overdue >= feedbackDays * 3 ? "critical" : "medium",
      title: "Interview scorecard is outstanding",
      detail: `Feedback ${overdue} days overdue against a ${feedbackDays}-day target.`,
      to: "/staff/recruitment/evaluations",
      objectType: "interview",
      objectId: i.id,
      applicationId: i.application_id,
      ageDays: overdue,
    });
  }

  for (const o of input.offers) {
    if (!["sent", "viewed"].includes(o.status)) continue;
    const waiting = daysSince(o.sent_at);
    const expiryPassed = o.expiry_date ? new Date(o.expiry_date) < new Date() : false;
    if (!expiryPassed && waiting < offerDays) continue;
    items.push({
      key: `offer_expiring:${o.id}`,
      kind: "offer_expiring",
      severity: expiryPassed ? "critical" : "high",
      title: `${o.offer_no} is awaiting a candidate response`,
      detail: expiryPassed
        ? `The offer expiry date (${o.expiry_date}) has passed.`
        : `${waiting} days since it was sent against a ${offerDays}-day response target.`,
      to: "/staff/recruitment/offers",
      objectType: "offer",
      objectId: o.id,
      applicationId: o.application_id,
      ageDays: waiting,
    });
  }

  return items
    .filter((i) => !cleared.has(i.key))
    .sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.ageDays - a.ageDays,
    );
}

/** Marks the underlying condition as handled, with a required reason. */
export async function resolveAttentionItem(item: AttentionItem, note: string) {
  const reason = note.trim();
  if (!reason) throw new Error("Say what was done so the resolution is auditable.");
  await rec.recordAttentionAction("attention_resolved", item, { note: reason });
}

/** Explicitly stands the item down without acting on it. */
export async function dismissAttentionItem(item: AttentionItem, note: string) {
  const reason = note.trim();
  if (!reason) throw new Error("A dismissal needs a reason so the queue stays trustworthy.");
  await rec.recordAttentionAction("attention_dismissed", item, { note: reason });
}

/** Takes ownership of the application behind the item. */
export async function assignAttentionItem(item: AttentionItem, staffId: string) {
  if (!item.applicationId) throw new Error("This item has no application to assign.");
  await rec.assignApplicationRecruiter(item.applicationId, staffId);
  await rec.recordAttentionAction("attention_assigned", item, { recruiter_staff_id: staffId });
}

function stageRoute(stage: string, vacancyId: string): string {
  if (stage === "screening" || stage === "applied") return "/staff/recruitment/screening";
  if (stage === "shortlisted") return "/staff/recruitment/shortlist";
  if (stage === "interview") return "/staff/recruitment/interviews";
  if (stage === "evaluation") return "/staff/recruitment/evaluations";
  if (stage === "offer" || stage === "accepted") return "/staff/recruitment/offers";
  if (stage === "onboarding") return "/staff/recruitment/onboarding";
  return `/staff/recruitment/pipeline?vacancy=${vacancyId}`;
}

export const SEVERITY_TONE: Record<AttentionSeverity, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-warning/10 text-warning-foreground border-warning/30",
  medium: "bg-info/10 text-info border-info/30",
};

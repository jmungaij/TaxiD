/**
 * Work priority intelligence for the org work queue.
 *
 * This module owns BUCKETING and the queue shape only. Scoring, effort sizing
 * and banding are delegated to the single canonical engine in
 * `@/lib/work/coreScore`, so this screen and the personal cockpit can never
 * rank the same item differently.
 */
import {
  assignRelativeBands,
  scoreWorkFacts,
  type PriorityBand,
  type SlaStatus,
  type WorkScoringFacts,
} from "@/lib/work/coreScore";

import type { StaffWorkItem } from "./types";

export type WorkBucket = "now" | "next" | "waiting" | "approval" | "at_risk" | "completed";

export const BUCKET_LABEL: Record<WorkBucket, string> = {
  now: "Now",
  next: "Next",
  waiting: "Waiting",
  approval: "Approval",
  at_risk: "At risk",
  completed: "Completed",
};

export interface ScoredWork {
  item: StaffWorkItem;
  score: number;
  bucket: WorkBucket;
  reasons: string[];
  effortMinutes: number;
  effortBasis: string;
  band: PriorityBand;
}

const days = (iso: string | null | undefined) =>
  !iso ? null : Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

function slaView(item: StaffWorkItem, now: Date): { status: SlaStatus; remainingMinutes: number | null } {
  if (!item.sla_due_at) return { status: "none", remainingMinutes: null };
  const remaining = Math.round((new Date(item.sla_due_at).getTime() - now.getTime()) / 60_000);
  return {
    status: remaining < 0 ? "breached" : remaining < 24 * 60 ? "at_risk" : "on_track",
    remainingMinutes: remaining,
  };
}

function toFacts(item: StaffWorkItem, now: Date): WorkScoringFacts {
  const sla = slaView(item, now);
  return {
    id: item.id,
    title: item.title,
    workKind: item.work_kind,
    priority: item.priority,
    band: item.priority_band,
    effortMinutes: item.effort_minutes,
    effortBasis: item.effort_basis,
    valueKes: item.value_score,
    slaStatus: sla.status,
    slaRemainingMinutes: sla.remainingMinutes,
    slaDueAt: item.sla_due_at,
    lifecycleState: item.lifecycle_state,
    needsApproval: item.needs_approval,
    approvalState: item.approval_state,
    escalationLevel: item.escalation_level,
    qualityFlag: item.quality_flag,
    reviewState: item.review_state,
    nextAction: item.next_action,
    nextActionDue: item.next_action_due,
    objectiveId: item.objective_id,
  };
}

/** Score one work item through the canonical engine. */
export function scoreWork(item: StaffWorkItem, now = new Date()): ScoredWork {
  const sla = slaView(item, now);
  const scored = scoreWorkFacts(toFacts(item, now), now);
  return {
    item,
    score: scored.score,
    bucket: bucketFor(item, sla.remainingMinutes === null ? null : sla.remainingMinutes / 60),
    reasons: scored.reasons,
    effortMinutes: scored.effortMinutes,
    effortBasis: scored.effortBasis,
    band: scored.band,
  };
}

function bucketFor(item: StaffWorkItem, slaLeft: number | null): WorkBucket {
  if (item.status === "done") return "completed";
  if (item.status === "in_review" || item.review_state === "submitted") return "approval";
  if (item.status === "blocked" || item.status === "waiting") return "waiting";
  if (item.work_kind === "approval") return "approval";
  if (item.review_state === "returned") return "at_risk";
  if (slaLeft !== null && slaLeft < 24) return "at_risk";
  const dueIn = days(item.next_action_due);
  if (dueIn !== null && dueIn < 0) return "at_risk";
  if (item.priority === "critical" || item.priority === "high") return "now";
  return "next";
}


/** Score and group a work list into the MY WORK buckets. */
export function buildQueue(items: StaffWorkItem[]): Record<WorkBucket, ScoredWork[]> {
  const out: Record<WorkBucket, ScoredWork[]> = {
    now: [], next: [], waiting: [], approval: [], at_risk: [], completed: [],
  };
  const now = new Date();
  const scored = items.map((i) => scoreWork(i, now));
  // Bands are relative to the whole queue, so "everything is high" cannot happen.
  const bands = assignRelativeBands(scored, (s) => ({
    score: s.score,
    slaStatus: slaView(s.item, now).status,
  }));
  for (const s of scored) out[s.bucket].push({ ...s, band: bands.get(s) ?? s.band });
  for (const k of Object.keys(out) as WorkBucket[]) out[k].sort((a, b) => b.score - a.score);
  return out;
}

/** Capacity signal from recorded workload only — no surveillance inputs. */
export interface CapacitySignal {
  openItems: number;
  atRisk: number;
  overdue: number;
  state: "underutilised" | "balanced" | "overloaded" | "unknown";
  note: string;
}

export function capacitySignal(items: StaffWorkItem[]): CapacitySignal {
  const open = items.filter((i) => i.status !== "done");
  const scored = open.map((i) => scoreWork(i));
  const atRisk = scored.filter((s) => s.bucket === "at_risk").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((i) => i.next_action_due && i.next_action_due < today).length;
  if (items.length === 0) {
    return { openItems: 0, atRisk: 0, overdue: 0, state: "unknown", note: "No work assigned — capacity cannot be assessed." };
  }
  const state =
    open.length > 12 || atRisk > 3 ? "overloaded" : open.length <= 2 ? "underutilised" : "balanced";
  const note =
    state === "overloaded"
      ? "Reallocate or simplify before adding work. Hiring is not the first intervention."
      : state === "underutilised"
        ? "Spare capacity available for reallocation from overloaded colleagues."
        : "Workload within sustainable range.";
  return { openItems: open.length, atRisk, overdue, state, note };
}

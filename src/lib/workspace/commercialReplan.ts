/**
 * COMMERCIAL REPLAN — turns the carry-forward list into tomorrow's plan using
 * LIVE commercial facts, not a fixed rollover.
 *
 * Day Close previously carried every unfinished item forward at its recorded
 * effort estimate, which is how a person could end the day with more hours
 * queued for tomorrow than tomorrow contains. This engine reads what actually
 * moved on the authoritative pipeline (`commercial_opportunities` stage,
 * probability, value, last update) plus the account's own health (customers
 * waiting, overdue promises) and recommends an explicit disposition per item,
 * then fits only what real productive capacity allows.
 *
 * PURE. Every recommendation names the record it was derived from; nothing is
 * estimated here and no number is invented.
 */
import { businessMinutesBetween, NAIROBI_BUSINESS_CALENDAR } from "@/lib/work/businessTime";
import type { CarryForwardItem, TomorrowPrep } from "./prepareTomorrow";
import type { ScoredPersonalWork, WaitingCustomer } from "./personalOs";

/** A live opportunity as recorded on the authoritative pipeline. */
export interface OpportunitySignal {
  id: string;
  ref: string | null;
  stage: string;
  probabilityPct: number | null;
  valueKes: number | null;
  updatedAt: string | null;
}

export type ReplanDisposition =
  | "continue"
  | "reschedule"
  | "waiting"
  | "escalate"
  | "nurture"
  | "close";

export const REPLAN_LABEL: Record<ReplanDisposition, string> = {
  continue: "Do it tomorrow",
  reschedule: "Schedule for a later day",
  waiting: "Waiting on someone else",
  escalate: "Escalate to a manager",
  nurture: "Nurture — no immediate movement",
  close: "Close — nothing left to win",
};

export interface ReplanRecommendation {
  workId: string;
  title: string;
  disposition: ReplanDisposition;
  /** Plain-language justification for the employee. */
  why: string;
  /** The record and field the recommendation was read from. */
  evidence: string;
  effortMinutes: number;
  valueKes: number | null;
  stage: string | null;
  /** True when the item is inside tomorrow's real productive capacity. */
  withinCapacity: boolean;
}

export interface CommercialReplan {
  date: string;
  recommendations: ReplanRecommendation[];
  /** Productive minutes tomorrow, from the recorded capacity profile. */
  capacityMinutes: number | null;
  /** Minutes of work the recommendations place inside capacity. */
  plannedMinutes: number;
  /** Minutes of carried work that did NOT fit and needs a decision. */
  unplacedMinutes: number;
  /** True when carried demand exceeds recorded capacity. */
  capacityConflict: boolean;
  counts: Record<ReplanDisposition, number>;
  /** Opportunities whose stage changed today, from the live pipeline. */
  movedToday: number;
  /** Opportunities carried here that have not moved in 10+ working days. */
  stalled: number;
  note: string;
}

export interface ReplanContext {
  opportunities?: OpportunitySignal[];
  waiting?: WaitingCustomer[];
  /** Productive minutes available tomorrow, from `work_capacity_profiles`. */
  capacityMinutes?: number | null;
  now?: Date;
}

/** Working days since a record last changed; null when never recorded. */
function stalledDays(updatedAt: string | null, now: Date): number | null {
  if (!updatedAt) return null;
  return Math.floor(
    businessMinutesBetween(new Date(updatedAt), now, NAIROBI_BUSINESS_CALENDAR) / (8 * 60),
  );
}

const CLOSED_STAGES = new Set(["won", "lost"]);
const EARLY_STAGES = new Set(["lead", "qualified"]);
/** A carried item worth escalating rather than re-trying alone. */
const ESCALATION_VALUE_KES = 500_000;

function opportunityFor(
  item: CarryForwardItem,
  scored: ScoredPersonalWork[],
  opportunities: OpportunitySignal[],
): OpportunitySignal | null {
  const row = scored.find((s) => s.work.id === item.workId)?.work as
    | { entity_id?: string | null; entity_ref?: string | null }
    | undefined;
  if (!row) return null;
  return (
    opportunities.find((o) => o.id === row.entity_id) ??
    opportunities.find((o) => o.ref && o.ref === row.entity_ref) ??
    null
  );
}

function waitingFor(
  item: CarryForwardItem,
  scored: ScoredPersonalWork[],
  waiting: WaitingCustomer[],
): WaitingCustomer | null {
  const row = scored.find((s) => s.work.id === item.workId)?.work as
    | { entity_ref?: string | null }
    | undefined;
  if (!row?.entity_ref) return null;
  return waiting.find((w) => w.accountName === row.entity_ref) ?? null;
}

/**
 * Recommends a disposition per carried item from live commercial movement and
 * account health, then places only what tomorrow's recorded capacity holds.
 */
export function replanTomorrow(
  prep: TomorrowPrep,
  scored: ScoredPersonalWork[],
  ctx: ReplanContext = {},
): CommercialReplan {
  const now = ctx.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const opportunities = ctx.opportunities ?? [];
  const waiting = ctx.waiting ?? [];
  const capacityMinutes =
    typeof ctx.capacityMinutes === "number" && ctx.capacityMinutes > 0 ? ctx.capacityMinutes : null;

  const scoreOf = (workId: string) => scored.find((s) => s.work.id === workId)?.score ?? 0;
  const slaOf = (workId: string) => scored.find((s) => s.work.id === workId)?.work.sla.status ?? null;

  let stalled = 0;

  const graded = [...prep.carry]
    .sort((a, b) => scoreOf(b.workId) - scoreOf(a.workId))
    .map((item): ReplanRecommendation => {
      const opp = opportunityFor(item, scored, opportunities);
      const wait = waitingFor(item, scored, waiting);
      const idle = opp ? stalledDays(opp.updatedAt, now) : null;
      if (idle !== null && idle >= 10) stalled += 1;
      const valueKes = opp?.valueKes ?? null;
      const sla = slaOf(item.workId);

      let disposition: ReplanDisposition = "continue";
      let why = item.why;
      let evidence = "staff_work_items.lifecycle_state";

      if (opp && CLOSED_STAGES.has(opp.stage)) {
        disposition = "close";
        why = `The opportunity is already recorded as ${opp.stage} — there is nothing left to progress.`;
        evidence = `commercial_opportunities.stage = ${opp.stage}${opp.ref ? ` (${opp.ref})` : ""}`;
      } else if (!item.actionable) {
        disposition = "waiting";
        why = "Held for a decision that is not yours to make.";
        evidence = "staff_work_items.approval_state = pending";
      } else if (wait && (wait.overduePromises > 0 || (wait.waitingHours ?? 0) > 0)) {
        disposition = "continue";
        why = `${wait.accountName} has been waiting ${wait.waitingHours ?? 0} h on ${wait.openPromises} promise(s).`;
        evidence = "recorded customer commitments on this account";
      } else if (sla === "breached" && (valueKes ?? 0) >= ESCALATION_VALUE_KES) {
        disposition = "escalate";
        why = `Breached commitment on KSh ${Math.round(valueKes ?? 0).toLocaleString("en-KE")} of recorded value — a manager should intervene.`;
        evidence = `sla breached · commercial_opportunities.expected_value_cents${opp?.ref ? ` (${opp.ref})` : ""}`;
      } else if (opp && idle !== null && idle >= 10 && (opp.probabilityPct ?? 0) < 20) {
        disposition = "nurture";
        why = `No recorded movement in ${idle} working days and probability is ${opp.probabilityPct ?? 0}% — nurture rather than chase daily.`;
        evidence = `commercial_opportunities.updated_at = ${opp.updatedAt}`;
      } else if (opp && EARLY_STAGES.has(opp.stage) && (opp.probabilityPct ?? 0) < 40) {
        disposition = "reschedule";
        why = `Still at ${opp.stage} with ${opp.probabilityPct ?? 0}% probability — give it a dated slot rather than tomorrow's prime time.`;
        evidence = `commercial_opportunities.stage = ${opp.stage}`;
      } else if (opp) {
        why = `${opp.stage} stage, ${opp.probabilityPct ?? 0}% probability${
          valueKes ? `, KSh ${Math.round(valueKes).toLocaleString("en-KE")} recorded value` : ""
        }.`;
        evidence = `commercial_opportunities.stage = ${opp.stage}${opp.ref ? ` (${opp.ref})` : ""}`;
      }

      return {
        workId: item.workId,
        title: item.title,
        disposition,
        why,
        evidence,
        effortMinutes: item.effortMinutes,
        valueKes,
        stage: opp?.stage ?? null,
        withinCapacity: false,
      };
    });

  // Only "continue" work consumes tomorrow's capacity: everything else is a
  // decision, not a task. Capacity is filled highest-ranked first.
  let used = 0;
  for (const rec of graded) {
    if (rec.disposition !== "continue") continue;
    if (capacityMinutes === null || used + rec.effortMinutes <= capacityMinutes) {
      rec.withinCapacity = true;
      used += rec.effortMinutes;
    } else {
      rec.disposition = "reschedule";
      rec.why = `Tomorrow's recorded productive capacity is already committed — schedule this on a day that has room. ${rec.why}`;
      rec.evidence = `${rec.evidence}; work_capacity_profiles.productive_minutes = ${capacityMinutes}`;
    }
  }

  const counts = graded.reduce(
    (acc, r) => ({ ...acc, [r.disposition]: (acc[r.disposition] ?? 0) + 1 }),
    {
      continue: 0,
      reschedule: 0,
      waiting: 0,
      escalate: 0,
      nurture: 0,
      close: 0,
    } as Record<ReplanDisposition, number>,
  );

  const unplacedMinutes = graded
    .filter((r) => !r.withinCapacity && r.disposition === "reschedule")
    .reduce((t, r) => t + r.effortMinutes, 0);

  const movedToday = opportunities.filter((o) => (o.updatedAt ?? "").slice(0, 10) === today).length;

  const note =
    graded.length === 0
      ? "Nothing is unfinished — tomorrow opens clear."
      : `${counts.continue} item${counts.continue === 1 ? "" : "s"} fit tomorrow's recorded capacity; ${
          graded.length - counts.continue
        } need a decision instead of a rollover.`;

  return {
    date: prep.date,
    recommendations: graded,
    capacityMinutes,
    plannedMinutes: used,
    unplacedMinutes,
    capacityConflict: capacityMinutes !== null && prep.plannedMinutes > capacityMinutes,
    counts,
    movedToday,
    stalled,
    note,
  };
}

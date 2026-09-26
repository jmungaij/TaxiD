import type {
  PersonalCommitment,
  ScoredPersonalWork,
  WaitingCustomer,
} from "@/lib/workspace/personalOs";
import { humanizeMinutes } from "@/lib/workspace/humanTime";
import { isExternallyBlocked, workProvenance } from "@/lib/workspace/productivity";
import type { AvailableAction } from "@/lib/workspace/workEngine";

/**
 * RANKED NEXT BEST ACTIONS.
 *
 * One ordered list that merges two authoritative sources:
 *   1. work already assigned to the employee (scored by the personal OS), and
 *   2. real unowned records the employee could take (server-side availability).
 *
 * Ranking is deterministic and explainable — every entry carries the reasons
 * that produced its position, so the employee can trust the order before acting.
 */

export type RankedActionOrigin = "assigned" | "available";

/**
 * One named input into an action's rank, with the record it came from. Shown to
 * the employee so the order is auditable rather than asserted.
 */
export type RankFactor = {
  label: string;
  /** Points this factor contributed to the rank. */
  points: number;
  /** The recorded field the factor was read from. */
  evidence: string;
};

export type RankedAction = {
  key: string;
  origin: RankedActionOrigin;
  /** Present for assigned work — the executable work item. */
  workId: string | null;
  /** Present for available capacity — becomes work when taken. */
  action: AvailableAction | null;
  title: string;
  minutes: number;
  score: number;
  fitsWindow: boolean;
  accountId: string | null;
  accountName: string | null;
  reasons: string[];
  /** Every scored input behind the position, highest contribution first. */
  factors: RankFactor[];
  expectedOutcome: string;
  source: string;
};

export type RankContext = {
  commitments?: PersonalCommitment[];
  waiting?: WaitingCustomer[];
  nextActions?: { work_item_id: string | null; account_id: string; account_name: string | null }[];
  windowMinutes?: number;
  skipWorkId?: string | null;
  limit?: number;
};

/** Unowned work is real, but assigned commitments outrank it by design. */
const AVAILABLE_WEIGHT = 0.55;
/** Work that fits the time the employee actually has is preferred. */
const FITS_WINDOW_BONUS = 8;

export function rankNextBestActions(
  scored: ScoredPersonalWork[],
  available: AvailableAction[],
  ctx: RankContext = {},
): RankedAction[] {
  const window = Math.max(0, Math.round(ctx.windowMinutes ?? 0));
  const limit = ctx.limit ?? 6;

  const accountFor = (workId: string) => {
    const link =
      (ctx.nextActions ?? []).find((a) => a.work_item_id === workId) ??
      (ctx.commitments ?? []).find((c) => c.work_item_id === workId);
    return {
      accountId: link?.account_id ?? null,
      accountName: link?.account_name ?? null,
    };
  };

  const assigned: RankedAction[] = scored
    .filter((s) => s.work.id !== ctx.skipWorkId && !isExternallyBlocked(s.work))
    .map((s) => {
      const fits = window > 0 && s.effortMinutes <= window;
      const link = accountFor(s.work.id);
      const promise = (ctx.commitments ?? []).find(
        (c) =>
          c.work_item_id === s.work.id && (c.status === "open" || c.status === "in_progress"),
      );
      const wait = (ctx.waiting ?? []).find(
        (w) => w.accountName === (link.accountName ?? s.work.entity_ref),
      );

      const reasons: string[] = [];
      if (promise)
        reasons.push(`${promise.account_name ?? "A customer"} is waiting on: ${promise.commitment}`);
      if (wait?.waitingHours) reasons.push(`${wait.accountName} has been waiting ${wait.waitingHours}h`);
      for (const c of s.contributions.filter((c) => c.points > 0).slice(0, 3)) reasons.push(c.label);
      if (window > 0)
        reasons.push(
          fits
            ? `Fits the ${humanizeMinutes(window)} you have available`
            : `Needs ${humanizeMinutes(s.effortMinutes)} — longer than your ${humanizeMinutes(window)} window`,
        );

      // Scored work may arrive without contributions or a density figure (older
      // records, or work with no recorded effort). Factors describe what IS
      // recorded and stay silent about what is not.
      const factors: RankFactor[] = [
        ...(s.contributions ?? []).map((c) => ({
          label: c.label,
          points: c.points,
          evidence: c.evidence,
        })),
      ];
      if (typeof s.valuePerMinute === "number")
        factors.push({
          label: `Recorded value density KSh ${s.valuePerMinute.toLocaleString("en-KE")} per minute`,
          points: 0,
          evidence: `effort_minutes = ${s.effortMinutes} (${s.effortBasis})`,
        });
      if (promise)
        factors.push({
          label: `Open customer promise to ${promise.account_name ?? "the customer"}`,
          points: 0,
          evidence: `crm commitment due ${promise.due_at ?? "no date recorded"}`,
        });
      if (wait?.waitingHours)
        factors.push({
          label: `Customer waiting ${wait.waitingHours} h`,
          points: 0,
          evidence: "last recorded inbound contact on the account",
        });
      if (window > 0)
        factors.push({
          label: fits ? "Fits your available time" : "Longer than your available time",
          points: fits ? FITS_WINDOW_BONUS : 0,
          evidence: `estimate ${s.effortMinutes} min vs ${window} min free`,
        });
      factors.sort((a, b) => b.points - a.points);

      return {
        key: `assigned:${s.work.id}`,
        origin: "assigned" as const,
        workId: s.work.id,
        action: null,
        title: s.work.title,
        minutes: s.effortMinutes,
        score: s.score + (fits ? FITS_WINDOW_BONUS : 0),
        fitsWindow: fits,
        accountId: link.accountId,
        accountName: link.accountName ?? s.work.entity_ref ?? null,
        reasons,
        factors,
        expectedOutcome:
          s.work.required_action ??
          promise?.expected_outcome ??
          "Record the outcome on the canonical record",
        source: workProvenance(s.work),
      };
    });

  const takeable: RankedAction[] = available.map((a, i) => {
    const fits = window > 0 && a.suggestedMinutes <= window;
    return {
      key: `available:${a.kind}:${a.accountId ?? i}:${a.title}`,
      origin: "available" as const,
      workId: null,
      action: a,
      title: a.title,
      minutes: a.suggestedMinutes,
      score: a.valueScore * AVAILABLE_WEIGHT + (fits ? FITS_WINDOW_BONUS : 0),
      fitsWindow: fits,
      accountId: a.accountId,
      accountName: a.accountName,
      reasons: [a.reason, `Nobody currently owns this — priority ${a.priority}`],
      factors: [
        {
          label: `Unowned record value score ${Math.round(a.valueScore)}`,
          points: Math.round(a.valueScore * AVAILABLE_WEIGHT),
          evidence: `server availability · ${a.kind}`,
        },
        {
          label: `Declared priority ${a.priority}`,
          points: 0,
          evidence: a.reason,
        },
        ...(fits
          ? [
              {
                label: "Fits your available time",
                points: FITS_WINDOW_BONUS,
                evidence: `estimate ${a.suggestedMinutes} min vs ${window} min free`,
              },
            ]
          : []),
      ],
      expectedOutcome: a.reason,
      source: `available capacity · ${a.kind.replace(/_/g, " ")}`,
    };
  });

  return [...assigned, ...takeable]
    .sort((a, b) => b.score - a.score || a.minutes - b.minutes)
    .slice(0, limit);
}

/**
 * A time-boxed loop: as many ranked actions as genuinely fit the chosen sprint,
 * never more — an unachievable plan is worse than a short one.
 */
export function buildSprint(actions: RankedAction[], minutes: number): RankedAction[] {
  const loop: RankedAction[] = [];
  let remaining = minutes;
  for (const a of actions) {
    if (a.minutes <= remaining) {
      loop.push(a);
      remaining -= a.minutes;
    }
    if (remaining <= 2) break;
  }
  if (!loop.length && actions.length) loop.push(actions[0]);
  return loop;
}

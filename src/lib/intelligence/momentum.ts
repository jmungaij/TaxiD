/**
 * DEAL MOMENTUM AND IDLENESS.
 *
 * Momentum is not a subjective rating and not a hidden score: it is an
 * operational reading of observable facts — recorded changes in the window,
 * stage movement, time since the deal last moved, whether a priced proposal
 * exists, and whether the customer has replied.
 *
 * Idle thresholds vary by stage and deal size, because a KES 5m negotiation
 * going quiet for a week is not the same event as a new lead going quiet.
 */
import type { MovementSummary } from "./movement";

export const MOMENTUM_BANDS = ["accelerating", "progressing", "stable", "slowing", "stalled"] as const;
export type MomentumBand = (typeof MOMENTUM_BANDS)[number];

export const MOMENTUM_LABEL: Record<MomentumBand, string> = {
  accelerating: "Accelerating",
  progressing: "Progressing",
  stable: "Stable",
  slowing: "Slowing",
  stalled: "Stalled",
};

export interface MomentumInput {
  stage: string;
  valueCents: number | null;
  /** Last time the record itself moved. */
  updatedAt: string | null;
  /** Last recorded customer-facing interaction, if known. */
  lastInteractionAt?: string | null;
  /** Did the customer initiate the most recent interaction? */
  customerReplied?: boolean | null;
  hasProposal?: boolean;
  movement: MovementSummary | null;
}

export interface MomentumReading {
  band: MomentumBand;
  /** Days with no recorded movement. Null when nothing is dated. */
  idleDays: number | null;
  /** The threshold this deal is judged against, and why it is that number. */
  idleThresholdDays: number;
  idle: boolean;
  headline: string;
  reasons: string[];
}

const dayMs = 86_400_000;

const daysSince = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / dayMs) : null;
};

/**
 * Idle allowance by stage. Early stages get less patience than negotiation,
 * where customers legitimately go quiet while deciding internally.
 */
const STAGE_IDLE_DAYS: Record<string, number> = {
  new: 3,
  qualified: 5,
  quoted: 5,
  proposal: 4,
  negotiation: 7,
};

/** Large deals are chased sooner. */
function thresholdFor(stage: string, valueCents: number | null): { days: number; reason: string } {
  const base = STAGE_IDLE_DAYS[stage.toLowerCase()] ?? 7;
  const kes = valueCents == null ? null : valueCents / 100;
  if (kes != null && kes >= 1_000_000) {
    return { days: Math.max(2, base - 2), reason: `High-value deal (KES ${kes.toLocaleString()}) — chased sooner.` };
  }
  if (kes != null && kes < 100_000) {
    return { days: base + 2, reason: "Smaller deal — a longer quiet period is acceptable." };
  }
  return { days: base, reason: `Standard allowance for the ${stage.replace(/_/g, " ")} stage.` };
}

export function dealMomentum(input: MomentumInput, now: Date = new Date()): MomentumReading {
  const stage = (input.stage ?? "").toLowerCase();
  const reasons: string[] = [];
  const { days: idleThresholdDays, reason: thresholdReason } = thresholdFor(stage, input.valueCents);

  if (stage === "won" || stage === "lost") {
    return {
      band: stage === "won" ? "accelerating" : "stalled",
      idleDays: null,
      idleThresholdDays,
      idle: false,
      headline: stage === "won" ? "Closed won" : "Closed lost",
      reasons: [`Recorded as ${stage}.`],
    };
  }

  const recordIdle = daysSince(input.updatedAt, now);
  const contactIdle = daysSince(input.lastInteractionAt, now);
  const idleDays =
    recordIdle == null && contactIdle == null ? null : Math.min(recordIdle ?? 9_999, contactIdle ?? 9_999);
  const idle = idleDays != null && idleDays > idleThresholdDays;

  let score = 0;
  const moved = input.movement;
  if (moved) {
    if (moved.indicators.includes("stage_advanced")) {
      score += 3;
      reasons.push("Stage advanced in the last week.");
    }
    if (moved.indicators.includes("stage_regressed")) {
      score -= 2;
      reasons.push("Stage moved backwards.");
    }
    if (moved.indicators.includes("value_up")) {
      score += 2;
      reasons.push("Deal value grew.");
    }
    if (moved.indicators.includes("value_down")) {
      score -= 2;
      reasons.push("Deal value shrank.");
    }
    if (moved.indicators.includes("no_change")) {
      score -= 2;
      reasons.push(`No recorded change in ${moved.windowDays} days.`);
    }
  } else {
    reasons.push("No change history is available for this deal yet.");
  }

  if (input.customerReplied) {
    score += 2;
    reasons.push("The customer was the last to make contact.");
  } else if (contactIdle != null) {
    reasons.push(`Last customer contact ${contactIdle} day(s) ago, all from our side.`);
  }

  if (["quoted", "proposal", "negotiation"].includes(stage)) {
    if (input.hasProposal) {
      score += 1;
      reasons.push("A priced proposal is on record.");
    } else {
      score -= 2;
      reasons.push("This stage expects a proposal, and none is recorded.");
    }
  }

  if (idleDays == null) {
    reasons.push("Nothing is dated on this deal, so idle time cannot be read.");
  } else {
    reasons.push(`${idleDays} day(s) since anything moved (allowance ${idleThresholdDays}). ${thresholdReason}`);
    if (idle) score -= idleDays >= idleThresholdDays * 3 ? 4 : 2;
  }

  const band: MomentumBand =
    idleDays != null && idleDays >= idleThresholdDays * 3
      ? "stalled"
      : score >= 4
        ? "accelerating"
        : score >= 2
          ? "progressing"
          : score >= 0 && !idle
            ? "stable"
            : score <= -4
              ? "stalled"
              : "slowing";

  const headline =
    band === "stalled"
      ? idleDays != null
        ? `Stalled — nothing for ${idleDays} days`
        : "Stalled"
      : band === "slowing"
        ? "Slowing — needs a next step"
        : band === "accelerating"
          ? "Accelerating"
          : band === "progressing"
            ? "Progressing"
            : "Stable";

  return { band, idleDays, idleThresholdDays, idle, headline, reasons };
}

/** Deals that have gone quiet beyond their own allowance — "deal rot". */
export function idleDeals<T extends { momentum: MomentumReading }>(rows: T[]): T[] {
  return rows
    .filter((r) => r.momentum.idle)
    .sort((a, b) => (b.momentum.idleDays ?? 0) - (a.momentum.idleDays ?? 0));
}

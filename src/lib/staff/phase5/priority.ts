/**
 * Phase 5 — Enterprise Priority Engine and decision SLAs.
 *
 * Attention is the scarcest resource in the company, so situations are ranked
 * on a declared, auditable formula rather than by recency. Every weight is
 * visible and every contribution is explained, because a priority nobody can
 * interrogate is just another opinion.
 *
 * Reversibility lowers priority: an easily reversed action does not need to
 * consume executive attention ahead of an irreversible one.
 */
import type { Correlated } from "./correlation";

export const PRIORITY_WEIGHTS = {
  businessImpact: 0.22,
  urgency: 0.18,
  customerImpact: 0.14,
  revenueExposure: 0.16,
  operationalSeverity: 0.10,
  strategicImportance: 0.08,
  risk: 0.07,
  confidence: 0.05,
} as const;

export type PriorityFactor = keyof typeof PRIORITY_WEIGHTS;

/** Declared per-situation factor profile, 0–1. Not derived from the counts. */
const PROFILE: Record<string, Record<PriorityFactor, number>> = {
  customer_retention_risk: { businessImpact: 0.9, urgency: 0.7, customerImpact: 1.0, revenueExposure: 0.85, operationalSeverity: 0.6, strategicImportance: 0.8, risk: 0.6, confidence: 0.7 },
  marketplace_liquidity_gap: { businessImpact: 0.85, urgency: 0.9, customerImpact: 0.8, revenueExposure: 0.7, operationalSeverity: 0.9, strategicImportance: 0.85, risk: 0.6, confidence: 0.7 },
  revenue_recovery: { businessImpact: 0.8, urgency: 0.75, customerImpact: 0.4, revenueExposure: 1.0, operationalSeverity: 0.4, strategicImportance: 0.6, risk: 0.7, confidence: 0.8 },
  commercial_stall: { businessImpact: 0.65, urgency: 0.5, customerImpact: 0.4, revenueExposure: 0.7, operationalSeverity: 0.2, strategicImportance: 0.7, risk: 0.3, confidence: 0.7 },
  platform_integrity: { businessImpact: 0.7, urgency: 0.6, customerImpact: 0.5, revenueExposure: 0.5, operationalSeverity: 0.8, strategicImportance: 0.5, risk: 1.0, confidence: 0.6 },
};

export const SLA_CLASSES = ["immediate", "today", "this_week", "strategic", "monitor"] as const;
export type SlaClass = (typeof SLA_CLASSES)[number];

export const SLA_HOURS: Record<SlaClass, number | null> = {
  immediate: 4,
  today: 24,
  this_week: 120,
  strategic: 720,
  monitor: null,
};

export const SLA_LABEL: Record<SlaClass, string> = {
  immediate: "Immediate — decide within 4 hours",
  today: "Today — decide within 24 hours",
  this_week: "This week — decide within 5 working days",
  strategic: "Strategic — decide inside the planning cycle",
  monitor: "Monitor — no decision required yet",
};

export interface Prioritised {
  key: string;
  label: string;
  /** 0–100. */
  score: number;
  sla: SlaClass;
  deadlineAt: string | null;
  /** Factor-by-factor contribution, largest first. */
  contributions: { factor: PriorityFactor; weight: number; value: number; points: number }[];
  /** Confidence in the underlying evidence, 0–1. */
  confidence: number;
  reversible: boolean;
  correlation: Correlated;
  /** Plain statement of why this ranks where it does. */
  rationale: string;
}

/** Evidence confidence: readable contributors ÷ declared contributors. */
function evidenceConfidence(c: Correlated): number {
  const declared = c.situation.contributors.length;
  const readable = declared - c.blind.length;
  const base = declared === 0 ? 0 : readable / declared;
  const graded = c.grade === "correlated" ? 1 : c.grade === "observed" ? 0.85 : c.grade === "inferred" ? 0.6 : 0.3;
  return Math.round(base * graded * 100) / 100;
}

function slaFor(score: number, grade: Correlated["grade"]): SlaClass {
  if (grade === "modelled") return "monitor";
  if (score >= 78) return "immediate";
  if (score >= 62) return "today";
  if (score >= 45) return "this_week";
  return "strategic";
}

export function prioritise(correlations: readonly Correlated[]): Prioritised[] {
  const out: Prioritised[] = [];
  for (const c of correlations) {
    if (!c.present) continue;
    const profile = PROFILE[c.situation.key];
    if (!profile) continue;
    const confidence = evidenceConfidence(c);
    const contributions = (Object.keys(PRIORITY_WEIGHTS) as PriorityFactor[]).map((factor) => {
      const weight = PRIORITY_WEIGHTS[factor];
      const value = factor === "confidence" ? confidence : profile[factor];
      return { factor, weight, value, points: Math.round(weight * value * 100 * 10) / 10 };
    }).sort((a, b) => b.points - a.points);

    const raw = contributions.reduce((n, x) => n + x.points, 0);
    // Reversible situations are de-prioritised by a declared 8% discount.
    const reversible = c.situation.key === "commercial_stall";
    const score = Math.round(Math.min(100, raw * (reversible ? 0.92 : 1)));
    const sla = slaFor(score, c.grade);
    const hours = SLA_HOURS[sla];
    out.push({
      key: c.situation.key,
      label: c.situation.label,
      score,
      sla,
      deadlineAt: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
      contributions,
      confidence,
      reversible,
      correlation: c,
      rationale: `${contributions[0].factor} and ${contributions[1].factor} dominate; evidence graded ${c.grade} at ${Math.round(confidence * 100)}% confidence across ${c.evidence.length} observed signal(s)${c.blind.length ? `, ${c.blind.length} contributor(s) unreadable` : ""}.`,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** What matters most now — the five-item answer, never fifty alerts. */
export function whatMattersMost(items: readonly Prioritised[], limit = 5): Prioritised[] {
  return items.slice(0, limit);
}

/** Decisions whose SLA has elapsed and must escalate one tier. */
export function escalations(items: readonly Prioritised[], now = Date.now()): Prioritised[] {
  return items.filter((i) => i.deadlineAt !== null && new Date(i.deadlineAt).getTime() < now);
}

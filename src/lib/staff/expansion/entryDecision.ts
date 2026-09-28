/**
 * Phase 9.6 — Market entry decision engine.
 *
 * Six hard gates, evaluated in order. A gate with missing evidence fails
 * closed: the engine returns DEFER with the exact evidence required, never a
 * hopeful GO. The decision record is designed to be minuted verbatim.
 */
import type { AttractivenessResult } from "./attractiveness";
import type { ScenarioMatrix } from "./entrySimulator";
import { type MarketRecord, missingDecisionSignals } from "./marketModel";

export type EntryVerdict = "go" | "conditional_go" | "defer" | "no_go";

export interface EntryGate {
  id: string;
  name: string;
  passed: boolean | null;
  requirement: string;
  observed: string;
}

export interface EntryDecision {
  marketId: string;
  marketName: string;
  verdict: EntryVerdict;
  gates: EntryGate[];
  /** Conditions that must be satisfied before capital is released. */
  conditions: string[];
  /** Evidence the engine needs before it can decide at all. */
  evidenceRequired: string[];
  recommendedStrategy: string | null;
  rationale: string;
  decidedAt: string;
}

export interface DecisionThresholds {
  minAttractiveness: number;
  maxPeakCashKes: number;
  maxBreakevenMonths: number;
  maxUnservedSharePct: number;
  maxRegulatoryFriction: number;
}

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  minAttractiveness: 58,
  maxPeakCashKes: 120_000_000,
  maxBreakevenMonths: 18,
  maxUnservedSharePct: 25,
  maxRegulatoryFriction: 65,
};

export function decideEntry(
  record: MarketRecord,
  attractiveness: AttractivenessResult,
  matrix: ScenarioMatrix,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): EntryDecision {
  const gates: EntryGate[] = [];
  const evidenceRequired = missingDecisionSignals(record);
  const conditions: string[] = [];

  const base = matrix.scenarios.find((s) => s.strategy === "balanced_launch" && s.stress === "base") ?? null;
  const stressed = matrix.scenarios.filter((s) => s.stress !== "base");

  const push = (id: string, name: string, passed: boolean | null, requirement: string, observed: string) =>
    gates.push({ id, name, passed, requirement, observed });

  push("evidence", "Decision evidence complete",
    evidenceRequired.length === 0,
    "All six decision-critical market signals observed",
    evidenceRequired.length === 0 ? "All signals present" : `Missing: ${evidenceRequired.join(", ")}`);

  const score = attractiveness.score.value;
  push("attractiveness", "Attractiveness threshold",
    score === null ? null : score >= thresholds.minAttractiveness,
    `Score ≥ ${thresholds.minAttractiveness} with ≥60% weight evidenced`,
    score === null ? `Not assessable (${attractiveness.coveragePct}% weight evidenced)`
      : `${score}/100 · ${attractiveness.coveragePct}% weight evidenced`);

  const peak = base?.peakCashNeed.value ?? null;
  push("capital", "Capital ceiling",
    peak === null ? null : peak <= thresholds.maxPeakCashKes,
    `Peak cash need ≤ KES ${thresholds.maxPeakCashKes.toLocaleString()}`,
    peak === null ? "Not projectable" : `KES ${Math.round(peak).toLocaleString()}`);

  const be = base?.breakevenMonth.value ?? null;
  push("payback", "Breakeven horizon",
    be === null ? null : be <= thresholds.maxBreakevenMonths,
    `Contribution breakeven within ${thresholds.maxBreakevenMonths} months`,
    be === null ? "No breakeven inside the projected horizon" : `Month ${be}`);

  const unserved = base?.unservedShare ?? null;
  push("fulfilment", "Fulfilment integrity",
    unserved === null ? null : unserved <= thresholds.maxUnservedSharePct,
    `Unserved demand ≤ ${thresholds.maxUnservedSharePct}% of projected trips`,
    unserved === null ? "Not projectable" : `${unserved.toFixed(1)}% unserved`);

  const friction = record.signals.regulatoryFriction.value;
  push("regulatory", "Regulatory admissibility",
    friction === null ? null : friction <= thresholds.maxRegulatoryFriction,
    `Assessed friction ≤ ${thresholds.maxRegulatoryFriction}/100`,
    friction === null ? "Not assessed" : `${friction}/100`);

  const survivesStress = stressed.filter((s) => s.verdict === "viable" || s.verdict === "fragile").length;
  push("resilience", "Stress resilience",
    stressed.length === 0 ? null : survivesStress >= Math.ceil(stressed.length * 0.6),
    "At least 60% of stress cases remain viable or fragile-but-recoverable",
    stressed.length === 0 ? "No stress cases projectable"
      : `${survivesStress}/${stressed.length} stress cases survive`);

  const unknown = gates.filter((g) => g.passed === null);
  const failed = gates.filter((g) => g.passed === false);

  let verdict: EntryVerdict;
  let rationale: string;

  if (unknown.length > 0) {
    verdict = "defer";
    rationale = `Entry cannot be decided: ${unknown.length} gate${unknown.length > 1 ? "s" : ""} lack admissible evidence. TaxiD does not commit capital against an unevidenced market.`;
  } else if (failed.length === 0) {
    verdict = "go";
    rationale = "All entry gates pass on evidenced signals and the base case survives stress.";
  } else if (failed.length <= 2 && failed.every((g) => g.id !== "evidence" && g.id !== "regulatory")) {
    verdict = "conditional_go";
    rationale = `Entry is economically defensible but ${failed.length} gate${failed.length > 1 ? "s" : ""} fail — release capital only against the stated conditions.`;
    for (const g of failed) conditions.push(`${g.name}: ${g.requirement} (observed ${g.observed})`);
  } else {
    verdict = "no_go";
    rationale = `Entry is rejected: ${failed.map((g) => g.name).join(", ")} fail on evidenced signals.`;
  }

  if (unserved !== null && unserved > 15) {
    conditions.push("Lead with supply acquisition — demand generation must not outrun fulfilment capacity.");
  }

  return {
    marketId: record.definition.id,
    marketName: record.definition.name,
    verdict,
    gates,
    conditions,
    evidenceRequired,
    recommendedStrategy: matrix.mostRobustStrategy,
    rationale,
    decidedAt: new Date().toISOString(),
  };
}

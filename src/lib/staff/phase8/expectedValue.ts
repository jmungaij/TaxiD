/**
 * Phase 8.6 — Expected Economic Value (EEV) engine.
 *
 * Opportunities are never ranked by gross revenue. Each is scored on
 * risk-adjusted incremental contribution per unit of the constrained enterprise
 * capacity it consumes, and the ranking is fully explainable: every factor, its
 * weight and its contribution to the final number are returned.
 *
 * Objective: maximum risk-adjusted incremental economic value per unit of
 * constrained enterprise capacity.
 */
import { type Measure, type Provenance, clamp, weakestProvenance } from "./provenance";

export interface Opportunity {
  id: string;
  name: string;
  customer: string;
  service: string;
  /** Gross marketplace transaction value the opportunity would create. */
  transactionValue: number;
  /** Incremental contribution if won and fulfilled, in KES. */
  incrementalContribution: number;
  probabilityOfWinning: number;      // 0-1
  probabilityOfFulfilment: number;   // 0-1
  retentionValue: number;
  expansionValue: number;
  incrementalCost: number;
  /** 0-1, higher is riskier (credit, regulatory, delivery). */
  risk: number;
  timeToCashDays: number;
  /** Constrained capacity consumed, e.g. sales hours. */
  requiredCapacityHours: number;
  /** Working capital tied up, in KES. */
  requiredCapital: number;
  provenance: Provenance;
  source: string;
}

export interface EevFactor {
  key: string;
  label: string;
  /** Raw input restated for the reader. */
  input: string;
  /** Effect on the score: multiplicative factors show their multiplier. */
  effect: number;
  explanation: string;
}

export interface EevResult {
  opportunityId: string;
  name: string;
  expectedRevenue: Measure;
  expectedContribution: Measure;
  riskAdjustedContribution: Measure;
  /** Risk-adjusted contribution per constrained capacity hour. */
  valuePerCapacityHour: Measure;
  downside: Measure;
  probability: number;
  timeToCashDays: number;
  requiredCapacityHours: number;
  requiredCapital: number;
  factors: EevFactor[];
  provenance: Provenance;
  /** One sentence explaining the rank — never an opaque AI score. */
  rationale: string;
}

const MODEL_VERSION = "eev-1.0.0";
/** Time value applied per 30 days to cash that arrives later. */
const TIME_DECAY_PER_MONTH = 0.03;

function m(label: string, value: number, unit: Measure["unit"], provenance: Provenance, source: string, calculation: string): Measure {
  return {
    label, value, unit, provenance, source, calculation,
    asOf: new Date().toISOString(),
    confidence: provenance === "MODELLED" ? 65 : null,
    modelVersion: provenance === "MODELLED" ? MODEL_VERSION : undefined,
  };
}

export function scoreOpportunity(o: Opportunity): EevResult {
  const pWin = clamp(o.probabilityOfWinning, 0, 1);
  const pFulfil = clamp(o.probabilityOfFulfilment, 0, 1);
  const joint = pWin * pFulfil;
  const risk = clamp(o.risk, 0, 1);
  const timeFactor = 1 / (1 + TIME_DECAY_PER_MONTH * (Math.max(0, o.timeToCashDays) / 30));

  const grossValue = o.incrementalContribution + o.retentionValue + o.expansionValue - o.incrementalCost;
  const expectedContribution = grossValue * joint;
  const riskAdjusted = expectedContribution * (1 - risk) * timeFactor;
  const capacity = Math.max(0.25, o.requiredCapacityHours);
  const provenance = weakestProvenance([o.provenance, "MODELLED"]);

  const factors: EevFactor[] = [
    { key: "p_win", label: "Probability of winning", input: `${(pWin * 100).toFixed(0)}%`, effect: pWin, explanation: "Applied to all incremental value; an unwon deal contributes nothing." },
    { key: "p_fulfil", label: "Probability of fulfilment", input: `${(pFulfil * 100).toFixed(0)}%`, effect: pFulfil, explanation: "Marketplace supply must be able to serve the demand; unfulfilled demand destroys value." },
    { key: "contribution", label: "Incremental contribution", input: `KES ${o.incrementalContribution.toLocaleString()}`, effect: o.incrementalContribution, explanation: "Contribution, not transaction value — partner entitlement and taxes are excluded." },
    { key: "retention", label: "Retention value", input: `KES ${o.retentionValue.toLocaleString()}`, effect: o.retentionValue, explanation: "Value of keeping the customer transacting beyond this deal." },
    { key: "expansion", label: "Expansion value", input: `KES ${o.expansionValue.toLocaleString()}`, effect: o.expansionValue, explanation: "Evidence-backed cross-service expansion only." },
    { key: "cost", label: "Incremental cost", input: `KES ${o.incrementalCost.toLocaleString()}`, effect: -o.incrementalCost, explanation: "Deducted before probability weighting." },
    { key: "risk", label: "Risk discount", input: `${(risk * 100).toFixed(0)}%`, effect: 1 - risk, explanation: "Credit, regulatory and delivery risk reduce the usable value." },
    { key: "time", label: "Time-to-cash discount", input: `${o.timeToCashDays} days`, effect: timeFactor, explanation: `${(TIME_DECAY_PER_MONTH * 100).toFixed(0)}% per 30 days — cash later is worth less.` },
    { key: "capacity", label: "Constrained capacity", input: `${o.requiredCapacityHours} h`, effect: 1 / capacity, explanation: "The ranking metric is value per constrained hour, so cheap-to-win value ranks higher." },
  ];

  const src = o.source;
  return {
    opportunityId: o.id,
    name: o.name,
    expectedRevenue: m("Expected transaction value", o.transactionValue * joint, "kes", provenance, src, "transaction value × P(win) × P(fulfil)"),
    expectedContribution: m("Expected contribution", expectedContribution, "kes", provenance, src, "(contribution + retention + expansion − cost) × P(win) × P(fulfil)"),
    riskAdjustedContribution: m("Risk-adjusted contribution", riskAdjusted, "kes", provenance, src, "expected contribution × (1 − risk) × time-to-cash discount"),
    valuePerCapacityHour: m("Value per constrained hour", riskAdjusted / capacity, "kes", provenance, src, "risk-adjusted contribution ÷ required capacity hours"),
    downside: m("Downside if lost", -o.incrementalCost * (1 - joint), "kes", provenance, src, "incremental cost already committed × P(not won or not fulfilled)"),
    probability: joint,
    timeToCashDays: o.timeToCashDays,
    requiredCapacityHours: o.requiredCapacityHours,
    requiredCapital: o.requiredCapital,
    factors,
    provenance,
    rationale:
      `Ranked on KES ${Math.round(riskAdjusted / capacity).toLocaleString()} risk-adjusted contribution per constrained hour: ` +
      `${(joint * 100).toFixed(0)}% joint win/fulfil probability, ${(risk * 100).toFixed(0)}% risk discount, ` +
      `${o.timeToCashDays}-day time-to-cash, ${o.requiredCapacityHours} h of capacity.`,
  };
}

/** Ranked by value per constrained hour — deliberately not by deal size. */
export function rankOpportunities(opportunities: readonly Opportunity[]): EevResult[] {
  return opportunities
    .map(scoreOpportunity)
    .sort((a, b) => (b.valuePerCapacityHour.value ?? 0) - (a.valuePerCapacityHour.value ?? 0));
}

/** Where the largest deal is NOT the best deal, say so out loud. */
export function rankingInversions(results: readonly EevResult[]): string[] {
  const bySize = [...results].sort((a, b) => (b.expectedRevenue.value ?? 0) - (a.expectedRevenue.value ?? 0));
  const notes: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const byValue = results[i];
    if (bySize[i] && bySize[i].opportunityId !== byValue.opportunityId) {
      notes.push(`${byValue.name} outranks the larger ${bySize[i].name} on risk-adjusted value per constrained hour.`);
    }
  }
  return notes.slice(0, 5);
}

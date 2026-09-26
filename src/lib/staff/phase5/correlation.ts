/**
 * Phase 5 — Event correlation and the causal intelligence layer.
 *
 * Five alerts about one problem is noise. Correlation groups observed signals
 * into named business situations, so the organisation is presented with
 * "Customer retention risk" and its contributing evidence rather than five
 * unrelated notifications.
 *
 * Causal chains are explicitly graded — observed, correlated, inferred or
 * modelled — because a chain drawn from two counts is not a proven cause. The
 * grade is derived from the evidence actually available, never asserted.
 */
import type { IngestedSignal } from "./ingestion";

export type CausalGrade = "observed" | "correlated" | "inferred" | "modelled";

export const CAUSAL_GRADE_LABEL: Record<CausalGrade, string> = {
  observed: "Observed — each link is recorded in a system of record",
  correlated: "Correlated — the links co-occur; direction is not established",
  inferred: "Inferred — derived from recorded facts and business rules",
  modelled: "Modelled — no direct evidence; the chain is a hypothesis",
};

export interface SituationDefinition {
  key: string;
  label: string;
  /** Domain that owns the situation. */
  domain: "customer" | "commercial" | "marketplace" | "operations" | "finance" | "risk" | "people";
  /** Signals that, together, indicate this situation. */
  contributors: readonly string[];
  /** Minimum number of contributing signals before the situation is named. */
  minimum: number;
  /** Owning agent for orchestration. */
  owner: string;
  /** Coordination case the orchestrator would run. */
  coordination: string;
  /** The causal chain, cause first. */
  chain: readonly string[];
  /** Consequence at the end of the chain, and what would quantify it. */
  consequence: string;
  quantifiedBy: string | null;
}

export const SITUATIONS: readonly SituationDefinition[] = [
  {
    key: "customer_retention_risk",
    label: "Customer retention risk",
    domain: "customer",
    contributors: ["customer.at_risk", "sla.at_risk", "booking.delayed", "invoice.overdue"],
    minimum: 2,
    owner: "customer_success",
    coordination: "customer_at_risk",
    chain: [
      "Service failures recorded on customer journeys",
      "Fulfilment slips behind commitment",
      "Customer confidence falls",
      "Usage and settlement behaviour deteriorate",
      "Recurring revenue exposed",
    ],
    consequence: "Recurring corporate revenue at risk",
    quantifiedBy: "corporate_invoices",
  },
  {
    key: "marketplace_liquidity_gap",
    label: "Marketplace liquidity gap",
    domain: "marketplace",
    contributors: ["partner.capacity_low", "booking.delayed", "sla.at_risk"],
    minimum: 1,
    owner: "marketplace",
    coordination: "supply_shortage",
    chain: [
      "Available supply falls below observed demand",
      "Matching time lengthens",
      "Fulfilment is delayed",
      "Service commitments are missed",
      "Demand goes unserved and revenue is forgone",
    ],
    consequence: "Unserved demand and SLA exposure",
    quantifiedBy: "charter_bookings",
  },
  {
    key: "revenue_recovery",
    label: "Revenue recovery exposure",
    domain: "finance",
    contributors: ["invoice.overdue", "settlement.mismatch", "opportunity.stalled"],
    minimum: 1,
    owner: "finance",
    coordination: "invoice_overdue",
    chain: [
      "Invoices pass due without settlement",
      "Ledger and settlement records diverge",
      "Cash conversion slows",
      "Working capital exposure increases",
    ],
    consequence: "Cash at risk and collection cost",
    quantifiedBy: "corporate_invoices",
  },
  {
    key: "commercial_stall",
    label: "Commercial pipeline stall",
    domain: "commercial",
    contributors: ["opportunity.stalled", "customer.at_risk"],
    minimum: 1,
    owner: "sales",
    coordination: "stalled_opportunity",
    chain: [
      "Opportunities receive no qualifying activity",
      "Buying momentum decays",
      "Conversion rate falls",
      "Pipeline coverage of the revenue plan weakens",
    ],
    consequence: "Weighted pipeline value at risk",
    quantifiedBy: "charter_quotes",
  },
  {
    key: "platform_integrity",
    label: "Platform and data integrity degradation",
    domain: "risk",
    contributors: ["data.integrity_defect", "risk.threshold_crossed", "settlement.mismatch"],
    minimum: 2,
    owner: "data_quality",
    coordination: "invoice_overdue",
    chain: [
      "Integrity defects appear in operational records",
      "Risk thresholds are breached",
      "Downstream reporting and settlement become unreliable",
      "Decisions are taken on untrustworthy data",
    ],
    consequence: "Decision quality and financial reporting exposure",
    quantifiedBy: "data_quality_findings",
  },
];

export interface Correlated {
  situation: SituationDefinition;
  /** Contributing signals that were actually observed as raised. */
  evidence: IngestedSignal[];
  /** Contributors declared but unreadable — the situation is partially blind. */
  blind: string[];
  /** Total observed magnitude across contributing signals. */
  magnitude: number;
  grade: CausalGrade;
  /** True when the correlation threshold was met. */
  present: boolean;
}

/**
 * Grade the causal chain from the evidence actually present:
 *  - every contributor readable and raised → correlated (co-occurrence proven)
 *  - a single readable contributor         → observed at the first link only
 *  - partial visibility                    → inferred
 *  - nothing readable                      → modelled
 */
function grade(evidence: IngestedSignal[], blind: string[], contributors: number): CausalGrade {
  if (evidence.length === 0) return "modelled";
  if (blind.length > 0) return "inferred";
  if (evidence.length === contributors && contributors > 1) return "correlated";
  return evidence.length > 1 ? "correlated" : "observed";
}

export function correlate(signals: readonly IngestedSignal[]): Correlated[] {
  const byKey = new Map(signals.map((s) => [s.eventKey, s]));
  return SITUATIONS.map((situation) => {
    const evidence: IngestedSignal[] = [];
    const blind: string[] = [];
    for (const key of situation.contributors) {
      const sig = byKey.get(key);
      if (!sig || sig.state === "unavailable") { blind.push(key); continue; }
      if (sig.state === "raised") evidence.push(sig);
    }
    const magnitude = evidence.reduce((n, s) => n + (s.observed ?? 0), 0);
    return {
      situation,
      evidence,
      blind,
      magnitude,
      grade: grade(evidence, blind, situation.contributors.length),
      present: evidence.length >= situation.minimum,
    };
  });
}

/** Situations present now, strongest first. */
export function presentSituations(correlations: readonly Correlated[]): Correlated[] {
  return correlations.filter((c) => c.present).sort((a, b) => b.magnitude - a.magnitude);
}

/** Noise reduction achieved: raw signals collapsed into named situations. */
export function noiseReduction(signals: readonly IngestedSignal[], correlations: readonly Correlated[]) {
  const raw = signals.filter((s) => s.state === "raised").length;
  const grouped = presentSituations(correlations).length;
  return {
    raw,
    grouped,
    reduction: raw === 0 ? 0 : Math.max(0, Math.round(((raw - grouped) / raw) * 100)),
  };
}

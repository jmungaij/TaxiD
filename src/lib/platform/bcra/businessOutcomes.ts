/**
 * BCRA Phase 5 — Business Outcome Certification.
 *
 * Translates technical evidence into measurable business outcomes. Every
 * figure derives from existing registers (capability release, value streams,
 * dependency matrix, LCIF revenue exposure) — nothing is entered manually.
 */
import type { BcraCapabilityRegister, BcraCapabilityRelease } from "./capabilityRelease";
import type { ValueStreamRegister } from "./valueStreams";
import type { DependencyMatrixReport } from "./dependencyIntelligence";

export const OUTCOME_VERSION = "1.0.0";

export type BusinessConfidence = "high" | "moderate" | "low" | "insufficient";

export interface CapabilityOutcome {
  module: string;
  title: string;
  revenueProtected: boolean;
  revenueAtRiskKes: number;
  customerSlaProtected: boolean;
  expectedChurnReductionPct: number;
  operationalContinuity: number;
  financialIntegrity: number;
  complianceStatus: "compliant" | "at_risk" | "non_compliant";
  enterpriseRisk: "low" | "moderate" | "elevated" | "high";
  businessConfidence: BusinessConfidence;
  expectedBusinessImpact: string;
  score: number;
  passed: boolean;
}

export interface BusinessOutcomeRegister {
  version: string;
  outcomes: CapabilityOutcome[];
  totalRevenueAtRiskKes: number;
  revenueProtectedPct: number;
  slaProtectedPct: number;
  compliantPct: number;
  score: number;
  passed: boolean;
  confidence: BusinessConfidence;
  blockers: string[];
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function dimScore(cap: BcraCapabilityRelease, d: string): number {
  return cap.dimensions.find((x) => x.dimension === d)?.score ?? 0;
}

function confidence(score: number, blockers: number): BusinessConfidence {
  if (blockers > 0 && score < 70) return "insufficient";
  if (score >= 90 && blockers === 0) return "high";
  if (score >= 78) return "moderate";
  return "low";
}

export function certifyBusinessOutcomes(
  register: BcraCapabilityRegister,
  streams: ValueStreamRegister,
  dependencies: DependencyMatrixReport,
): BusinessOutcomeRegister {
  const outcomes: CapabilityOutcome[] = register.capabilities.map((cap) => {
    const financial = dimScore(cap, "financial");
    const customer = dimScore(cap, "customer");
    const operational = dimScore(cap, "operational");
    const compliance = dimScore(cap, "compliance");
    const node = dependencies.nodes.find((n) => n.module === cap.module);
    const chain = node?.chainScore ?? cap.score;
    const streamRisks = streams.streams.filter((s) => s.capabilities.includes(cap.module));
    const streamP0 = streamRisks.reduce((n, s) => n + s.risks.filter((r) => r.severity === "p0").length, 0);

    const continuity = clamp(operational * 0.5 + chain * 0.5);
    const integrity = clamp(financial * 0.6 + compliance * 0.4);
    const complianceStatus = compliance >= 85 ? "compliant" : compliance >= 70 ? "at_risk" : "non_compliant";
    const risk = chain < 60 || streamP0 > 0 ? "high" : chain < 75 ? "elevated" : chain < 88 ? "moderate" : "low";
    const score = clamp(continuity * 0.3 + integrity * 0.3 + customer * 0.2 + chain * 0.2);
    const blockers = cap.blockers.length + streamP0;

    return {
      module: cap.module,
      title: cap.title,
      revenueProtected: financial >= 80 && cap.revenueAtRiskKes === 0,
      revenueAtRiskKes: cap.revenueAtRiskKes,
      customerSlaProtected: customer >= 75 && streamRisks.every((s) => s.slaHonoured),
      // Churn reduction is a deterministic function of customer readiness above the floor.
      expectedChurnReductionPct: Math.max(0, Math.round((customer - 60) / 4)),
      operationalContinuity: continuity,
      financialIntegrity: integrity,
      complianceStatus,
      enterpriseRisk: risk,
      businessConfidence: confidence(score, blockers),
      expectedBusinessImpact:
        `${cap.title}: continuity ${continuity}/100, financial integrity ${integrity}/100, ` +
        `${cap.revenueAtRiskKes.toLocaleString()} KES exposed, limiting dimension '${cap.limitingDimension}'.`,
      score,
      passed: score >= 80 && complianceStatus === "compliant" && risk !== "high",
    };
  });

  const n = Math.max(1, outcomes.length);
  const score = clamp(outcomes.reduce((s, o) => s + o.score, 0) / n);
  const blockers = outcomes.filter((o) => !o.passed)
    .map((o) => `${o.module}: outcome ${o.score}/100 · risk=${o.enterpriseRisk} · compliance=${o.complianceStatus}`);

  return {
    version: OUTCOME_VERSION,
    outcomes,
    totalRevenueAtRiskKes: outcomes.reduce((s, o) => s + o.revenueAtRiskKes, 0),
    revenueProtectedPct: Math.round((outcomes.filter((o) => o.revenueProtected).length / n) * 100),
    slaProtectedPct: Math.round((outcomes.filter((o) => o.customerSlaProtected).length / n) * 100),
    compliantPct: Math.round((outcomes.filter((o) => o.complianceStatus === "compliant").length / n) * 100),
    score,
    passed: blockers.length === 0,
    confidence: confidence(score, blockers.length),
    blockers,
  };
}

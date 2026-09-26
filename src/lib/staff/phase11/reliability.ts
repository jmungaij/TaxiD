/**
 * Phase 11 §11.10, §11.11, §11.21, §11.22 — Trust & Safety intelligence, the
 * Reliability Engine, the exception learning loop and careful self-healing.
 *
 * Detection is never punishment: a risk finding must be scored, explained and
 * verified before any intervention, and the intervention itself is reviewed and
 * learned from. Self-healing is limited to reversible, non-financial,
 * non-safety-critical repair.
 */
import { clamp } from "@/lib/staff/phase8/provenance";

/* ------------------------------------------------------- trust & safety (11.10) */

export type RiskPattern =
  | "fraud"
  | "account_abuse"
  | "payment_anomaly"
  | "location_anomaly"
  | "identity_anomaly"
  | "provider_anomaly"
  | "customer_anomaly"
  | "collusion"
  | "unusual_cancellation"
  | "unusual_pricing"
  | "document_anomaly"
  | "high_risk_mission";

export const RISK_PATTERN_LABEL: Record<RiskPattern, string> = {
  fraud: "Fraud",
  account_abuse: "Account abuse",
  payment_anomaly: "Payment anomaly",
  location_anomaly: "Location anomaly",
  identity_anomaly: "Identity anomaly",
  provider_anomaly: "Provider anomaly",
  customer_anomaly: "Customer anomaly",
  collusion: "Collusion pattern",
  unusual_cancellation: "Unusual cancellations",
  unusual_pricing: "Unusual pricing",
  document_anomaly: "Document anomaly",
  high_risk_mission: "High-risk mission",
};

export type RiskStage = "detect" | "score" | "explain" | "verify" | "intervene" | "review" | "learn";

export const RISK_STAGES: readonly RiskStage[] = ["detect", "score", "explain", "verify", "intervene", "review", "learn"];

export interface RiskFinding {
  id: string;
  pattern: RiskPattern;
  subject: string;
  /** 0-100. */
  score: number | null;
  /** Machine-readable rationale. Without it the finding may not progress. */
  explanation: string | null;
  evidence: string[];
  /** Verification performed with a human or an authoritative document. */
  verified: boolean;
  reviewerRole: string | null;
}

export interface RiskResponse {
  finding: RiskFinding;
  /** Furthest stage the finding may legitimately reach right now. */
  stage: RiskStage;
  action: string;
  blocked: string | null;
  graduated: boolean;
}

/** Graduated response: no punishment on an opaque score. */
export function respondToRisk(f: RiskFinding): RiskResponse {
  if (f.score === null) {
    return { finding: f, stage: "detect", action: "Record the detection only", blocked: "No score — the finding cannot be prioritised", graduated: true };
  }
  if (!f.explanation) {
    return { finding: f, stage: "score", action: "Hold for explanation", blocked: "No machine-readable rationale — intervention prohibited", graduated: true };
  }
  if (f.evidence.length === 0) {
    return { finding: f, stage: "explain", action: "Request supporting evidence", blocked: "No evidence attached", graduated: true };
  }
  if (!f.verified) {
    return {
      finding: f, stage: "verify",
      action: f.score >= 70 ? "Request identity/payment verification from the subject" : "Monitor and re-score",
      blocked: "Not verified — punitive action prohibited", graduated: true,
    };
  }
  if (!f.reviewerRole) {
    return { finding: f, stage: "intervene", action: "Apply the least restrictive intervention and queue for review", blocked: "No named reviewer yet", graduated: true };
  }
  return { finding: f, stage: "learn", action: `Reviewed by ${f.reviewerRole}; outcome fed back to the detector`, blocked: null, graduated: true };
}

export interface TrustIntelligenceSummary {
  findings: number;
  patternsCovered: number;
  patternsTotal: number;
  blocked: number;
  reachedLearning: number;
  /** True when no finding produced punishment without verification and review. */
  noPunishmentWithoutReview: boolean;
}

export function summariseTrust(responses: readonly RiskResponse[]): TrustIntelligenceSummary {
  return {
    findings: responses.length,
    patternsCovered: new Set(responses.map((r) => r.finding.pattern)).size,
    patternsTotal: Object.keys(RISK_PATTERN_LABEL).length,
    blocked: responses.filter((r) => r.blocked !== null).length,
    reachedLearning: responses.filter((r) => r.stage === "learn").length,
    noPunishmentWithoutReview: responses.every((r) => r.stage !== "learn" || (r.finding.verified && r.finding.reviewerRole !== null)),
  };
}

/* ----------------------------------------------------------- reliability (11.11) */

export interface Slo {
  id: string;
  label: string;
  target: string;
  /** Observed value in the SLO's unit. null when not instrumented. */
  observed: number | null;
  /** Numeric threshold the observation must meet. */
  threshold: number;
  comparison: "lte" | "gte";
  unit: "percent" | "seconds" | "minutes" | "count";
  source: string;
}

export interface SloResult extends Slo {
  status: "met" | "breached" | "uninstrumented";
  /** Remaining error budget as a percentage of the allowance. */
  errorBudgetPct: number | null;
}

export function evaluateSlo(s: Slo): SloResult {
  if (s.observed === null) return { ...s, status: "uninstrumented", errorBudgetPct: null };
  const met = s.comparison === "gte" ? s.observed >= s.threshold : s.observed <= s.threshold;
  const budget =
    s.comparison === "gte"
      ? clamp(((s.observed - s.threshold) / Math.max(1, 100 - s.threshold)) * 100, -100, 100)
      : clamp(((s.threshold - s.observed) / Math.max(1, s.threshold)) * 100, -100, 100);
  return { ...s, status: met ? "met" : "breached", errorBudgetPct: Math.round(budget) };
}

export interface ReliabilityPosture {
  slos: SloResult[];
  met: number;
  breached: number;
  uninstrumented: number;
  mttdMinutes: number | null;
  mttrMinutes: number | null;
  eventLagSeconds: number | null;
  reconciliation: "balanced" | "variance" | "unknown";
  /** 0-100 share of SLOs that are instrumented at all. */
  observability: number;
  narrative: string;
}

export function assessReliability(input: {
  slos: readonly Slo[];
  mttdMinutes: number | null;
  mttrMinutes: number | null;
  eventLagSeconds: number | null;
  reconciliation: "balanced" | "variance" | "unknown";
}): ReliabilityPosture {
  const results = input.slos.map(evaluateSlo);
  const uninstrumented = results.filter((r) => r.status === "uninstrumented").length;
  const observability = results.length === 0 ? 0 : Math.round(((results.length - uninstrumented) / results.length) * 100);
  return {
    slos: results,
    met: results.filter((r) => r.status === "met").length,
    breached: results.filter((r) => r.status === "breached").length,
    uninstrumented,
    mttdMinutes: input.mttdMinutes,
    mttrMinutes: input.mttrMinutes,
    eventLagSeconds: input.eventLagSeconds,
    reconciliation: input.reconciliation,
    observability,
    narrative:
      observability === 100
        ? "Every declared SLO is instrumented."
        : `${uninstrumented} of ${results.length} SLOs are not yet instrumented — reliability cannot be claimed for those paths.`,
  };
}

/* ------------------------------------------------------------- exceptions (11.21) */

export type ExceptionClass = "one_off" | "systemic" | "provider_specific" | "customer_specific" | "market_specific" | "technology_specific" | "unclassified";

export interface ExceptionRecord {
  id: string;
  what: string;
  where: string;
  why: string | null;
  affected: string;
  economicImpactCents: number | null;
  resolution: string | null;
  timeToResolveMinutes: number | null;
  detectedByAi: boolean;
  aiRecommendationWorked: boolean | null;
  humanInterventionWorked: boolean | null;
  /** Signature used to spot recurrence. */
  signature: string;
}

export interface ClassifiedException extends ExceptionRecord {
  classification: ExceptionClass;
  recurrences: number;
  lesson: string | null;
}

/** Classify each exception and search actively for recurring failure patterns. */
export function classifyExceptions(records: readonly ExceptionRecord[]): ClassifiedException[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.signature, (counts.get(r.signature) ?? 0) + 1);

  return records.map((r) => {
    const recurrences = counts.get(r.signature) ?? 1;
    const classification: ExceptionClass =
      r.why === null
        ? "unclassified"
        : recurrences >= 3
          ? "systemic"
          : /provider|driver|operator/i.test(r.affected)
            ? "provider_specific"
            : /customer|account|corporate/i.test(r.affected)
              ? "customer_specific"
              : /integration|webhook|event|api|timeout/i.test(r.why)
                ? "technology_specific"
                : /market|city|zone|corridor/i.test(r.where)
                  ? "market_specific"
                  : "one_off";
    return {
      ...r,
      classification,
      recurrences,
      lesson:
        r.resolution === null
          ? null
          : `${classification.replace(/_/g, " ")}: ${r.what} resolved by ${r.resolution}${
              r.timeToResolveMinutes === null ? "" : ` in ${r.timeToResolveMinutes} min`
            }${r.detectedByAi ? " (AI detected)" : " (human detected)"}`,
    };
  });
}

export interface ExceptionLearning {
  total: number;
  systemic: number;
  unclassified: number;
  aiDetectionRate: number | null;
  aiRecommendationSuccessRate: number | null;
  meanTimeToResolveMinutes: number | null
  ;
  economicImpactCents: number | null;
  patterns: { signature: string; occurrences: number; example: string }[];
}

export function summariseExceptions(records: readonly ClassifiedException[]): ExceptionLearning {
  const withAiOutcome = records.filter((r) => r.aiRecommendationWorked !== null);
  const times = records.map((r) => r.timeToResolveMinutes).filter((v): v is number => v !== null);
  const impacts = records.map((r) => r.economicImpactCents).filter((v): v is number => v !== null);
  const grouped = new Map<string, ClassifiedException[]>();
  for (const r of records) grouped.set(r.signature, [...(grouped.get(r.signature) ?? []), r]);

  return {
    total: records.length,
    systemic: records.filter((r) => r.classification === "systemic").length,
    unclassified: records.filter((r) => r.classification === "unclassified").length,
    aiDetectionRate: records.length === 0 ? null : Math.round((records.filter((r) => r.detectedByAi).length / records.length) * 100),
    aiRecommendationSuccessRate:
      withAiOutcome.length === 0 ? null : Math.round((withAiOutcome.filter((r) => r.aiRecommendationWorked).length / withAiOutcome.length) * 100),
    meanTimeToResolveMinutes: times.length === 0 ? null : Math.round(times.reduce((a, v) => a + v, 0) / times.length),
    economicImpactCents: impacts.length === 0 ? null : impacts.reduce((a, v) => a + v, 0),
    patterns: Array.from(grouped.entries())
      .filter(([, rows]) => rows.length >= 2)
      .map(([signature, rows]) => ({ signature, occurrences: rows.length, example: rows[0].what }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5),
  };
}

/* ---------------------------------------------------------- self-healing (11.22) */

export type RepairStage = "detect" | "diagnose" | "recommend" | "authorise" | "repair" | "verify";

export interface RepairAction {
  id: string;
  fault: string;
  remedy: string;
  /** Whether the remedy touches financial or safety state. */
  touchesFinancialTruth: boolean;
  touchesSafetyState: boolean;
  reversible: boolean;
  diagnosis: string | null;
  authorisedBy: string | null;
  verification: string | null;
}

export interface RepairVerdict {
  action: RepairAction;
  stage: RepairStage;
  permitted: boolean;
  reason: string;
}

/** Self-healing never silently alters financial truth or safety-critical state. */
export function evaluateRepair(a: RepairAction): RepairVerdict {
  if (a.touchesFinancialTruth || a.touchesSafetyState) {
    return {
      action: a, stage: "recommend", permitted: false,
      reason: `Repair touches ${a.touchesFinancialTruth ? "financial truth" : "safety-critical state"} — it may only be recommended to a human`,
    };
  }
  if (!a.reversible) return { action: a, stage: "recommend", permitted: false, reason: "Repair is not reversible — human authorisation required" };
  if (a.diagnosis === null) return { action: a, stage: "detect", permitted: false, reason: "No diagnosis — repair withheld" };
  if (a.authorisedBy === null) return { action: a, stage: "authorise", permitted: false, reason: "Awaiting authorisation under the operations policy" };
  if (a.verification === null) return { action: a, stage: "repair", permitted: true, reason: "Repair may execute but must be verified before closure" };
  return { action: a, stage: "verify", permitted: true, reason: `Repaired and verified: ${a.verification}` };
}

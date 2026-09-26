/**
 * Phase 10 §10.10 + §10.15 — Provider 360 and Marketplace Quality Intelligence.
 *
 * Independent supply is a managed relationship, not a fleet registry row. The
 * quality score is deliberately decomposed: components and confidence are always
 * shown, so no opaque number decides a provider's livelihood.
 */
import { type Measure, clamp, liveMeasure, modelledMeasure, unavailableMeasure } from "../phase8/provenance";
import type { SupplyKind } from "./mission";

export interface ProviderIdentity {
  providerId: string;
  name: string;
  kind: SupplyKind;
  businessStructure: "individual" | "sole_proprietor" | "limited_company" | "partnership" | "unknown";
  markets: string[];
  services: string[];
  onboardedAt: string | null;
}

export interface ProviderObservations {
  resourceCount: number | null;
  driverCount: number | null;
  acceptanceRate: number | null;
  arrivalOnTimeRate: number | null;
  completionRate: number | null;
  cancellationRate: number | null;
  customerRating: number | null;
  complaintsPer100: number | null;
  slaComplianceRate: number | null;
  safetyIncidentsPer100: number | null;
  documentComplianceRate: number | null;
  paymentReliabilityRate: number | null;
  disputeRate: number | null;
  missionsCompleted: number | null;
  earningsCents: number | null;
  settledCents: number | null;
  contributionCents: number | null;
  asOf: string | null;
}

export interface QualityComponent {
  key: string;
  label: string;
  weight: number;
  /** 0-100 normalised, null when unobserved. */
  score: number | null;
  observed: string;
}

export interface ProviderQuality {
  score: number | null;
  /** Share of quality weight actually evidenced, 0-100. */
  coverage: number;
  confidence: number | null;
  components: QualityComponent[];
  /** Why the score is absent or weak. */
  note?: string;
}

export interface Provider360 {
  identity: ProviderIdentity;
  quality: ProviderQuality;
  fulfilment: Measure;
  earnings: Measure;
  contribution: Measure;
  lifetimeValue: Measure;
  riskFlags: string[];
  growthPotential: Measure;
  gaps: string[];
}

const RATE = (v: number | null) => (v === null ? null : clamp(v, 0, 100));
const INVERSE = (v: number | null, worst: number) => (v === null ? null : clamp(100 - (v / worst) * 100, 0, 100));

export function scoreProviderQuality(o: ProviderObservations): ProviderQuality {
  const components: QualityComponent[] = [
    { key: "acceptance", label: "Offer acceptance", weight: 12, score: RATE(o.acceptanceRate), observed: "dispatch offers accepted ÷ offers made" },
    { key: "arrival", label: "On-time arrival", weight: 12, score: RATE(o.arrivalOnTimeRate), observed: "arrivals within the promised window" },
    { key: "completion", label: "Completion", weight: 14, score: RATE(o.completionRate), observed: "accepted missions completed" },
    { key: "cancellation", label: "Cancellation discipline", weight: 10, score: INVERSE(o.cancellationRate, 25), observed: "provider-initiated cancellations (25% scored as zero)" },
    { key: "rating", label: "Customer rating", weight: 14, score: o.customerRating === null ? null : clamp((o.customerRating / 5) * 100, 0, 100), observed: "mean customer rating out of 5" },
    { key: "complaints", label: "Complaint rate", weight: 8, score: INVERSE(o.complaintsPer100, 10), observed: "complaints per 100 missions (10 scored as zero)" },
    { key: "sla", label: "SLA compliance", weight: 10, score: RATE(o.slaComplianceRate), observed: "missions meeting the contracted SLA" },
    { key: "safety", label: "Safety", weight: 10, score: INVERSE(o.safetyIncidentsPer100, 2), observed: "safety incidents per 100 missions (2 scored as zero)" },
    { key: "compliance", label: "Document compliance", weight: 6, score: RATE(o.documentComplianceRate), observed: "mandatory documents valid and in date" },
    { key: "payment", label: "Payment reliability", weight: 4, score: RATE(o.paymentReliabilityRate), observed: "settlements completed without exception" },
  ];

  const evidenced = components.filter((c) => c.score !== null);
  const total = components.reduce((a, c) => a + c.weight, 0);
  const evidencedWeight = evidenced.reduce((a, c) => a + c.weight, 0);
  const coverage = Math.round((evidencedWeight / total) * 100);

  /* Below half the weight, a single number would mislead more than it informs. */
  if (coverage < 50) {
    return {
      score: null,
      coverage,
      confidence: null,
      components,
      note: `Only ${coverage}% of quality weight is observed — Yalla will not publish a provider score on this evidence`,
    };
  }

  return {
    score: Math.round(evidenced.reduce((a, c) => a + (c.score ?? 0) * c.weight, 0) / evidencedWeight),
    coverage,
    confidence: Math.round(clamp(coverage * 0.8 + Math.min(20, (o.missionsCompleted ?? 0) / 5), 0, 100)),
    components,
    note: coverage < 85 ? `${100 - coverage}% of quality weight is still unobserved` : undefined,
  };
}

export function buildProvider360(identity: ProviderIdentity, o: ProviderObservations): Provider360 {
  const src = "drivers + dispatch_assignments + commercial_transactions";
  const asOf = o.asOf ?? new Date().toISOString();
  const gaps: string[] = [];
  const na = (label: string, unit: Measure["unit"], why: string) => {
    gaps.push(why);
    return unavailableMeasure(label, unit, src, why);
  };

  const quality = scoreProviderQuality(o);

  const fulfilment = o.completionRate === null
    ? na("Fulfilment rate", "percent", "Completion rate is not instrumented for this provider")
    : liveMeasure("Fulfilment rate", o.completionRate, "percent", src, "completed ÷ accepted missions", asOf);

  const earnings = o.earningsCents === null
    ? na("Provider earnings", "kes", "No settled earnings are recorded against this provider")
    : liveMeasure("Provider earnings", o.earningsCents / 100, "kes", src, "sum of partner entitlement on recognised transactions", asOf);

  const contribution = o.contributionCents === null
    ? na("Yalla contribution", "kes", "No contribution is recorded against this provider's missions")
    : liveMeasure("Yalla contribution", o.contributionCents / 100, "kes", src, "sum of contribution on recognised transactions", asOf);

  /* LTV is modelled, and is only stated when both a run rate and tenure exist. */
  const months = identity.onboardedAt
    ? Math.max(1, (Date.now() - new Date(identity.onboardedAt).getTime()) / (30 * 86_400_000))
    : null;
  const lifetimeValue = o.contributionCents === null || months === null
    ? na("Modelled lifetime value", "kes", "Requires observed contribution and a known onboarding date")
    : modelledMeasure(
        "Modelled lifetime value",
        (o.contributionCents / 100 / months) * 24,
        "kes",
        src,
        "observed monthly contribution × 24-month expected tenure",
        45,
        "yalla-p10-provider-1.0.0",
      );

  const growthPotential = quality.score === null || o.resourceCount === null
    ? na("Growth potential", "score", "Requires a published quality score and a declared resource count")
    : modelledMeasure(
        "Growth potential",
        clamp(quality.score * 0.6 + Math.min(40, o.resourceCount * 4), 0, 100),
        "score",
        src,
        "quality score (60%) + declared capacity headroom (capped at 40)",
        40,
        "yalla-p10-provider-1.0.0",
      );

  const riskFlags: string[] = [];
  if ((o.cancellationRate ?? 0) > 15) riskFlags.push(`Cancellation rate ${Math.round(o.cancellationRate ?? 0)}% exceeds the 15% marketplace tolerance`);
  if ((o.safetyIncidentsPer100 ?? 0) > 0.5) riskFlags.push("Safety incident rate is above the platform threshold");
  if ((o.documentComplianceRate ?? 100) < 100) riskFlags.push("One or more mandatory documents are expired or missing");
  if ((o.disputeRate ?? 0) > 5) riskFlags.push(`Dispute rate ${Math.round(o.disputeRate ?? 0)}% is elevated`);
  if (identity.businessStructure === "unknown") riskFlags.push("Business structure is not established — settlement and tax treatment are unverified");

  return { identity, quality, fulfilment, earnings, contribution, lifetimeValue, riskFlags, growthPotential, gaps };
}

/** Providers that must not be matched until an operator intervenes. */
export function suspendedFromMatching(p: Provider360): boolean {
  return p.riskFlags.some((f) => f.startsWith("Safety") || f.startsWith("One or more mandatory documents"));
}

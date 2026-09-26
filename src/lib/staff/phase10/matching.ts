/**
 * Phase 10 §10.4–10.5 — the Universal Matching Engine.
 *
 * The objective is not cheapest and not nearest. It is the BEST FEASIBLE MATCH
 * under Yalla's configured commercial, service and governance rules. Feasibility
 * is a hard gate — a provider that fails compliance, capacity, category or
 * availability is never scored, never ranked and never quietly preferred because
 * it is cheap.
 */
import type { Mission, SupplyKind } from "./mission";

export interface SupplyCandidate {
  providerId: string;
  providerName: string;
  kind: SupplyKind;
  /** Service categories the provider can serve. */
  categories: string[];
  /** Compliance credentials held and in date. */
  compliance: string[];
  /** Seats / units of capacity available for the window. */
  capacity: number | null;
  /** True only when the provider has declared availability for the window. */
  availableForWindow: boolean;
  /** Distance to mission origin in km; null when position is unknown. */
  distanceKm: number | null;
  /** Estimated minutes to reach the origin; null when unknown. */
  etaMinutes: number | null;
  /** 0-100 provider quality score from Provider 360. */
  qualityScore: number | null;
  /** Historical share of accepted missions fulfilled, 0-100. */
  fulfilmentRate: number | null;
  /** Historical share of offers accepted, 0-100. */
  acceptanceRate: number | null;
  /** Quoted price to the customer in cents. */
  priceCents: number | null;
  /** Provider entitlement in cents — used to derive Yalla contribution. */
  entitlementCents: number | null;
  /** Customer-declared preference for this provider, if any. */
  customerPreferred?: boolean;
  /** Provider-declared preference for this customer/account, if any. */
  providerPreferred?: boolean;
  riskFlags?: string[];
}

export interface MatchWeights {
  quality: number;
  fulfilment: number;
  price: number;
  proximity: number;
  contribution: number;
  preference: number;
  sla: number;
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  quality: 22,
  fulfilment: 20,
  price: 14,
  proximity: 14,
  contribution: 14,
  preference: 8,
  sla: 8,
};

export interface MatchPolicy {
  weights: MatchWeights;
  /** Providers below this quality score are never matched. */
  minQualityScore: number;
  /** Providers below this fulfilment rate are never matched. */
  minFulfilmentRate: number;
  /** Missions whose ETA exceeds the SLA by this factor are infeasible. */
  slaToleranceFactor: number;
  /** Contribution below this floor makes the match commercially infeasible. */
  minContributionCents: number;
}

export const DEFAULT_MATCH_POLICY: MatchPolicy = {
  weights: DEFAULT_MATCH_WEIGHTS,
  minQualityScore: 55,
  minFulfilmentRate: 70,
  slaToleranceFactor: 1.25,
  minContributionCents: 0,
};

export interface ScoreComponent {
  dimension: keyof MatchWeights;
  weight: number;
  /** 0-100 normalised score, or null when the input is not observed. */
  score: number | null;
  basis: string;
}

export interface MatchCandidateResult {
  providerId: string;
  providerName: string;
  feasible: boolean;
  /** Hard reasons the candidate cannot serve this mission. */
  infeasibilities: string[];
  /** 0-100 weighted score over evidenced dimensions only. */
  score: number | null;
  /** Share of scoring weight actually evidenced. */
  evidenceCoverage: number;
  components: ScoreComponent[];
  contributionCents: number | null;
  explanation: string;
}

export interface MatchResult {
  missionId: string;
  ranked: MatchCandidateResult[];
  rejected: MatchCandidateResult[];
  best: MatchCandidateResult | null;
  /** Why no match was made, when best is null. */
  noMatchReason?: string;
}

function feasibility(mission: Mission, c: SupplyCandidate, policy: MatchPolicy): string[] {
  const out: string[] = [];
  const req = mission.requirement;

  if (!mission.supplyKinds.includes(c.kind)) out.push(`${c.kind} cannot serve a ${mission.type} mission`);
  if (!c.availableForWindow) out.push("No declared availability for the mission window");
  if (!c.categories.includes(req.serviceCategory)) out.push(`Does not serve service category ${req.serviceCategory}`);

  for (const credential of req.compliance) {
    if (!c.compliance.includes(credential)) out.push(`Missing compliance credential ${credential}`);
  }

  const needed = req.seats ?? (req.weightKg ? 1 : null);
  if (needed !== null) {
    if (c.capacity === null) out.push("Capacity is not declared — feasibility cannot be established");
    else if (c.capacity < needed) out.push(`Capacity ${c.capacity} is below the required ${needed}`);
  }

  if (c.qualityScore !== null && c.qualityScore < policy.minQualityScore) {
    out.push(`Quality score ${Math.round(c.qualityScore)} is below the ${policy.minQualityScore} service floor`);
  }
  if (c.fulfilmentRate !== null && c.fulfilmentRate < policy.minFulfilmentRate) {
    out.push(`Fulfilment rate ${Math.round(c.fulfilmentRate)}% is below the ${policy.minFulfilmentRate}% floor`);
  }
  if (req.slaMinutes && c.etaMinutes !== null && c.etaMinutes > req.slaMinutes * policy.slaToleranceFactor) {
    out.push(`ETA ${c.etaMinutes} min breaches the ${req.slaMinutes} min SLA beyond tolerance`);
  }
  if (c.priceCents !== null && c.entitlementCents !== null) {
    const contribution = c.priceCents - c.entitlementCents;
    if (contribution < policy.minContributionCents) {
      out.push(`Contribution of ${contribution} cents is below the commercial floor`);
    }
  }
  for (const flag of c.riskFlags ?? []) out.push(`Risk flag: ${flag}`);
  return out;
}

function normalise(value: number | null, best: number | null, worst: number | null, lowerIsBetter: boolean): number | null {
  if (value === null || best === null || worst === null) return null;
  if (best === worst) return 100;
  const lo = Math.min(best, worst);
  const hi = Math.max(best, worst);
  const pct = ((value - lo) / (hi - lo)) * 100;
  return lowerIsBetter ? 100 - pct : pct;
}

export function matchMission(
  mission: Mission,
  candidates: readonly SupplyCandidate[],
  policy: MatchPolicy = DEFAULT_MATCH_POLICY,
): MatchResult {
  const evaluated = candidates.map((c) => ({ candidate: c, infeasibilities: feasibility(mission, c, policy) }));
  const feasible = evaluated.filter((e) => e.infeasibilities.length === 0).map((e) => e.candidate);

  const prices = feasible.map((c) => c.priceCents).filter((v): v is number => v !== null);
  const distances = feasible.map((c) => c.distanceKm).filter((v): v is number => v !== null);
  const contributions = feasible
    .map((c) => (c.priceCents !== null && c.entitlementCents !== null ? c.priceCents - c.entitlementCents : null))
    .filter((v): v is number => v !== null);

  const build = (c: SupplyCandidate, infeasibilities: string[]): MatchCandidateResult => {
    const contribution = c.priceCents !== null && c.entitlementCents !== null ? c.priceCents - c.entitlementCents : null;
    const w = policy.weights;
    const slaScore = mission.requirement.slaMinutes && c.etaMinutes !== null
      ? Math.max(0, Math.min(100, (1 - c.etaMinutes / (mission.requirement.slaMinutes || 1)) * 100 + 50))
      : null;

    const components: ScoreComponent[] = [
      { dimension: "quality", weight: w.quality, score: c.qualityScore, basis: "Provider 360 quality score" },
      { dimension: "fulfilment", weight: w.fulfilment, score: c.fulfilmentRate, basis: "historical fulfilment rate" },
      {
        dimension: "price",
        weight: w.price,
        score: normalise(c.priceCents, prices.length ? Math.min(...prices) : null, prices.length ? Math.max(...prices) : null, true),
        basis: "price relative to the feasible set",
      },
      {
        dimension: "proximity",
        weight: w.proximity,
        score: normalise(c.distanceKm, distances.length ? Math.min(...distances) : null, distances.length ? Math.max(...distances) : null, true),
        basis: "distance to origin relative to the feasible set",
      },
      {
        dimension: "contribution",
        weight: w.contribution,
        score: normalise(contribution, contributions.length ? Math.max(...contributions) : null, contributions.length ? Math.min(...contributions) : null, false),
        basis: "expected Yalla contribution relative to the feasible set",
      },
      {
        dimension: "preference",
        weight: w.preference,
        score: c.customerPreferred || c.providerPreferred ? (c.customerPreferred && c.providerPreferred ? 100 : 70) : 40,
        basis: "declared customer and provider preferences",
      },
      { dimension: "sla", weight: w.sla, score: slaScore, basis: "ETA against the mission SLA" },
    ];

    const evidenced = components.filter((k) => k.score !== null);
    const totalWeight = components.reduce((a, k) => a + k.weight, 0);
    const evidencedWeight = evidenced.reduce((a, k) => a + k.weight, 0);
    const score = evidencedWeight === 0
      ? null
      : Math.round(evidenced.reduce((a, k) => a + (k.score ?? 0) * k.weight, 0) / evidencedWeight);

    const top = [...evidenced].sort((a, b) => (b.score ?? 0) * b.weight - (a.score ?? 0) * a.weight)[0];
    return {
      providerId: c.providerId,
      providerName: c.providerName,
      feasible: infeasibilities.length === 0,
      infeasibilities,
      score,
      evidenceCoverage: Math.round((evidencedWeight / totalWeight) * 100),
      components,
      contributionCents: contribution,
      explanation: infeasibilities.length
        ? `Infeasible: ${infeasibilities[0]}`
        : score === null
          ? "Feasible but unscoreable — no scoring dimension is evidenced"
          : `Best on ${top?.dimension ?? "evidence"} (${top?.basis ?? "n/a"}); ${Math.round((evidencedWeight / totalWeight) * 100)}% of scoring weight evidenced`,
    };
  };

  const ranked = evaluated
    .filter((e) => e.infeasibilities.length === 0)
    .map((e) => build(e.candidate, []))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const rejected = evaluated
    .filter((e) => e.infeasibilities.length > 0)
    .map((e) => build(e.candidate, e.infeasibilities));

  const best = ranked.find((r) => r.score !== null) ?? null;
  return {
    missionId: mission.id,
    ranked,
    rejected,
    best,
    noMatchReason: best
      ? undefined
      : candidates.length === 0
        ? "No supply candidates were discovered for this mission"
        : ranked.length === 0
          ? `Every candidate was infeasible — leading reason: ${rejected[0]?.infeasibilities[0] ?? "unknown"}`
          : "Feasible supply exists but no scoring dimension is evidenced, so no match can be justified",
  };
}

/**
 * §10.5 multi-modal decision: are these requirements separate missions or one
 * coordinated programme? A programme requires a shared customer and an
 * overlapping or contiguous time envelope across more than one product line.
 */
export interface ModalDecision {
  coordinated: boolean;
  rationale: string;
  productLines: string[];
}

export function assessMultiModal(missions: readonly Mission[]): ModalDecision {
  if (missions.length < 2) {
    return { coordinated: false, rationale: "A single mission is never a programme", productLines: missions.map((m) => m.product) };
  }
  const customers = new Set(missions.map((m) => m.demand.accountId ?? m.demand.customerId));
  const lines = [...new Set(missions.map((m) => m.product))];
  if (customers.size > 1) {
    return { coordinated: false, rationale: "Missions belong to different customers and cannot share governance", productLines: lines };
  }
  const times = missions.map((m) => new Date(m.requirement.startAt).getTime()).filter((t) => !Number.isNaN(t));
  const span = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : 0;
  const contiguous = span <= 24 * 14;
  if (lines.length === 1 && !contiguous) {
    return { coordinated: false, rationale: "One product line and no shared time envelope — treat as separate missions", productLines: lines };
  }
  return {
    coordinated: contiguous,
    rationale: contiguous
      ? `One customer, ${lines.length} product line(s) inside a ${Math.round(span)} h envelope — orchestrate as one corporate mobility programme`
      : `Missions span ${Math.round(span / 24)} days beyond the programme envelope — orchestrate separately`,
    productLines: lines,
  };
}

/**
 * Phase 8.4 / 8.10 — Marketplace Liquidity Engine and the SAFARID Liquidity Index.
 *
 * SAFARID's growth is matching independent supply to demand, so liquidity is a
 * primary engine, not a dashboard tile. The index is transparent: every
 * component, its weight and its observed value are returned with the score, and
 * any missing component reduces confidence rather than being assumed.
 */
import { type Measure, type Provenance, clamp, liveMeasure, modelledMeasure, unavailableMeasure, weakestProvenance } from "./provenance";
import type { ServiceLine } from "./customerEconomics";

const MODEL_VERSION = "yli-1.0.0";

export interface LiquidityCellFacts {
  geography: string;
  service: ServiceLine;
  /** e.g. "Mon 07:00-09:00" — the demand window the cell describes. */
  window: string;
  /* demand */
  requests: number | null;
  bookings: number | null;
  /* supply */
  registeredProviders: number | null;
  activeProviders: number | null;
  acceptedOffers: number | null;
  offeredJobs: number | null;
  medianResponseSeconds: number | null;
  /* matching */
  matched: number | null;
  cancellations: number | null
  medianTimeToMatchSeconds: number | null;
  /* economics */
  transactionValue: number | null;
  contribution: number | null;
  incentiveCost: number | null;
  /* quality */
  qualityScore: number | null;
  provenance: Provenance;
  source: string;
}

export interface IndexComponent {
  key: string;
  label: string;
  weight: number;
  /** 0-100 normalised, or null when the input is unreadable. */
  score: number | null;
  observed: string;
}

export interface LiquidityCell {
  id: string;
  geography: string;
  service: ServiceLine;
  window: string;
  demandLevel: Measure;
  supplyLevel: Measure;
  conversion: Measure;
  fulfilmentProbability: Measure;
  acceptanceRate: Measure;
  cancellationRate: Measure;
  timeToMatch: Measure;
  contribution: Measure;
  /** SAFARID Liquidity Index 0-100 with its full component breakdown. */
  index: Measure;
  components: IndexComponent[];
  capacityDeficit: Measure;
  revenueOpportunity: Measure;
  recommendedPartnerAcquisition: Measure;
  confidence: number;
  provenance: Provenance;
  verdict: "liquid" | "supply_constrained" | "demand_constrained" | "not_evidenced";
}

const WEIGHTS: { key: string; label: string; weight: number }[] = [
  { key: "demand", label: "Demand intensity", weight: 0.18 },
  { key: "supply", label: "Available supply", weight: 0.2 },
  { key: "fulfilment", label: "Fulfilment probability", weight: 0.22 },
  { key: "response", label: "Response time", weight: 0.12 },
  { key: "cancellation", label: "Cancellation", weight: 0.13 },
  { key: "quality", label: "Quality", weight: 0.15 },
];

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

export function computeLiquidityCell(f: LiquidityCellFacts): LiquidityCell {
  const src = f.source;
  const na = (l: string, u: Measure["unit"], why: string) => unavailableMeasure(l, u, src, why);
  const live = (l: string, v: number | null, u: Measure["unit"], calc: string, why: string) =>
    v === null ? na(l, u, why) : liveMeasure(l, v, u, src, calc);

  const conversionR = ratio(f.bookings, f.requests);
  const fulfilR = ratio(f.matched, f.requests);
  const acceptR = ratio(f.acceptedOffers, f.offeredJobs);
  const cancelR = ratio(f.cancellations, f.bookings);

  const components: IndexComponent[] = WEIGHTS.map((w) => {
    switch (w.key) {
      case "demand":
        return { ...w, score: f.requests === null ? null : clamp(Math.log10(Math.max(1, f.requests)) * 33, 0, 100), observed: f.requests === null ? "no request record" : `${f.requests} requests` };
      case "supply":
        return { ...w, score: f.activeProviders === null ? null : clamp(Math.log10(Math.max(1, f.activeProviders)) * 40, 0, 100), observed: f.activeProviders === null ? "no active-provider record" : `${f.activeProviders} active providers` };
      case "fulfilment":
        return { ...w, score: fulfilR === null ? null : clamp(fulfilR * 100, 0, 100), observed: fulfilR === null ? "matched/requests unreadable" : `${(fulfilR * 100).toFixed(0)}% matched` };
      case "response":
        return { ...w, score: f.medianResponseSeconds === null ? null : clamp(100 - (f.medianResponseSeconds / 120) * 100, 0, 100), observed: f.medianResponseSeconds === null ? "no response telemetry" : `${f.medianResponseSeconds}s median response` };
      case "cancellation":
        return { ...w, score: cancelR === null ? null : clamp(100 - cancelR * 200, 0, 100), observed: cancelR === null ? "cancellation rate unreadable" : `${(cancelR * 100).toFixed(1)}% cancelled` };
      default:
        return { ...w, score: f.qualityScore === null ? null : clamp(f.qualityScore, 0, 100), observed: f.qualityScore === null ? "no quality signal" : `${f.qualityScore}/100 quality` };
    }
  });

  const usable = components.filter((c) => c.score !== null);
  const weightAvailable = usable.reduce((a, c) => a + c.weight, 0);
  const confidence = Math.round(weightAvailable * 100);

  const index: Measure = usable.length === 0
    ? na("SAFARID Liquidity Index", "score", "No liquidity component is readable for this cell")
    : modelledMeasure("SAFARID Liquidity Index",
        usable.reduce((a, c) => a + (c.score ?? 0) * c.weight, 0) / weightAvailable,
        "score", src,
        `weighted mean of ${usable.map((c) => c.label).join(", ")} (weights normalised over available components)`,
        confidence, MODEL_VERSION);

  const deficit = (f.requests !== null && f.matched !== null)
    ? liveMeasure("Capacity deficit", Math.max(0, f.requests - f.matched), "count", src, "requests less matched requests")
    : na("Capacity deficit", "count", "Requires request and match counts");

  const perTxnContribution = ratio(f.contribution, f.bookings);
  const opportunity = (deficit.value !== null && perTxnContribution !== null)
    ? modelledMeasure("Revenue opportunity", deficit.value * perTxnContribution, "kes", src,
        "capacity deficit × observed contribution per booking", Math.min(confidence, 70), MODEL_VERSION)
    : na("Revenue opportunity", "kes", "Requires a capacity deficit and observed contribution per booking");

  const jobsPerProvider = ratio(f.matched, f.activeProviders);
  const partners = (deficit.value !== null && jobsPerProvider !== null && jobsPerProvider > 0)
    ? modelledMeasure("Recommended partner acquisition", Math.ceil(deficit.value / jobsPerProvider), "count", src,
        "capacity deficit ÷ observed jobs per active provider", Math.min(confidence, 65), MODEL_VERSION)
    : na("Recommended partner acquisition", "count", "Requires observed jobs per active provider");

  const verdict: LiquidityCell["verdict"] =
    usable.length === 0 ? "not_evidenced"
      : (fulfilR !== null && fulfilR < 0.8 && (f.activeProviders ?? 0) >= 0 && (deficit.value ?? 0) > 0) ? "supply_constrained"
      : (f.requests !== null && f.activeProviders !== null && f.requests < f.activeProviders) ? "demand_constrained"
      : "liquid";

  return {
    id: `${f.geography}|${f.service}|${f.window}`,
    geography: f.geography,
    service: f.service,
    window: f.window,
    demandLevel: live("Demand", f.requests, "count", "COUNT of requests in window", "No request record"),
    supplyLevel: live("Active supply", f.activeProviders, "count", "COUNT of providers active in window", "No provider activity record"),
    conversion: conversionR === null ? na("Conversion", "percent", "Requires requests and bookings") : liveMeasure("Conversion", conversionR * 100, "percent", src, "bookings ÷ requests"),
    fulfilmentProbability: fulfilR === null ? na("Fulfilment probability", "percent", "Requires requests and matches") : liveMeasure("Fulfilment probability", fulfilR * 100, "percent", src, "matched ÷ requests"),
    acceptanceRate: acceptR === null ? na("Acceptance rate", "percent", "Requires offers and acceptances") : liveMeasure("Acceptance rate", acceptR * 100, "percent", src, "accepted ÷ offered"),
    cancellationRate: cancelR === null ? na("Cancellation rate", "percent", "Requires bookings and cancellations") : liveMeasure("Cancellation rate", cancelR * 100, "percent", src, "cancellations ÷ bookings"),
    timeToMatch: f.medianTimeToMatchSeconds === null ? na("Time to match", "count", "No match telemetry") : liveMeasure("Time to match (s)", f.medianTimeToMatchSeconds, "count", src, "median seconds from request to match"),
    contribution: f.contribution === null ? na("Contribution", "kes", "Economic model inputs not admissible for this cell") : liveMeasure("Contribution", f.contribution, "kes", src, "economic model contribution over the cell"),
    index,
    components,
    capacityDeficit: deficit,
    revenueOpportunity: opportunity,
    recommendedPartnerAcquisition: partners,
    confidence,
    provenance: weakestProvenance([f.provenance, index.provenance]),
    verdict,
  };
}

export function rankLiquidityCells(facts: readonly LiquidityCellFacts[]): LiquidityCell[] {
  return facts.map(computeLiquidityCell)
    .sort((a, b) => (b.revenueOpportunity.value ?? -1) - (a.revenueOpportunity.value ?? -1));
}

/* ---------------------------------------------- network effect intelligence */

export interface NetworkEffectFacts {
  demandDensity: number | null;
  supplyDensity: number | null;
  matchingEfficiency: number | null;
  customerRetention: number | null;
  partnerRetention: number | null;
  geographies: number | null;
  serviceBreadth: number | null;
  source: string;
  provenance: Provenance;
}

export interface NetworkEffectAssessment {
  signals: { label: string; value: Measure; direction: "reinforcing" | "balancing" | "unknown" }[];
  verdict: "reinforcing" | "congesting" | "not_evidenced";
  explanation: string;
}

export function assessNetworkEffects(f: NetworkEffectFacts): NetworkEffectAssessment {
  const mk = (label: string, v: number | null, unit: Measure["unit"], calc: string): Measure =>
    v === null ? unavailableMeasure(label, unit, f.source, "Signal not readable") : liveMeasure(label, v, unit, f.source, calc);

  const signals: NetworkEffectAssessment["signals"] = [
    { label: "Demand density", value: mk("Demand density", f.demandDensity, "count", "requests per active geography"), direction: "reinforcing" },
    { label: "Supply density", value: mk("Supply density", f.supplyDensity, "count", "active providers per geography"), direction: "reinforcing" },
    { label: "Matching efficiency", value: mk("Matching efficiency", f.matchingEfficiency, "percent", "matched ÷ requests"), direction: "reinforcing" },
    { label: "Customer retention", value: mk("Customer retention", f.customerRetention, "percent", "repeat customers ÷ customers"), direction: "reinforcing" },
    { label: "Partner retention", value: mk("Partner retention", f.partnerRetention, "percent", "retained providers ÷ providers"), direction: "reinforcing" },
    { label: "Geographic coverage", value: mk("Geographies", f.geographies, "count", "distinct served geographies"), direction: "reinforcing" },
    { label: "Service breadth", value: mk("Service breadth", f.serviceBreadth, "count", "distinct services transacted"), direction: "reinforcing" },
  ];

  const readable = signals.filter((s) => s.value.value !== null);
  if (readable.length < 3) {
    return { signals, verdict: "not_evidenced", explanation: "Fewer than three network signals are readable; no network-effect claim may be made." };
  }
  const efficiency = f.matchingEfficiency ?? null;
  const congesting = efficiency !== null && efficiency < 70 && (f.demandDensity ?? 0) > (f.supplyDensity ?? 0);
  return {
    signals,
    verdict: congesting ? "congesting" : "reinforcing",
    explanation: congesting
      ? "Demand density is outgrowing supply density while matching efficiency is below 70% — growth is currently producing congestion, not reinforcement."
      : "Observed signals are consistent with cross-side reinforcement; the claim is limited to the readable signals only.",
  };
}

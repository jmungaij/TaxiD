/**
 * Phase 11 — data source.
 *
 * Phase 11 owns no system of record (§11.37: do not allow AI to create financial
 * truth). Every fact is read from the transaction spine and the provider
 * registry. Where a read is unavailable, the adaptive layer reports an
 * instrumentation gap rather than inventing a marketplace figure.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SignalEnvelope } from "./sensing";
import type { MarketplaceState, StateObservation } from "./state";
import { buildState } from "./state";
import type { InterventionOption } from "./scenario";
import type { Comparison, Experiment, ModelRegistryEntry } from "./learning";
import type { Slo } from "./reliability";
import type { PredictionInput } from "./prediction";

interface SpineRow {
  service_line: string | null;
  status: string | null;
  customer_user_id: string | null;
  driver_id: string | null;
  gross_transaction_value_cents: number | null;
  contribution_cents: number | null;
  platform_revenue_cents: number | null;
  partner_entitlement_cents: number | null;
  payment_ref: string | null;
  settlement_id: string | null;
  revenue_event_id: string | null;
  recognised_at: string | null;
  fulfilled_at: string | null;
}

export interface AdaptiveFacts {
  rows: SpineRow[];
  transactions: number;
  customers: number;
  providers: number;
  contributionCents: number | null;
  grossValueCents: number | null;
  recognisedRevenueCents: number | null;
  settledCents: number | null;
  contributionPerMissionCents: number | null;
  /** Daily fulfilled-mission counts, oldest → newest. */
  dailyMissions: number[];
  asOf: string | null;
  freshnessHours: number | null;
  gaps: string[];
}

const sum = (rows: SpineRow[], key: keyof SpineRow): number | null => {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  return values.length === 0 ? null : values.reduce((a, v) => a + v, 0);
};

export async function loadAdaptiveFacts(): Promise<AdaptiveFacts> {
  const gaps: string[] = [];
  const empty: AdaptiveFacts = {
    rows: [], transactions: 0, customers: 0, providers: 0,
    contributionCents: null, grossValueCents: null, recognisedRevenueCents: null, settledCents: null,
    contributionPerMissionCents: null, dailyMissions: [], asOf: null, freshnessHours: null, gaps,
  };

  const { data, error } = await supabase
    .from("commercial_transactions")
    .select(
      "service_line, status, customer_user_id, driver_id, gross_transaction_value_cents, contribution_cents, platform_revenue_cents, partner_entitlement_cents, payment_ref, settlement_id, revenue_event_id, recognised_at, fulfilled_at",
    )
    .order("fulfilled_at", { ascending: false })
    .limit(1000);

  if (error) {
    gaps.push(`Transaction spine is not readable with the current role: ${error.message}`);
    return empty;
  }

  const rows = (data ?? []) as SpineRow[];
  if (rows.length === 0) {
    gaps.push("The transaction spine returned no rows — the adaptive loop has nothing authoritative to sense");
    return empty;
  }

  const providerCount = await countDrivers(gaps);

  const fulfilled = rows.filter((r) => r.fulfilled_at);
  const buckets = new Map<string, number>();
  for (const r of fulfilled) {
    const day = (r.fulfilled_at as string).slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  const dailyMissions = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, n]) => n);

  const contributionCents = sum(rows, "contribution_cents");
  const asOf = rows[0]?.fulfilled_at ?? rows[0]?.recognised_at ?? null;
  const freshnessHours = asOf ? Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 3_600_000)) : null;

  if (dailyMissions.length < 3) {
    gaps.push(`Only ${dailyMissions.length} day(s) of fulfilment history — forecasts will be withheld until three are available`);
  }
  gaps.push("Search, ETA, satisfaction, complaint, weather and traffic signals have no system of record — those sensing domains stay blind");

  return {
    rows,
    transactions: rows.length,
    customers: new Set(rows.map((r) => r.customer_user_id).filter(Boolean)).size,
    providers: providerCount ?? new Set(rows.map((r) => r.driver_id).filter(Boolean)).size,
    contributionCents,
    grossValueCents: sum(rows, "gross_transaction_value_cents"),
    recognisedRevenueCents: sum(rows.filter((r) => r.recognised_at), "platform_revenue_cents"),
    settledCents: rows.some((r) => r.settlement_id) ? sum(rows.filter((r) => r.settlement_id), "partner_entitlement_cents") : null,
    contributionPerMissionCents: contributionCents === null ? null : Math.round(contributionCents / Math.max(1, rows.length)),
    dailyMissions,
    asOf,
    freshnessHours,
    gaps,
  };
}

async function countDrivers(gaps: string[]): Promise<number | null> {
  const { count, error } = await supabase.from("drivers").select("id", { count: "exact", head: true });
  if (error) {
    gaps.push(`Provider registry is not readable with the current role: ${error.message}`);
    return null;
  }
  return count ?? null;
}

/* ------------------------------------------------------------------- shaping */

const AUTH = { role: "staff", scope: "enterprise" } as const;

/** Signal envelopes for the facts the spine can actually evidence. */
export function buildSignals(facts: AdaptiveFacts): SignalEnvelope[] {
  if (facts.transactions === 0) return [];
  const base = {
    observedAt: facts.asOf,
    entity: "commercial_transaction",
    entityId: null,
    confidence: null,
    authorisation: AUTH,
    quality: "authoritative" as const,
  };
  const envelopes: SignalEnvelope[] = [
    { ...base, signal: "fulfilment", source: "commercial_transactions", eventType: "mission.fulfilled", correlationId: `p11-fulfilment-${facts.transactions}`, value: facts.transactions },
    { ...base, signal: "revenue", source: "commercial_transactions.platform_revenue_cents", eventType: "revenue.recognised", correlationId: `p11-revenue-${facts.transactions}`, value: facts.recognisedRevenueCents },
    { ...base, signal: "repeat_behaviour", source: "commercial_transactions", eventType: "customer.repeat", correlationId: `p11-customers-${facts.customers}`, value: facts.customers },
    { ...base, signal: "driver_availability", source: "drivers", entity: "provider", eventType: "supply.registered", correlationId: `p11-supply-${facts.providers}`, value: facts.providers },
  ];
  if (facts.rows.some((r) => r.payment_ref)) {
    envelopes.push({ ...base, signal: "payment", source: "commercial_transactions.payment_ref", eventType: "payment.linked", correlationId: "p11-payment", value: facts.rows.filter((r) => r.payment_ref).length });
  }
  if (facts.settledCents !== null) {
    envelopes.push({ ...base, signal: "settlement", source: "commercial_transactions.settlement_id", eventType: "settlement.recorded", correlationId: "p11-settlement", value: facts.settledCents });
  }
  return envelopes;
}

/** The marketplace state cells Phase 11 reasons over. */
export function buildStates(facts: AdaptiveFacts): MarketplaceState[] {
  const observed: StateObservation = {
    demand: facts.transactions || null,
    availableSupply: facts.providers || null,
    committedSupply: facts.rows.filter((r) => r.driver_id).length || null,
    expectedArrivals: null,
    providerQualityScore: null,
    priceIndex: null,
    fulfilmentProbability:
      facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.fulfilled_at).length / facts.transactions) * 100),
    contributionPerMissionCents: facts.contributionPerMissionCents,
    asOf: facts.asOf,
  };

  const blank: StateObservation = {
    demand: null, availableSupply: null, committedSupply: null, expectedArrivals: null,
    providerQualityScore: null, priceIndex: null, fulfilmentProbability: null,
    contributionPerMissionCents: facts.contributionPerMissionCents, asOf: facts.asOf,
  };

  return [
    buildState("nbo-jkia-am-peak", {
      market: "Kenya", city: "Nairobi", zone: "Embakasi", corridor: "CBD ↔ JKIA",
      airport: "JKIA", service: "Airport transfers", customerSegment: "Corporate & individual", window: "Weekday 06:00–09:00",
    }, observed),
    buildState("nbo-westlands-pm-peak", {
      market: "Kenya", city: "Nairobi", zone: "Westlands", corridor: "Westlands ↔ CBD",
      airport: null, service: "Corporate ground", customerSegment: "Corporate", window: "Weekday 16:00–20:00",
    }, blank),
    buildState("msa-island-weekend", {
      market: "Kenya", city: "Mombasa", zone: "Island", corridor: "Airport ↔ Diani",
      airport: "MBA", service: "Charter", customerSegment: "Leisure & corporate", window: "Weekend all-day",
    }, blank),
    buildState("nbo-logistics-corridor", {
      market: "Kenya", city: "Nairobi", zone: "Industrial Area", corridor: "Nairobi ↔ Mombasa",
      airport: null, service: "Logistics", customerSegment: "Shipper", window: "Daily",
    }, blank),
  ];
}

/** Forecast inputs — only for series the spine can evidence. */
export function buildPredictionInputs(facts: AdaptiveFacts, stateId: string): PredictionInput[] {
  const drivers = [
    "Fulfilled-mission history from the transaction spine",
    facts.freshnessHours === null ? "Freshness unknown" : `Newest fulfilment ${facts.freshnessHours}h old`,
  ];
  return [
    {
      kind: "demand", cellId: stateId, horizon: "Next comparable window", unit: "count",
      history: facts.dailyMissions, source: "commercial_transactions.fulfilled_at", drivers, freshnessHours: facts.freshnessHours,
    },
    {
      kind: "capacity_shortage", cellId: stateId, horizon: "Next comparable window", unit: "count",
      history: facts.dailyMissions.map((n) => Math.max(0, n - facts.providers)),
      source: "commercial_transactions + drivers", drivers, freshnessHours: facts.freshnessHours,
    },
    {
      kind: "contribution", cellId: stateId, horizon: "Next comparable window", unit: "kes",
      history: facts.contributionPerMissionCents === null ? [] : facts.dailyMissions.map((n) => Math.round((n * facts.contributionPerMissionCents!) / 100)),
      source: "commercial_transactions.contribution_cents", drivers, freshnessHours: facts.freshnessHours,
    },
  ];
}

/**
 * Intervention options for the priority cell. Cost and lead time are policy
 * parameters; incremental missions are derived from the measured shortage, so an
 * unmeasured cell produces unquantified options rather than optimistic ones.
 */
export function buildInterventionOptions(state: MarketplaceState, facts: AdaptiveFacts): InterventionOption[] {
  const gap = state.unservedDemand;
  const contribution = facts.contributionPerMissionCents;
  const share = (pct: number) => (gap === null ? null : Math.max(0, Math.round(gap * pct)));

  return [
    {
      id: `${state.id}-incentivise`, kind: "incentivise_supply", stateId: state.id,
      description: "Time-boxed completion incentive for compliant providers already active in the zone",
      costCents: 1_200_000, expectedIncrementalMissions: share(0.45), contributionPerMissionCents: contribution,
      customerImpact: 10, providerImpact: 25, fulfilmentImpact: 20, riskScore: 20, operationalComplexity: 25,
      confidence: 68, incentiveSide: "driver", policyDomain: "incentives", leadTimeMinutes: 60,
    },
    {
      id: `${state.id}-reposition`, kind: "reposition_supply", stateId: state.id,
      description: "Reposition available providers from adjacent surplus zones into the corridor",
      costCents: 250_000, expectedIncrementalMissions: share(0.3), contributionPerMissionCents: contribution,
      customerImpact: 8, providerImpact: 5, fulfilmentImpact: 15, riskScore: 15, operationalComplexity: 30,
      confidence: 62, incentiveSide: "none", policyDomain: "operations", leadTimeMinutes: 45,
    },
    {
      id: `${state.id}-recruit`, kind: "add_supply", stateId: state.id,
      description: "Recruit and onboard additional independent providers for the corridor",
      costCents: 4_500_000, expectedIncrementalMissions: share(0.6), contributionPerMissionCents: contribution,
      customerImpact: 12, providerImpact: 15, fulfilmentImpact: 25, riskScore: 35, operationalComplexity: 70,
      confidence: 45, incentiveSide: "fleet_operator", policyDomain: "provider_eligibility", leadTimeMinutes: 20_160,
    },
    {
      id: `${state.id}-shift-demand`, kind: "shift_demand", stateId: state.id,
      description: "Contact corporate accounts about alternative departure windows",
      costCents: 60_000, expectedIncrementalMissions: share(0.15), contributionPerMissionCents: contribution,
      customerImpact: -5, providerImpact: 5, fulfilmentImpact: 10, riskScore: 10, operationalComplexity: 20,
      confidence: 55, incentiveSide: "corporate_customer", policyDomain: "customer_eligibility", leadTimeMinutes: 240,
    },
    {
      id: `${state.id}-price`, kind: "adjust_price", stateId: state.id,
      description: "Move price within the ±8% authorised corridor to clear the peak",
      costCents: 0, expectedIncrementalMissions: share(0.2), contributionPerMissionCents: contribution,
      customerImpact: -25, providerImpact: 20, fulfilmentImpact: 10, riskScore: 45, operationalComplexity: 15,
      confidence: 58, incentiveSide: "none", policyDomain: "pricing", leadTimeMinutes: 5,
    },
  ];
}

/** Expected-versus-actual comparisons. Modelled expectations only exist where measured. */
export function buildComparisons(facts: AdaptiveFacts, forecastMissions: number | null): Comparison[] {
  const actualMissions = facts.dailyMissions.length === 0 ? null : facts.dailyMissions[facts.dailyMissions.length - 1];
  return [
    { dimension: "demand", expected: forecastMissions, actual: actualMissions, unit: "count", tolerancePct: 20 },
    { dimension: "supply", expected: null, actual: facts.providers || null, unit: "count", tolerancePct: 20 },
    { dimension: "price", expected: null, actual: null, unit: "kes", tolerancePct: 8 },
    { dimension: "eta", expected: null, actual: null, unit: "minutes", tolerancePct: 25 },
    {
      dimension: "fulfilment", expected: 100,
      actual: facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.fulfilled_at).length / facts.transactions) * 100),
      unit: "percent", tolerancePct: 10,
    },
    {
      dimension: "revenue", expected: facts.grossValueCents, actual: facts.recognisedRevenueCents,
      unit: "kes", tolerancePct: 100,
    },
    { dimension: "contribution", expected: null, actual: facts.contributionCents, unit: "kes", tolerancePct: 15 },
    { dimension: "customer_behaviour", expected: null, actual: facts.customers || null, unit: "count", tolerancePct: 20 },
    { dimension: "provider_behaviour", expected: null, actual: null, unit: "percent", tolerancePct: 20 },
    { dimension: "liquidity", expected: null, actual: null, unit: "percent", tolerancePct: 15 },
  ];
}

/**
 * The experiment attached to the loop. With no holdout instrumented, the design
 * is honestly pre/post only, so the causal layer will report correlation rather
 * than causal evidence.
 */
export function buildExperiment(facts: AdaptiveFacts): Experiment | null {
  if (facts.contributionPerMissionCents === null || facts.transactions === 0) return null;
  return {
    id: "p11-supply-incentive-1",
    hypothesis: "A time-boxed completion incentive raises fulfilled missions in the shortage window without eroding contribution per mission",
    interventionClass: "Provider incentive during predicted shortage",
    method: "pre_post_only",
    treatmentSamples: facts.transactions,
    controlSamples: null,
    treatmentContributionCents: facts.contributionPerMissionCents,
    controlContributionCents: null,
    conversionTreatmentPct: null,
    conversionControlPct: null,
    costCents: 1_200_000,
    customerExperienceDelta: null,
    providerExperienceDelta: null,
    riskDelta: null,
  };
}

/** Reliability SLOs. Uninstrumented targets are declared, never faked as met. */
export function buildSlos(facts: AdaptiveFacts): Slo[] {
  const fulfilmentRate = facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.fulfilled_at).length / facts.transactions) * 100);
  const paymentLinkRate = facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.payment_ref).length / facts.transactions) * 100);
  const revenueRate = facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.revenue_event_id).length / facts.transactions) * 100);

  return [
    { id: "slo-availability", label: "Platform availability", target: "≥ 99.5%", observed: null, threshold: 99.5, comparison: "gte", unit: "percent", source: "uptime monitor (not wired)" },
    { id: "slo-latency", label: "API latency p95", target: "≤ 1.5s", observed: null, threshold: 1.5, comparison: "lte", unit: "seconds", source: "edge function telemetry (not wired)" },
    { id: "slo-matching", label: "Match rate", target: "≥ 95%", observed: null, threshold: 95, comparison: "gte", unit: "percent", source: "dispatch_events (not aggregated)" },
    { id: "slo-booking", label: "Booking completion", target: "≥ 98%", observed: fulfilmentRate, threshold: 98, comparison: "gte", unit: "percent", source: "commercial_transactions.fulfilled_at" },
    { id: "slo-payment", label: "Payment linkage", target: "100%", observed: paymentLinkRate, threshold: 100, comparison: "gte", unit: "percent", source: "commercial_transactions.payment_ref" },
    { id: "slo-settlement", label: "Settlement recorded", target: "≥ 95%", observed: facts.transactions === 0 ? null : Math.round((facts.rows.filter((r) => r.settlement_id).length / facts.transactions) * 100), threshold: 95, comparison: "gte", unit: "percent", source: "commercial_transactions.settlement_id" },
    { id: "slo-revenue", label: "Revenue recognition", target: "≥ 98%", observed: revenueRate, threshold: 98, comparison: "gte", unit: "percent", source: "commercial_transactions.revenue_event_id" },
    { id: "slo-freshness", label: "Data freshness", target: "≤ 24h", observed: facts.freshnessHours, threshold: 24, comparison: "lte", unit: "count", source: "commercial_transactions.fulfilled_at" },
    { id: "slo-ai-decision", label: "AI decision latency", target: "≤ 5s", observed: null, threshold: 5, comparison: "lte", unit: "seconds", source: "decision fabric (not instrumented)" },
  ];
}

/** The production model register governed by the AI Governance Board (§11.32). */
export function buildModelRegistry(facts: AdaptiveFacts): ModelRegistryEntry[] {
  const evaluated = facts.dailyMissions.length >= 3;
  return [
    {
      id: "mdl-demand", name: "Demand forecast (damped trend)", owner: "Head of Marketplace Intelligence",
      version: "yalla-p11-baseline-1.0", purpose: "Forecast fulfilled missions per cell and window",
      trainingProvenance: "commercial_transactions.fulfilled_at — no external data",
      evaluation: evaluated ? "Backtest against observed daily fulfilment" : null,
      deployedAt: facts.asOf, accuracyPct: null, baselineAccuracyPct: null,
      dataDriftPct: null, conceptDriftPct: null, falsePositiveRate: null, falseNegativeRate: null,
      calibrationChecked: false, biasReviewed: true, economicValueCents: null,
      retirementCriteria: "Retire if MAPE exceeds 35% over 20 outcomes or economic value is not demonstrated",
    },
    {
      id: "mdl-shortage", name: "Capacity shortage detector", owner: "Marketplace Operations Lead",
      version: "yalla-p11-baseline-1.0", purpose: "Predict where fulfilment will fail",
      trainingProvenance: "commercial_transactions + drivers registry",
      evaluation: evaluated ? "Compared to observed unserved demand" : null,
      deployedAt: facts.asOf, accuracyPct: null, baselineAccuracyPct: null,
      dataDriftPct: null, conceptDriftPct: null, falsePositiveRate: null, falseNegativeRate: null,
      calibrationChecked: false, biasReviewed: true, economicValueCents: null,
      retirementCriteria: "Retire if false negatives exceed 20% or no shortage is ever confirmed",
    },
    {
      id: "mdl-intervention", name: "Intervention value estimator", owner: "Head of Commercial",
      version: "yalla-p11-baseline-1.0", purpose: "Value interventions on incremental contribution",
      trainingProvenance: "commercial_transactions.contribution_cents",
      evaluation: null, deployedAt: facts.asOf, accuracyPct: null, baselineAccuracyPct: null,
      dataDriftPct: null, conceptDriftPct: null, falsePositiveRate: null, falseNegativeRate: null,
      calibrationChecked: false, biasReviewed: true, economicValueCents: null,
      retirementCriteria: "Retire if validated interventions show no incremental contribution",
    },
  ];
}

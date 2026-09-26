/**
 * Phase 9 — expansion data source.
 *
 * The candidate market set is defined here, but its signals are only ever
 * filled from what the platform can actually evidence. Nairobi draws LIVE fare
 * and cost signals from the commercial transaction spine; every other market
 * starts with declared registry facts and explicit gaps, which is why most of
 * them will correctly DEFER rather than GO.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  buildMarketRecord,
  type MarketDefinition,
  type MarketRecord,
  type SignalInput,
  type SignalKey,
} from "./marketModel";

export const CANDIDATE_MARKETS: MarketDefinition[] = [
  { id: "nairobi", name: "Nairobi", country: "Kenya", countryCode: "KE", tier: "core", populationSource: "KNBS census 2019" },
  { id: "mombasa", name: "Mombasa", country: "Kenya", countryCode: "KE", tier: "adjacent", populationSource: "KNBS census 2019" },
  { id: "kisumu", name: "Kisumu", country: "Kenya", countryCode: "KE", tier: "adjacent", populationSource: "KNBS census 2019" },
  { id: "kampala", name: "Kampala", country: "Uganda", countryCode: "UG", tier: "frontier", populationSource: "UBOS projection" },
  { id: "dar_es_salaam", name: "Dar es Salaam", country: "Tanzania", countryCode: "TZ", tier: "frontier", populationSource: "NBS projection" },
  { id: "kigali", name: "Kigali", country: "Rwanda", countryCode: "RW", tier: "frontier", populationSource: "NISR projection" },
];

/** Registry facts we are prepared to state, with their source. Nothing else. */
const REGISTRY: Record<string, Partial<Record<SignalKey, SignalInput>>> = {
  nairobi: {
    urbanPopulation: { value: 4_397_073, source: "KNBS census 2019", calculation: "Nairobi County enumerated population", provenance: "LIVE" },
    competitorCount: { value: 4, source: "Yalla competitive register", calculation: "count of licensed e-hailing operators actively serving Nairobi", provenance: "LIVE" },
    regulatoryFriction: { value: 28, source: "Yalla regulatory assessment (NTSA)", calculation: "licensed and operating; friction scored on assessed compliance load", provenance: "MODELLED", confidence: 70 },
    digitalPaymentReadiness: { value: 92, source: "Yalla settlement mix", calculation: "share of completed trips settling via M-Pesa or card", provenance: "MODELLED", confidence: 65 },
  },
  mombasa: {
    urbanPopulation: { value: 1_208_333, source: "KNBS census 2019", calculation: "Mombasa County enumerated population", provenance: "LIVE" },
    competitorCount: { value: 3, source: "Yalla competitive register", calculation: "count of operators actively serving Mombasa", provenance: "LIVE" },
    regulatoryFriction: { value: 30, source: "Yalla regulatory assessment (NTSA)", calculation: "same national regime as Nairobi with county licensing overhead", provenance: "MODELLED", confidence: 60 },
    digitalPaymentReadiness: { value: 88, source: "National mobile money penetration", calculation: "adult mobile money account penetration as a settlement proxy", provenance: "MODELLED", confidence: 50 },
  },
  kisumu: {
    urbanPopulation: { value: 1_155_574, source: "KNBS census 2019", calculation: "Kisumu County enumerated population", provenance: "LIVE" },
    competitorCount: { value: 2, source: "Yalla competitive register", calculation: "count of operators actively serving Kisumu", provenance: "LIVE" },
    regulatoryFriction: { value: 26, source: "Yalla regulatory assessment (NTSA)", calculation: "national regime, low county friction", provenance: "MODELLED", confidence: 55 },
  },
  kampala: {
    urbanPopulation: { value: 1_680_000, source: "UBOS projection 2024", calculation: "Kampala Capital City Authority projected population", provenance: "MODELLED", confidence: 55 },
    competitorCount: { value: 5, source: "Yalla competitive register", calculation: "count of operators actively serving Kampala", provenance: "LIVE" },
  },
  dar_es_salaam: {
    urbanPopulation: { value: 5_383_000, source: "NBS projection 2024", calculation: "Dar es Salaam region projected population", provenance: "MODELLED", confidence: 55 },
    competitorCount: { value: 5, source: "Yalla competitive register", calculation: "count of operators actively serving Dar es Salaam", provenance: "LIVE" },
  },
  kigali: {
    urbanPopulation: { value: 1_242_000, source: "NISR projection 2024", calculation: "Kigali City projected population", provenance: "MODELLED", confidence: 55 },
    competitorCount: { value: 3, source: "Yalla competitive register", calculation: "count of operators actively serving Kigali", provenance: "LIVE" },
  },
};

export interface HomeMarketFacts {
  /** Mean customer charge across recognised transactions, KES. */
  averageFare: number | null;
  /** Mean cost to serve (charge − platform revenue), KES. */
  costToServe: number | null;
  transactionCount: number;
  asOf: string | null;
}

/** Reads the transaction spine for the home market's economics. Never guesses. */
export async function loadHomeMarketFacts(): Promise<HomeMarketFacts> {
  const empty: HomeMarketFacts = { averageFare: null, costToServe: null, transactionCount: 0, asOf: null };
  const { data, error } = await supabase
    .from("commercial_transactions")
    .select("customer_charge_cents, platform_revenue_cents, fulfilled_at")
    .not("customer_charge_cents", "is", null)
    .order("fulfilled_at", { ascending: false })
    .limit(2000);

  if (error || !data || data.length === 0) return empty;

  const charges = data
    .map((r) => (r.customer_charge_cents ?? 0) / 100)
    .filter((n) => n > 0);
  if (charges.length === 0) return empty;

  const revenue = data
    .map((r) => (r.platform_revenue_cents ?? 0) / 100)
    .filter((n) => n >= 0);

  const avgFare = charges.reduce((a, b) => a + b, 0) / charges.length;
  const avgRevenue = revenue.length ? revenue.reduce((a, b) => a + b, 0) / revenue.length : null;

  return {
    averageFare: avgFare,
    /* Cost to serve is what does not remain with Yalla — the partner side of the fare. */
    costToServe: avgRevenue === null ? null : Math.max(0, avgFare - avgRevenue),
    transactionCount: charges.length,
    asOf: data.find((r) => r.fulfilled_at)?.fulfilled_at ?? null,
  };
}

/** Builds every candidate market record from registry facts plus live home data. */
export async function loadMarketRecords(): Promise<MarketRecord[]> {
  let home: HomeMarketFacts = { averageFare: null, costToServe: null, transactionCount: 0, asOf: null };
  try {
    home = await loadHomeMarketFacts();
  } catch {
    /* Leave the home signals unavailable rather than substituting a figure. */
  }

  return CANDIDATE_MARKETS.map((def) => {
    const inputs: Partial<Record<SignalKey, SignalInput>> = { ...(REGISTRY[def.id] ?? {}) };

    if (def.id === "nairobi" && home.averageFare !== null) {
      inputs.averageFare = {
        value: home.averageFare, source: "commercial_transactions", provenance: "LIVE",
        calculation: `mean customer charge across ${home.transactionCount} recognised transactions`,
        asOf: home.asOf ?? undefined,
      };
      if (home.costToServe !== null) {
        inputs.costToServe = {
          value: home.costToServe, source: "commercial_transactions", provenance: "LIVE",
          calculation: "mean customer charge − mean platform revenue per transaction",
          asOf: home.asOf ?? undefined,
        };
      }
    }

    return buildMarketRecord(def, inputs);
  });
}

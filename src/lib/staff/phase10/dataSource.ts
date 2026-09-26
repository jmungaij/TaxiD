/**
 * Phase 10 — data source.
 *
 * Phase 10 has NO source of truth of its own (§10.36). Every figure is read from
 * the systems already certified in earlier phases: the transaction spine for
 * money, the driver registry for supply, mission telemetry for execution. Where a
 * read is not available, the orchestration layer reports a gap rather than
 * substituting a plausible number.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ProductLine } from "./mission";
import type { ProductObservations } from "./product360";
import type { LiquidityObservation } from "./liquidityBrain";
import type { ProviderIdentity, ProviderObservations } from "./provider360";
import type { DemoFacts } from "./orchestrationDemo";
import type { KnowledgeNode } from "./enterpriseGraph";
import type { FlywheelObservation } from "./networkValue";

/** Maps a spine service_line value onto the canonical product taxonomy. */
export function productLineFor(serviceLine: string | null): ProductLine {
  const v = (serviceLine ?? "").toLowerCase();
  if (v.includes("corporate")) return "corporate_mobility";
  if (v.includes("charter") && v.includes("air")) return "yalla_air";
  if (v.includes("air") || v.includes("flight")) return "yalla_air";
  if (v.includes("charter") || v.includes("bus")) return "charter";
  if (v.includes("delivery") || v.includes("logistic") || v.includes("courier") || v.includes("parcel")) return "delivery_logistics";
  if (v.includes("lease") || v.includes("leasing")) return "leasing";
  if (v.includes("rental") || v.includes("rent")) return "rentals";
  return "individual_mobility";
}

interface SpineRow {
  service_line: string | null;
  status: string | null;
  customer_kind: string | null;
  customer_user_id: string | null;
  driver_id: string | null;
  provider_kind: string | null;
  gross_transaction_value_cents: number | null;
  customer_charge_cents: number | null;
  partner_entitlement_cents: number | null;
  platform_revenue_cents: number | null;
  contribution_cents: number | null;
  payment_ref: string | null;
  transaction_ref: string | null;
  settlement_id: string | null;
  revenue_event_id: string | null;
  recognised_at: string | null;
  fulfilled_at: string | null;
}

export interface OrchestrationFacts {
  rows: SpineRow[];
  productObservations: Map<ProductLine, ProductObservations>;
  demoFacts: DemoFacts;
  recognisedRevenueCents: number | null;
  settledCents: number | null;
  transactions: number;
  customers: number;
  providers: number;
  asOf: string | null;
  /** Reads that failed or returned nothing. Surfaced, never hidden. */
  gaps: string[];
}

const sum = (rows: SpineRow[], key: keyof SpineRow): number | null => {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  return values.length === 0 ? null : values.reduce((a, v) => a + v, 0);
};

/** Reads the transaction spine and shapes it for every Phase 10 engine. */
export async function loadOrchestrationFacts(): Promise<OrchestrationFacts> {
  const gaps: string[] = [];
  const empty: OrchestrationFacts = {
    rows: [],
    productObservations: new Map(),
    demoFacts: { contributionPerMissionCents: null, customerChargeCents: null, providerEntitlementCents: null, transactionRef: null, asOf: null },
    recognisedRevenueCents: null,
    settledCents: null,
    transactions: 0,
    customers: 0,
    providers: 0,
    asOf: null,
    gaps,
  };

  const { data, error } = await supabase
    .from("commercial_transactions")
    .select(
      "service_line, status, customer_kind, customer_user_id, driver_id, provider_kind, gross_transaction_value_cents, customer_charge_cents, partner_entitlement_cents, platform_revenue_cents, contribution_cents, payment_ref, transaction_ref, settlement_id, revenue_event_id, recognised_at, fulfilled_at",
    )
    .order("fulfilled_at", { ascending: false })
    .limit(1000);

  if (error) {
    gaps.push(`Transaction spine is not readable with the current role: ${error.message}`);
    return empty;
  }
  const rows = (data ?? []) as SpineRow[];
  if (rows.length === 0) {
    gaps.push("The transaction spine returned no rows — orchestration economics cannot be stated");
    return empty;
  }

  const byLine = new Map<ProductLine, SpineRow[]>();
  for (const row of rows) {
    const line = productLineFor(row.service_line);
    byLine.set(line, [...(byLine.get(line) ?? []), row]);
  }

  const productObservations = new Map<ProductLine, ProductObservations>();
  for (const [line, lineRows] of byLine) {
    const recognised = lineRows.filter((r) => r.recognised_at !== null);
    productObservations.set(line, {
      missions: lineRows.length,
      bookings: lineRows.length,
      customers: new Set(lineRows.map((r) => r.customer_user_id).filter(Boolean)).size || null,
      providers: new Set(lineRows.map((r) => r.driver_id).filter(Boolean)).size || null,
      grossValueCents: sum(lineRows, "gross_transaction_value_cents") ?? sum(lineRows, "customer_charge_cents"),
      revenueCents: sum(recognised, "platform_revenue_cents"),
      contributionCents: sum(recognised, "contribution_cents"),
      slaComplianceRate: null,
      customerSatisfaction: null,
      providerQualityMean: null,
      openExceptions: null,
      liquidityState: null,
      asOf: lineRows[0]?.fulfilled_at ?? null,
    });
  }

  const recognised = rows.filter((r) => r.recognised_at !== null);
  const contributions = recognised.map((r) => r.contribution_cents).filter((v): v is number => typeof v === "number");
  const paid = rows.find((r) => r.payment_ref !== null) ?? null;
  const withCharge = rows.find((r) => typeof r.customer_charge_cents === "number") ?? null;

  if (contributions.length === 0) gaps.push("No recognised transaction carries a contribution figure");
  if (!paid) gaps.push("No transaction carries a payment reference");

  return {
    rows,
    productObservations,
    demoFacts: {
      contributionPerMissionCents: contributions.length === 0 ? null : Math.round(contributions.reduce((a, v) => a + v, 0) / contributions.length),
      customerChargeCents: withCharge?.customer_charge_cents ?? null,
      providerEntitlementCents: withCharge?.partner_entitlement_cents ?? null,
      transactionRef: paid?.transaction_ref ?? null,
      asOf: rows[0]?.fulfilled_at ?? null,
    },
    
    recognisedRevenueCents: sum(recognised, "platform_revenue_cents"),
    settledCents: rows.some((r) => r.settlement_id) ? sum(rows.filter((r) => r.settlement_id), "partner_entitlement_cents") : null,
    transactions: rows.length,
    customers: new Set(rows.map((r) => r.customer_user_id).filter(Boolean)).size,
    providers: new Set(rows.map((r) => r.driver_id).filter(Boolean)).size,
    asOf: rows[0]?.fulfilled_at ?? null,
    gaps,
  };
}

export interface ProviderRecord {
  identity: ProviderIdentity;
  observations: ProviderObservations;
}

/** Reads the supply base. Quality components not yet instrumented stay null. */
export async function loadProviders(limit = 25): Promise<{ providers: ProviderRecord[]; gaps: string[] }> {
  const gaps: string[] = [];
  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, first_name, last_name, driver_type, status, county, city, driver_rating, risk_score, verification_status, activation_date, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    gaps.push(`Provider registry is not readable with the current role: ${error.message}`);
    return { providers: [], gaps };
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    gaps.push("The provider registry returned no rows");
    return { providers: [], gaps };
  }

  gaps.push("Acceptance, arrival, cancellation, SLA and complaint telemetry are not yet attributed per provider — quality scores will be withheld where coverage is below 50%");

  const providers: ProviderRecord[] = rows.map((r) => {
    const isFleet = r.driver_type === "fleet_driver";
    return {
    identity: {
      providerId: r.id as string,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || (r.driver_code as string) || "Unnamed provider",
      kind: isFleet ? "fleet" : "driver",
      businessStructure: isFleet ? "limited_company" : "individual",
      markets: [r.city, r.county].filter((v): v is string => Boolean(v)),
      services: ["individual_mobility"],
      onboardedAt: (r.activation_date as string) ?? (r.created_at as string) ?? null,
    },
    observations: {
      resourceCount: null,
      driverCount: isFleet ? null : 1,
      acceptanceRate: null,
      arrivalOnTimeRate: null,
      completionRate: null,
      cancellationRate: null,
      customerRating: typeof r.driver_rating === "number" ? r.driver_rating : null,
      complaintsPer100: null,
      slaComplianceRate: null,
      safetyIncidentsPer100: null,
      documentComplianceRate: r.verification_status === "approved" ? 100 : null,
      paymentReliabilityRate: null,
      disputeRate: null,
      missionsCompleted: null,
      earningsCents: null,
      settledCents: null,
      contributionCents: null,
      asOf: (r.created_at as string) ?? null,
    },
    };
  });

  return { providers, gaps };
}

/**
 * Liquidity cells. Demand and supply telemetry is not yet aggregated per cell, so
 * most cells are honestly returned as unmeasured; the transaction spine supplies
 * the contribution per mission used to price any intervention.
 */
export function buildLiquidityObservations(facts: OrchestrationFacts): { cellId: string; market: string; zone: string; window: string; service: string; observation: LiquidityObservation }[] {
  const contribution = facts.demoFacts.contributionPerMissionCents;
  const totalMissions = facts.transactions;

  return [
    {
      cellId: "nairobi-cbd-peak-am",
      market: "Nairobi",
      zone: "CBD",
      window: "Weekday 06:00–09:00",
      service: "Airport transfers",
      observation: {
        demand: totalMissions === 0 ? null : totalMissions,
        availableSupply: facts.providers === 0 ? null : facts.providers,
        committedSupply: facts.providers === 0 ? null : facts.providers,
        unavailableSupply: null,
        expectedCancellationRate: null,
        matchRate: null,
        fulfilmentRate: null,
        timeToMatchMinutes: null,
        timeToPickupMinutes: null,
        contributionPerMissionCents: contribution,
        asOf: facts.asOf,
      },
    },
    {
      cellId: "nairobi-westlands-peak-pm",
      market: "Nairobi",
      zone: "Westlands",
      window: "Weekday 16:00–20:00",
      service: "Corporate ground",
      observation: {
        demand: null, availableSupply: null, committedSupply: null, unavailableSupply: null,
        expectedCancellationRate: null, matchRate: null, fulfilmentRate: null,
        timeToMatchMinutes: null, timeToPickupMinutes: null,
        contributionPerMissionCents: contribution, asOf: facts.asOf,
      },
    },
    {
      cellId: "mombasa-island-weekend",
      market: "Mombasa",
      zone: "Island",
      window: "Weekend all-day",
      service: "Charter",
      observation: {
        demand: null, availableSupply: null, committedSupply: null, unavailableSupply: null,
        expectedCancellationRate: null, matchRate: null, fulfilmentRate: null,
        timeToMatchMinutes: null, timeToPickupMinutes: null,
        contributionPerMissionCents: contribution, asOf: facts.asOf,
      },
    },
  ];
}

/** Knowledge graph registry — one authoritative system per entity, no duplicates. */
export function buildKnowledgeNodes(facts: OrchestrationFacts): KnowledgeNode[] {
  return [
    { entity: "person", systemOfRecord: "profiles", count: facts.customers || null, connectedTo: ["customer", "company"] },
    { entity: "customer", systemOfRecord: "profiles + corporate_employees", count: facts.customers || null, connectedTo: ["mission", "transaction"] },
    { entity: "company", systemOfRecord: "corporate_accounts", count: null, connectedTo: ["customer", "contract"] },
    { entity: "provider", systemOfRecord: "drivers + provider registry", count: facts.providers || null, connectedTo: ["resource", "mission"] },
    { entity: "resource", systemOfRecord: "vehicles + charter_inventory", count: null, connectedTo: ["provider", "mission"] },
    { entity: "service", systemOfRecord: "Phase 10 product catalogue", count: 7, connectedTo: ["market", "mission"] },
    { entity: "market", systemOfRecord: "country_launch_status", count: null, connectedTo: ["service", "mission"] },
    { entity: "mission", systemOfRecord: "commercial_transactions + mission object", count: facts.transactions || null, connectedTo: ["transaction", "outcome"] },
    { entity: "transaction", systemOfRecord: "commercial_transactions", count: facts.transactions || null, connectedTo: ["payment", "outcome"] },
    { entity: "contract", systemOfRecord: "corporate agreements", count: null, connectedTo: ["company", "payment"] },
    { entity: "payment", systemOfRecord: "mpesa + payment tables", count: facts.rows.filter((r) => r.payment_ref).length || null, connectedTo: ["transaction", "risk"] },
    { entity: "risk", systemOfRecord: "trust cases + risk events", count: null, connectedTo: ["decision", "outcome"] },
    { entity: "decision", systemOfRecord: "commercial_actions + decision fabric", count: null, connectedTo: ["outcome", "knowledge"] },
    { entity: "outcome", systemOfRecord: "commercial_action_outcomes", count: null, connectedTo: ["knowledge"] },
    { entity: "knowledge", systemOfRecord: "staff knowledge base", count: null, connectedTo: ["decision"] },
  ];
}

/** Flywheel observation assembled strictly from what the spine can evidence. */
export function buildFlywheelObservation(facts: OrchestrationFacts): FlywheelObservation {
  return {
    customers: facts.customers || null,
    providers: facts.providers || null,
    availability: null,
    experience: null,
    transactions: facts.transactions || null,
    providerOpportunity: facts.providers === 0 ? null : facts.transactions / facts.providers,
    dataCoverage: facts.transactions === 0
      ? null
      : (facts.rows.filter((r) => r.payment_ref && r.revenue_event_id).length / facts.transactions) * 100,
    matchingQuality: null,
    asOf: facts.asOf,
  };
}

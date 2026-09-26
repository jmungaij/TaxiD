/**
 * Phase 10 §10.29–10.32 — Product 360, the canonical commercial taxonomy, the
 * Enterprise Revenue Tree and the Enterprise KPI Tree.
 *
 * The public catalogue and the internal operating catalogue become the same
 * taxonomy: every service maps to a product, an owner, a mission type, a supply
 * type, a revenue model and a KPI. Navigation stops being website furniture and
 * becomes the commercial structure revenue rolls up through.
 */
import { type Measure, liveMeasure, modelledMeasure, sumMeasures, unavailableMeasure } from "../phase8/provenance";
import { MISSION_PRODUCT, type MissionType, type ProductLine, type SupplyKind } from "./mission";

export interface CatalogueEntry {
  productLine: ProductLine;
  label: string;
  /** Public-site service names that belong to this product line. */
  services: string[];
  missionTypes: MissionType[];
  supplyKinds: SupplyKind[];
  customerSegments: string[];
  revenueModel: "commission" | "margin" | "fee" | "contract" | "subscription";
  operatingModel: "marketplace" | "managed_marketplace" | "brokered";
  department: string;
  ownerRole: string;
  primaryKpi: string;
  principalRisk: string;
}

/** The canonical taxonomy. SAFARID orchestrates; the asset stays with the provider. */
export const PRODUCT_CATALOGUE: CatalogueEntry[] = [
  {
    productLine: "individual_mobility",
    label: "Individual Mobility",
    services: ["City rides", "Airport transfers", "Executive chauffeur", "Scheduled rides"],
    missionTypes: ["ride", "airport"],
    supplyKinds: ["driver", "fleet"],
    customerSegments: ["individual", "traveller"],
    revenueModel: "commission",
    operatingModel: "marketplace",
    department: "Mobility Operations",
    ownerRole: "Head of Rider Products",
    primaryKpi: "Completed missions per available provider hour",
    principalRisk: "Liquidity failure in peak windows",
  },
  {
    productLine: "corporate_mobility",
    label: "Corporate Mobility",
    services: ["Employee transport", "Executive travel", "Corporate airport transfers", "Staff shuttles"],
    missionTypes: ["corporate_ground", "airport"],
    supplyKinds: ["driver", "fleet", "operator"],
    customerSegments: ["corporate", "employee"],
    revenueModel: "contract",
    operatingModel: "managed_marketplace",
    department: "Corporate & Enterprise",
    ownerRole: "Head of Corporate Mobility",
    primaryKpi: "Contracted SLA compliance",
    principalRisk: "SLA breach on contracted enterprise accounts",
  },
  {
    productLine: "charter",
    label: "Charter",
    services: ["Bus charter", "Van charter", "Group transport", "Event mobility"],
    missionTypes: ["charter"],
    supplyKinds: ["operator", "fleet"],
    customerSegments: ["corporate", "business", "traveller"],
    revenueModel: "margin",
    operatingModel: "brokered",
    department: "Charter Business",
    ownerRole: "Head of Charter",
    principalRisk: "Operator compliance lapse on a committed charter",
    primaryKpi: "Quote-to-commitment conversion",
  },
  {
    productLine: "yalla_air",
    label: "SAFARID Air",
    services: ["Private charter flights", "Group air charter", "Air ambulance coordination"],
    missionTypes: ["air"],
    supplyKinds: ["aircraft_operator"],
    customerSegments: ["corporate", "traveller"],
    revenueModel: "fee",
    operatingModel: "brokered",
    department: "Air Mobility",
    ownerRole: "Head of SAFARID Air",
    primaryKpi: "Operator compliance and mission completion",
    principalRisk: "Operating an aircraft mission against lapsed AOC or insurance",
  },
  {
    productLine: "delivery_logistics",
    label: "Delivery & Logistics",
    services: ["Parcel delivery", "Courier", "Same-day delivery", "Freight and cargo"],
    missionTypes: ["delivery", "logistics"],
    supplyKinds: ["courier", "carrier", "fleet"],
    customerSegments: ["individual", "business", "shipper"],
    revenueModel: "commission",
    operatingModel: "marketplace",
    department: "Delivery & Logistics",
    ownerRole: "Head of Logistics",
    primaryKpi: "On-time delivery with proof of delivery",
    principalRisk: "Loss or damage in transit without goods-in-transit cover",
  },
  {
    productLine: "rentals",
    label: "Rentals",
    services: ["Self-drive rental", "Chauffeured rental", "Long-stay rental"],
    missionTypes: ["rental"],
    supplyKinds: ["rental_operator", "fleet"],
    customerSegments: ["individual", "corporate", "traveller"],
    revenueModel: "margin",
    operatingModel: "managed_marketplace",
    department: "Rentals & Leasing",
    ownerRole: "Head of Rentals",
    primaryKpi: "Fleet utilisation across the rental window",
    principalRisk: "Condition disputes without inspection evidence",
  },
  {
    productLine: "leasing",
    label: "Leasing",
    services: ["Corporate vehicle leasing", "Fleet leasing", "Driver-inclusive leasing"],
    missionTypes: ["leasing"],
    supplyKinds: ["lessor", "operator"],
    customerSegments: ["corporate", "business"],
    revenueModel: "subscription",
    operatingModel: "brokered",
    department: "Rentals & Leasing",
    ownerRole: "Head of Leasing",
    primaryKpi: "Contract renewal rate",
    principalRisk: "Recurring billing failure across a contract term",
  },
];

export function catalogueFor(line: ProductLine): CatalogueEntry | undefined {
  return PRODUCT_CATALOGUE.find((c) => c.productLine === line);
}

export function catalogueForMission(type: MissionType): CatalogueEntry | undefined {
  return catalogueFor(MISSION_PRODUCT[type]);
}

/* ------------------------------------------------------------------ */
/* Product 360                                                         */
/* ------------------------------------------------------------------ */

export interface ProductObservations {
  missions: number | null;
  bookings: number | null;
  customers: number | null
  providers: number | null;
  grossValueCents: number | null;
  revenueCents: number | null;
  contributionCents: number | null;
  slaComplianceRate: number | null;
  customerSatisfaction: number | null;
  providerQualityMean: number | null;
  openExceptions: number | null;
  liquidityState: string | null;
  asOf: string | null;
}

export interface Product360 {
  entry: CatalogueEntry;
  missions: Measure;
  revenue: Measure;
  contribution: Measure;
  contributionMargin: Measure;
  slaCompliance: Measure;
  liquidityState: string;
  openExceptions: number | null;
  recommendations: string[];
  gaps: string[];
}

const MV = "yalla-p10-product-1.0.0";

export function buildProduct360(entry: CatalogueEntry, o: ProductObservations): Product360 {
  const src = "commercial_transactions + mission telemetry";
  const asOf = o.asOf ?? new Date().toISOString();
  const gaps: string[] = [];
  const na = (label: string, unit: Measure["unit"], why: string) => {
    gaps.push(`${entry.label}: ${why}`);
    return unavailableMeasure(label, unit, src, why);
  };

  const revenue = o.revenueCents === null
    ? na("Revenue", "kes", "No recognised revenue is attributed to this product line")
    : liveMeasure("Revenue", o.revenueCents / 100, "kes", src, "sum of platform revenue on recognised transactions", asOf);

  const contribution = o.contributionCents === null
    ? na("Contribution", "kes", "No contribution is attributed to this product line")
    : liveMeasure("Contribution", o.contributionCents / 100, "kes", src, "sum of contribution on recognised transactions", asOf);

  const margin = o.contributionCents === null || o.grossValueCents === null || o.grossValueCents === 0
    ? na("Contribution margin", "percent", "Requires both contribution and gross transaction value")
    : liveMeasure("Contribution margin", (o.contributionCents / o.grossValueCents) * 100, "percent", src,
        "contribution ÷ gross transaction value", asOf);

  const recommendations: string[] = [];
  if ((o.openExceptions ?? 0) > 0) recommendations.push(`Clear ${o.openExceptions} open exception(s) before scaling ${entry.label} demand`);
  if (o.providers !== null && o.providers < 10) recommendations.push(`Supply base of ${o.providers} provider(s) is thin — provider acquisition precedes sales effort`);
  if (margin.value !== null && margin.value < 10) recommendations.push(`Contribution margin of ${margin.value.toFixed(1)}% is below the 10% product floor — review pricing and provider entitlement`);
  if (revenue.value === null) recommendations.push(`Attribute revenue to ${entry.label} in the transaction spine before this product can be managed commercially`);

  return {
    entry,
    missions: o.missions === null
      ? na("Missions", "count", "Mission volume is not instrumented for this product line")
      : liveMeasure("Missions", o.missions, "count", src, "count of transactions attributed to this product line", asOf),
    revenue,
    contribution,
    contributionMargin: margin,
    slaCompliance: o.slaComplianceRate === null
      ? na("SLA compliance", "percent", "SLA outcomes are not instrumented for this product line")
      : liveMeasure("SLA compliance", o.slaComplianceRate, "percent", src, "missions meeting the contracted SLA", asOf),
    liquidityState: o.liquidityState ?? "unmeasured",
    openExceptions: o.openExceptions,
    recommendations,
    gaps,
  };
}

/* ------------------------------------------------------------------ */
/* §10.31 Enterprise Revenue Tree                                      */
/* ------------------------------------------------------------------ */

export interface RevenueNode {
  id: string;
  label: string;
  revenue: Measure;
  contribution: Measure;
  missions: number | null;
  children: RevenueNode[];
}

export function buildRevenueTree(products: readonly Product360[]): RevenueNode {
  const children: RevenueNode[] = products.map((p) => ({
    id: p.entry.productLine,
    label: p.entry.label,
    revenue: p.revenue,
    contribution: p.contribution,
    missions: p.missions.value,
    children: [],
  }));

  return {
    id: "yalla",
    label: "SAFARID",
    revenue: sumMeasures("SAFARID revenue", "kes", children.map((c) => c.revenue)),
    contribution: sumMeasures("SAFARID contribution", "kes", children.map((c) => c.contribution)),
    missions: children.some((c) => c.missions !== null)
      ? children.reduce((a, c) => a + (c.missions ?? 0), 0)
      : null,
    children: children.sort((a, b) => (b.revenue.value ?? -1) - (a.revenue.value ?? -1)),
  };
}

/* ------------------------------------------------------------------ */
/* §10.32 Enterprise KPI Tree                                          */
/* ------------------------------------------------------------------ */

export interface KpiNode {
  id: string;
  label: string;
  measure: Measure;
  /** The KPI this one feeds. Root has null. */
  feeds: string | null;
  owner: string;
  children: KpiNode[];
}

export interface KpiInputs {
  demandMissions: number | null;
  liquidityMatchRate: number | null;
  transactions: number | null;
  revenueCents: number | null;
  contributionCents: number | null;
  retentionRate: number | null;
  networkEffectScore: number | null;
  asOf: string | null;
}

export function buildKpiTree(i: KpiInputs): KpiNode {
  const src = "commercial_transactions + mission telemetry + liquidity brain";
  const asOf = i.asOf ?? new Date().toISOString();
  const live = (label: string, value: number | null, unit: Measure["unit"], calc: string, why: string): Measure =>
    value === null ? unavailableMeasure(label, unit, src, why) : liveMeasure(label, value, unit, src, calc, asOf);

  const contributionKes = i.contributionCents === null ? null : i.contributionCents / 100;
  const enterpriseValue = contributionKes === null || i.retentionRate === null
    ? unavailableMeasure("Enterprise value proxy", "kes", src, "Requires observed contribution and a measured retention rate")
    : modelledMeasure("Enterprise value proxy", contributionKes * 12 * (1 + (i.retentionRate / 100)), "kes", src,
        "annualised contribution × (1 + retention rate)", 35, MV);

  const chain: KpiNode[] = [
    { id: "demand", label: "Demand", measure: live("Demand missions", i.demandMissions, "count", "count of mission intents captured", "Mission intent capture is not instrumented"), feeds: "liquidity", owner: "Growth", children: [] },
    { id: "liquidity", label: "Liquidity", measure: live("Match rate", i.liquidityMatchRate, "percent", "matched missions ÷ mission intents", "Match rate is not instrumented"), feeds: "transactions", owner: "Marketplace Operations", children: [] },
    { id: "transactions", label: "Transactions", measure: live("Completed transactions", i.transactions, "count", "count of recognised transactions", "No recognised transactions are attributed"), feeds: "revenue", owner: "Operations", children: [] },
    { id: "revenue", label: "Revenue", measure: live("Revenue", i.revenueCents === null ? null : i.revenueCents / 100, "kes", "sum of platform revenue on recognised transactions", "No recognised revenue is attributed"), feeds: "contribution", owner: "Finance", children: [] },
    { id: "contribution", label: "Contribution", measure: live("Contribution", contributionKes, "kes", "sum of contribution on recognised transactions", "No contribution is attributed"), feeds: "retention", owner: "Finance", children: [] },
    { id: "retention", label: "Retention", measure: live("Retention rate", i.retentionRate, "percent", "customers transacting in consecutive periods", "Retention is not yet measured across periods"), feeds: "network_effects", owner: "Customer", children: [] },
    { id: "network_effects", label: "Network effects", measure: live("Network effect score", i.networkEffectScore, "score", "flywheel score from the network effects engine", "Network effects are not yet measurable"), feeds: "enterprise_value", owner: "Strategy", children: [] },
  ];

  /* Nest the chain so each KPI visibly feeds the next. */
  for (let idx = chain.length - 1; idx > 0; idx -= 1) chain[idx - 1].children = [chain[idx]];

  return {
    id: "enterprise_value",
    label: "Enterprise value",
    measure: enterpriseValue,
    feeds: null,
    owner: "Executive",
    children: [chain[0]],
  };
}

/** Departments must not optimise a metric that feeds nothing. */
export function orphanKpis(root: KpiNode): string[] {
  const out: string[] = [];
  const walk = (node: KpiNode) => {
    if (node.feeds === null && node.id !== "enterprise_value") out.push(node.label);
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}

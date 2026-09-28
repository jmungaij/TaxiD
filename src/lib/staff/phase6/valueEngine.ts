/**
 * Phase 6 — TaxiD Value Engine and the single enterprise objective function.
 *
 * The engine answers two questions about any activity: what measurable value is
 * it creating, and what is consuming resources without producing enough value.
 * Every value stream declares the table that would quantify it, so a stream is
 * either MEASURED (its system of record is readable) or explicitly
 * NOT CONNECTED. No stream is ever scored from an invented number.
 *
 * The objective function exists so no department can optimise itself at the
 * enterprise's expense: sales volume that destroys margin, cost cuts that
 * destroy service quality, utilisation that destroys partner quality and agent
 * throughput that destroys oversight all reduce the same single score.
 */
import type { Coverage } from "@/lib/staff/phase2/readiness";

export const VALUE_DIMENSIONS = [
  "revenue", "margin", "customer_value", "marketplace_liquidity", "service_quality",
  "operational_efficiency", "risk_reduction", "employee_productivity", "strategic_progress",
] as const;
export type ValueDimension = (typeof VALUE_DIMENSIONS)[number];

export const VALUE_DIMENSION_LABEL: Record<ValueDimension, string> = {
  revenue: "Revenue",
  margin: "Margin",
  customer_value: "Customer value",
  marketplace_liquidity: "Marketplace liquidity",
  service_quality: "Service quality",
  operational_efficiency: "Operational efficiency",
  risk_reduction: "Risk reduction",
  employee_productivity: "Employee productivity",
  strategic_progress: "Strategic progress",
};

export interface ValueStream {
  key: string;
  label: string;
  /** The activity whose value is being asserted. */
  activity: string;
  dimensions: readonly ValueDimension[];
  /** Table that quantifies the value, or null when nothing does. */
  quantifiedBy: string | null;
  /** Resource the stream consumes — links to the allocation engine. */
  consumes: string;
  owner: string;
}

export const VALUE_STREAMS: readonly ValueStream[] = [
  { key: "charter_bookings", label: "Charter & corporate bookings", activity: "Convert quotes into completed charter movements", dimensions: ["revenue", "customer_value", "service_quality"], quantifiedBy: "charter_bookings", consumes: "sales_capacity", owner: "Commercial" },
  { key: "corporate_billing", label: "Corporate billing & collection", activity: "Invoice, collect and reconcile corporate accounts", dimensions: ["revenue", "margin", "risk_reduction"], quantifiedBy: "corporate_invoices", consumes: "finance_capacity", owner: "Finance" },
  { key: "marketplace_supply", label: "Marketplace supply activation", activity: "Recruit, verify and activate partner capacity", dimensions: ["marketplace_liquidity", "service_quality"], quantifiedBy: "charter_partner_applications", consumes: "marketplace_capacity", owner: "Marketplace" },
  { key: "delivery_fulfilment", label: "Delivery fulfilment", activity: "Dispatch and complete delivery orders", dimensions: ["revenue", "service_quality", "operational_efficiency"], quantifiedBy: "delivery_orders", consumes: "operational_capacity", owner: "Operations" },
  { key: "dispatch_matching", label: "Dispatch matching", activity: "Match demand to the best available supply", dimensions: ["marketplace_liquidity", "operational_efficiency", "service_quality"], quantifiedBy: "dispatch_requests", consumes: "technology_capacity", owner: "Operations" },
  { key: "customer_support", label: "Customer operations", activity: "Resolve customer and corporate issues", dimensions: ["customer_value", "service_quality"], quantifiedBy: "corporate_support_tickets", consumes: "customer_success_capacity", owner: "Customer Operations" },
  { key: "wallet_funding", label: "Corporate wallet funding", activity: "Pre-fund corporate wallets through verified callbacks", dimensions: ["revenue", "risk_reduction"], quantifiedBy: "charter_wallet_ledger", consumes: "capital", owner: "Finance" },
  { key: "compliance_assurance", label: "Compliance & KYB assurance", activity: "Keep corporate and partner documentation valid", dimensions: ["risk_reduction", "strategic_progress"], quantifiedBy: "corporate_documents", consumes: "human_time", owner: "Compliance" },
  { key: "revenue_assurance", label: "Revenue assurance", activity: "Detect and recover leakage between service and settlement", dimensions: ["revenue", "margin", "risk_reduction"], quantifiedBy: "charter_wallet_reconciliation_findings", consumes: "finance_capacity", owner: "Revenue Assurance" },
  { key: "agentic_operations", label: "Agentic operations", activity: "Let agents sense, prepare and (with authority) execute work", dimensions: ["employee_productivity", "operational_efficiency"], quantifiedBy: "staff_action_outcomes", consumes: "ai_compute", owner: "AI Governance" },
  { key: "people_capability", label: "People & capability", activity: "Build the capability the operating model requires", dimensions: ["employee_productivity", "strategic_progress"], quantifiedBy: null, consumes: "human_time", owner: "People" },
  { key: "strategic_expansion", label: "Strategic expansion", activity: "Open new corridors, cities and service lines", dimensions: ["strategic_progress", "revenue"], quantifiedBy: "country_launch_status", consumes: "management_attention", owner: "Executive" },
];

export type MeasurementState = "measured" | "not_connected";

export interface ValueStreamAssessment {
  stream: ValueStream;
  state: MeasurementState;
  /** Rows visible to this identity in the quantifying table. */
  observed: number | null;
  /** Why the stream cannot be measured. */
  reason: string | null;
}

const readable = (coverage: Coverage, table: string | null) =>
  !!table && !!coverage[table] && coverage[table].rows !== null;

export function assessValueStreams(coverage: Coverage): ValueStreamAssessment[] {
  return VALUE_STREAMS.map((stream) => {
    if (!stream.quantifiedBy) {
      return { stream, state: "not_connected", observed: null, reason: "No system of record declared for this stream" };
    }
    const probe = coverage[stream.quantifiedBy];
    if (!probe) {
      return { stream, state: "not_connected", observed: null, reason: `${stream.quantifiedBy} was not probed for this identity` };
    }
    if (probe.rows === null) {
      return { stream, state: "not_connected", observed: null, reason: probe.error ?? `${stream.quantifiedBy} unreadable` };
    }
    return { stream, state: "measured", observed: probe.rows, reason: null };
  });
}

/** Streams consuming a resource with no measurable value attached. */
export function valueUnjustified(assessments: readonly ValueStreamAssessment[]): ValueStreamAssessment[] {
  return assessments.filter((a) => a.state === "not_connected");
}

/* -------------------------------------------- enterprise objective function */

export interface ObjectiveTerm {
  key: string;
  label: string;
  /** Weight in the enterprise objective — configurable, never hidden. */
  weight: number;
  /** What this term protects against. */
  guards: string;
  /** Value dimension the term expresses. */
  dimension: ValueDimension;
  /** Table that measures the term, or null. */
  quantifiedBy: string | null;
}

export const OBJECTIVE_TERMS: readonly ObjectiveTerm[] = [
  { key: "customer_value", label: "Customer value", weight: 0.16, guards: "Growth that destroys customer outcomes", dimension: "customer_value", quantifiedBy: "corporate_accounts" },
  { key: "revenue", label: "Revenue", weight: 0.14, guards: "Activity that produces no revenue", dimension: "revenue", quantifiedBy: "charter_bookings" },
  { key: "profitability", label: "Profitability", weight: 0.14, guards: "Unprofitable bookings won for volume", dimension: "margin", quantifiedBy: "corporate_invoices" },
  { key: "marketplace_health", label: "Marketplace health", weight: 0.12, guards: "Utilisation won by degrading partner quality", dimension: "marketplace_liquidity", quantifiedBy: "charter_inventory" },
  { key: "service_quality", label: "Service quality", weight: 0.12, guards: "Cost cuts that degrade the customer experience", dimension: "service_quality", quantifiedBy: "availability_metrics" },
  { key: "reliability", label: "Reliability", weight: 0.08, guards: "Speed bought by breaking the platform", dimension: "operational_efficiency", quantifiedBy: "availability_metrics" },
  { key: "risk", label: "Risk & compliance", weight: 0.10, guards: "Throughput bought by accepting unmanaged risk", dimension: "risk_reduction", quantifiedBy: "compliance_alerts" },
  { key: "employee_sustainability", label: "Employee sustainability", weight: 0.07, guards: "Output bought by exhausting people", dimension: "employee_productivity", quantifiedBy: null },
  { key: "strategic_priority", label: "Strategic progress", weight: 0.07, guards: "Local wins that ignore enterprise strategy", dimension: "strategic_progress", quantifiedBy: "country_launch_status" },
];

export interface ObjectiveEvaluation {
  term: ObjectiveTerm;
  /** 0–100 contribution, or null when the term cannot be measured. */
  score: number | null;
  state: MeasurementState;
  reason: string | null;
}

export interface ObjectiveResult {
  terms: ObjectiveEvaluation[];
  /** Weighted score over measurable terms only. */
  score: number | null;
  /** Share of the objective's weight that is actually measurable. */
  measuredWeight: number;
  withheld: string[];
}

/**
 * Evaluate the objective function. A term scores only from readable evidence;
 * unmeasurable terms are excluded from the score and named in `withheld`, so
 * the headline number can never be inflated by silence.
 */
export function evaluateObjective(coverage: Coverage): ObjectiveResult {
  const withheld: string[] = [];
  const terms = OBJECTIVE_TERMS.map((term): ObjectiveEvaluation => {
    if (!readable(coverage, term.quantifiedBy)) {
      withheld.push(
        term.quantifiedBy
          ? `${term.label} excluded — ${term.quantifiedBy} unreadable for this identity`
          : `${term.label} excluded — no system of record`,
      );
      return { term, score: null, state: "not_connected", reason: term.quantifiedBy ? `${term.quantifiedBy} unreadable` : "no source" };
    }
    const rows = coverage[term.quantifiedBy!].rows ?? 0;
    // Evidence density, capped: presence of measurable records earns the term's
    // score; it is a measured proxy, not a business target.
    const score = Math.min(100, 40 + Math.round(Math.log10(rows + 1) * 30));
    return { term, score, state: "measured", reason: null };
  });

  const measured = terms.filter((t) => t.score !== null);
  const measuredWeight = measured.reduce((s, t) => s + t.term.weight, 0);
  const score = measuredWeight === 0
    ? null
    : Math.round(measured.reduce((s, t) => s + (t.score ?? 0) * t.term.weight, 0) / measuredWeight);

  return { terms, score, measuredWeight: Math.round(measuredWeight * 100), withheld };
}

/* ------------------------------------------------------------- north star */

export interface NorthStar {
  statement: string;
  /** Drivers underneath the single number. */
  drivers: { label: string; quantifiedBy: string | null }[];
}

export const NORTH_STAR: NorthStar = {
  statement:
    "Successful mobility transactions and customer outcomes generated through a healthy, trusted and economically sustainable marketplace.",
  drivers: [
    { label: "Completed movements", quantifiedBy: "charter_bookings" },
    { label: "Fulfilled deliveries", quantifiedBy: "delivery_orders" },
    { label: "Active corporate accounts", quantifiedBy: "corporate_accounts" },
    { label: "Available marketplace capacity", quantifiedBy: "charter_inventory" },
    { label: "Settled revenue", quantifiedBy: "corporate_invoices" },
    { label: "Service availability", quantifiedBy: "availability_metrics" },
    { label: "Trust & compliance standing", quantifiedBy: "compliance_alerts" },
  ],
};

export interface NorthStarDriver {
  label: string;
  quantifiedBy: string | null;
  observed: number | null;
  state: MeasurementState;
}

export function northStarDrivers(coverage: Coverage): NorthStarDriver[] {
  return NORTH_STAR.drivers.map((d) => ({
    label: d.label,
    quantifiedBy: d.quantifiedBy,
    observed: readable(coverage, d.quantifiedBy) ? coverage[d.quantifiedBy!].rows : null,
    state: readable(coverage, d.quantifiedBy) ? "measured" : "not_connected",
  }));
}

/* -------------------------------- TaxiD Enterprise Effectiveness Index (EEI) */

export const EEI_DOMAINS = [
  { key: "customer", label: "Customer", measures: "Outcomes & retention", tables: ["corporate_accounts", "client_journey_events"] },
  { key: "revenue", label: "Revenue", measures: "Growth & leakage", tables: ["charter_bookings", "corporate_invoices"] },
  { key: "marketplace", label: "Marketplace", measures: "Liquidity & fulfilment", tables: ["charter_inventory", "charter_partner_applications"] },
  { key: "operations", label: "Operations", measures: "Reliability & efficiency", tables: ["dispatch_requests", "delivery_orders"] },
  { key: "finance", label: "Finance", measures: "Collection & reconciliation", tables: ["charter_wallet_ledger", "charter_wallet_reconciliation_findings"] },
  { key: "people", label: "People", measures: "Capability & productivity", tables: ["capabilities"] },
  { key: "technology", label: "Technology", measures: "Reliability & performance", tables: ["availability_metrics"] },
  { key: "ai", label: "AI", measures: "Accuracy, value & safety", tables: ["staff_action_outcomes", "staff_decisions"] },
  { key: "security", label: "Security", measures: "Control effectiveness", tables: ["access_denials", "audit_logs"] },
  { key: "strategy", label: "Strategy", measures: "Objective attainment", tables: ["country_launch_status"] },
] as const;

export interface EeiDomainScore {
  key: string;
  label: string;
  measures: string;
  /** 0–100 from readable evidence, or null when no evidence is readable. */
  score: number | null;
  evidence: { table: string; rows: number | null; reason?: string }[];
}

export interface EeiResult {
  domains: EeiDomainScore[];
  index: number | null;
  measuredDomains: number;
  totalDomains: number;
}

/**
 * The Effectiveness Index is drillable: each domain score is derived only from
 * named tables, and every table's row count (or unreadable reason) is returned
 * with it.
 */
export function enterpriseEffectivenessIndex(coverage: Coverage): EeiResult {
  const domains = EEI_DOMAINS.map((d): EeiDomainScore => {
    const evidence = d.tables.map((t) => ({
      table: t,
      rows: coverage[t]?.rows ?? null,
      reason: coverage[t]?.error,
    }));
    const usable = evidence.filter((e) => e.rows !== null);
    const score = usable.length === 0
      ? null
      : Math.round(
          usable.reduce((s, e) => s + Math.min(100, 40 + Math.log10((e.rows ?? 0) + 1) * 30), 0) / usable.length,
        );
    return { key: d.key, label: d.label, measures: d.measures, score, evidence };
  });
  const measured = domains.filter((d) => d.score !== null);
  return {
    domains,
    index: measured.length === 0 ? null : Math.round(measured.reduce((s, d) => s + (d.score ?? 0), 0) / measured.length),
    measuredDomains: measured.length,
    totalDomains: domains.length,
  };
}

/**
 * Customer Operations — cross-module integration matrix.
 *
 * Declares which platform domains PUBLISH signals into Customer Operations and
 * which CONSUME signals produced by it. This is the contract that makes the
 * module an enterprise signal hub rather than an isolated ticketing tool.
 */
import type { BusinessDomain, CaseType } from "./taxonomy";

export type Direction = "inbound" | "outbound" | "bidirectional";

export interface IntegrationLink {
  domain: BusinessDomain;
  surface: string;
  route: string;
  direction: Direction;
  /** Signals Customer Operations receives from this domain. */
  consumes: string[];
  /** Signals Customer Operations publishes to this domain. */
  publishes: string[];
  /** Backing tables / RPCs already present in the platform. */
  backing: string[];
}

export const INTEGRATION_MATRIX: IntegrationLink[] = [
  {
    domain: "finance",
    surface: "Refunds & Disputes · Payment Operations",
    route: "/dashboard/admin/refunds",
    direction: "bidirectional",
    consumes: ["Refund decision + reversal outcome", "Payment attempt failure class", "Ledger / wallet reconciliation state"],
    publishes: ["Refund request raised from a case", "Disputed amount + evidence pack", "Goodwill credit authorisation"],
    backing: ["refund_requests", "refund_request_events", "payment_attempts", "wallet_transactions"],
  },
  {
    domain: "driver_ops",
    surface: "Driver Management · Conduct & Lifecycle",
    route: "/dashboard/admin/drivers",
    direction: "bidirectional",
    consumes: ["Driver score & prior incidents", "Lifecycle / suspension state", "Settlement exposure"],
    publishes: ["Conduct complaint signal", "Disciplinary action request", "Coaching / academy enrolment trigger"],
    backing: ["drivers", "driver_incidents", "driver_scores", "driver_lifecycle_actions"],
  },
  {
    domain: "rider_ops",
    surface: "Rider Management · Rider 360",
    route: "/dashboard/admin/rider-management",
    direction: "bidirectional",
    consumes: ["Trip history", "Wallet balance & transactions", "Loyalty tier and trust score"],
    publishes: ["Support contact history", "Churn-risk signal", "Rider trust score adjustment input"],
    backing: ["rider_profiles", "fact_trips", "rider_wallets", "rider_trust_scores"],
  },
  {
    domain: "logistics",
    surface: "Delivery & Logistics Command Center",
    route: "/dashboard/admin/logistics-center",
    direction: "bidirectional",
    consumes: ["Shipment exceptions & SLA breaches", "Proof of delivery + OTP verification", "Route / warehouse scan events"],
    publishes: ["Lost parcel investigation", "Redelivery / reroute request", "Warehouse root-cause signal"],
    backing: ["delivery_orders", "proof_of_delivery", "package_chain_of_custody", "delivery_route_segments"],
  },
  {
    domain: "trust_safety",
    surface: "Trust & Safety · Fraud Intelligence",
    route: "/dashboard/admin/trust-center",
    direction: "bidirectional",
    consumes: ["Fraud signals & device fingerprints", "Open investigations", "Watchlist membership"],
    publishes: ["Safety incident escalation", "Fraud case nomination", "Evidence pack for enforcement"],
    backing: ["fraud_signals", "fraud_cases", "trust_incidents", "rider_sos_alerts"],
  },
  {
    domain: "corporate",
    surface: "Corporate Accounts · Enterprise Support",
    route: "/dashboard/admin/corporates",
    direction: "bidirectional",
    consumes: ["Corporate agreement & policy rules", "Budget / cost centre consumption", "Approval chain state"],
    publishes: ["Support consumption per corporate account", "Policy exception request", "Account health signal"],
    backing: ["corporate_accounts", "corporate_policy_rules", "budget_consumption", "approval_requests"],
  },
  {
    domain: "marketplace",
    surface: "Marketplace · Supply & Pricing",
    route: "/dashboard/admin/marketplace",
    direction: "outbound",
    consumes: ["Supply / surge snapshot for the pickup zone"],
    publishes: ["Delay complaint density per zone", "Supply gap signal", "Pricing dissatisfaction signal"],
    backing: ["marketplace_supply_snapshots", "marketplace_surge_events", "dispatch_requests"],
  },
  {
    domain: "fleet",
    surface: "Fleet Operations",
    route: "/dashboard/admin/fleet",
    direction: "bidirectional",
    consumes: ["Vehicle compliance & maintenance state"],
    publishes: ["Vehicle defect report", "Inspection request"],
    backing: ["vehicles", "vehicle_compliance", "vehicle_inspections"],
  },
  {
    domain: "support",
    surface: "Executive Intelligence & Analytics",
    route: "/dashboard/admin/executive-intelligence",
    direction: "outbound",
    consumes: [],
    publishes: ["Case volume & SLA compliance trend", "Root cause distribution", "Workforce performance", "Predicted breach exposure"],
    backing: ["support_cases", "support_case_events", "executive_metrics"],
  },
];

/* ------------------------ operational dependency map --------------------- */

/**
 * Improvement #5 — the matrix must verify interaction *quality*, not just that
 * a connection exists. Each link declares its expected exchange contract; the
 * runtime evaluator compares that against observed activity already loaded in
 * the module and returns an operational status.
 */
export interface ExchangeContract {
  domain: BusinessDomain;
  /** Canonical event published across the boundary. */
  event: string;
  direction: Extract<Direction, "inbound" | "outbound">;
  /** Latency budget for the exchange, in minutes. */
  expectedLatencyMinutes: number;
  /** How often the exchange is expected to occur. */
  cadence: "per_case" | "hourly" | "daily";
  criticality: "critical" | "standard";
}

export const EXCHANGE_CONTRACTS: ExchangeContract[] = [
  { domain: "finance", event: "refund.approved", direction: "inbound", expectedLatencyMinutes: 30, cadence: "per_case", criticality: "critical" },
  { domain: "finance", event: "refund.requested", direction: "outbound", expectedLatencyMinutes: 5, cadence: "per_case", criticality: "critical" },
  { domain: "logistics", event: "shipment.exception", direction: "inbound", expectedLatencyMinutes: 15, cadence: "per_case", criticality: "critical" },
  { domain: "logistics", event: "parcel.investigation.opened", direction: "outbound", expectedLatencyMinutes: 15, cadence: "per_case", criticality: "standard" },
  { domain: "driver_ops", event: "driver.incident.recorded", direction: "inbound", expectedLatencyMinutes: 60, cadence: "per_case", criticality: "standard" },
  { domain: "driver_ops", event: "conduct.signal.published", direction: "outbound", expectedLatencyMinutes: 30, cadence: "per_case", criticality: "standard" },
  { domain: "rider_ops", event: "rider.trust_score.updated", direction: "inbound", expectedLatencyMinutes: 240, cadence: "daily", criticality: "standard" },
  { domain: "trust_safety", event: "fraud.signal.raised", direction: "inbound", expectedLatencyMinutes: 10, cadence: "per_case", criticality: "critical" },
  { domain: "trust_safety", event: "safety.escalation.published", direction: "outbound", expectedLatencyMinutes: 5, cadence: "per_case", criticality: "critical" },
  { domain: "corporate", event: "corporate.policy.exception", direction: "outbound", expectedLatencyMinutes: 60, cadence: "per_case", criticality: "standard" },
  { domain: "marketplace", event: "supply.gap.published", direction: "outbound", expectedLatencyMinutes: 60, cadence: "hourly", criticality: "standard" },
  { domain: "fleet", event: "vehicle.defect.reported", direction: "outbound", expectedLatencyMinutes: 120, cadence: "per_case", criticality: "standard" },
  { domain: "support", event: "customerops.kpi.snapshot", direction: "outbound", expectedLatencyMinutes: 1440, cadence: "daily", criticality: "standard" },
];

export type ExchangeStatus = "healthy" | "degraded" | "stale" | "unobserved";

export interface ExchangeHealth extends ExchangeContract {
  status: ExchangeStatus;
  /** Observed exchanges in the evaluated window. */
  observed: number;
  /** Minutes since the last successful exchange, null when never observed. */
  minutesSinceLast: number | null;
  note: string;
}

export interface ObservedExchange {
  /** Matches `ExchangeContract.event`. */
  event: string;
  count: number;
  lastAt: string | null;
}

/** Grace multiplier before an exchange is considered degraded. */
const DEGRADED_FACTOR = 2;
const STALE_FACTOR = 6;

export function evaluateExchangeHealth(observed: ObservedExchange[], now = Date.now()): ExchangeHealth[] {
  const byEvent = new Map(observed.map((o) => [o.event, o]));
  return EXCHANGE_CONTRACTS.map((contract) => {
    const o = byEvent.get(contract.event);
    if (!o || o.count === 0 || !o.lastAt) {
      return {
        ...contract,
        status: "unobserved" as ExchangeStatus,
        observed: 0,
        minutesSinceLast: null,
        note: "No exchange observed in the evaluated window",
      };
    }
    const minutesSinceLast = Math.max(0, Math.round((now - new Date(o.lastAt).getTime()) / 60000));
    const budget = contract.expectedLatencyMinutes;
    const status: ExchangeStatus =
      minutesSinceLast <= budget
        ? "healthy"
        : minutesSinceLast <= budget * DEGRADED_FACTOR
          ? "degraded"
          : minutesSinceLast <= budget * STALE_FACTOR
            ? "stale"
            : "stale";
    return {
      ...contract,
      status,
      observed: o.count,
      minutesSinceLast,
      note:
        status === "healthy"
          ? `Within the ${budget}m budget`
          : `Last exchange ${minutesSinceLast}m ago against a ${budget}m budget`,
    };
  });
}

export interface DependencyScore {
  healthy: number;
  degraded: number;
  stale: number;
  unobserved: number;
  /** 0-100 operational quality of the dependency map. */
  score: number;
}

export function dependencyScore(health: ExchangeHealth[]): DependencyScore {
  const count = (s: ExchangeStatus) => health.filter((h) => h.status === s).length;
  const healthy = count("healthy");
  const degraded = count("degraded");
  const stale = count("stale");
  const unobserved = count("unobserved");
  const total = health.length || 1;
  const weighted = healthy * 1 + degraded * 0.6 + stale * 0.2;
  return { healthy, degraded, stale, unobserved, score: Math.round((weighted / total) * 100) };
}

/** Domains a case type must be able to traverse — used by the coverage check. */
export interface TraversalCheck {
  caseType: CaseType;
  required: BusinessDomain[];
  covered: BusinessDomain[];
  missing: BusinessDomain[];
  ok: boolean;
}

const LINKED_DOMAINS = new Set(INTEGRATION_MATRIX.map((l) => l.domain));

export function checkTraversal(caseType: CaseType, required: BusinessDomain[], playbookDomains: BusinessDomain[]): TraversalCheck {
  const covered = required.filter((d) => LINKED_DOMAINS.has(d) && playbookDomains.includes(d));
  const missing = required.filter((d) => !covered.includes(d));
  return { caseType, required, covered, missing, ok: missing.length === 0 };
}


/**
 * Business Capability Contract — Mobility (Ride-hailing) Operations.
 *
 * Closes the BCRA cross-capability dependency chain: `mobility` was declared as
 * an upstream by four certified modules but published no contract, which left
 * every downstream chain uncertifiable.
 */
import type { CapabilityContract } from "./capabilityContract";

export const MOBILITY_CONTRACT: CapabilityContract = {
  module: "mobility",
  title: "Mobility & Ride Operations",
  version: "1.0.0",
  route: "/dashboard/admin/rider-management",
  owner: "Mobility Operations",
  workflows: [
    {
      id: "ride_lifecycle",
      name: "Request to completed ride",
      trigger: "Rider submits a trip request",
      stages: ["Fare quote", "Dispatch and driver acceptance", "Pickup", "In-trip tracking", "Completion and receipt"],
      approvals: ["Ops approval for manual dispatch override"],
      targetMinutes: 60,
    },
    {
      id: "fare_adjustment",
      name: "Fare dispute adjustment",
      trigger: "Rider or driver disputes a completed fare",
      stages: ["Capture dispute", "Replay trip telemetry", "Recompute fare", "Approve adjustment", "Notify parties"],
      approvals: ["Maker-checker on any fare adjustment above threshold"],
      targetMinutes: 1440,
    },
    {
      id: "surge_governance",
      name: "Surge zone governance",
      trigger: "Demand-supply imbalance detected in a hex zone",
      stages: ["Detect imbalance", "Propose multiplier", "Approve", "Publish zone version", "Review outcome"],
      approvals: ["Pricing approver for multipliers above the policy ceiling"],
      targetMinutes: 30,
    },
  ],
  publishes: [
    { name: "ride.booked", payload: ["ride_id", "rider_id", "trip_intent"], latencyBudgetMinutes: 5, criticality: "standard" },
    { name: "ride.started", payload: ["ride_id", "driver_id", "started_at"], latencyBudgetMinutes: 5, criticality: "standard" },
    { name: "ride.completed", payload: ["ride_id", "fare_kes", "completed_at"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "ride.cancelled", payload: ["ride_id", "cancelled_by", "reason_code"], latencyBudgetMinutes: 10, criticality: "standard" },
    { name: "surge.zone.published", payload: ["zone_id", "multiplier", "version", "approved_by"], latencyBudgetMinutes: 5, criticality: "standard" },
  ],
  consumes: [
    { name: "driver.suspended", payload: ["driver_id", "reason_code", "suspended_until", "decision_id"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "driver.incident.recorded", payload: ["driver_id", "incident_type", "severity", "vehicle_id"], latencyBudgetMinutes: 60, criticality: "standard" },
    { name: "wallet.credited", payload: ["wallet_id", "amount_kes", "source"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "case.escalated", payload: ["case_id", "tier", "target_domain"], latencyBudgetMinutes: 10, criticality: "critical" },
  ],
  dependencies: [
    { module: "fleet", reason: "Driver eligibility, vehicle compliance and availability", degradedBehaviour: "Dispatch uses the last certified eligibility snapshot" },
    { module: "finance_refunds", reason: "Fare settlement, adjustments and refunds", degradedBehaviour: "Adjustments queue for settlement once finance recovers" },
    { module: "trust_safety", reason: "Enforcement and safety interventions during trips", degradedBehaviour: "Safety flags applied post-trip from the enforcement backlog" },
    { module: "customer_operations", reason: "Rider and driver support cases raised from trips", degradedBehaviour: "Cases captured offline and replayed to the queue" },
  ],
  kpis: [
    { id: "acceptance_rate", name: "Dispatch acceptance rate", unit: "percent", target: "≥ 85%", source: "dispatch_acceptance_stats" },
    { id: "eta_accuracy", name: "Pickup ETA accuracy", unit: "percent", target: "≥ 90% within ±3 minutes", source: "dispatch_eta_estimates vs actuals" },
    { id: "completion_rate", name: "Trip completion rate", unit: "percent", target: "≥ 95%", source: "trip_bookings" },
    { id: "cancel_rate", name: "Driver cancellation rate", unit: "percent", target: "≤ 5%", source: "ride.cancelled events" },
    { id: "fare_dispute_rate", name: "Fare dispute rate", unit: "percent", target: "≤ 1%", source: "fare adjustments vs completed trips" },
  ],
  aiRoadmap: [
    { service: "forecasting", status: "live", description: "Demand and supply forecasting per hex zone driving surge proposals", evaluation: "MAPE against realised demand, replayed against dispatch_demand_signals" },
    { service: "prioritization", status: "live", description: "Dispatch candidate ranking on ETA, acceptance and reliability", evaluation: "Uplift in acceptance rate against the deterministic baseline" },
    { service: "risk_detection", status: "live", description: "GPS-integrity and fare-manipulation anomaly detection", evaluation: "Precision against confirmed fraud cases, shadow-scored before enforcement" },
    { service: "natural_language_query", status: "planned", description: "Natural-language querying of trip and dispatch telemetry for ops", evaluation: "Answer accuracy against curated question set before release" },
  ],
  failureModes: [
    { id: "dispatch_starvation", mode: "No driver accepts within the offer window", detection: "Offer timeout streak on a request", impact: "Rider abandonment and lost revenue", mitigation: "Widen the radius, escalate to manual dispatch, notify the rider with an honest ETA" },
    { id: "gps_drift", mode: "Trip telemetry drifts or drops mid-trip", detection: "GPS integrity signal degraded", impact: "Wrong fare and disputed trips", mitigation: "Fall back to route-segment estimation and flag the trip for fare review" },
    { id: "surge_runaway", mode: "Surge multiplier exceeds the policy ceiling", detection: "Zone version approval gate", impact: "Regulatory and reputational exposure", mitigation: "Hard ceiling enforced at publish; auto-revert to the last approved version" },
    { id: "settlement_lag", mode: "Fare settlement lags behind trip completion", detection: "Unsettled completed trips beyond the budget", impact: "Driver payout delay and trust erosion", mitigation: "Replay settlement from the payment outbox and alert finance" },
  ],
  escalationPaths: [
    { trigger: "Dispatch acceptance below floor in a city", tier: "Tier 2", owner: "City operations lead", responseMinutes: 60 },
    { trigger: "Safety incident during an active trip", tier: "Tier 3", owner: "Trust & Safety duty officer", responseMinutes: 15 },
    { trigger: "Surge ceiling breach attempt", tier: "Tier 3", owner: "Pricing governance", responseMinutes: 30 },
    { trigger: "Settlement backlog beyond one cycle", tier: "Tier 2", owner: "Finance operations", responseMinutes: 240 },
  ],
};

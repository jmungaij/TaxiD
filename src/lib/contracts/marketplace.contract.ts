/**
 * Business Capability Contract — Marketplace & Partner Supply.
 *
 * Closes the last uncertified BCRA dependency: `marketplace` was declared as an
 * upstream by every certified module while publishing no contract.
 */
import type { CapabilityContract } from "./capabilityContract";

export const MARKETPLACE_CONTRACT: CapabilityContract = {
  module: "marketplace",
  title: "Marketplace & Partner Supply",
  version: "1.0.0",
  route: "/dashboard/admin/marketplace",
  owner: "Marketplace Operations",
  workflows: [
    {
      id: "partner_onboarding",
      name: "Partner onboarding to live supply",
      trigger: "Partner or fleet owner applies to the marketplace",
      stages: ["Application", "Due diligence", "Commercial terms", "Supply activation", "Performance review"],
      approvals: ["Commercial lead for terms", "Compliance for due diligence"],
      targetMinutes: 5760,
    },
    {
      id: "supply_balancing",
      name: "Supply and demand balancing",
      trigger: "Marketplace health dimension breaches its floor",
      stages: ["Detect imbalance", "Select lever (incentive, radius, pricing)", "Approve", "Apply", "Measure uplift"],
      approvals: ["Marketplace manager for incentive spend"],
      targetMinutes: 120,
    },
    {
      id: "partner_settlement",
      name: "Partner commission settlement",
      trigger: "Settlement period closes",
      stages: ["Aggregate completed supply", "Compute commission", "Reconcile", "Approve payout", "Publish statement"],
      approvals: ["Finance approval before payout release"],
      targetMinutes: 2880,
    },
  ],
  publishes: [
    { name: "marketplace.incentive.applied", payload: ["campaign_id", "zone_id", "budget_kes", "approved_by"], latencyBudgetMinutes: 30, criticality: "standard" },
    { name: "partner.activated", payload: ["partner_id", "supply_type", "city", "activated_at"], latencyBudgetMinutes: 60, criticality: "standard" },
  ],
  consumes: [
    { name: "ride.completed", payload: ["ride_id", "fare_kes", "completed_at"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "package.delivered", payload: ["order_id", "delivered_at", "pod_id"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "surge.zone.published", payload: ["zone_id", "multiplier", "version"], latencyBudgetMinutes: 5, criticality: "standard" },
    { name: "settlement.completed", payload: ["settlement_id", "amount_kes", "period"], latencyBudgetMinutes: 60, criticality: "critical" },
  ],
  dependencies: [
    { module: "mobility", reason: "Realised trip supply and demand signals per zone", degradedBehaviour: "Balancing runs on the last certified supply snapshot" },
    { module: "fleet", reason: "Partner-owned vehicle and driver eligibility", degradedBehaviour: "New partner supply held until eligibility is re-certified" },
    { module: "finance_refunds", reason: "Commission computation and payout settlement", degradedBehaviour: "Statements published as provisional until finance settles" },
    { module: "delivery_logistics", reason: "Courier and parcel supply participating in the marketplace", degradedBehaviour: "Delivery supply excluded from balancing levers" },
  ],
  kpis: [
    { id: "supply_liquidity", name: "Supply liquidity", unit: "percent", target: "≥ 90% of demand covered", source: "dispatch_supply_cells" },
    { id: "partner_retention", name: "Active partner retention", unit: "percent", target: "≥ 92% quarterly", source: "partner activity ledger" },
    { id: "incentive_roi", name: "Incentive return on spend", unit: "percent", target: "≥ 150%", source: "incentive spend vs incremental completed supply" },
    { id: "settlement_accuracy", name: "Settlement accuracy", unit: "percent", target: "≥ 99.5%", source: "settlement reconciliation" },
    { id: "time_to_activate", name: "Partner time to activation", unit: "minutes", target: "≤ 5760 minutes p90", source: "onboarding timestamps" },
  ],
  aiRoadmap: [
    { service: "forecasting", status: "live", description: "Zone-level supply and demand forecasting driving balancing levers", evaluation: "MAPE against realised coverage, replayed on dispatch_demand_signals" },
    { service: "prioritization", status: "live", description: "Incentive budget allocation ranking across zones and partners", evaluation: "Incremental supply per shilling against a holdout zone" },
    { service: "risk_detection", status: "live", description: "Partner collusion and incentive-gaming detection", evaluation: "Precision against confirmed marketplace fraud cases" },
    { service: "executive_summarization", status: "preview", description: "Marketplace health narrative for the executive review", evaluation: "Factuality check against Marketplace 360 certified KPIs" },
  ],
  failureModes: [
    { id: "supply_collapse", mode: "Supply liquidity collapses in a city", detection: "Liquidity dimension below floor for consecutive windows", impact: "Unserved demand and rider churn", mitigation: "Trigger incentive campaign; widen dispatch radius; alert city ops" },
    { id: "incentive_leakage", mode: "Incentive spend without incremental supply", detection: "ROI below floor on an active campaign", impact: "Direct margin loss", mitigation: "Auto-pause the campaign and require re-approval" },
    { id: "settlement_variance", mode: "Partner statement diverges from the ledger", detection: "Reconciliation variance above tolerance", impact: "Partner disputes and payout delay", mitigation: "Hold payout, reconcile from the event ledger, finance sign-off" },
    { id: "stale_partner", mode: "Activated partner with no supply for a full period", detection: "Activity ledger scan", impact: "Distorted liquidity planning", mitigation: "Move to dormant and exclude from coverage forecasts" },
  ],
  escalationPaths: [
    { trigger: "Liquidity below floor in a launched city", tier: "Tier 2", owner: "City marketplace manager", responseMinutes: 120 },
    { trigger: "Incentive ROI below floor", tier: "Tier 2", owner: "Commercial lead", responseMinutes: 480 },
    { trigger: "Settlement variance above tolerance", tier: "Tier 3", owner: "Finance controller", responseMinutes: 240 },
    { trigger: "Suspected partner fraud", tier: "Tier 3", owner: "Trust & Safety + Marketplace", responseMinutes: 60 },
  ],
};

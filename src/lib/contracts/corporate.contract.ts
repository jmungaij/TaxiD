/**
 * Business Capability Contract — Corporate Mobility.
 *
 * Closes the BCRA dependency chain for `corporate`, which was declared as an
 * upstream by mobility, finance and customer operations without a contract.
 */
import type { CapabilityContract } from "./capabilityContract";

export const CORPORATE_CONTRACT: CapabilityContract = {
  module: "corporate",
  title: "Corporate Mobility & Billing",
  version: "1.0.0",
  route: "/dashboard/corporate",
  owner: "Corporate Operations",
  workflows: [
    {
      id: "corporate_onboarding",
      name: "Corporate onboarding and KYB",
      trigger: "Corporate registration submitted",
      stages: ["Company details", "KYB document upload", "CR12 and KRA verification", "Review decision", "Wallet activation"],
      approvals: ["Compliance reviewer for KYB", "Finance for credit or pre-funded terms"],
      targetMinutes: 2880,
    },
    {
      id: "ride_approval",
      name: "Policy-governed ride approval",
      trigger: "Employee requests a corporate-billed trip",
      stages: ["Policy evaluation", "Budget reservation", "Approver decision", "Dispatch", "Expense coding"],
      approvals: ["Designated approver or delegate within the designation limit"],
      targetMinutes: 60,
    },
    {
      id: "period_billing",
      name: "Billing period close to invoice",
      trigger: "Billing period ends",
      stages: ["Freeze period", "Reconcile rides and adjustments", "Apply taxes", "Issue invoice", "Collect and settle"],
      approvals: ["Finance controller before invoice issue"],
      targetMinutes: 4320,
    },
  ],
  publishes: [
    { name: "corporate.ride.approved", payload: ["approval_id", "employee_id", "company_id", "budget_ref"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "corporate.policy.violation", payload: ["violation_id", "policy_rule", "employee_id", "severity"], latencyBudgetMinutes: 30, criticality: "standard" },
    { name: "corporate.invoice.issued", payload: ["invoice_id", "company_id", "amount_kes", "period"], latencyBudgetMinutes: 60, criticality: "critical" },
    { name: "corporate.wallet.topped_up", payload: ["company_id", "amount_kes", "reference", "method"], latencyBudgetMinutes: 15, criticality: "critical" },
  ],
  consumes: [
    { name: "ride.completed", payload: ["ride_id", "fare_kes", "completed_at"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "ride.cancelled", payload: ["ride_id", "cancelled_by", "reason_code"], latencyBudgetMinutes: 10, criticality: "standard" },
    { name: "wallet.debited", payload: ["wallet_id", "amount_kes", "reason"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "package.delivered", payload: ["order_id", "delivered_at", "pod_id"], latencyBudgetMinutes: 10, criticality: "critical" },
  ],
  dependencies: [
    { module: "mobility", reason: "Trip execution and fare capture for corporate-billed rides", degradedBehaviour: "Approvals queue; billing recomputes when trips replay" },
    { module: "finance_refunds", reason: "Invoicing, settlement, adjustments and refunds", degradedBehaviour: "Period stays open and invoices are held until finance recovers" },
    { module: "delivery_logistics", reason: "Corporate delivery orders billed on the same period", degradedBehaviour: "Delivery lines excluded and carried to the next period" },
    { module: "customer_operations", reason: "Corporate admin support and dispute handling", degradedBehaviour: "Disputes captured against the invoice for later review" },
  ],
  kpis: [
    { id: "kyb_cycle", name: "KYB decision cycle", unit: "minutes", target: "≤ 2880 minutes p90", source: "corporate_registration_reviews" },
    { id: "approval_sla", name: "Ride approval within SLA", unit: "percent", target: "≥ 95%", source: "corporate_ride_approvals" },
    { id: "policy_compliance", name: "Policy-compliant trips", unit: "percent", target: "≥ 98%", source: "corporate_policy_violations vs trips" },
    { id: "invoice_accuracy", name: "Invoice accuracy (no post-issue adjustment)", unit: "percent", target: "≥ 99%", source: "corporate_invoice_adjustments" },
    { id: "collection_days", name: "Days to collect", unit: "count", target: "≤ 14 days", source: "corporate_invoices settlement dates" },
  ],
  aiRoadmap: [
    { service: "risk_detection", status: "live", description: "Spend anomaly and policy-abuse detection across employee travel", evaluation: "Precision against confirmed violations, replayed on corporate_policy_violations" },
    { service: "forecasting", status: "live", description: "Period spend and budget-exhaustion forecasting per cost centre", evaluation: "MAPE against realised period spend" },
    { service: "executive_summarization", status: "preview", description: "Corporate account review summaries for quarterly business reviews", evaluation: "Factuality check against the certified invoice and trip ledger" },
    { service: "classification", status: "planned", description: "Automatic expense-code classification for uncoded trips", evaluation: "Agreement with finance-confirmed coding" },
  ],
  failureModes: [
    { id: "budget_overrun", mode: "Trips billed beyond the reserved budget", detection: "Budget consumption exceeds the reservation", impact: "Unrecoverable spend and invoice disputes", mitigation: "Hard reservation at approval; block dispatch when the budget is exhausted" },
    { id: "kyb_stale", mode: "KYB document expires while the account is active", detection: "Document expiry monitor", impact: "Regulatory exposure on corporate billing", mitigation: "Expiry alerts at 30 days; suspend new approvals after expiry" },
    { id: "invoice_mismatch", mode: "Invoice lines do not reconcile to trips", detection: "Corporate financial reconciliation run", impact: "Delayed collection and loss of trust", mitigation: "Hold issue, run reconciliation, require controller sign-off" },
    { id: "orphan_approval", mode: "Approval issued without a completed trip", detection: "Approval without a matching ride event beyond the window", impact: "Reserved budget never released", mitigation: "Auto-release the reservation after the expiry window" },
  ],
  escalationPaths: [
    { trigger: "KYB rejected or expired on an active account", tier: "Tier 3", owner: "Compliance officer", responseMinutes: 240 },
    { trigger: "Invoice reconciliation variance above tolerance", tier: "Tier 2", owner: "Finance controller", responseMinutes: 480 },
    { trigger: "Budget exhausted for a live cost centre", tier: "Tier 2", owner: "Corporate account manager", responseMinutes: 120 },
    { trigger: "Repeated policy violations by one employee", tier: "Tier 2", owner: "Corporate admin", responseMinutes: 1440 },
  ],
};

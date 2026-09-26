/**
 * Business Capability Contract — Finance · Refunds, Disputes & Settlement.
 *
 * Published as part of Stage 0 (Platform Integrity Closure) so that every
 * declared dependency on `finance_refunds` resolves to a real contract and the
 * knowledge graph carries no dangling edges.
 */
import type { CapabilityContract } from "./capabilityContract";

export const FINANCE_REFUNDS_CONTRACT: CapabilityContract = {
  module: "finance_refunds",
  title: "Finance · Refunds, Disputes & Settlement",
  version: "1.0.0",
  route: "/dashboard/admin/refunds",
  owner: "Finance Operations",
  workflows: [
    {
      id: "refund_execution",
      name: "Refund request to disbursement",
      trigger: "refund.requested received from Customer Operations",
      stages: [
        "Intake and de-duplication",
        "Evidence and fraud scoring",
        "Policy evaluation (rules engine)",
        "Maker-checker approval",
        "Wallet or M-Pesa disbursement",
        "Ledger posting and reconciliation",
      ],
      approvals: ["Maker-checker for all refunds", "Finance controller dual approval above KES 100,000"],
      targetMinutes: 240,
    },
    {
      id: "dispute_resolution",
      name: "Chargeback and dispute resolution",
      trigger: "Payment processor chargeback or customer dispute raised",
      stages: ["Register dispute", "Assemble evidence pack", "Respond to processor", "Post outcome", "Recover or write off"],
      approvals: ["Finance controller for write-off"],
      targetMinutes: 4320,
    },
    {
      id: "settlement_cycle",
      name: "Partner and driver settlement cycle",
      trigger: "Settlement window closes",
      stages: ["Aggregate earnings", "Apply deductions and levies", "Three-way reconciliation", "Approve batch", "Disburse", "Publish settlement evidence"],
      approvals: ["Finance controller batch approval"],
      targetMinutes: 1440,
    },
  ],
  publishes: [
    { name: "refund.approved", payload: ["refund_id", "case_id", "status", "amount_kes", "approver_id"], latencyBudgetMinutes: 30, criticality: "critical" },
    { name: "refund.rejected", payload: ["refund_id", "case_id", "reason_code"], latencyBudgetMinutes: 30, criticality: "standard" },
    { name: "wallet.credited", payload: ["wallet_id", "amount_kes", "source", "reference"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "wallet.debited", payload: ["wallet_id", "amount_kes", "reason", "reference"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "settlement.completed", payload: ["settlement_id", "amount_kes", "period", "batch_id"], latencyBudgetMinutes: 60, criticality: "critical" },
  ],
  consumes: [
    { name: "refund.requested", payload: ["case_id", "amount_kes", "evidence_refs"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "fraud.signal.raised", payload: ["subject_id", "score", "signal_type"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "ride.completed", payload: ["ride_id", "fare_kes", "completed_at"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "package.delivered", payload: ["order_id", "delivered_at", "pod_id"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "corporate.invoice.issued", payload: ["invoice_id", "company_id", "amount_kes", "period"], latencyBudgetMinutes: 60, criticality: "critical" },
  ],
  dependencies: [
    { module: "customer_operations", reason: "Refund intake, evidence and customer communication", degradedBehaviour: "Refunds queue as pending intake; no auto-approval without evidence" },
    { module: "trust_safety", reason: "Fraud scoring before disbursement", degradedBehaviour: "Auto-approval disabled; every refund requires manual review" },
    { module: "delivery_logistics", reason: "Delivery proof for parcel compensation", degradedBehaviour: "Compensation held until POD evidence is available" },
    { module: "fleet", reason: "Driver earnings and deduction inputs for settlement", degradedBehaviour: "Settlement batch built from last certified earnings snapshot" },
  ],
  kpis: [
    { id: "refund_cycle_time", name: "Refund cycle time", unit: "minutes", target: "≤ 240 minutes p90", source: "refund_requests timestamps" },
    { id: "auto_approval_rate", name: "Policy auto-approval rate", unit: "percent", target: "≥ 60%", source: "rules engine decisions on refund_requests" },
    { id: "reconciliation_variance", name: "Ledger reconciliation variance", unit: "kes", target: "= 0 unexplained", source: "payment_financial_reconciliation_full" },
    { id: "dispute_win_rate", name: "Dispute win rate", unit: "percent", target: "≥ 70%", source: "chargebacks outcomes" },
    { id: "settlement_on_time", name: "On-time settlement rate", unit: "percent", target: "≥ 99%", source: "settlement batches vs window close" },
  ],
  aiRoadmap: [
    { service: "risk_detection", status: "live", description: "Refund abuse and duplicate-claim detection across wallet, case and trip history", evaluation: "Precision/recall against confirmed abuse cases, shadow-scored for two cycles" },
    { service: "forecasting", status: "live", description: "Refund liability and settlement cash-out forecasting per window", evaluation: "Forecast error against realised disbursements" },
    { service: "classification", status: "planned", description: "Automatic dispute reason-code assignment from evidence packs", evaluation: "Agreement with controller-confirmed reason codes" },
    { service: "executive_summarization", status: "planned", description: "Finance exposure briefing for the executive command centre", evaluation: "Factual grounding against ledger KPIs" },
  ],
  failureModes: [
    { id: "double_disbursement", mode: "Refund disbursed twice for one case", detection: "Idempotency key collision or duplicate ledger entry", impact: "Direct financial loss", mitigation: "Exactly-once wallet credit with idempotency keys; reconciliation blocks the batch" },
    { id: "ledger_drift", mode: "Projection drifts from the authoritative payment_attempts state", detection: "Projection consistency gate reports drift", impact: "Reported balances are wrong; audit exposure", mitigation: "Run the projection synchronisation engine and re-certify" },
    { id: "processor_outage", mode: "M-Pesa or processor unavailable", detection: "Consecutive gateway failures on disbursement", impact: "Refunds and settlements stall", mitigation: "Queue with backoff; publish a stabilisation banner; disclose the delay on the case" },
    { id: "evidence_gap", mode: "Refund approved without an evidence pack", detection: "Evidence hash missing on the approval record", impact: "Unauditable payout", mitigation: "Block approval when evidence hash verification fails" },
  ],
  escalationPaths: [
    { trigger: "Reconciliation variance detected", tier: "Tier 3", owner: "Finance controller", responseMinutes: 60 },
    { trigger: "Refund above KES 100,000", tier: "Tier 2", owner: "Finance controller (dual approval)", responseMinutes: 240 },
    { trigger: "Suspected refund fraud ring", tier: "Tier 3", owner: "Trust & Safety + Finance", responseMinutes: 30 },
    { trigger: "Settlement batch failure", tier: "Tier 2", owner: "Finance operations lead", responseMinutes: 120 },
  ],
};

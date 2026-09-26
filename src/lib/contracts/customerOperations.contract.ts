/**
 * Business Capability Contract — Module 2 · Enterprise Customer Operations.
 */
import type { CapabilityContract } from "./capabilityContract";

export const CUSTOMER_OPERATIONS_CONTRACT: CapabilityContract = {
  module: "customer_operations",
  title: "Enterprise Customer Operations & Resolution Center",
  version: "1.1.0",
  route: "/dashboard/admin/customer-operations",
  owner: "Customer Operations",
  workflows: [
    {
      id: "case_resolution",
      name: "Omnichannel case resolution",
      trigger: "Case created from any channel (app, web, phone, email, WhatsApp)",
      stages: ["Intake", "Auto-classification", "Priority prediction", "Auto-escalation", "Playbook execution", "Approval", "Resolution", "Root cause capture"],
      approvals: ["Finance approver for monetary outcomes", "Trust & Safety lead for safety outcomes"],
      targetMinutes: 720,
    },
    {
      id: "refund_dispute",
      name: "Refund dispute resolution",
      trigger: "Case classified as refund_dispute",
      stages: ["Verify payment", "Verify service delivery", "Verify ledger", "Maker-checker approval", "Reverse", "Notify"],
      approvals: ["Finance approver (separation of duties enforced in database)"],
      targetMinutes: 720,
    },
    {
      id: "safety_response",
      name: "Safety incident rapid response",
      trigger: "Case classified as safety_incident or SOS alert consumed",
      stages: ["Confirm safety", "Suspend driver", "Preserve evidence", "Investigate", "Regulatory assessment", "Resolve"],
      approvals: ["Trust & Safety lead", "Compliance admin for regulatory submission"],
      targetMinutes: 120,
    },
  ],
  publishes: [
    { name: "refund.requested", payload: ["case_id", "amount_kes", "evidence_refs"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "case.escalated", payload: ["case_id", "tier", "target_domain"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "parcel.investigation.opened", payload: ["case_id", "order_id", "evidence_required"], latencyBudgetMinutes: 15, criticality: "standard" },
    { name: "safety.escalation.published", payload: ["case_id", "driver_id", "severity"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "conduct.signal.published", payload: ["driver_id", "reason_code", "severity"], latencyBudgetMinutes: 30, criticality: "standard" },
    { name: "supply.gap.published", payload: ["zone", "delay_case_count", "window"], latencyBudgetMinutes: 60, criticality: "standard" },
    { name: "customerops.kpi.snapshot", payload: ["sla_compliance", "mttr", "frt", "root_cause_distribution"], latencyBudgetMinutes: 1440, criticality: "standard" },
  ],
  consumes: [
    { name: "refund.approved", payload: ["refund_id", "case_id", "status"], latencyBudgetMinutes: 30, criticality: "critical" },
    { name: "shipment.exception", payload: ["order_id", "exception_type", "sla_state"], latencyBudgetMinutes: 15, criticality: "critical" },
    { name: "fraud.signal.raised", payload: ["subject_id", "score", "signal_type"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "driver.incident.recorded", payload: ["driver_id", "incident_type", "severity"], latencyBudgetMinutes: 60, criticality: "standard" },
  ],
  dependencies: [
    { module: "finance_refunds", reason: "Refund execution and ledger verification", degradedBehaviour: "Cases hold at the approval gate; no automated disbursement" },
    { module: "delivery_logistics", reason: "Shipment evidence, POD/OTP and warehouse scans", degradedBehaviour: "Evidence assessment returns low confidence and blocks compensation" },
    { module: "trust_safety", reason: "Fraud signals and safety enforcement", degradedBehaviour: "High-risk cases are queued for manual review" },
  ],
  kpis: [
    { id: "sla_compliance", name: "Resolution SLA compliance", unit: "percent", target: "≥ 95%", source: "support_cases.sla_resolution_breached" },
    { id: "mttr", name: "Mean time to resolution", unit: "minutes", target: "≤ 480", source: "support_cases created_at → resolved_at" },
    { id: "frt", name: "First response time", unit: "minutes", target: "≤ 30", source: "support_cases.first_response_at" },
    { id: "reopen_rate", name: "Reopen rate", unit: "percent", target: "≤ 5%", source: "support_case_events" },
  ],
  aiRoadmap: [
    { service: "classification", status: "live", description: "Blended rules + statistical + similarity pipeline; LLM classifier registered but disabled", evaluation: "Agreement rate against agent-confirmed reason codes ≥ 85%" },
    { service: "prioritization", status: "live", description: "Explainable weighted priority prediction with per-driver attribution", evaluation: "Breach rate of predicted-urgent cases lower than manual triage baseline" },
    { service: "similar_case_retrieval", status: "planned", description: "Retrieve historically similar cases and their dispositions", evaluation: "Agent acceptance rate of the suggested precedent" },
    { service: "sop_recommendation", status: "live", description: "Playbook and knowledge suggestion per classified case type", evaluation: "Playbook adherence rate" },
    { service: "executive_summarization", status: "planned", description: "Narrative executive briefing over case intelligence", evaluation: "Factual grounding check against source metrics" },
    { service: "risk_detection", status: "live", description: "Fraud, churn and contradiction detection over case evidence", evaluation: "Precision on confirmed fraud cases" },
    { service: "forecasting", status: "live", description: "SLA breach, corporate pressure and logistics overload prediction", evaluation: "Hit rate of 2h SLA breach predictions" },
    { service: "natural_language_query", status: "planned", description: "Ask questions of the case corpus in natural language", evaluation: "Query answer accuracy against deterministic aggregates" },
  ],
  failureModes: [
    { id: "classifier_drift", mode: "Classification quality degrades as language shifts", detection: "Agreement score across classifiers falls below 60%", impact: "Cases route to the wrong domain", mitigation: "Rules classifier remains the deterministic fallback; agents can override" },
    { id: "evidence_gap", mode: "Required evidence unavailable from an upstream domain", detection: "Evidence assessment marks required items missing", impact: "Financial decisions blocked", mitigation: "Case holds at the gate with an explicit next step" },
    { id: "exchange_stale", mode: "Cross-domain event exchange stops", detection: "Dependency map reports stale or unobserved", impact: "Stale correlation data", mitigation: "Dependency score surfaces the broken link on the Integration tab" },
    { id: "sla_storm", mode: "Simultaneous SLA breaches from an upstream outage", detection: "More than 10 cases predicted to breach within 2h", impact: "Contractual credit exposure", mitigation: "Predictive signal drives queue re-prioritisation and reassignment" },
  ],
  escalationPaths: [
    { trigger: "Safety incident", tier: "Tier 3", owner: "Trust & Safety · Rapid Response", responseMinutes: 15 },
    { trigger: "Fraud with exposure ≥ KES 10,000", tier: "Tier 3", owner: "Fraud Intelligence", responseMinutes: 60 },
    { trigger: "Corporate SLA pressure", tier: "Tier 2", owner: "Corporate Success", responseMinutes: 240 },
    { trigger: "Predicted SLA breach within 2h", tier: "Tier 2", owner: "Customer Operations · Queue Management", responseMinutes: 30 },
  ],
};

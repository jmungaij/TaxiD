/**
 * Business Capability Contract — Trust & Safety.
 *
 * Stage 0 (Platform Integrity Closure): resolves every declared dependency on
 * `trust_safety` and makes the fraud/safety capability self-describing.
 */
import type { CapabilityContract } from "./capabilityContract";

export const TRUST_SAFETY_CONTRACT: CapabilityContract = {
  module: "trust_safety",
  title: "Trust & Safety Command Center",
  version: "1.0.0",
  route: "/dashboard/admin/trust-safety",
  owner: "Trust & Safety",
  workflows: [
    {
      id: "fraud_investigation",
      name: "Fraud signal to disposition",
      trigger: "Risk engine raises a signal above the investigation threshold",
      stages: ["Signal intake", "Entity resolution", "Evidence correlation", "Analyst review", "Disposition", "Enforcement or release"],
      approvals: ["Trust & Safety lead for account restriction", "Dual approval for permanent ban"],
      targetMinutes: 240,
    },
    {
      id: "safety_incident",
      name: "Safety incident response",
      trigger: "safety.escalation.published or SOS activation",
      stages: ["Acknowledge", "Contact parties", "Stabilise (suspend / dispatch support)", "Investigate", "Regulatory notification", "Close with root cause"],
      approvals: ["Safety duty manager for driver suspension"],
      targetMinutes: 60,
    },
    {
      id: "conduct_review",
      name: "Driver and rider conduct review",
      trigger: "conduct.signal.published or repeated complaints",
      stages: ["Aggregate signals", "Score behaviour", "Issue warning or training", "Verify improvement"],
      approvals: ["Conduct panel for deactivation"],
      targetMinutes: 2880,
    },
  ],
  publishes: [
    { name: "fraud.signal.raised", payload: ["subject_id", "score", "signal_type", "entity_kind"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "driver.suspended", payload: ["driver_id", "reason_code", "suspended_until", "decision_id"], latencyBudgetMinutes: 10, criticality: "critical" },
  ],
  consumes: [
    { name: "safety.escalation.published", payload: ["case_id", "driver_id", "severity"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "conduct.signal.published", payload: ["driver_id", "reason_code", "severity"], latencyBudgetMinutes: 30, criticality: "standard" },
    { name: "case.escalated", payload: ["case_id", "tier", "target_domain"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "shipment.exception", payload: ["order_id", "exception_type", "sla_state"], latencyBudgetMinutes: 15, criticality: "critical" },
    { name: "driver.incident.recorded", payload: ["driver_id", "incident_type", "severity"], latencyBudgetMinutes: 60, criticality: "standard" },
  ],
  dependencies: [
    { module: "customer_operations", reason: "Case evidence, victim contact and disclosure", degradedBehaviour: "Investigations proceed on signal evidence only; customer contact deferred" },
    { module: "fleet", reason: "Driver identity, compliance and vehicle history", degradedBehaviour: "Enforcement uses last-known compliance snapshot" },
    { module: "finance_refunds", reason: "Payout holds and recovery on confirmed fraud", degradedBehaviour: "Holds recorded as intents and applied when finance recovers" },
    { module: "delivery_logistics", reason: "Parcel tampering and delivery-fraud evidence", degradedBehaviour: "High-value shipments require manual release" },
  ],
  kpis: [
    { id: "signal_precision", name: "Fraud signal precision", unit: "percent", target: "≥ 75%", source: "confirmed vs raised fraud signals" },
    { id: "safety_ack_time", name: "Safety acknowledgement time", unit: "minutes", target: "≤ 5 minutes p95", source: "safety escalation timestamps" },
    { id: "investigation_cycle", name: "Investigation cycle time", unit: "minutes", target: "≤ 240 minutes p90", source: "trust cases timeline" },
    { id: "repeat_offender_rate", name: "Repeat offender rate", unit: "percent", target: "≤ 5%", source: "enforcement history per subject" },
    { id: "false_suspension_rate", name: "Reversed suspension rate", unit: "percent", target: "≤ 2%", source: "appeals overturned / suspensions issued" },
  ],
  aiRoadmap: [
    { service: "risk_detection", status: "live", description: "Behavioural and device-graph anomaly detection across riders, drivers and wallets", evaluation: "Precision against analyst-confirmed dispositions, shadow-scored before enforcement" },
    { service: "prioritization", status: "live", description: "Investigation queue ranking by expected loss and safety severity", evaluation: "Time-to-detection improvement on confirmed cases" },
    { service: "similar_case_retrieval", status: "planned", description: "Surface prior cases with matching modus operandi", evaluation: "Analyst-rated usefulness on sampled cases" },
    { service: "executive_summarization", status: "planned", description: "Weekly trust posture briefing", evaluation: "Factual grounding against case KPIs" },
  ],
  failureModes: [
    { id: "signal_flood", mode: "Risk engine floods the queue with low-value signals", detection: "Signal volume above baseline with falling precision", impact: "Analyst capacity consumed; real threats delayed", mitigation: "Raise the investigation threshold and re-tune scoring weights" },
    { id: "silent_engine", mode: "Risk engine stops emitting signals", detection: "Zero signals in a monitored window", impact: "Fraud proceeds undetected", mitigation: "Health check alert on signal heartbeat; fail over to rule-only scoring" },
    { id: "wrongful_enforcement", mode: "Driver suspended on a false positive", detection: "Appeal overturned within the review window", impact: "Supply loss and reputational harm", mitigation: "Dual approval for permanent action; automatic reinstatement and earnings make-good" },
    { id: "evidence_loss", mode: "Case evidence unavailable at review time", detection: "Evidence reference resolves to nothing", impact: "Enforcement unprovable; regulatory exposure", mitigation: "Immutable evidence hashing at capture; block disposition without evidence" },
  ],
  escalationPaths: [
    { trigger: "Physical safety incident in progress", tier: "Tier 3", owner: "Safety duty manager", responseMinutes: 5 },
    { trigger: "Confirmed fraud ring", tier: "Tier 3", owner: "Trust & Safety lead + Finance", responseMinutes: 30 },
    { trigger: "Regulator-notifiable incident", tier: "Tier 3", owner: "Compliance officer", responseMinutes: 60 },
    { trigger: "Appeal against suspension", tier: "Tier 2", owner: "Conduct panel", responseMinutes: 1440 },
  ],
};

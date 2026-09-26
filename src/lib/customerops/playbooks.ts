/**
 * Customer Operations — configuration-driven operational playbooks (SOPs).
 *
 * Each case type resolves to a Standard Operating Procedure: ordered checklist,
 * required evidence, approval gates, cross-domain handoffs and audit outcome.
 * Pure configuration — rendered by the UI, no backend required.
 */
import type { BusinessDomain, CaseType } from "./taxonomy";

export interface PlaybookStep {
  id: string;
  title: string;
  /** Domain that executes this step (drives the cross-domain traversal check). */
  domain: BusinessDomain;
  /** Evidence that must be attached before the step can be marked complete. */
  evidence: string[];
  /** Maker-checker approval required to advance. */
  approval?: string;
  /** Existing platform surface an agent uses to complete the step. */
  system?: string;
}

export interface Playbook {
  caseType: CaseType;
  title: string;
  objective: string;
  targetResolutionMinutes: number;
  steps: PlaybookStep[];
  /** Terminal audit record written when the playbook completes. */
  auditOutcome: string;
}

const step = (
  id: string,
  title: string,
  domain: BusinessDomain,
  evidence: string[],
  extra: Partial<PlaybookStep> = {},
): PlaybookStep => ({ id, title, domain, evidence, ...extra });

export const PLAYBOOKS: Playbook[] = [
  {
    caseType: "refund_dispute",
    title: "Refund dispute resolution",
    objective: "Validate the disputed charge end-to-end and reverse only verified, ledger-consistent amounts.",
    targetResolutionMinutes: 720,
    steps: [
      step("verify_payment", "Verify payment attempt & M-Pesa receipt", "finance", ["payment_attempts record", "M-Pesa receipt number"], { system: "/dashboard/admin/payments" }),
      step("verify_trip", "Verify the trip or delivery actually occurred", "logistics", ["fact_trips row or delivery_orders row", "GPS trace"], { system: "/dashboard/admin/rider-management?tab=trips" }),
      step("verify_settlement", "Verify driver settlement exposure", "driver_ops", ["driver_payouts record", "settlement batch id"], { system: "/dashboard/admin/drivers" }),
      step("verify_ledger", "Verify ledger and wallet balance impact", "finance", ["journal_lines", "wallet_transactions"], { system: "/dashboard/admin/wallets" }),
      step("approve", "Maker-checker approval of the refund amount", "finance", ["refund_requests decision"], { approval: "Finance approver (separation of duties enforced in DB)", system: "/dashboard/admin/refunds" }),
      step("reverse", "Execute reversal", "finance", ["mpesa-reverse response", "reversal reference"], { system: "/dashboard/admin/refunds" }),
      step("notify", "Notify the customer with the resolution outcome", "support", ["notification dispatch id"]),
      step("close", "Close case and record root cause", "support", ["root cause classification"]),
    ],
    auditOutcome: "refund_requests + refund_request_events + support_case_events append-only trail",
  },
  {
    caseType: "lost_parcel",
    title: "Lost parcel investigation",
    objective: "Reconstruct the parcel's chain of custody before deciding compensation or fraud escalation.",
    targetResolutionMinutes: 1440,
    steps: [
      step("custody", "Reconstruct chain of custody", "logistics", ["package_chain_of_custody", "warehouse scan events"], { system: "/delivery/ops/packages" }),
      step("gps", "Correlate courier GPS history to the delivery window", "logistics", ["location_history", "delivery_route_segments"]),
      step("pod", "Validate proof of delivery and OTP verification", "logistics", ["proof_of_delivery record", "OTP verification log"], { system: "/delivery/ops/pod" }),
      step("driver_history", "Review courier behaviour and prior disputes", "driver_ops", ["driver_incidents", "prior support_cases"]),
      step("fraud_check", "Screen for delivery fraud patterns", "trust_safety", ["delivery_fraud_signals", "package_tamper_alerts"], { system: "/dashboard/admin/delivery-fraud" }),
      step("decision", "Approve compensation or escalate as fraud", "finance", ["compensation calculation"], { approval: "Logistics manager + Finance approver" }),
      step("close", "Notify customer, close and record root cause", "support", ["root cause classification"]),
    ],
    auditOutcome: "support_case_events + audit_logs + delivery_document_events",
  },
  {
    caseType: "safety_incident",
    title: "Safety incident rapid response",
    objective: "Protect life first, preserve evidence, then apply disciplinary and regulatory follow-up.",
    targetResolutionMinutes: 120,
    steps: [
      step("triage", "Confirm immediate customer safety", "trust_safety", ["contact attempt log"], { system: "/dashboard/admin/trust-center" }),
      step("suspend", "Suspend the involved driver pending investigation", "driver_ops", ["driver_lifecycle_actions record"], { approval: "Trust & Safety lead" }),
      step("evidence", "Preserve trip, GPS and SOS evidence", "trust_safety", ["rider_sos_alerts", "trip_location_events"]),
      step("rider_care", "Contact the rider, confirm welfare and log the statement", "rider_ops", ["rider welfare check", "rider statement"], { system: "/dashboard/admin/rider-management" }),
      step("investigate", "Open a formal Trust & Safety investigation", "trust_safety", ["trust_investigations record"]),
      step("regulatory", "Assess regulatory / NTSA reporting duty", "trust_safety", ["regulatory_submissions"], { approval: "Compliance admin" }),
      step("resolve", "Communicate outcome and close with prevention action", "support", ["resolution note", "prevention action"]),
    ],
    auditOutcome: "trust_incidents + support_case_events + admin_audit_log",
  },
  {
    caseType: "driver_conduct",
    title: "Driver conduct review",
    objective: "Apply consistent, evidence-based disciplinary outcomes.",
    targetResolutionMinutes: 1440,
    steps: [
      step("evidence", "Collect rider statement and trip context", "support", ["case description", "fact_trips row"]),
      step("history", "Review driver score and prior conduct cases", "driver_ops", ["driver_scores", "driver_incidents"], { system: "/dashboard/admin/drivers" }),
      step("conduct_risk", "Trust & Safety conduct assessment and enforcement decision", "trust_safety", ["trust_incidents", "enforcement decision"], { approval: "Trust & Safety lead" }),
      step("interview", "Driver response captured", "driver_ops", ["driver statement note"]),
      step("action", "Apply disciplinary action or coaching assignment", "driver_ops", ["driver_lifecycle_actions", "training_enrollments"], { approval: "Driver Operations manager" }),
      step("close", "Notify rider, close and record root cause", "support", ["root cause classification"]),
    ],
    auditOutcome: "driver_lifecycle_history + support_case_events",
  },
  {
    caseType: "payment_issue",
    title: "Payment failure recovery",
    objective: "Restore the customer's payment path and reconcile the canonical payment state.",
    targetResolutionMinutes: 480,
    steps: [
      step("attempt", "Locate the payment attempt and failure class", "finance", ["payment_attempts", "failure classification"], { system: "/dashboard/admin/payment-ops" }),
      step("callback", "Confirm M-Pesa callback and DLQ status", "finance", ["mpesa_callback_logs", "payment DLQ entry"], { system: "/dashboard/admin/payment-dlq" }),
      step("reconcile", "Reconcile wallet projection against the ledger", "finance", ["wallet_reconciliation", "projection drift scan"], { system: "/dashboard/admin/reconciliation" }),
      step("retry", "Retry or issue an alternative payment path", "finance", ["retry reference"], { approval: "Finance approver (maker-checker on any monetary movement)" }),
      step("close", "Confirm with customer and close", "support", ["confirmation note"]),
    ],
    auditOutcome: "payment_audit_logs_v2 + support_case_events",
  },
  {
    caseType: "delivery_failure",
    title: "Delivery exception handling",
    objective: "Recover the delivery within SLA or arrange a compliant redelivery / refund.",
    targetResolutionMinutes: 480,
    steps: [
      step("locate", "Locate the shipment and current route segment", "logistics", ["delivery_orders", "delivery_route_segments"], { system: "/dashboard/admin/logistics-center" }),
      step("dispatch", "Re-dispatch or reroute the courier", "logistics", ["delivery_dispatch_jobs record"]),
      step("sla", "Assess SLA breach and notify the partner", "logistics", ["SLA breach alert", "notification dispatch id"]),
      step("courier", "Review courier performance and record the conduct signal", "driver_ops", ["driver_scores", "conduct signal"], { system: "/dashboard/admin/drivers" }),
      step("compensate", "Decide redelivery, credit or refund", "finance", ["decision note"], { approval: "Logistics manager" }),
      step("close", "Close and record root cause (warehouse / courier / address)", "support", ["root cause classification"]),
    ],
    auditOutcome: "audit_logs + support_case_events",
  },
  {
    caseType: "fraud",
    title: "Fraud investigation",
    objective: "Contain financial exposure and produce an evidence pack for enforcement.",
    targetResolutionMinutes: 2880,
    steps: [
      step("contain", "Freeze wallet / suspend account as needed", "trust_safety", ["wallet_freezes record"], { approval: "Fraud lead", system: "/dashboard/admin/fraud-center" }),
      step("signals", "Collect fraud signals and device fingerprints", "trust_safety", ["fraud_signals", "device_fingerprints"]),
      step("financial", "Quantify financial exposure", "finance", ["suspicious_transactions", "payment exposure total"]),
      step("rider_check", "Verify rider identity, devices and booking pattern", "rider_ops", ["profiles", "device_fingerprints", "fact_trips"]),
      step("driver_check", "Verify driver / courier collusion signals", "driver_ops", ["driver_scores", "driver_incidents"]),
      step("case", "Open a formal fraud case", "trust_safety", ["fraud_cases record"], { system: "/dashboard/admin/fraud-cases" }),
      step("decision", "Enforcement decision and recovery action", "trust_safety", ["decision record"], { approval: "Compliance admin" }),
      step("close", "Close with prevention rule recommendation", "support", ["fraud_rules recommendation"]),
    ],
    auditOutcome: "fraud_cases + audit_hash_chain + support_case_events",
  },
  {
    caseType: "corporate_policy",
    title: "Corporate policy exception",
    objective: "Resolve policy, budget and invoicing exceptions against the corporate agreement.",
    targetResolutionMinutes: 1440,
    steps: [
      step("account", "Load the corporate account and agreement terms", "corporate", ["corporate_accounts", "corporate_ride_policies"], { system: "/dashboard/admin/corporates" }),
      step("violation", "Review the policy violation and approval chain", "corporate", ["corporate_policy_violations", "approval_requests"]),
      step("budget", "Check budget / cost centre consumption", "finance", ["budget_consumption", "cost_centers"]),
      step("decision", "Grant exception or uphold the policy", "corporate", ["decision note"], { approval: "Corporate admin + Finance approver" }),
      step("close", "Update the account owner and close", "support", ["notification dispatch id"]),
    ],
    auditOutcome: "corporate_policy_audit_log + support_case_events",
  },
  {
    caseType: "delayed_ride",
    title: "Delayed ride recovery",
    objective: "Recover the trip experience and feed supply signals back to the marketplace.",
    targetResolutionMinutes: 240,
    steps: [
      step("trip", "Review trip, dispatch and ETA history", "marketplace", ["dispatch_requests", "dispatch_eta_estimates"]),
      step("supply", "Check supply/surge conditions in the pickup zone", "marketplace", ["marketplace_supply_snapshots"], { system: "/dashboard/admin/marketplace" }),
      step("driver_review", "Review the assigned driver's acceptance and ETA adherence", "driver_ops", ["driver_scores", "dispatch_assignments"], { system: "/dashboard/admin/drivers" }),
      step("goodwill", "Apply goodwill credit where warranted", "finance", ["wallet_transactions credit"], { approval: "Tier 2 supervisor" }),
      step("close", "Close and publish the supply gap signal", "support", ["root cause classification"]),
    ],
    auditOutcome: "support_case_events + marketplace supply signal",
  },
  {
    caseType: "vehicle_issue",
    title: "Vehicle / rental issue",
    objective: "Return the vehicle to a compliant, safe state and protect the rental agreement.",
    targetResolutionMinutes: 1440,
    steps: [
      step("vehicle", "Identify the vehicle and current compliance state", "fleet", ["vehicles", "vehicle_compliance"], { system: "/dashboard/admin/fleet" }),
      step("inspection", "Schedule inspection or maintenance", "fleet", ["vehicle_inspections", "vehicle_maintenance"]),
      step("driver_handover", "Brief the assigned driver and confirm handover", "driver_ops", ["driver assignment note"], { system: "/dashboard/admin/drivers" }),
      step("swap", "Arrange replacement vehicle if service-affecting", "fleet", ["assignment change record"], { approval: "Fleet manager" }),
      step("close", "Confirm with the customer and close", "support", ["confirmation note"]),
    ],
    auditOutcome: "vehicle_compliance_events + support_case_events",
  },
  {
    caseType: "general_enquiry",
    title: "General enquiry handling",
    objective: "Answer accurately in one touch using knowledge intelligence.",
    targetResolutionMinutes: 240,
    steps: [
      step("understand", "Confirm the customer's request", "support", ["case description"]),
      step("knowledge", "Apply the suggested knowledge article / policy", "support", ["knowledge reference"]),
      step("close", "Respond and close", "support", ["response sent"]),
    ],
    auditOutcome: "support_case_events",
  },
];

export const PLAYBOOK_BY_TYPE = new Map(PLAYBOOKS.map((p) => [p.caseType, p]));

export function getPlaybook(type: CaseType): Playbook {
  return PLAYBOOK_BY_TYPE.get(type) ?? PLAYBOOK_BY_TYPE.get("general_enquiry")!;
}

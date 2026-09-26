/**
 * SAFARID orchestration — event-to-work engine.
 *
 * This is the layer that was missing between the Super Admin data ecosystem and
 * the Staff Portal. It answers, for every platform event:
 *
 *   Can automation handle it?  Does it need human work, approval, escalation,
 *   a notification only, or nothing at all?  Which department queue owns it?
 *   How urgent is it, and by when must it be resolved?
 *
 * Every function here is PURE and deterministic: the same event always produces
 * the same decision, so the classification can be replayed and audited.
 */
import {
  EVENT_LABEL,
  EVENT_STAGE,
  type ChainStage,
  type EntityType,
  type EventType,
  type PlatformEvent,
} from "./events";

/** Departmental work queues. Aligned to the Staff Portal operating model. */
export const OPS_QUEUES = [
  "customer_operations",
  "supply_operations",
  "dispatch_fulfilment",
  "corporate_operations",
  "delivery_logistics",
  "rental_leasing",
  "charter_aviation",
  "finance",
  "trust_safety",
  "sales_revenue",
] as const;
export type OpsQueue = (typeof OPS_QUEUES)[number];

export const QUEUE_LABEL: Record<OpsQueue, string> = {
  customer_operations: "Customer Operations",
  supply_operations: "Supply Operations",
  dispatch_fulfilment: "Dispatch & Fulfilment",
  corporate_operations: "Corporate Operations",
  delivery_logistics: "Delivery & Logistics",
  rental_leasing: "Rental & Leasing",
  charter_aviation: "Charter & Aviation",
  finance: "Finance",
  trust_safety: "Trust, Safety & Compliance",
  sales_revenue: "Sales & Revenue Operations",
};

/** Roles authorised to work a queue. Server-side RLS mirrors this mapping. */
export const QUEUE_ROLES: Record<OpsQueue, string[]> = {
  customer_operations: ["support_agent", "support_lead", "operations_admin", "admin", "super_admin"],
  supply_operations: ["fleet_manager", "operations_admin", "operations_manager", "admin", "super_admin"],
  dispatch_fulfilment: ["dispatcher", "operations_manager", "operations_admin", "admin", "super_admin"],
  corporate_operations: ["corporate_admin", "operations_admin", "admin", "super_admin"],
  delivery_logistics: ["logistics_manager", "operations_admin", "operations_manager", "admin", "super_admin"],
  rental_leasing: ["rental_manager", "operations_admin", "admin", "super_admin"],
  charter_aviation: ["charter_admin", "operations_admin", "admin", "super_admin"],
  finance: ["finance_admin", "finance_analyst", "admin", "super_admin"],
  trust_safety: ["compliance_admin", "trust_safety_officer", "admin", "super_admin"],
  sales_revenue: ["sales_rep", "sales_manager", "revenue_admin", "admin", "super_admin"],
};

export const DISPOSITIONS = ["auto", "staff_work", "approval", "escalate", "notify_only", "no_action"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Base routing per event type: owning queue, work kind, SLA and required action. */
interface RouteRule {
  queue: OpsQueue;
  workKind: string;
  priority: Priority;
  /** SLA target in minutes from event time. */
  slaMinutes: number;
  requiredAction: string;
  /** Approval is intrinsic to the event (authority decision, not just work). */
  needsApproval?: boolean;
}

const R: Record<EventType, RouteRule> = {
  demand_captured: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "low", slaMinutes: 60, requiredAction: "Confirm the requirement is complete and matchable" },
  demand_unmatched: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "high", slaMinutes: 10, requiredAction: "Source replacement independent supply or advise the customer" },
  quote_awaiting_provider_response: { queue: "charter_aviation", workKind: "operations_task", priority: "medium", slaMinutes: 120, requiredAction: "Chase provider quotes and present options to the customer" },
  high_value_demand: { queue: "sales_revenue", workKind: "sales_opportunity", priority: "high", slaMinutes: 60, requiredAction: "Qualify the opportunity and secure the booking" },
  approval_required: { queue: "corporate_operations", workKind: "approval", priority: "high", slaMinutes: 45, requiredAction: "Record an authority decision with reason", needsApproval: true },
  provider_cancelled: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "high", slaMinutes: 15, requiredAction: "Secure replacement supply and update the customer" },
  driver_no_show: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "critical", slaMinutes: 10, requiredAction: "Reassign supply, contact the customer, log provider performance" },
  late_pickup: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "medium", slaMinutes: 20, requiredAction: "Contact the provider and set customer expectation" },
  route_exception: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "medium", slaMinutes: 30, requiredAction: "Resolve the routing issue with the provider" },
  failed_pickup: { queue: "delivery_logistics", workKind: "operations_task", priority: "high", slaMinutes: 30, requiredAction: "Rebook pickup or return the consignment to the sender" },
  failed_delivery: { queue: "delivery_logistics", workKind: "operations_task", priority: "high", slaMinutes: 30, requiredAction: "Confirm the address, reattempt delivery or arrange return" },
  pod_dispute: { queue: "delivery_logistics", workKind: "customer_case", priority: "high", slaMinutes: 120, requiredAction: "Gather proof-of-delivery evidence and record a decision" },
  sla_breach_risk: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "high", slaMinutes: 10, requiredAction: "Intervene before the SLA is breached" },
  sla_breached: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "critical", slaMinutes: 15, requiredAction: "Recover the service and record the breach cause" },
  fulfilment_completed: { queue: "dispatch_fulfilment", workKind: "operations_task", priority: "low", slaMinutes: 1440, requiredAction: "No action — transaction closes automatically" },
  reservation_exception: { queue: "rental_leasing", workKind: "operations_task", priority: "high", slaMinutes: 60, requiredAction: "Resolve inventory availability with the rental provider" },
  return_exception: { queue: "rental_leasing", workKind: "operations_task", priority: "medium", slaMinutes: 240, requiredAction: "Reconcile the return condition with the provider and customer" },
  damage_dispute: { queue: "rental_leasing", workKind: "customer_case", priority: "high", slaMinutes: 480, requiredAction: "Collect evidence from both parties and record a liability decision" },
  agreement_approval_required: { queue: "rental_leasing", workKind: "approval", priority: "high", slaMinutes: 480, requiredAction: "Approve or decline the agreement with reason", needsApproval: true },
  payment_failed: { queue: "finance", workKind: "reconciliation", priority: "high", slaMinutes: 60, requiredAction: "Recover the payment or place the transaction on hold" },
  refund_requested: { queue: "finance", workKind: "approval", priority: "medium", slaMinutes: 480, requiredAction: "Assess and authorise the refund", needsApproval: true },
  reconciliation_exception: { queue: "finance", workKind: "reconciliation", priority: "high", slaMinutes: 480, requiredAction: "Investigate the money mismatch and correct the record" },
  settlement_exception: { queue: "finance", workKind: "reconciliation", priority: "high", slaMinutes: 480, requiredAction: "Resolve the provider settlement discrepancy" },
  commission_exception: { queue: "finance", workKind: "reconciliation", priority: "medium", slaMinutes: 720, requiredAction: "Recalculate commission against the agreed terms" },
  corporate_invoice_exception: { queue: "corporate_operations", workKind: "reconciliation", priority: "medium", slaMinutes: 720, requiredAction: "Correct the invoice and notify the corporate account" },
  provider_onboarding_submitted: { queue: "supply_operations", workKind: "document_review", priority: "medium", slaMinutes: 480, requiredAction: "Verify provider identity, ownership and compliance documents" },
  compliance_document_expiring: { queue: "supply_operations", workKind: "document_review", priority: "medium", slaMinutes: 1440, requiredAction: "Request a renewed document from the independent provider" },
  compliance_document_expired: { queue: "trust_safety", workKind: "document_review", priority: "critical", slaMinutes: 120, requiredAction: "Restrict supply eligibility until a valid document is provided" },
  provider_repeat_cancellation: { queue: "supply_operations", workKind: "operations_task", priority: "high", slaMinutes: 480, requiredAction: "Run a provider performance intervention and decide on restriction" },
  fraud_signal: { queue: "trust_safety", workKind: "operations_task", priority: "critical", slaMinutes: 60, requiredAction: "Investigate the signal and apply a containment decision" },
  safety_incident: { queue: "trust_safety", workKind: "customer_case", priority: "critical", slaMinutes: 30, requiredAction: "Run the safety protocol and record the outcome" },
  customer_complaint: { queue: "customer_operations", workKind: "customer_case", priority: "medium", slaMinutes: 240, requiredAction: "Acknowledge, resolve and record service recovery" },
};

/** Events automation is expected to absorb when the happy path holds. */
const AUTOMATABLE: EventType[] = ["demand_captured", "fulfilment_completed", "late_pickup", "demand_unmatched", "provider_cancelled", "payment_failed"];

export interface OrchestrationDecision {
  eventId: string;
  eventType: EventType;
  stage: ChainStage;
  disposition: Disposition;
  /** Null when nothing needs to be queued. */
  queue: OpsQueue | null;
  workKind: string | null;
  priority: Priority;
  slaMinutes: number;
  requiredAction: string | null;
  needsApproval: boolean;
  escalateImmediately: boolean;
  /** Ordered, human-readable justification — persisted for audit. */
  reasons: string[];
  entityType: EntityType;
  entityId: string;
  title: string;
  /** Roles allowed to see and action the resulting work. */
  authorisedRoles: string[];
}

const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "critical"];
const raise = (p: Priority, steps = 1): Priority =>
  PRIORITY_ORDER[Math.min(PRIORITY_ORDER.length - 1, PRIORITY_ORDER.indexOf(p) + steps)];

/**
 * Classify one platform event into an operational disposition.
 * Automation first, humans for the exceptions, approval where authority is required.
 */
export function classifyEvent(event: PlatformEvent): OrchestrationDecision {
  const rule = R[event.type];
  const s = event.signals ?? {};
  const reasons: string[] = [];
  let priority = rule.priority;
  let slaMinutes = rule.slaMinutes;
  let disposition: Disposition = "staff_work";
  let escalateImmediately = false;

  // 1. Did automation already close the loop?
  if (s.autoResolved) {
    reasons.push("Automation resolved the event without human intervention");
    disposition = "auto";
  } else if (event.type === "fulfilment_completed") {
    reasons.push("Clean fulfilment — routine closure handled automatically");
    disposition = "auto";
  } else if (
    (event.type === "demand_unmatched" || event.type === "provider_cancelled") &&
    s.replacementSupplyAvailable
  ) {
    reasons.push("Replacement independent supply is available — rematching automatically");
    disposition = "auto";
  } else if (event.type === "demand_captured") {
    reasons.push("Complete requirement enters matching automatically");
    disposition = "auto";
  } else if (event.type === "compliance_document_expiring" && (s.daysToExpiry ?? 0) > 30) {
    reasons.push("Expiry is more than 30 days away — provider reminded, no work created");
    disposition = "notify_only";
  }

  if (disposition === "staff_work") {
    if (AUTOMATABLE.includes(event.type)) {
      reasons.push("Automated path exhausted — human intervention required");
    } else {
      reasons.push(`${EVENT_LABEL[event.type]} always requires human handling`);
    }

    if (rule.needsApproval) {
      disposition = "approval";
      reasons.push("Authority decision required before the transaction can proceed");
    }

    // 2. Contextual severity — corporate, waiting customers, SLA and money.
    if (s.customerWaiting) { priority = raise(priority); slaMinutes = Math.min(slaMinutes, 15); reasons.push("Customer is actively waiting (+priority, SLA tightened)"); }
    if (s.isCorporate) { priority = raise(priority); reasons.push("Corporate account — contractual obligation (+priority)"); }
    if (s.slaSensitive) { slaMinutes = Math.min(slaMinutes, 10); reasons.push("SLA-sensitive booking — SLA tightened to 10 minutes"); }
    if ((s.amountKes ?? 0) >= 500_000) { priority = "critical"; reasons.push("Value at or above KES 500,000 (critical)"); }
    else if ((s.amountKes ?? 0) >= 100_000) { priority = raise(priority); reasons.push("Value at or above KES 100,000 (+priority)"); }
    if ((s.providerCancellationCount ?? 0) >= 3) { priority = raise(priority); reasons.push("Provider has cancelled 3+ times — performance risk (+priority)"); }
    if (s.repeatIssue) { priority = raise(priority); reasons.push("Repeat failure on the same entity (+priority)"); }
    if (event.type === "compliance_document_expired" || (s.daysToExpiry ?? 1) < 0) {
      reasons.push("Document is expired — supply eligibility must be restricted");
    }

    // 3. Immediate escalation for critical, SLA-breached or safety-critical work.
    if (priority === "critical" || event.type === "sla_breached" || event.type === "safety_incident") {
      escalateImmediately = true;
      disposition = disposition === "approval" ? "approval" : "escalate";
      reasons.push("Escalated to the department lead on creation");
    }
  }

  const noQueue = disposition === "auto" || disposition === "notify_only";
  const queue: OpsQueue | null = noQueue ? null : rule.queue;

  return {
    eventId: event.id,
    eventType: event.type,
    stage: EVENT_STAGE[event.type],
    disposition,
    queue,
    workKind: queue ? rule.workKind : null,
    priority,
    slaMinutes,
    requiredAction: queue ? rule.requiredAction : null,
    needsApproval: !!rule.needsApproval && disposition !== "auto",
    escalateImmediately,
    reasons,
    entityType: event.entityType,
    entityId: event.entityId,
    title: workTitle(event),
    authorisedRoles: queue ? QUEUE_ROLES[queue] : [],
  };
}

/** Stable, human-readable work title derived from the event. */
export function workTitle(event: PlatformEvent): string {
  const line = event.serviceLine ? event.serviceLine.replace(/_/g, " ") : event.entityType.replace(/_/g, " ");
  return `${EVENT_LABEL[event.type]} — ${line}`;
}

/** True when the event produces a staff work item. */
export const createsWork = (d: OrchestrationDecision) =>
  d.disposition === "staff_work" || d.disposition === "approval" || d.disposition === "escalate";

export const routeRuleFor = (type: EventType): Readonly<RouteRule> => R[type];

/** Queues a role may work. Used for role-adaptive navigation and RLS parity. */
export function queuesForRoles(roles: string[]): OpsQueue[] {
  const set = new Set(roles);
  return OPS_QUEUES.filter((q) => QUEUE_ROLES[q].some((r) => set.has(r)));
}

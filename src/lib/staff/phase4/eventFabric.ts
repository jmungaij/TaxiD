/**
 * Phase 4 — TaxiD Event Fabric and Business State Machines.
 *
 * Agents never act on prose instructions. They subscribe to machine-readable
 * business events and operate against explicit object states, so every agent
 * action can be traced to (a) an event that occurred and (b) a legal state
 * transition. Events declare the table that evidences them; an event with no
 * source cannot fire and is reported as unwired rather than displayed as if
 * it were live.
 */

export const EVENT_DOMAINS = [
  "customer", "commercial", "marketplace", "operations",
  "logistics", "finance", "people", "risk",
] as const;
export type EventDomain = (typeof EVENT_DOMAINS)[number];

export interface BusinessEvent {
  key: string;
  domain: EventDomain;
  /** Table that evidences the event, or null when nothing records it yet. */
  source: string | null;
  meaning: string;
  /** Agents that subscribe. First entry owns the resulting work item. */
  subscribers: readonly string[];
  /** Highest action class the resulting workflow may reach. */
  ceiling: "A0" | "A1" | "A2" | "A3" | "A4";
}

export const BUSINESS_EVENTS: readonly BusinessEvent[] = [
  { key: "customer.created", domain: "customer", source: "corporate_accounts", meaning: "A corporate account record exists", subscribers: ["customer_success", "revenue"], ceiling: "A2" },
  { key: "customer.at_risk", domain: "customer", source: "client_journey_events", meaning: "Usage, service or payment signals indicate churn exposure", subscribers: ["customer_success", "revenue", "operations", "finance"], ceiling: "A2" },
  { key: "lead.created", domain: "commercial", source: "contact_submissions", meaning: "An inbound enquiry has been captured", subscribers: ["sales"], ceiling: "A3" },
  { key: "opportunity.stalled", domain: "commercial", source: "charter_quotes", meaning: "No qualifying activity recorded within the policy window", subscribers: ["sales", "revenue"], ceiling: "A2" },
  { key: "opportunity.won", domain: "commercial", source: "charter_bookings", meaning: "A quote converted into a confirmed booking", subscribers: ["sales", "customer_success", "finance"], ceiling: "A1" },
  { key: "contract.expiring", domain: "commercial", source: "corporate_documents", meaning: "A contract or governing document reaches its expiry window", subscribers: ["customer_success", "compliance", "revenue"], ceiling: "A2" },
  { key: "booking.created", domain: "operations", source: "charter_bookings", meaning: "A service commitment has been made", subscribers: ["operations", "marketplace"], ceiling: "A2" },
  { key: "booking.delayed", domain: "operations", source: "dispatch_events", meaning: "Fulfilment is behind the committed schedule", subscribers: ["operations", "customer_success"], ceiling: "A3" },
  { key: "booking.completed", domain: "operations", source: "charter_bookings", meaning: "Service delivered and closed", subscribers: ["finance", "customer_success"], ceiling: "A1" },
  { key: "sla.at_risk", domain: "operations", source: "availability_metrics", meaning: "A service level commitment is trending to breach", subscribers: ["operations", "customer_success", "risk"], ceiling: "A3" },
  { key: "shipment.delayed", domain: "logistics", source: "delivery_dispatch_jobs", meaning: "A delivery is behind its predicted window", subscribers: ["logistics", "operations"], ceiling: "A3" },
  { key: "shipment.delivered", domain: "logistics", source: "delivery_orders", meaning: "Proof of delivery captured", subscribers: ["logistics", "finance"], ceiling: "A1" },
  { key: "partner.capacity_low", domain: "marketplace", source: "charter_inventory", meaning: "Available supply is below demand in a segment or city", subscribers: ["marketplace", "operations", "revenue"], ceiling: "A2" },
  { key: "payment.received", domain: "finance", source: "charter_wallet_ledger", meaning: "A verified inbound payment settled", subscribers: ["finance", "revenue"], ceiling: "A1" },
  { key: "invoice.overdue", domain: "finance", source: "corporate_invoices", meaning: "An invoice passed its due date without settlement", subscribers: ["finance", "customer_success", "revenue"], ceiling: "A3" },
  { key: "settlement.mismatch", domain: "finance", source: "charter_wallet_reconciliation_findings", meaning: "Ledger and settlement records disagree", subscribers: ["finance", "risk", "data_quality"], ceiling: "A2" },
  { key: "employee.capability_gap", domain: "people", source: "capabilities", meaning: "A required capability is not held at the needed level", subscribers: ["people", "executive"], ceiling: "A2" },
  { key: "critical_role.unfilled", domain: "people", source: "corporate_designations", meaning: "A position the business depends on has no holder", subscribers: ["people", "executive"], ceiling: "A2" },
  { key: "risk.threshold_crossed", domain: "risk", source: "alerts_events", meaning: "A monitored risk indicator breached its threshold", subscribers: ["risk", "compliance", "executive"], ceiling: "A3" },
  { key: "compliance.obligation_due", domain: "risk", source: "compliance_alerts", meaning: "A regulatory or contractual obligation falls due", subscribers: ["compliance", "risk"], ceiling: "A3" },
  { key: "data.integrity_defect", domain: "risk", source: "data_quality_findings", meaning: "Duplicate, orphaned or contradictory records detected", subscribers: ["data_quality"], ceiling: "A2" },
  { key: "platform.incident", domain: "risk", source: "noc_incidents", meaning: "Platform or integration health degraded", subscribers: ["tech_ops", "operations"], ceiling: "A3" },
];

export function eventByKey(key: string): BusinessEvent | undefined {
  return BUSINESS_EVENTS.find((e) => e.key === key);
}

/** Events with no recording table — cannot fire, must not be shown as live. */
export function unwiredEvents(): BusinessEvent[] {
  return BUSINESS_EVENTS.filter((e) => !e.source);
}

/* ---------------------------------------------------- business state machines */

export interface ObjectStateMachine {
  key: string;
  label: string;
  /** Authoritative table holding the state. */
  table: string | null;
  states: readonly { key: string; next: readonly string[]; agentMayPrepare?: boolean }[];
}

export const STATE_MACHINES: readonly ObjectStateMachine[] = [
  {
    key: "opportunity", label: "Opportunity", table: "charter_quotes",
    states: [
      { key: "NEW", next: ["QUALIFIED", "LOST"], agentMayPrepare: true },
      { key: "QUALIFIED", next: ["DISCOVERY", "LOST"], agentMayPrepare: true },
      { key: "DISCOVERY", next: ["PROPOSAL", "LOST"], agentMayPrepare: true },
      { key: "PROPOSAL", next: ["NEGOTIATION", "LOST"], agentMayPrepare: true },
      { key: "NEGOTIATION", next: ["WON", "LOST"] },
      { key: "WON", next: [] },
      { key: "LOST", next: [] },
    ],
  },
  {
    key: "customer", label: "Customer", table: "corporate_accounts",
    states: [
      { key: "PROSPECT", next: ["ONBOARDING", "CHURNED"] },
      { key: "ONBOARDING", next: ["ACTIVE", "CHURNED"], agentMayPrepare: true },
      { key: "ACTIVE", next: ["AT_RISK", "EXPANDED", "RENEWED", "CHURNED"] },
      { key: "AT_RISK", next: ["RETAINED", "CHURNED"], agentMayPrepare: true },
      { key: "RETAINED", next: ["ACTIVE", "EXPANDED", "CHURNED"] },
      { key: "EXPANDED", next: ["RENEWED", "AT_RISK", "CHURNED"] },
      { key: "RENEWED", next: ["ACTIVE", "CHURNED"] },
      { key: "CHURNED", next: [] },
    ],
  },
  {
    key: "partner", label: "Marketplace partner", table: "charter_partner_applications",
    states: [
      { key: "APPLIED", next: ["VERIFYING", "DEACTIVATED"] },
      { key: "VERIFYING", next: ["VERIFIED", "DEACTIVATED"], agentMayPrepare: true },
      { key: "VERIFIED", next: ["APPROVED", "DEACTIVATED"] },
      { key: "APPROVED", next: ["ACTIVE", "DEACTIVATED"] },
      { key: "ACTIVE", next: ["SUSPENDED", "DEACTIVATED"] },
      { key: "SUSPENDED", next: ["ACTIVE", "DEACTIVATED"] },
      { key: "DEACTIVATED", next: [] },
    ],
  },
  {
    key: "booking", label: "Booking", table: "charter_bookings",
    states: [
      { key: "REQUESTED", next: ["QUOTED", "CANCELLED"], agentMayPrepare: true },
      { key: "QUOTED", next: ["CONFIRMED", "CANCELLED"], agentMayPrepare: true },
      { key: "CONFIRMED", next: ["ASSIGNED", "CANCELLED"] },
      { key: "ASSIGNED", next: ["IN_SERVICE", "CANCELLED"] },
      { key: "IN_SERVICE", next: ["COMPLETED"] },
      { key: "COMPLETED", next: [] },
      { key: "CANCELLED", next: [] },
    ],
  },
  {
    key: "invoice", label: "Invoice", table: "corporate_invoices",
    states: [
      { key: "DRAFT", next: ["ISSUED", "VOID"], agentMayPrepare: true },
      { key: "ISSUED", next: ["PAID", "OVERDUE", "DISPUTED", "VOID"] },
      { key: "OVERDUE", next: ["PAID", "DISPUTED", "WRITTEN_OFF"], agentMayPrepare: true },
      { key: "DISPUTED", next: ["PAID", "WRITTEN_OFF"] },
      { key: "PAID", next: [] },
      { key: "WRITTEN_OFF", next: [] },
      { key: "VOID", next: [] },
    ],
  },
];

export function machineByKey(key: string): ObjectStateMachine | undefined {
  return STATE_MACHINES.find((m) => m.key === key);
}

export function isLegalTransition(machineKey: string, from: string, to: string): boolean {
  const st = machineByKey(machineKey)?.states.find((s) => s.key === from);
  return !!st && st.next.includes(to);
}

/** A structural audit: unreachable states, dangling targets, no terminal state. */
export function stateMachineDefects(): { machine: string; defect: string }[] {
  const out: { machine: string; defect: string }[] = [];
  for (const m of STATE_MACHINES) {
    const keys = new Set(m.states.map((s) => s.key));
    if (!m.states.some((s) => s.next.length === 0)) {
      out.push({ machine: m.key, defect: "no terminal state" });
    }
    for (const s of m.states) {
      for (const n of s.next) {
        if (!keys.has(n)) out.push({ machine: m.key, defect: `${s.key} → unknown state ${n}` });
      }
    }
    const reachable = new Set([m.states[0].key]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of m.states) {
        if (!reachable.has(s.key)) continue;
        for (const n of s.next) if (!reachable.has(n)) { reachable.add(n); grew = true; }
      }
    }
    for (const s of m.states) {
      if (!reachable.has(s.key)) out.push({ machine: m.key, defect: `${s.key} unreachable` });
    }
  }
  return out;
}

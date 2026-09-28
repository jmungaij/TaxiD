/**
 * Phase 4 — TaxiD Agent Network.
 *
 * A controlled network of specialised digital workers, not one super-agent.
 * Every agent declares its purpose, accountable human owner, the events it
 * subscribes to, the context it is authorised to read, the peers it may
 * consult, its autonomy level and the highest action class it may ever reach.
 *
 * The autonomy level is a ceiling, not a promise: `authorityGate` still
 * evaluates each individual action, and `learning.autonomyEligibility` refuses
 * to advance an agent past supervised execution until its accuracy and
 * override rates have actually been measured.
 */
import { BUSINESS_EVENTS } from "./eventFabric";
import type { AuthoritySubject } from "@/lib/staff/phase2/authority";

/** 1 Observe · 2 Recommend · 3 Prepare · 4 Human approves · 5 Conditional · 6 Measured autonomy */
export type AutonomyLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  1: "L1 Observe",
  2: "L2 Recommend",
  3: "L3 Prepare",
  4: "L4 Human approves",
  5: "L5 Conditional autonomy",
  6: "L6 Measured autonomy",
};

export type ActionClass = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";

export const ACTION_CLASS_LABEL: Record<ActionClass, string> = {
  A0: "A0 Inform",
  A1: "A1 Recommend",
  A2: "A2 Prepare",
  A3: "A3 Execute with approval",
  A4: "A4 Autonomous execution",
  A5: "A5 Prohibited",
};

/** Highest action class each autonomy level may reach. */
export const AUTONOMY_CEILING: Record<AutonomyLevel, ActionClass> = {
  1: "A0", 2: "A1", 3: "A2", 4: "A3", 5: "A4", 6: "A4",
};

export const CLASS_ORDER: ActionClass[] = ["A0", "A1", "A2", "A3", "A4"];

export interface AgentSpec {
  key: string;
  name: string;
  purpose: string;
  /** Accountable human function — an agent without an owner may not run. */
  owner: string;
  department: string;
  capabilities: readonly string[];
  /** Context classes the agent may request from the Context Fabric. */
  contextScopes: readonly string[];
  /** Authority subjects the agent's actions touch. */
  subjects: readonly AuthoritySubject[];
  /** Events the agent subscribes to. */
  events: readonly string[];
  /** Peer agents it may consult through the coordination layer. */
  consults: readonly string[];
  autonomy: AutonomyLevel;
  risk: "low" | "medium" | "high";
  version: string;
  model: string;
  tools: readonly string[];
}

const MODEL = "google/gemini-3.6-flash";

export const AGENTS: readonly AgentSpec[] = [
  {
    key: "executive", name: "Executive Intelligence Agent",
    purpose: "Hold enterprise priorities and surface what genuinely needs executive judgement.",
    owner: "Chief Executive", department: "Executive",
    capabilities: ["Strategic signal detection", "Cross-domain synthesis", "Decision framing", "Attention prioritisation"],
    contextScopes: ["strategy", "enterprise_kpis", "risk", "revenue", "capability"],
    subjects: ["policy"], events: ["risk.threshold_crossed", "employee.capability_gap", "critical_role.unfilled"],
    consults: ["revenue", "marketplace", "people", "risk"], autonomy: 2, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_kpis", "read_risk_register", "draft_briefing"],
  },
  {
    key: "revenue", name: "Revenue Agent",
    purpose: "Continuously test pipeline, conversion, leakage, collections, expansion and margin for opportunity and exposure.",
    owner: "Chief Revenue Officer", department: "Revenue Operations",
    capabilities: ["Leakage detection", "Collection exposure", "Expansion identification", "Margin analysis"],
    contextScopes: ["revenue", "contract", "transaction", "customer", "financial_state"],
    subjects: ["payment", "contract"], events: ["opportunity.won", "opportunity.stalled", "invoice.overdue", "payment.received", "customer.at_risk", "partner.capacity_low", "contract.expiring"],
    consults: ["sales", "finance", "customer_success", "marketplace", "knowledge"], autonomy: 2, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_invoices", "read_ledger", "read_quotes", "draft_revenue_brief"],
  },
  {
    key: "sales", name: "Sales Agent",
    purpose: "Qualify leads, keep opportunities moving and prepare (never send) commercial follow-up.",
    owner: "Head of Enterprise Sales", department: "Commercial",
    capabilities: ["Lead qualification", "Opportunity intelligence", "Follow-up preparation", "Pipeline hygiene"],
    contextScopes: ["customer", "account", "contract", "historical_actions", "knowledge"],
    subjects: ["customer"], events: ["lead.created", "opportunity.stalled", "opportunity.won"],
    consults: ["revenue", "customer_success", "knowledge"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_leads", "draft_email", "create_task", "prepare_briefing"],
  },
  {
    key: "customer_success", name: "Customer Success Agent",
    purpose: "Protect and grow customer relationships; detect risk early and coordinate recovery.",
    owner: "Head of Customer Success", department: "Customer Operations",
    capabilities: ["Health scoring", "Churn risk detection", "Service recovery orchestration", "Renewal preparation"],
    contextScopes: ["customer", "service", "contract", "financial_state", "current_state"],
    subjects: ["customer"], events: ["customer.created", "customer.at_risk", "contract.expiring", "booking.delayed", "sla.at_risk", "invoice.overdue", "booking.completed"],
    consults: ["revenue", "sales", "marketplace", "finance", "operations"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_journey_events", "prepare_recovery_plan", "create_task"],
  },
  {
    key: "marketplace", name: "Marketplace Agent",
    purpose: "Keep demand and supply matched by city, time, category and price, and expose liquidity gaps.",
    owner: "Head of Marketplace", department: "Marketplace",
    capabilities: ["Demand/supply balance", "Shortage detection", "Idle capacity detection", "Matching quality analysis"],
    contextScopes: ["marketplace", "transaction", "service", "current_state"],
    subjects: ["partner"], events: ["partner.capacity_low", "booking.created", "customer.at_risk"],
    consults: ["operations", "revenue", "charter", "rentals"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_inventory", "read_bookings", "prepare_supply_acquisition_list"],
  },
  {
    key: "operations", name: "Operations Agent",
    purpose: "Hold fulfilment promises: bookings, assignment, exceptions and SLA integrity.",
    owner: "Head of Operations", department: "Operations",
    capabilities: ["Exception detection", "SLA monitoring", "Intervention preparation", "Escalation routing"],
    contextScopes: ["service", "transaction", "customer", "current_state"],
    subjects: ["booking"], events: ["booking.created", "booking.delayed", "sla.at_risk", "shipment.delayed", "platform.incident"],
    consults: ["marketplace", "customer_success", "logistics", "tech_ops"], autonomy: 4, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_dispatch", "prepare_intervention", "notify_owner"],
  },
  {
    key: "logistics", name: "Logistics Agent",
    purpose: "Keep shipments moving: routing, delivery exceptions and proof of delivery integrity.",
    owner: "Head of Logistics", department: "Logistics",
    capabilities: ["Route exception detection", "ETA deviation analysis", "Recovery preparation"],
    contextScopes: ["service", "transaction", "current_state"],
    subjects: ["booking"], events: ["shipment.delayed", "shipment.delivered"],
    consults: ["operations", "customer_success"], autonomy: 4, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_delivery_jobs", "prepare_recovery", "notify_owner"],
  },
  {
    key: "charter", name: "Charter Agent",
    purpose: "Translate charter requirements into operator matches and coordinated missions.",
    owner: "Head of Charter", department: "Charter Business",
    capabilities: ["Requirement interpretation", "Operator matching", "Mission coordination", "Quote preparation"],
    contextScopes: ["customer", "service", "marketplace", "contract"],
    subjects: ["booking"], events: ["lead.created", "booking.created", "partner.capacity_low"],
    consults: ["marketplace", "operations", "revenue"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_quotes", "read_inventory", "prepare_quote"],
  },
  {
    key: "rentals", name: "Rentals & Leasing Agent",
    purpose: "Match availability to demand and keep reservations, contracts and renewals current.",
    owner: "Head of Rentals & Leasing", department: "Rentals & Leasing",
    capabilities: ["Availability matching", "Reservation preparation", "Renewal detection", "Contract expiry watch"],
    contextScopes: ["customer", "contract", "service", "marketplace"],
    subjects: ["booking"], events: ["booking.created", "contract.expiring"],
    consults: ["marketplace", "revenue", "customer_success"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_inventory", "prepare_reservation", "create_task"],
  },
  {
    key: "finance", name: "Finance Agent",
    purpose: "Hold the money truth: invoicing, reconciliation, settlement and financial exceptions.",
    owner: "Chief Financial Officer", department: "Finance",
    capabilities: ["Reconciliation analysis", "Collection preparation", "Settlement exception triage", "Dispute context assembly"],
    contextScopes: ["financial_state", "transaction", "contract", "customer", "historical_actions"],
    subjects: ["payment"], events: ["invoice.overdue", "payment.received", "settlement.mismatch", "booking.completed", "shipment.delivered"],
    consults: ["revenue", "customer_success", "risk", "data_quality", "compliance"], autonomy: 3, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_invoices", "read_ledger", "prepare_collection_action"],
  },
  {
    key: "people", name: "People Agent",
    purpose: "Strengthen capability and organisational effectiveness — never surveillance.",
    owner: "Chief People Officer", department: "People & Capability",
    capabilities: ["Capability gap analysis", "Succession readiness", "Workload balance", "Development recommendation"],
    contextScopes: ["employee", "department", "policies", "capability"],
    subjects: ["employee"], events: ["employee.capability_gap", "critical_role.unfilled"],
    consults: ["executive", "knowledge"], autonomy: 2, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_designations", "read_capabilities", "prepare_development_plan"],
  },
  {
    key: "knowledge", name: "Knowledge Agent",
    purpose: "Hold policies, SOPs and decision memory so the organisation stops re-deciding solved questions.",
    owner: "Head of Knowledge", department: "Knowledge",
    capabilities: ["Policy retrieval", "Precedent retrieval", "Decision memory", "Playbook maintenance"],
    contextScopes: ["policies", "knowledge", "historical_actions"],
    subjects: ["policy"], events: ["contract.expiring", "compliance.obligation_due"],
    consults: ["compliance", "risk"], autonomy: 2, risk: "low", version: "0.1.0", model: MODEL,
    tools: ["read_policies", "read_decision_log"],
  },
  {
    key: "risk", name: "Risk Agent",
    purpose: "Identify exposure, verify controls and escalate before loss occurs.",
    owner: "Chief Risk Officer", department: "Risk",
    capabilities: ["Threshold monitoring", "Control verification", "Escalation routing", "Incident correlation"],
    contextScopes: ["risk", "financial_state", "current_state", "policies"],
    subjects: ["audit"], events: ["risk.threshold_crossed", "settlement.mismatch", "sla.at_risk", "platform.incident"],
    consults: ["compliance", "finance", "tech_ops", "executive"], autonomy: 3, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_alerts", "prepare_escalation"],
  },
  {
    key: "compliance", name: "Compliance Agent",
    purpose: "Track obligations, expiries and evidence so nothing lapses silently.",
    owner: "Head of Compliance", department: "Compliance",
    capabilities: ["Obligation tracking", "Document expiry monitoring", "Evidence assembly"],
    contextScopes: ["policies", "contract", "risk", "customer"],
    subjects: ["audit"], events: ["compliance.obligation_due", "contract.expiring", "risk.threshold_crossed"],
    consults: ["risk", "knowledge"], autonomy: 3, risk: "high", version: "0.1.0", model: MODEL,
    tools: ["read_compliance_alerts", "read_documents", "prepare_evidence_pack"],
  },
  {
    key: "data_quality", name: "Data Quality Agent",
    purpose: "Keep the graphs trustworthy: duplicates, orphans, anomalies and broken relationships.",
    owner: "Head of Data", department: "Data & Platform",
    capabilities: ["Duplicate detection", "Orphan detection", "Anomaly detection", "Relationship integrity checks"],
    contextScopes: ["current_state", "transaction", "customer"],
    subjects: ["audit"], events: ["data.integrity_defect", "settlement.mismatch"],
    consults: ["finance", "tech_ops"], autonomy: 3, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_quality_findings", "prepare_remediation"],
  },
  {
    key: "tech_ops", name: "Technology Operations Agent",
    purpose: "Keep the platform and its integrations healthy, and correlate incidents to business impact.",
    owner: "Head of Platform Engineering", department: "Data & Platform",
    capabilities: ["Health monitoring", "Integration failure detection", "Incident correlation", "Runbook preparation"],
    contextScopes: ["current_state", "risk"],
    subjects: ["audit"], events: ["platform.incident", "data.integrity_defect"],
    consults: ["risk", "operations", "data_quality"], autonomy: 4, risk: "medium", version: "0.1.0", model: MODEL,
    tools: ["read_incidents", "read_health", "prepare_runbook", "notify_owner"],
  },
];

export function agentByKey(key: string): AgentSpec | undefined {
  return AGENTS.find((a) => a.key === key);
}

export function agentsForEvent(eventKey: string): AgentSpec[] {
  return AGENTS.filter((a) => a.events.includes(eventKey));
}

/** Highest action class an agent may reach at its current autonomy level. */
export function agentCeiling(agent: AgentSpec): ActionClass {
  return AUTONOMY_CEILING[agent.autonomy];
}

/**
 * Structural audit of the network. Enforces the anti-silo and anti-super-agent
 * rules: no agent may consult itself, every consult and event must exist, every
 * agent needs an accountable owner, and no agent may subscribe to more than
 * half the event fabric (that would be a super-agent by another name).
 */
export function agentNetworkDefects(): { agent: string; defect: string }[] {
  const out: { agent: string; defect: string }[] = [];
  const keys = new Set(AGENTS.map((a) => a.key));
  const eventKeys = new Set(BUSINESS_EVENTS.map((e) => e.key));
  const half = Math.ceil(BUSINESS_EVENTS.length / 2);
  for (const a of AGENTS) {
    if (!a.owner) out.push({ agent: a.key, defect: "no accountable human owner" });
    if (a.consults.includes(a.key)) out.push({ agent: a.key, defect: "consults itself" });
    for (const c of a.consults) if (!keys.has(c)) out.push({ agent: a.key, defect: `unknown consult ${c}` });
    for (const e of a.events) if (!eventKeys.has(e)) out.push({ agent: a.key, defect: `unknown event ${e}` });
    if (a.events.length === 0) out.push({ agent: a.key, defect: "subscribes to no event — cannot be triggered" });
    if (a.events.length > half) out.push({ agent: a.key, defect: "subscribes to more than half of all events — super-agent risk" });
    if (a.autonomy > 4 && a.risk === "high") out.push({ agent: a.key, defect: "high-risk agent above supervised autonomy" });
  }
  /** Every event must have at least one subscriber that actually declares it. */
  for (const e of BUSINESS_EVENTS) {
    if (agentsForEvent(e.key).length === 0) out.push({ agent: "—", defect: `event ${e.key} has no subscribing agent` });
  }
  return out;
}

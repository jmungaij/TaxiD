/**
 * Phase 4 — SAFARID Enterprise Orchestrator.
 *
 * The orchestrator is the coordination layer, not an agent. It runs one loop
 * for every business event: detect → assemble context → analyse → generate
 * options → evaluate risk → check authority → decide → act → measure → learn.
 *
 * Multi-agent reasoning happens here: the owning agent consults its declared
 * peers and the orchestrator merges their findings into a single recommendation
 * with one owner and one authority basis. That is what prevents twenty
 * intelligent islands — no agent speaks to the business directly.
 *
 * Nothing in this module invents a number. Quantified consequences carry the
 * table that would supply them and stay `null` until that table is readable, so
 * an unmeasured impact renders as DATA NOT AVAILABLE instead of a plausible
 * fabrication.
 */
import { AGENTS, agentByKey, agentsForEvent } from "./agents";
import { BUSINESS_EVENTS, eventByKey } from "./eventFabric";
import { assembleContext, type ContextEnvelope, type Epistemic } from "./contextFabric";
import { evaluateAgentAction, policyByKey, type GateDecision } from "./authorityGate";
import type { Coverage } from "@/lib/staff/phase2/readiness";

/** The Operating Model 2.0 loop, in execution order. */
export const ORCHESTRATION_LOOP = [
  "Business event",
  "Detect",
  "Assemble context",
  "Analyse",
  "Generate options",
  "Evaluate risk",
  "Check authority",
  "Decide",
  "Execute",
  "Measure outcome",
  "Capture learning",
  "Improve",
] as const;

/** The enterprise loop the whole operating system closes. */
export const ENTERPRISE_LOOP = [
  "Strategy", "Organisation", "People", "Capabilities", "Business", "Customers",
  "Marketplace", "Transactions", "Revenue", "Outcomes", "AI senses", "AI analyses",
  "Human / AI decides", "AI orchestrates", "Action", "Measurement", "Learning", "Adaptation",
] as const;

/* ------------------------------------------------------- coordination cases */

export interface Consultation {
  agent: string;
  question: string;
  /** Table that would answer it. */
  evidence: string;
  epistemic: Epistemic;
}

export interface DecisionOption {
  label: string;
  consequence: string;
  /** Table supplying the quantification, or null when nothing measures it. */
  quantifiedBy: string | null;
  epistemic: Epistemic;
}

export interface Coordination {
  key: string;
  label: string;
  triggerEvent: string;
  /** Agent that owns the resulting work item. */
  owner: string;
  consults: readonly Consultation[];
  /** Action policy the orchestrator would put through the Authority Gate. */
  policyKey: string;
  options: readonly DecisionOption[];
  humanDecision: string;
}

export const COORDINATIONS: readonly Coordination[] = [
  {
    key: "customer_at_risk",
    label: "Corporate customer at risk",
    triggerEvent: "customer.at_risk",
    owner: "customer_success",
    policyKey: "cs.prepare_recovery",
    consults: [
      { agent: "revenue", question: "What recurring revenue is exposed?", evidence: "corporate_invoices", epistemic: "fact" },
      { agent: "sales", question: "Is there an open expansion opportunity to protect?", evidence: "charter_quotes", epistemic: "fact" },
      { agent: "marketplace", question: "Is supply quality degrading this account's service?", evidence: "charter_inventory", epistemic: "inference" },
      { agent: "finance", question: "Is there an unresolved payment or dispute?", evidence: "corporate_invoices", epistemic: "fact" },
      { agent: "operations", question: "Are SLA failures implicated?", evidence: "availability_metrics", epistemic: "fact" },
    ],
    options: [
      { label: "Service recovery plan with named owner", consequence: "Addresses fulfilment cause before commercial concession", quantifiedBy: "availability_metrics", epistemic: "recommendation" },
      { label: "Executive relationship intervention", consequence: "Escalates to sponsor level for strategic accounts", quantifiedBy: "corporate_accounts", epistemic: "recommendation" },
      { label: "Commercial review", consequence: "Re-price or restructure — requires commercial authority", quantifiedBy: null, epistemic: "recommendation" },
    ],
    humanDecision: "Customer success owner selects the recovery path; any commercial concession routes to an authorised commercial approver.",
  },
  {
    key: "pricing_concession",
    label: "Customer requests a 12% pricing concession",
    triggerEvent: "contract.expiring",
    owner: "revenue",
    policyKey: "cs.grant_concession",
    consults: [
      { agent: "finance", question: "What is the current margin on this account?", evidence: "corporate_invoices", epistemic: "fact" },
      { agent: "customer_success", question: "What is the account's service and health record?", evidence: "client_journey_events", epistemic: "fact" },
      { agent: "marketplace", question: "What does fulfilling this account cost in supply terms?", evidence: "charter_inventory", epistemic: "inference" },
      { agent: "knowledge", question: "What precedent and pricing policy governs concessions?", evidence: "corporate_policy_rules", epistemic: "fact" },
    ],
    options: [
      { label: "Accept the concession", consequence: "Protects volume, reduces margin", quantifiedBy: "corporate_invoices", epistemic: "simulation" },
      { label: "Counteroffer at a lower percentage with term extension", consequence: "Trades price for committed duration", quantifiedBy: "corporate_documents", epistemic: "simulation" },
      { label: "Value-add instead of discount", consequence: "Holds price, increases fulfilment cost", quantifiedBy: "charter_inventory", epistemic: "simulation" },
    ],
    humanDecision: "Prohibited to agents (A5). The orchestrator assembles evidence and options; an authorised commercial approver decides and the decision is recorded.",
  },
  {
    key: "supply_shortage",
    label: "Nairobi executive vehicle supply shortage",
    triggerEvent: "partner.capacity_low",
    owner: "marketplace",
    policyKey: "marketplace.prepare_supply_list",
    consults: [
      { agent: "operations", question: "Which committed bookings are exposed?", evidence: "charter_bookings", epistemic: "fact" },
      { agent: "revenue", question: "What revenue is at risk if demand goes unserved?", evidence: "corporate_invoices", epistemic: "inference" },
      { agent: "charter", question: "Which approved operators have idle capacity?", evidence: "charter_inventory", epistemic: "fact" },
      { agent: "rentals", question: "Can leasing supply substitute in the short term?", evidence: "charter_inventory", epistemic: "inference" },
    ],
    options: [
      { label: "Reallocate existing approved supply", consequence: "Fastest, no acquisition cost", quantifiedBy: "charter_inventory", epistemic: "recommendation" },
      { label: "Prepare a partner acquisition list and outreach tasks", consequence: "Adds durable capacity, takes onboarding time", quantifiedBy: "charter_partner_applications", epistemic: "recommendation" },
      { label: "Constrain demand intake for the segment", consequence: "Protects SLA, forgoes revenue", quantifiedBy: "charter_bookings", epistemic: "recommendation" },
    ],
    humanDecision: "Marketplace manager approves the acquisition list; partner suspension or activation stays a human decision.",
  },
  {
    key: "invoice_overdue",
    label: "Invoice becomes overdue",
    triggerEvent: "invoice.overdue",
    owner: "finance",
    policyKey: "finance.prepare_collection",
    consults: [
      { agent: "customer_success", question: "Is the account healthy or in dispute?", evidence: "corporate_support_tickets", epistemic: "fact" },
      { agent: "revenue", question: "What is the exposure across this customer's open invoices?", evidence: "corporate_invoices", epistemic: "fact" },
      { agent: "compliance", question: "Are the contract and billing terms current?", evidence: "corporate_documents", epistemic: "fact" },
      { agent: "risk", question: "Does the pattern indicate credit risk?", evidence: "alerts_events", epistemic: "inference" },
    ],
    options: [
      { label: "Standard reminder sequence", consequence: "Lowest relationship cost", quantifiedBy: "corporate_invoices", epistemic: "recommendation" },
      { label: "Hold new service intake", consequence: "Limits further exposure, affects the customer", quantifiedBy: "charter_bookings", epistemic: "recommendation" },
      { label: "Escalate to formal collection", consequence: "Recovers cash, damages relationship", quantifiedBy: null, epistemic: "recommendation" },
    ],
    humanDecision: "Finance admin authorises the collection path. No agent moves money or adjusts a ledger entry.",
  },
  {
    key: "stalled_opportunity",
    label: "Opportunity with no activity for 7 days",
    triggerEvent: "opportunity.stalled",
    owner: "sales",
    policyKey: "sales.prepare_followup",
    consults: [
      { agent: "revenue", question: "What is the weighted value of this opportunity?", evidence: "charter_quotes", epistemic: "fact" },
      { agent: "knowledge", question: "Which playbook applies to this segment?", evidence: "corporate_policy_rules", epistemic: "fact" },
      { agent: "customer_success", question: "Is this an existing account with service history?", evidence: "client_journey_events", epistemic: "fact" },
    ],
    options: [
      { label: "Prepared briefing, drafted email and a task for the owner", consequence: "Owner sends; the agent never dispatches commercial mail", quantifiedBy: "charter_quotes", epistemic: "recommendation" },
      { label: "Qualify out", consequence: "Frees pipeline capacity, forgoes the opportunity", quantifiedBy: null, epistemic: "recommendation" },
    ],
    humanDecision: "Opportunity owner sends or discards the prepared communication.",
  },
  {
    key: "critical_vacancy",
    label: "Strategic position remains vacant",
    triggerEvent: "critical_role.unfilled",
    owner: "people",
    policyKey: "people.recommend_development",
    consults: [
      { agent: "executive", question: "Which strategic objective depends on this position?", evidence: "dashboard_metrics", epistemic: "inference" },
      { agent: "knowledge", question: "What capability profile does the role require?", evidence: "capabilities", epistemic: "fact" },
    ],
    options: [
      { label: "Develop internally", consequence: "Builds capability, slower to full effectiveness", quantifiedBy: "capabilities", epistemic: "recommendation" },
      { label: "Recruit externally", consequence: "Faster capability, higher cost and integration risk", quantifiedBy: null, epistemic: "recommendation" },
      { label: "Restructure, automate or partner", consequence: "Avoids the hire, changes the operating model", quantifiedBy: null, epistemic: "recommendation" },
    ],
    humanDecision: "Employment decisions remain with the Chief People Officer (A5). The agent recommends only.",
  },
];

export function coordinationByKey(key: string): Coordination | undefined {
  return COORDINATIONS.find((c) => c.key === key);
}

export interface OrchestrationRun {
  coordination: Coordination;
  event: string;
  eventWired: boolean;
  context: ContextEnvelope;
  /** Consultations that can actually be answered with readable evidence. */
  answerable: Consultation[];
  unanswerable: { consultation: Consultation; reason: string }[];
  gate: GateDecision;
  /** Options whose consequence can be quantified from readable data. */
  quantifiable: DecisionOption[];
  recommendationWithheld: string | null;
}

/**
 * Run one coordination through the whole loop for a given identity and the
 * observed data coverage. Returns exactly what the orchestrator could and could
 * not establish — a withheld recommendation is a legitimate outcome.
 */
export function orchestrate(
  coordinationKey: string,
  roles: readonly string[],
  coverage: Coverage,
): OrchestrationRun | null {
  const coordination = coordinationByKey(coordinationKey);
  if (!coordination) return null;
  const event = eventByKey(coordination.triggerEvent);
  const readable = (table: string) => {
    const probe = coverage[table];
    return !!probe && probe.rows !== null;
  };

  const context = assembleContext(coordination.owner, roles);
  const answerable: Consultation[] = [];
  const unanswerable: { consultation: Consultation; reason: string }[] = [];
  for (const c of coordination.consults) {
    if (!agentByKey(c.agent)) {
      unanswerable.push({ consultation: c, reason: "Consulted agent is not registered" });
    } else if (!readable(c.evidence)) {
      unanswerable.push({ consultation: c, reason: `${c.evidence} is not readable for this identity` });
    } else {
      answerable.push(c);
    }
  }

  const gate = evaluateAgentAction({
    policyKey: coordination.policyKey,
    roles,
    eventKey: coordination.triggerEvent,
    context,
  });

  const quantifiable = coordination.options.filter((o) => o.quantifiedBy && readable(o.quantifiedBy));

  let recommendationWithheld: string | null = null;
  if (answerable.length === 0) {
    recommendationWithheld = "No consulted evidence is readable — no recommendation may be issued.";
  } else if (unanswerable.length > answerable.length) {
    recommendationWithheld = "Most consulted evidence is unavailable — findings are partial and must not be presented as a conclusion.";
  }

  return {
    coordination,
    event: coordination.triggerEvent,
    eventWired: !!event?.source,
    context,
    answerable,
    unanswerable,
    gate,
    quantifiable,
    recommendationWithheld,
  };
}

/* -------------------------------------------------------- next best action */

export interface NextBestAction {
  object: string;
  action: string;
  reason: string;
  /** Table evidencing the trigger. */
  evidence: string;
  /** Agent that produced it. */
  agent: string;
  owner: string;
  deadline: string;
  /** Impact statement and the table that would quantify it. */
  impact: string;
  quantifiedBy: string | null;
}

export const NEXT_BEST_ACTIONS: readonly NextBestAction[] = [
  { object: "Opportunity", action: "Contact procurement within 24 hours", reason: "No qualifying activity inside the policy window", evidence: "charter_quotes", agent: "sales", owner: "Opportunity owner", deadline: "24 hours", impact: "Recovers slipping conversion", quantifiedBy: "charter_quotes" },
  { object: "Customer", action: "Review declining usage with the account sponsor", reason: "Journey events show a sustained fall in service consumption", evidence: "client_journey_events", agent: "customer_success", owner: "Customer success owner", deadline: "5 days", impact: "Protects recurring revenue", quantifiedBy: "corporate_invoices" },
  { object: "Marketplace partner", action: "Request capacity expansion", reason: "Available supply is below observed demand in the segment", evidence: "charter_inventory", agent: "marketplace", owner: "Marketplace manager", deadline: "7 days", impact: "Restores fulfilment capability", quantifiedBy: "charter_bookings" },
  { object: "Invoice", action: "Initiate the policy collection workflow", reason: "Invoice passed its due date without settlement", evidence: "corporate_invoices", agent: "finance", owner: "Finance admin", deadline: "3 days", impact: "Reduces cash exposure", quantifiedBy: "corporate_invoices" },
  { object: "Booking", action: "Reassign or re-sequence the exposed booking", reason: "Fulfilment is behind the committed schedule", evidence: "dispatch_events", agent: "operations", owner: "Operations manager", deadline: "Same day", impact: "Protects the SLA commitment", quantifiedBy: "availability_metrics" },
  { object: "Shipment", action: "Trigger the delivery recovery playbook", reason: "Delivery is behind its predicted window", evidence: "delivery_dispatch_jobs", agent: "logistics", owner: "Logistics controller", deadline: "Same day", impact: "Preserves delivery reliability", quantifiedBy: "delivery_orders" },
  { object: "Contract", action: "Open the renewal conversation", reason: "Governing document reaches its expiry window", evidence: "corporate_documents", agent: "customer_success", owner: "Customer success owner", deadline: "30 days before expiry", impact: "Avoids uncontracted service", quantifiedBy: "corporate_documents" },
  { object: "Employee", action: "Begin capability development", reason: "A required capability is not held at the needed level", evidence: "capabilities", agent: "people", owner: "People partner", deadline: "Next development cycle", impact: "Closes a capability gap", quantifiedBy: null },
  { object: "Settlement", action: "Investigate the reconciliation finding", reason: "Ledger and settlement records disagree", evidence: "charter_wallet_reconciliation_findings", agent: "finance", owner: "Finance admin", deadline: "24 hours", impact: "Protects financial integrity", quantifiedBy: "charter_wallet_ledger" },
];

/* -------------------------------------------------------- attention queue */

export type AttentionKind =
  | "revenue_opportunity" | "customer_risk" | "marketplace_shortage"
  | "operational_exception" | "financial_anomaly" | "people_constraint" | "strategic_issue";

export interface AttentionItem {
  kind: AttentionKind;
  label: string;
  event: string;
  agent: string;
  owner: string;
  /** Evidence tables required to state the item at all. */
  evidence: readonly string[];
  authority: string;
  expectedOutcome: string;
}

export const ATTENTION_CANDIDATES: readonly AttentionItem[] = [
  { kind: "revenue_opportunity", label: "Expansion and recovery in the open pipeline", event: "opportunity.stalled", agent: "revenue", owner: "Chief Revenue Officer", evidence: ["charter_quotes", "corporate_invoices"], authority: "Revenue authority", expectedOutcome: "Recovered conversion on stalled opportunities" },
  { kind: "customer_risk", label: "Corporate accounts showing churn exposure", event: "customer.at_risk", agent: "customer_success", owner: "Head of Customer Success", evidence: ["client_journey_events", "corporate_accounts"], authority: "Customer authority", expectedOutcome: "Retention of exposed accounts" },
  { kind: "marketplace_shortage", label: "Segments where supply cannot meet demand", event: "partner.capacity_low", agent: "marketplace", owner: "Head of Marketplace", evidence: ["charter_inventory", "charter_bookings"], authority: "Marketplace authority", expectedOutcome: "Restored fulfilment capacity" },
  { kind: "operational_exception", label: "Commitments trending to SLA breach", event: "sla.at_risk", agent: "operations", owner: "Head of Operations", evidence: ["availability_metrics"], authority: "Operations authority", expectedOutcome: "Breaches prevented before they occur" },
  { kind: "financial_anomaly", label: "Overdue invoices and settlement mismatches", event: "invoice.overdue", agent: "finance", owner: "Chief Financial Officer", evidence: ["corporate_invoices", "charter_wallet_reconciliation_findings"], authority: "Finance authority", expectedOutcome: "Cash recovered, ledger reconciled" },
  { kind: "people_constraint", label: "Capability gaps and unfilled critical roles", event: "critical_role.unfilled", agent: "people", owner: "Chief People Officer", evidence: ["corporate_designations", "capabilities"], authority: "People authority", expectedOutcome: "Constraint removed by development or hire" },
  { kind: "strategic_issue", label: "Growth outpacing enterprise capacity", event: "employee.capability_gap", agent: "executive", owner: "Chief Executive", evidence: ["dashboard_metrics", "capabilities"], authority: "Executive authority", expectedOutcome: "Deliberate capacity decision taken" },
];

export interface AttentionResult {
  item: AttentionItem;
  /** Established = every evidence table readable. */
  established: boolean;
  missing: string[];
  gateSummary: string;
}

/**
 * "What requires SAFARID's attention today?" — answered only from readable
 * evidence. Items whose evidence is unreachable are returned as unestablished
 * with the missing sources named, never dropped and never asserted.
 */
export function attentionQueue(roles: readonly string[], coverage: Coverage): AttentionResult[] {
  return ATTENTION_CANDIDATES.map((item) => {
    const missing = item.evidence.filter((t) => {
      const probe = coverage[t];
      return !probe || probe.rows === null;
    });
    const coordination = COORDINATIONS.find((c) => c.triggerEvent === item.event);
    const gate = coordination
      ? evaluateAgentAction({ policyKey: coordination.policyKey, roles, eventKey: item.event })
      : null;
    return {
      item,
      established: missing.length === 0,
      missing,
      gateSummary: gate
        ? `${gate.effective}${gate.approvalRequired ? " · human approval required" : gate.autonomous ? " · audited autonomous" : ""}`
        : "No action policy — information only",
    };
  });
}

/** Orchestrator audit: every coordination must be runnable and governed. */
export function orchestratorDefects(): { coordination: string; defect: string }[] {
  const out: { coordination: string; defect: string }[] = [];
  for (const c of COORDINATIONS) {
    if (!eventByKey(c.triggerEvent)) out.push({ coordination: c.key, defect: `unknown trigger event ${c.triggerEvent}` });
    const owner = agentByKey(c.owner);
    if (!owner) { out.push({ coordination: c.key, defect: `unknown owning agent ${c.owner}` }); continue; }
    if (!owner.events.includes(c.triggerEvent)) {
      out.push({ coordination: c.key, defect: `${c.owner} does not subscribe to ${c.triggerEvent}` });
    }
    if (!agentsForEvent(c.triggerEvent).length) {
      out.push({ coordination: c.key, defect: `no agent subscribes to ${c.triggerEvent}` });
    }
    if (!policyByKey(c.policyKey)) out.push({ coordination: c.key, defect: `unknown action policy ${c.policyKey}` });
    for (const consult of c.consults) {
      if (!owner.consults.includes(consult.agent)) {
        out.push({ coordination: c.key, defect: `${c.owner} is not permitted to consult ${consult.agent}` });
      }
    }
    if (c.options.length < 2) out.push({ coordination: c.key, defect: "fewer than two options — not a decision" });
    if (!c.humanDecision) out.push({ coordination: c.key, defect: "no human decision point" });
  }
  /** Every event should ultimately reach a coordination or an owning agent. */
  for (const e of BUSINESS_EVENTS) {
    if (!AGENTS.some((a) => a.events.includes(e.key))) {
      out.push({ coordination: "—", defect: `event ${e.key} orchestrates to nothing` });
    }
  }
  return out;
}

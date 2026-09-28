/**
 * Phase 2 — Lifecycle definitions for the Work, Approval, Notification and
 * business engines.
 *
 * Every workflow has states; every state has an action; every action has an
 * authority basis; consequential transitions write an audit event. This module
 * is the single declarative source so the UI, tests and future server-side
 * enforcement agree on the state machine.
 */
import type { AuthorityAction, AuthoritySubject } from "./authority";

export interface LifecycleState {
  key: string;
  label: string;
  /** States reachable from here. Terminal states have none. */
  next: readonly string[];
  /** Action taken to leave this state. */
  action?: string;
  /** Authority required for that action. */
  authority?: { subject: AuthoritySubject; action: AuthorityAction };
  /** Mandatory evidence before the transition may occur. */
  gate?: string;
  /** True when leaving this state must write an audit event. */
  audited?: boolean;
}

export interface Lifecycle {
  key: string;
  label: string;
  /** Table that stores the state, or null when not yet a system of record. */
  table: string | null;
  states: readonly LifecycleState[];
  /** Business information produced when the lifecycle completes. */
  output: string;
}

const s = (
  key: string,
  label: string,
  next: readonly string[],
  extra: Partial<LifecycleState> = {},
): LifecycleState => ({ key, label, next, ...extra });

export const LIFECYCLES: readonly Lifecycle[] = [
  {
    key: "task",
    label: "Work Engine — task",
    table: "staff_follow_up_tasks",
    output: "Completed work with owner, SLA outcome and audit trail",
    states: [
      s("new", "New", ["assigned", "cancelled"], { action: "Assign owner", authority: { subject: "booking", action: "edit" } }),
      s("assigned", "Assigned", ["in_progress", "blocked", "cancelled"], { action: "Start work" }),
      s("in_progress", "In progress", ["review", "blocked"], { action: "Submit for review" }),
      s("blocked", "Blocked", ["in_progress", "cancelled"], { action: "Record blocker + escalate", audited: true }),
      s("review", "Review", ["completed", "in_progress"], { action: "Accept work", gate: "Evidence attached", audited: true }),
      s("completed", "Completed", []),
      s("cancelled", "Cancelled", [], { audited: true }),
    ],
  },
  {
    key: "approval",
    label: "Approval Centre — request",
    table: "approval_requests",
    output: "Decision that changes the underlying business object's state",
    states: [
      s("pending", "Pending", ["approved", "rejected", "returned", "delegated", "escalated", "info_requested"], {
        action: "Decide (approve / reject / return / delegate / escalate / request info)",
        authority: { subject: "payment", action: "approve" },
        gate: "Authority basis + supporting evidence recorded",
        audited: true,
      }),
      s("info_requested", "Information requested", ["pending"], { action: "Requester responds" }),
      s("returned", "Returned", ["pending"], { action: "Requester revises" }),
      s("delegated", "Delegated", ["pending"], { action: "Delegate accepts", audited: true }),
      s("escalated", "Escalated", ["approved", "rejected"], { action: "Higher authority decides", audited: true }),
      s("approved", "Approved", [], { audited: true }),
      s("rejected", "Rejected", [], { audited: true }),
    ],
  },
  {
    key: "sales",
    label: "Sales — lead to first revenue",
    table: "contact_submissions",
    output: "Won account, signed contract and first transaction",
    states: [
      s("lead", "Lead", ["qualified", "lost"], { action: "Qualify" }),
      s("qualified", "Qualified account", ["opportunity", "lost"], { action: "Create opportunity" }),
      s("opportunity", "Opportunity", ["quote", "lost"], { action: "Build quote", authority: { subject: "opportunity", action: "create" } }),
      s("quote", "Quote issued", ["approval", "lost"], { action: "Submit for approval", gate: "Pricing within configured floor" }),
      s("approval", "Commercial approval", ["contract", "quote"], { action: "Approve", authority: { subject: "opportunity", action: "approve" }, audited: true }),
      s("contract", "Contract", ["onboarding"], { action: "Countersign", authority: { subject: "contract", action: "approve" }, audited: true }),
      s("onboarding", "Customer onboarding", ["first_transaction"], { action: "Run activation workflow", gate: "Activation criteria satisfied" }),
      s("first_transaction", "First transaction", ["lost"], { action: "Hand to Customer Success" }),
      s("lost", "Lost", [], { audited: true }),
    ],
  },
  {
    key: "customer_activation",
    label: "Customer activation (corporate)",
    table: "corporate_accounts",
    output: "Active corporate account able to transact",
    states: [
      s("contract_verified", "Contract verification", ["kyb"], { gate: "Executed contract on file" }),
      s("kyb", "KYB", ["account_config"], { gate: "CR12, KRA PIN, tax compliance verified", audited: true }),
      s("account_config", "Account configuration", ["billing"], {}),
      s("billing", "Billing configuration", ["wallet"], {}),
      s("wallet", "Wallet / payment configuration", ["policies"], { gate: "Funding route verified via callback-gated top-up" }),
      s("policies", "Travel & spend policies", ["users"], {}),
      s("users", "Authorised users", ["cost_centres"], {}),
      s("cost_centres", "Cost centres", ["approvers"], {}),
      s("approvers", "Approvers", ["service_config"], {}),
      s("service_config", "Service configuration", ["test_booking"], {}),
      s("test_booking", "Test booking", ["active"], { gate: "One successful end-to-end booking" }),
      s("active", "Active", [], { audited: true }),
    ],
  },
  {
    key: "partner_activation",
    label: "Marketplace partner activation",
    table: "charter_partner_applications",
    output: "Activated supply partner with monitored performance",
    states: [
      s("applied", "Applied", ["under_review", "rejected"]),
      s("under_review", "Under review", ["verified", "rejected"], { action: "Identity & business verification" }),
      s("verified", "Verified", ["approved", "rejected"], { gate: "Resource, documents, insurance & compliance verified", audited: true }),
      s("approved", "Approved", ["active", "rejected"], { action: "Agree commercial terms", authority: { subject: "partner", action: "approve" }, audited: true }),
      s("active", "Active", ["suspended", "deactivated"], { action: "Publish availability" }),
      s("suspended", "Suspended", ["active", "deactivated"], { audited: true }),
      s("rejected", "Rejected", [], { audited: true }),
      s("deactivated", "Deactivated", [], { audited: true }),
    ],
  },
  {
    key: "resource_supply",
    label: "Marketplace resource supply",
    table: "charter_inventory",
    output: "Utilisation and availability truth for matching",
    states: [
      s("registered", "Registered", ["verified"]),
      s("verified", "Verified", ["eligible"], { gate: "Inspection & insurance current", audited: true }),
      s("eligible", "Eligible", ["available", "retired"]),
      s("available", "Available", ["reserved", "retired"]),
      s("reserved", "Reserved", ["assigned", "available"]),
      s("assigned", "Assigned", ["in_service"], { audited: true }),
      s("in_service", "In service", ["completed"]),
      s("completed", "Completed", ["available"]),
      s("retired", "Retired from marketplace", [], { action: "Withdraw resource", gate: "Open missions settled", audited: true }),
    ],
  },
  {
    key: "revenue",
    label: "Revenue engine — booking to recognised revenue",
    table: "corporate_invoices",
    output: "Recognised revenue, partner settlement and reconciled ledger",
    states: [
      s("booked", "Booking / order", ["priced"]),
      s("priced", "Priced", ["fulfilling"], { gate: "Pricing rule applied (city_pricing_rules / charter_pricing_config)" }),
      s("fulfilling", "Fulfilment", ["completed"]),
      s("completed", "Completed", ["invoiced"], { gate: "Proof of service captured" }),
      s("invoiced", "Invoiced", ["paid"], { action: "Issue invoice", authority: { subject: "payment", action: "execute" }, audited: true }),
      s("paid", "Payment recorded", ["reconciled"], { gate: "Payment event from verified callback only", audited: true }),
      s("reconciled", "Reconciled", ["settled"], {}),
      s("settled", "Partner settled", ["recognised"], { authority: { subject: "payment", action: "approve" }, audited: true }),
      s("recognised", "TaxiD revenue recognised", [], { gate: "Configured recognition rule satisfied", audited: true }),
    ],
  },
  {
    key: "reconciliation",
    label: "Revenue assurance exception",
    table: "charter_wallet_reconciliation_findings",
    output: "Closed exception with owner, reason and resolution",
    states: [
      s("open", "Open exception", ["assigned"]),
      s("assigned", "Owner assigned", ["investigating"]),
      s("investigating", "Investigating", ["resolved", "escalated"], { gate: "Reason classified" }),
      s("escalated", "Escalated", ["resolved"], { audited: true }),
      s("resolved", "Resolved", [], { audited: true }),
    ],
  },
  {
    key: "customer_success",
    label: "Customer success lifecycle",
    table: "client_journey_events",
    output: "Retention, expansion or documented churn cause",
    states: [
      s("new", "New", ["activated"]),
      s("activated", "Activated", ["engaged"]),
      s("engaged", "Engaged", ["at_risk", "expanded", "renewed"]),
      s("at_risk", "At risk", ["escalated", "retained", "churned"], { action: "Create intervention task", gate: "Signal evidence recorded" }),
      s("escalated", "Escalated", ["retained", "churned"], { audited: true }),
      s("retained", "Retained", ["engaged"]),
      s("expanded", "Expanded", ["renewed"]),
      s("renewed", "Renewed", ["engaged"], { audited: true }),
      s("churned", "Churned", [], { audited: true }),
    ],
  },
  {
    key: "position",
    label: "Position management",
    table: "corporate_designations",
    output: "Occupied, budgeted position enabling workforce planning",
    states: [
      s("requested", "Position requested", ["approved", "rejected"], { authority: { subject: "employee", action: "approve" } }),
      s("approved", "Approved position", ["recruiting"], { gate: "Cost centre & budget attached", audited: true }),
      s("recruiting", "Recruitment", ["candidate"]),
      s("candidate", "Candidate selected", ["appointed"]),
      s("appointed", "Appointment", ["occupied"], { audited: true }),
      s("occupied", "Position occupied", ["vacant"]),
      s("vacant", "Vacant", ["recruiting"], { audited: true }),
      s("rejected", "Rejected", [], { audited: true }),
    ],
  },
  {
    key: "employee",
    label: "Employee lifecycle",
    table: "corporate_employees",
    output: "Performance, capability and succession records",
    states: [
      s("onboarding", "Onboarding", ["active"], { gate: "Identity, contract and access provisioned" }),
      s("active", "Active employee", ["performance", "exit"]),
      s("performance", "Performance cycle", ["development", "career"], { gate: "Goal + evidence recorded" }),
      s("development", "Development", ["performance"], { action: "Learning → assessment → capability update" }),
      s("career", "Career / promotion / transfer", ["active"], { authority: { subject: "employee", action: "approve" }, audited: true }),
      s("exit", "Exit", [], { gate: "Access revoked, knowledge handover recorded", audited: true }),
    ],
  },
  {
    key: "capability",
    label: "Capability closed loop",
    table: "capabilities",
    output: "Updated capability level per position requirement",
    states: [
      s("required", "Required capability defined", ["assessed"]),
      s("assessed", "Available capability assessed", ["gap", "met"]),
      s("gap", "Gap", ["development_plan"]),
      s("development_plan", "Development plan", ["learning"]),
      s("learning", "Learning", ["assessment"]),
      s("assessment", "Assessment", ["certified", "learning"], { gate: "Pass mark achieved" }),
      s("certified", "Certified", ["met"], { audited: true }),
      s("met", "Requirement met", []),
    ],
  },
  {
    key: "knowledge",
    label: "Knowledge / SOP control",
    table: "corporate_documents",
    output: "Single current approved version retrievable by AI",
    states: [
      s("draft", "Draft", ["review"]),
      s("review", "Review", ["approved", "draft"], { authority: { subject: "policy", action: "approve" } }),
      s("approved", "Approved & effective", ["due_review", "superseded"], { audited: true }),
      s("due_review", "Due review", ["review", "superseded"]),
      s("superseded", "Superseded", [], { audited: true }),
    ],
  },
  {
    key: "risk",
    label: "Risk & incident control",
    table: "alerts_events",
    output: "Residual risk with owner and evidenced mitigation",
    states: [
      s("identified", "Identified", ["assessed"]),
      s("assessed", "Assessed (probability × impact)", ["mitigating"], { gate: "Owner and controls recorded" }),
      s("mitigating", "Mitigating", ["closed", "escalated"]),
      s("escalated", "Escalated (overdue high risk)", ["closed"], { audited: true }),
      s("closed", "Closed with residual risk", [], { audited: true }),
    ],
  },
  {
    key: "memory_loop",
    label: "Organisational memory loop",
    table: "approval_decisions",
    output: "Lesson recorded and fed into playbooks and recommendations",
    states: [
      s("decision", "Decision recorded", ["executed"], { audited: true }),
      s("executed", "Executed", ["measured"]),
      s("measured", "Outcome measured", ["reviewed"], { gate: "Result compared to expected benefit" }),
      s("reviewed", "Reviewed", ["learned"]),
      s("learned", "Lesson recorded & SOP updated", [], { audited: true }),
    ],
  },
  {
    key: "innovation",
    label: "Innovation experiment",
    table: null,
    output: "Scale / iterate / stop decision — no idea parking lot",
    states: [
      s("proposed", "Proposed (problem + hypothesis)", ["approved", "stopped"], { gate: "Owner, benefit, success criteria, deadline" }),
      s("approved", "Approved experiment", ["running", "stopped"], { authority: { subject: "policy", action: "approve" } }),
      s("running", "Running", ["evaluated"]),
      s("evaluated", "Evaluated against criteria", ["scaled", "iterated", "stopped"], { audited: true }),
      s("scaled", "Scaled", []),
      s("iterated", "Iterated", ["running"]),
      s("stopped", "Stopped", [], { audited: true }),
    ],
  },
  {
    key: "ai_action",
    label: "AI operating loop (governed)",
    table: "staff_insight_feedback",
    output: "Measured outcome that updates AI confidence",
    states: [
      s("detected", "Detected signal", ["recommended"], { gate: "Named evidence sources" }),
      s("recommended", "Recommended action", ["prepared"], { gate: "Confidence + assumptions disclosed" }),
      s("prepared", "Briefing prepared", ["routed"]),
      s("routed", "Routed to human owner", ["authorised", "rejected"]),
      s("authorised", "Human authorised", ["executed"], { authority: { subject: "audit", action: "view" }, audited: true }),
      s("executed", "Executed by workflow", ["measured"], { gate: "Never a silent write to HR, financial or org records", audited: true }),
      s("measured", "Outcome measured", ["learned"]),
      s("learned", "AI confidence updated", []),
      s("rejected", "Rejected by human", [], { audited: true }),
    ],
  },
];

export function lifecycleByKey(key: string): Lifecycle | undefined {
  return LIFECYCLES.find((l) => l.key === key);
}

/** Legal transition check — used by tests and, later, server-side guards. */
export function canTransition(lifecycleKey: string, from: string, to: string): boolean {
  const lc = lifecycleByKey(lifecycleKey);
  if (!lc) return false;
  const state = lc.states.find((st) => st.key === from);
  return !!state?.next.includes(to);
}

/** Transitions that must produce an audit event. */
export function auditedStates(lifecycleKey: string): string[] {
  return (lifecycleByKey(lifecycleKey)?.states ?? []).filter((st) => st.audited).map((st) => st.key);
}

/** Terminal states (no onward transition). */
export function terminalStates(lifecycleKey: string): string[] {
  return (lifecycleByKey(lifecycleKey)?.states ?? []).filter((st) => st.next.length === 0).map((st) => st.key);
}

/**
 * Structural integrity: every state is reachable, every `next` target exists,
 * and at least one terminal state exists. A failure here is a P1 blocker.
 */
export function lifecycleDefects(): { lifecycle: string; defect: string }[] {
  const out: { lifecycle: string; defect: string }[] = [];
  for (const lc of LIFECYCLES) {
    const keys = new Set(lc.states.map((st) => st.key));
    const referenced = new Set<string>();
    for (const st of lc.states) {
      for (const n of st.next) {
        if (!keys.has(n)) out.push({ lifecycle: lc.key, defect: `${st.key} → unknown state "${n}"` });
        referenced.add(n);
      }
    }
    if (!lc.states.some((st) => st.next.length === 0)) {
      out.push({ lifecycle: lc.key, defect: "no terminal state — workflow cannot complete" });
    }
    lc.states.slice(1).forEach((st) => {
      if (!referenced.has(st.key)) out.push({ lifecycle: lc.key, defect: `unreachable state "${st.key}"` });
    });
  }
  return out;
}

/** The Phase 2 closing loop, rendered on the operations page. */
export const ORCHESTRATION_LOOP = [
  "Strategy", "Organisation", "People", "Capability", "Work", "Customer",
  "Marketplace", "Transaction", "Revenue", "Outcome", "Intelligence",
  "Decision", "Action", "Measurement", "Learning", "New capability",
] as const;

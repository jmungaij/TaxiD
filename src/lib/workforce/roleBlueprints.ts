/**
 * TaxiD Workforce Operating System — Role Blueprint Engine.
 *
 * A role blueprint is the reusable contract between the operating model and a
 * human being: why the position exists, what it owns, what must change because
 * it exists, how that change is measured, and the standard work that produces
 * it. Blueprints are pure data — the launchpad turns one into objectives, KPIs,
 * tasks and calendar commitments for a named employee.
 *
 * Nothing here invents performance. Targets are role defaults that a manager
 * confirms before activation; actuals are only ever recorded by the existing
 * append-only KPI actuals spine.
 */

export type ValueLever =
  | "revenue"
  | "gmv"
  | "customer_acquisition"
  | "customer_retention"
  | "service_quality"
  | "operational_efficiency"
  | "cost"
  | "risk"
  | "compliance"
  | "strategic_capability";

export type AttributionKind = "direct" | "influenced" | "assisted" | "protected" | "strategic";

export type TaskPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export type RampPhase = "learn" | "execute" | "own";

export type EvidenceKind =
  | "crm_record"
  | "meeting_note"
  | "proposal_document"
  | "signed_agreement"
  | "assignment_completion"
  | "exception_resolution"
  | "reconciliation_pack"
  | "approval_record"
  | "verified_document"
  | "test_and_deployment"
  | "training_certificate";

export interface BlueprintKpi {
  key: string;
  /** Objective statement — the outcome required. */
  objective: string;
  /** How success is measured. */
  kpiLabel: string;
  unit: string;
  /** Role default target for the measurement period. */
  target: number;
  /** Relative importance, summed and normalised per role. */
  weightPct: number;
  period: "monthly" | "quarterly";
  evidence: EvidenceKind;
  lever: ValueLever;
  attribution: AttributionKind;
}

export interface BlueprintTask {
  key: string;
  title: string;
  /** KPI key this work exists to move. */
  kpiKey: string;
  priority: TaskPriority;
  /** Working minutes a competent holder needs per occurrence. */
  effortMinutes: number;
  /** Cadence used for calendar generation. */
  cadence: "daily" | "weekly" | "monthly" | "once";
  /** Which ramp phase first introduces the work. */
  phase: RampPhase;
  evidence: EvidenceKind;
  requiresApproval?: boolean;
  slaMinutes?: number;
  dependsOn?: string[];
}

export interface RoleBlueprint {
  key: string;
  title: string;
  department: string;
  jobFamily: string;
  grade: string;
  /** Why this position exists. */
  purpose: string;
  /** What the holder owns. */
  accountabilities: string[];
  /** What must change because the holder exists. */
  outcomes: string[];
  capabilities: string[];
  requiredTraining: string[];
  /** Decisions the holder may take alone. */
  authority: string[];
  /** What must go to a manager. */
  escalation: string[];
  dependencies: string[];
  platformRoles: string[];
  kpis: BlueprintKpi[];
  standardWork: BlueprintTask[];
  /** Contracted productive minutes per working day. */
  dailyCapacityMinutes: number;
  /** Ordered commercial or operational path from day 1 to value. */
  valuePath: string[];
}

const SALES: RoleBlueprint = {
  key: "corporate_mobility_sales_executive",
  title: "Corporate Mobility Sales Executive",
  department: "Commercial",
  jobFamily: "Revenue",
  grade: "P3",
  purpose:
    "Acquire and activate corporate mobility customers that generate recurring, compliant transaction value on the TaxiD platform.",
  accountabilities: [
    "Qualified corporate pipeline in assigned territory",
    "Proposal quality and commercial accuracy",
    "New account acquisition and first-transaction activation",
    "Account transition into recurring transaction behaviour",
  ],
  outcomes: [
    "Corporate accounts exist that did not exist before",
    "Activated accounts transact within 30 days of signature",
    "Recurring corporate GMV grows without discount leakage",
  ],
  capabilities: [
    "Consultative B2B selling",
    "Corporate mobility commercial modelling",
    "Proposal and tender writing",
    "CRM discipline",
  ],
  requiredTraining: ["TaxiD platform fundamentals", "Corporate pricing & policy", "KYB and compliance basics"],
  authority: ["Standard rate-card proposals", "Meeting scheduling", "Pipeline stage changes"],
  escalation: ["Non-standard discounts", "Bespoke SLAs", "Credit terms", "Contract deviations"],
  dependencies: ["Corporate Ops (activation)", "Finance (credit & invoicing)", "Compliance (KYB)", "Supply Ops (capacity)"],
  platformRoles: ["operations_manager"],
  dailyCapacityMinutes: 420,
  valuePath: [
    "Learn", "Prospect", "Qualify", "Contact", "Meet", "Propose", "Negotiate", "Close", "Activate", "Transact", "Retain",
  ],
  kpis: [
    { key: "qualified_pipeline", objective: "Build a qualified corporate pipeline", kpiLabel: "Qualified opportunities", unit: "opportunities", target: 12, weightPct: 20, period: "monthly", evidence: "crm_record", lever: "customer_acquisition", attribution: "direct" },
    { key: "meetings", objective: "Create decision-maker conversations", kpiLabel: "Decision-maker meetings", unit: "meetings", target: 16, weightPct: 15, period: "monthly", evidence: "meeting_note", lever: "customer_acquisition", attribution: "direct" },
    { key: "proposals", objective: "Convert conversations into commercial offers", kpiLabel: "Proposals issued", unit: "proposals", target: 8, weightPct: 15, period: "monthly", evidence: "proposal_document", lever: "revenue", attribution: "direct" },
    { key: "new_accounts", objective: "Acquire new corporate accounts", kpiLabel: "Signed accounts", unit: "accounts", target: 3, weightPct: 20, period: "monthly", evidence: "signed_agreement", lever: "customer_acquisition", attribution: "direct" },
    { key: "activated_accounts", objective: "Activate accounts into first transaction", kpiLabel: "Accounts transacting", unit: "accounts", target: 3, weightPct: 15, period: "monthly", evidence: "crm_record", lever: "gmv", attribution: "influenced" },
    { key: "retention", objective: "Keep acquired accounts transacting", kpiLabel: "Account retention", unit: "%", target: 95, weightPct: 15, period: "quarterly", evidence: "crm_record", lever: "customer_retention", attribution: "protected" },
  ],
  standardWork: [
    { key: "prospecting", title: "Prospect and build target list", kpiKey: "qualified_pipeline", priority: "P2", effortMinutes: 60, cadence: "daily", phase: "learn", evidence: "crm_record" },
    { key: "qualification", title: "Qualify inbound and outbound leads", kpiKey: "qualified_pipeline", priority: "P1", effortMinutes: 45, cadence: "daily", phase: "execute", evidence: "crm_record" },
    { key: "outreach", title: "Structured outreach sequence", kpiKey: "meetings", priority: "P2", effortMinutes: 45, cadence: "daily", phase: "learn", evidence: "crm_record" },
    { key: "meeting", title: "Hold decision-maker meeting", kpiKey: "meetings", priority: "P1", effortMinutes: 90, cadence: "weekly", phase: "execute", evidence: "meeting_note" },
    { key: "proposal", title: "Prepare and issue proposal", kpiKey: "proposals", priority: "P1", effortMinutes: 120, cadence: "weekly", phase: "execute", evidence: "proposal_document", requiresApproval: true },
    { key: "negotiation", title: "Negotiate and close agreement", kpiKey: "new_accounts", priority: "P0", effortMinutes: 120, cadence: "weekly", phase: "own", evidence: "signed_agreement", requiresApproval: true, dependsOn: ["proposal"] },
    { key: "activation", title: "Drive first-transaction activation", kpiKey: "activated_accounts", priority: "P0", effortMinutes: 60, cadence: "weekly", phase: "own", evidence: "crm_record", slaMinutes: 2880, dependsOn: ["negotiation"] },
    { key: "retention_review", title: "Run account retention review", kpiKey: "retention", priority: "P2", effortMinutes: 60, cadence: "monthly", phase: "own", evidence: "crm_record", dependsOn: ["activation"] },
    { key: "crm_hygiene", title: "Update CRM and pipeline record", kpiKey: "qualified_pipeline", priority: "P4", effortMinutes: 20, cadence: "daily", phase: "learn", evidence: "crm_record" },
  ],
};

const SUPPLY_OPS: RoleBlueprint = {
  key: "supply_operations_specialist",
  title: "Supply Operations Specialist",
  department: "Operations",
  jobFamily: "Operations",
  grade: "P2",
  purpose:
    "Ensure verified independent provider capacity is available, compliant and matched to demand so committed services are fulfilled on time.",
  accountabilities: [
    "Verified provider availability against forecast demand",
    "Provider compliance currency (documents, licences, insurance)",
    "Assignment coverage and exception resolution",
  ],
  outcomes: [
    "Qualified demand is matched instead of lost",
    "Fulfilment exceptions are resolved inside SLA",
    "Provider compliance never blocks a committed service",
  ],
  capabilities: ["Dispatch operations", "Provider relationship management", "Exception triage", "Capacity forecasting"],
  requiredTraining: ["Dispatch console", "Compliance verification", "Exception playbooks"],
  authority: ["Reassignment within capacity", "Provider stand-down for compliance lapse"],
  escalation: ["Commercial goodwill", "Provider suspension", "SLA credits"],
  dependencies: ["Dispatch", "Compliance", "Customer Ops", "Finance"],
  platformRoles: ["operations_admin", "fleet_manager"],
  dailyCapacityMinutes: 450,
  valuePath: ["Learn", "Prepare capacity", "Acquire supply", "Match demand", "Fulfil service", "Resolve exceptions", "Reconcile", "Improve SLA"],
  kpis: [
    { key: "match_rate", objective: "Match qualified demand", kpiLabel: "Match rate", unit: "%", target: 95, weightPct: 30, period: "monthly", evidence: "assignment_completion", lever: "gmv", attribution: "influenced" },
    { key: "exception_sla", objective: "Resolve exceptions inside SLA", kpiLabel: "Exceptions in SLA", unit: "%", target: 97, weightPct: 25, period: "monthly", evidence: "exception_resolution", lever: "service_quality", attribution: "protected" },
    { key: "verified_supply", objective: "Maintain compliant supply pool", kpiLabel: "Compliance-verified providers", unit: "providers", target: 120, weightPct: 25, period: "monthly", evidence: "verified_document", lever: "compliance", attribution: "protected" },
    { key: "cost_per_job", objective: "Improve fulfilment efficiency", kpiLabel: "Cost per completed job", unit: "%", target: -5, weightPct: 20, period: "quarterly", evidence: "reconciliation_pack", lever: "operational_efficiency", attribution: "influenced" },
  ],
  standardWork: [
    { key: "shift_readiness", title: "Confirm shift capacity and coverage", kpiKey: "match_rate", priority: "P1", effortMinutes: 30, cadence: "daily", phase: "learn", evidence: "assignment_completion" },
    { key: "unmatched_sweep", title: "Clear unmatched qualified demand", kpiKey: "match_rate", priority: "P0", effortMinutes: 60, cadence: "daily", phase: "execute", evidence: "assignment_completion", slaMinutes: 60 },
    { key: "exception_queue", title: "Work fulfilment exception queue", kpiKey: "exception_sla", priority: "P0", effortMinutes: 90, cadence: "daily", phase: "execute", evidence: "exception_resolution", slaMinutes: 120 },
    { key: "compliance_expiry", title: "Clear expiring provider documents", kpiKey: "verified_supply", priority: "P1", effortMinutes: 45, cadence: "weekly", phase: "execute", evidence: "verified_document" },
    { key: "supply_recruitment", title: "Onboard additional verified providers", kpiKey: "verified_supply", priority: "P2", effortMinutes: 60, cadence: "weekly", phase: "own", evidence: "verified_document" },
    { key: "sla_review", title: "Review SLA and efficiency trend", kpiKey: "cost_per_job", priority: "P3", effortMinutes: 45, cadence: "monthly", phase: "own", evidence: "reconciliation_pack" },
  ],
};

const CUSTOMER_OPS: RoleBlueprint = {
  key: "customer_operations_specialist",
  title: "Customer Operations Specialist",
  department: "Customer Operations",
  jobFamily: "Customer",
  grade: "P2",
  purpose:
    "Resolve customer requests and service failures fast enough to protect revenue, retention and the TaxiD service promise.",
  accountabilities: ["First-response and resolution SLA", "Case quality and evidence", "Commercial opportunity referral"],
  outcomes: ["Customers stay after a failure", "Revenue at risk is recovered", "Repeat causes are escalated, not absorbed"],
  capabilities: ["Case management", "Service recovery", "Root-cause articulation"],
  requiredTraining: ["Case console", "Service recovery policy", "Escalation matrix"],
  authority: ["Standard goodwill within policy", "Case closure with evidence"],
  escalation: ["Refunds above policy", "Safety incidents", "Legal or regulator contact"],
  dependencies: ["Dispatch", "Finance", "Trust & Safety", "Commercial"],
  platformRoles: ["operations_manager"],
  dailyCapacityMinutes: 420,
  valuePath: ["Learn", "Receive request", "Resolve", "Retain", "Identify opportunity", "Escalate commercial opportunity"],
  kpis: [
    { key: "first_response", objective: "Answer customers fast", kpiLabel: "First response in SLA", unit: "%", target: 95, weightPct: 25, period: "monthly", evidence: "approval_record", lever: "service_quality", attribution: "protected" },
    { key: "resolution", objective: "Resolve cases fully", kpiLabel: "Resolution in SLA", unit: "%", target: 92, weightPct: 25, period: "monthly", evidence: "exception_resolution", lever: "service_quality", attribution: "protected" },
    { key: "retained_revenue", objective: "Protect revenue at risk", kpiLabel: "Revenue protected", unit: "KES", target: 750000, weightPct: 25, period: "monthly", evidence: "reconciliation_pack", lever: "revenue", attribution: "protected" },
    { key: "referrals", objective: "Refer commercial opportunity", kpiLabel: "Qualified referrals", unit: "referrals", target: 6, weightPct: 25, period: "monthly", evidence: "crm_record", lever: "customer_acquisition", attribution: "assisted" },
  ],
  standardWork: [
    { key: "queue_now", title: "Work the live customer queue", kpiKey: "first_response", priority: "P0", effortMinutes: 180, cadence: "daily", phase: "learn", evidence: "exception_resolution", slaMinutes: 30 },
    { key: "case_followup", title: "Close open cases with evidence", kpiKey: "resolution", priority: "P1", effortMinutes: 90, cadence: "daily", phase: "execute", evidence: "exception_resolution" },
    { key: "recovery", title: "Run service recovery on at-risk accounts", kpiKey: "retained_revenue", priority: "P1", effortMinutes: 60, cadence: "weekly", phase: "execute", evidence: "reconciliation_pack", requiresApproval: true },
    { key: "cause_review", title: "Escalate repeat causes", kpiKey: "resolution", priority: "P3", effortMinutes: 45, cadence: "weekly", phase: "own", evidence: "approval_record" },
    { key: "referral", title: "Refer commercial opportunity to sales", kpiKey: "referrals", priority: "P2", effortMinutes: 20, cadence: "weekly", phase: "own", evidence: "crm_record" },
  ],
};

const FINANCE: RoleBlueprint = {
  key: "revenue_assurance_analyst",
  title: "Revenue Assurance Analyst",
  department: "Finance",
  jobFamily: "Finance",
  grade: "P3",
  purpose:
    "Prove that every completed service converts into recognised, reconciled and collected revenue with no leakage.",
  accountabilities: ["Transaction-to-settlement reconciliation", "Revenue eligibility gates", "Leakage investigation"],
  outcomes: ["Recognised revenue matches fulfilled service", "Leakage is found and recovered", "Closure runs without manual rescue"],
  capabilities: ["Reconciliation", "Financial controls", "SQL/data analysis"],
  requiredTraining: ["Commercial transaction spine", "Revenue recognition policy", "Settlement controls"],
  authority: ["Reconciliation case closure with evidence"],
  escalation: ["Write-offs", "Manual journal posting", "Control exceptions"],
  dependencies: ["Commerce OS", "Payments", "Settlement", "Compliance"],
  platformRoles: ["finance_admin"],
  dailyCapacityMinutes: 420,
  valuePath: ["Learn", "Reconcile", "Investigate", "Recover", "Close", "Harden control"],
  kpis: [
    { key: "reconciled", objective: "Reconcile the money chain", kpiLabel: "Transactions reconciled", unit: "%", target: 99, weightPct: 30, period: "monthly", evidence: "reconciliation_pack", lever: "revenue", attribution: "protected" },
    { key: "leakage", objective: "Eliminate revenue leakage", kpiLabel: "Leakage recovered", unit: "KES", target: 500000, weightPct: 30, period: "monthly", evidence: "reconciliation_pack", lever: "revenue", attribution: "protected" },
    { key: "closure_time", objective: "Close the period on time", kpiLabel: "Closure cycle time", unit: "days", target: 4, weightPct: 20, period: "monthly", evidence: "approval_record", lever: "operational_efficiency", attribution: "direct" },
    { key: "control_gaps", objective: "Harden financial controls", kpiLabel: "Open control gaps", unit: "gaps", target: 0, weightPct: 20, period: "quarterly", evidence: "approval_record", lever: "risk", attribution: "protected" },
  ],
  standardWork: [
    { key: "daily_recon", title: "Run daily money reconciliation", kpiKey: "reconciled", priority: "P1", effortMinutes: 90, cadence: "daily", phase: "learn", evidence: "reconciliation_pack" },
    { key: "exception_invest", title: "Investigate reconciliation exceptions", kpiKey: "leakage", priority: "P0", effortMinutes: 120, cadence: "daily", phase: "execute", evidence: "reconciliation_pack", slaMinutes: 480 },
    { key: "eligibility", title: "Clear revenue eligibility blockers", kpiKey: "reconciled", priority: "P1", effortMinutes: 60, cadence: "weekly", phase: "execute", evidence: "approval_record", requiresApproval: true },
    { key: "closure", title: "Prepare period closure pack", kpiKey: "closure_time", priority: "P1", effortMinutes: 180, cadence: "monthly", phase: "own", evidence: "reconciliation_pack" },
    { key: "control_review", title: "Review and close control gaps", kpiKey: "control_gaps", priority: "P3", effortMinutes: 60, cadence: "monthly", phase: "own", evidence: "approval_record" },
  ],
};

const COMPLIANCE: RoleBlueprint = {
  key: "compliance_verification_officer",
  title: "Compliance Verification Officer",
  department: "Compliance",
  jobFamily: "Risk & Compliance",
  grade: "P2",
  purpose:
    "Keep every participant on the platform verifiably eligible to operate, so growth never creates regulatory exposure.",
  accountabilities: ["Document verification", "Expiry prevention", "Regulatory evidence pack"],
  outcomes: ["No expired participant operates", "Regulator questions are answerable from evidence", "Verification never blocks growth"],
  capabilities: ["KYC/KYB verification", "Regulatory interpretation", "Evidence management"],
  requiredTraining: ["Country rule set", "Document verification standard", "Data protection"],
  authority: ["Approve compliant documents", "Reject incomplete submissions"],
  escalation: ["Suspected fraud", "Regulator correspondence", "Policy exceptions"],
  dependencies: ["Supply Ops", "Corporate Ops", "Trust & Safety"],
  platformRoles: ["compliance_admin"],
  dailyCapacityMinutes: 420,
  valuePath: ["Learn", "Verify", "Prevent expiry", "Evidence", "Report", "Improve rule set"],
  kpis: [
    { key: "verification_sla", objective: "Verify submissions fast", kpiLabel: "Verifications in SLA", unit: "%", target: 96, weightPct: 30, period: "monthly", evidence: "verified_document", lever: "compliance", attribution: "protected" },
    { key: "expired_active", objective: "Prevent expired participants", kpiLabel: "Expired but active", unit: "participants", target: 0, weightPct: 35, period: "monthly", evidence: "verified_document", lever: "risk", attribution: "protected" },
    { key: "evidence_ready", objective: "Keep evidence audit-ready", kpiLabel: "Evidence completeness", unit: "%", target: 100, weightPct: 35, period: "quarterly", evidence: "approval_record", lever: "compliance", attribution: "protected" },
  ],
  standardWork: [
    { key: "verify_queue", title: "Verify submitted documents", kpiKey: "verification_sla", priority: "P1", effortMinutes: 120, cadence: "daily", phase: "learn", evidence: "verified_document", slaMinutes: 480 },
    { key: "expiry_sweep", title: "Clear 30-day expiry watchlist", kpiKey: "expired_active", priority: "P0", effortMinutes: 60, cadence: "daily", phase: "execute", evidence: "verified_document", slaMinutes: 240 },
    { key: "evidence_pack", title: "Assemble regulatory evidence pack", kpiKey: "evidence_ready", priority: "P2", effortMinutes: 120, cadence: "monthly", phase: "own", evidence: "approval_record" },
  ],
};

/**
 * CORPORATE SALES SPECIALIST — authoritative blueprint for org position
 * YML-SAL-CSS-001 in the Sales department. KPIs, weights and targets are taken
 * verbatim from the executed letters of offer (ref YBL/HR/OFFR/FMMK/0826/01–05)
 * so the operating model and the employment contract cannot diverge. Nothing
 * here is invented: monetary targets are the contractual qualifying gross sales
 * target, not an aspiration added by the platform.
 */
const CORPORATE_SALES_SPECIALIST: RoleBlueprint = {
  key: "corporate_sales_specialist",
  title: "Corporate Sales Specialist",
  department: "Sales",
  jobFamily: "Revenue",
  grade: "Officer",
  purpose:
    "Acquire and grow a portfolio of corporate mobility clients for TaxiD by identifying opportunities, building strong relationships and closing deals that deliver sustainable revenue growth.",
  accountabilities: [
    "Qualified corporate lead pipeline created and progressed in the platform",
    "Proposals, quotations and service agreements prepared within approved pricing",
    "Corporate contracts negotiated and closed",
    "Client retention and repeat business on assigned accounts",
    "Accurate and timely CRM, pipeline and sales reporting",
  ],
  outcomes: [
    "Qualifying gross sales revenue is attributable to the specialist each month",
    "New corporate clients transact on the platform rather than remaining prospects",
    "Every booking can be traced back to the originating lead and specialist",
  ],
  capabilities: [
    "Consultative corporate selling",
    "Proposal, quotation and tender preparation",
    "Commercial negotiation inside delegated authority",
    "Client relationship management",
    "CRM and pipeline discipline",
  ],
  requiredTraining: [
    "TaxiD service portfolio",
    "Corporate pricing, policy and delegation limits",
    "Sales portal and lead pipeline enablement",
    "Data Protection Act 2019 and confidentiality obligations",
  ],
  authority: [
    "Create and qualify leads in the sales pipeline",
    "Hold client meetings, presentations and product demonstrations",
    "Issue quotations on the approved rate card",
    "Progress own leads through the pipeline stages",
  ],
  escalation: [
    "Discounts, incentives or commercial terms outside the approved rate card",
    "Credit arrangements and non-standard payment terms",
    "Contract deviations and bespoke service levels",
    "Material commercial or compliance concerns on an account",
  ],
  dependencies: [
    "Sales Manager (approval)",
    "Operations (service delivery)",
    "Finance (invoicing and credit)",
    "Customer Success (activation and retention)",
  ],
  platformRoles: [],
  dailyCapacityMinutes: 420,
  valuePath: [
    "Learn",
    "Prospect",
    "Qualify",
    "Meet",
    "Quote",
    "Negotiate",
    "Close",
    "Book",
    "Fulfil",
    "Retain",
  ],
  kpis: [
    { key: "monthly_sales_revenue", objective: "Achieve the contractual monthly qualifying gross sales target", kpiLabel: "Monthly qualifying gross sales revenue", unit: "KES", target: 3_000_000, weightPct: 40, period: "monthly", evidence: "signed_agreement", lever: "revenue", attribution: "direct" },
    { key: "new_corporate_clients", objective: "Acquire new corporate clients", kpiLabel: "New corporate clients", unit: "clients", target: 10, weightPct: 25, period: "monthly", evidence: "signed_agreement", lever: "customer_acquisition", attribution: "direct" },
    { key: "client_retention", objective: "Retain clients and generate repeat business", kpiLabel: "Client retention rate", unit: "%", target: 90, weightPct: 15, period: "monthly", evidence: "crm_record", lever: "customer_retention", attribution: "protected" },
    { key: "conversion_rate", objective: "Convert qualified leads into bookings", kpiLabel: "Sales conversion rate", unit: "%", target: 20, weightPct: 10, period: "monthly", evidence: "crm_record", lever: "revenue", attribution: "direct" },
    { key: "crm_discipline", objective: "Maintain reporting and CRM discipline", kpiLabel: "Timely and accurate reports", unit: "%", target: 100, weightPct: 10, period: "monthly", evidence: "crm_record", lever: "operational_efficiency", attribution: "direct" },
  ],
  standardWork: [
    { key: "prospect", title: "Prospect and develop the corporate target list", kpiKey: "new_corporate_clients", priority: "P2", effortMinutes: 60, cadence: "daily", phase: "learn", evidence: "crm_record" },
    { key: "create_lead", title: "Capture new leads in the sales portal", kpiKey: "conversion_rate", priority: "P1", effortMinutes: 20, cadence: "daily", phase: "learn", evidence: "crm_record" },
    { key: "qualify_lead", title: "Qualify leads against corporate mobility need", kpiKey: "conversion_rate", priority: "P1", effortMinutes: 40, cadence: "daily", phase: "execute", evidence: "crm_record" },
    { key: "client_meeting", title: "Hold client meeting, presentation or demonstration", kpiKey: "new_corporate_clients", priority: "P1", effortMinutes: 90, cadence: "weekly", phase: "execute", evidence: "meeting_note" },
    { key: "quotation", title: "Prepare and submit proposal or quotation", kpiKey: "monthly_sales_revenue", priority: "P1", effortMinutes: 120, cadence: "weekly", phase: "execute", evidence: "proposal_document", requiresApproval: true },
    { key: "close", title: "Negotiate and close the corporate contract", kpiKey: "monthly_sales_revenue", priority: "P0", effortMinutes: 120, cadence: "weekly", phase: "own", evidence: "signed_agreement", requiresApproval: true, dependsOn: ["quotation"] },
    { key: "convert_booking", title: "Convert the won lead into a booking", kpiKey: "monthly_sales_revenue", priority: "P0", effortMinutes: 45, cadence: "weekly", phase: "own", evidence: "crm_record", dependsOn: ["close"] },
    { key: "account_review", title: "Client follow-up and account review", kpiKey: "client_retention", priority: "P2", effortMinutes: 60, cadence: "monthly", phase: "own", evidence: "crm_record", dependsOn: ["convert_booking"] },
    { key: "reporting", title: "Update pipeline record and submit sales report", kpiKey: "crm_discipline", priority: "P4", effortMinutes: 25, cadence: "daily", phase: "learn", evidence: "crm_record" },
  ],
};

export const ROLE_BLUEPRINTS: RoleBlueprint[] = [
  CORPORATE_SALES_SPECIALIST,
  SALES,
  SUPPLY_OPS,
  CUSTOMER_OPS,
  FINANCE,
  COMPLIANCE,
];

export const blueprintByKey = (key: string): RoleBlueprint | undefined =>
  ROLE_BLUEPRINTS.find((b) => b.key === key);

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  P0: "P0 · Critical",
  P1: "P1 · Business critical",
  P2: "P2 · Growth",
  P3: "P3 · Improvement",
  P4: "P4 · Administrative",
};

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  crm_record: "CRM record",
  meeting_note: "Meeting note",
  proposal_document: "Proposal document",
  signed_agreement: "Signed agreement",
  assignment_completion: "Assignment completion",
  exception_resolution: "Exception resolution",
  reconciliation_pack: "Reconciliation pack",
  approval_record: "Approval record",
  verified_document: "Verified document",
  test_and_deployment: "Test & deployment record",
  training_certificate: "Training certificate",
};

export const LEVER_LABEL: Record<ValueLever, string> = {
  revenue: "Revenue",
  gmv: "GMV",
  customer_acquisition: "Customer acquisition",
  customer_retention: "Customer retention",
  service_quality: "Service quality",
  operational_efficiency: "Operational efficiency",
  cost: "Cost",
  risk: "Risk",
  compliance: "Compliance",
  strategic_capability: "Strategic capability",
};

export const ATTRIBUTION_LABEL: Record<AttributionKind, string> = {
  direct: "Direct",
  influenced: "Influenced",
  assisted: "Assisted",
  protected: "Protected",
  strategic: "Strategic",
};

/**
 * The management rule, rendered in the product so it is enforced, not aspired
 * to. Each entry is asserted by `auditBlueprint`.
 */
export const MANAGEMENT_RULES = [
  "No employee without a role.",
  "No role without outcomes.",
  "No outcome without KPIs.",
  "No KPI without work.",
  "No work without an owner.",
  "No important task without a deadline.",
  "No critical task without evidence.",
  "No activity without business purpose.",
  "No completed work without measuring the result.",
  "No recurring failure without intervention.",
] as const;

export interface BlueprintDefect {
  rule: string;
  detail: string;
}

/** Structural audit of a blueprint against the management rule. */
export function auditBlueprint(bp: RoleBlueprint): BlueprintDefect[] {
  const defects: BlueprintDefect[] = [];
  if (!bp.purpose.trim()) defects.push({ rule: "No role without outcomes.", detail: "Missing purpose" });
  if (bp.outcomes.length === 0) defects.push({ rule: "No role without outcomes.", detail: "No required outcomes" });
  if (bp.kpis.length === 0) defects.push({ rule: "No outcome without KPIs.", detail: "No KPIs defined" });

  const weight = bp.kpis.reduce((s, k) => s + k.weightPct, 0);
  if (weight !== 100) defects.push({ rule: "No outcome without KPIs.", detail: `KPI weights total ${weight}%, expected 100%` });

  for (const k of bp.kpis) {
    if (!bp.standardWork.some((t) => t.kpiKey === k.key)) {
      defects.push({ rule: "No KPI without work.", detail: `KPI ${k.key} has no standard work` });
    }
  }
  for (const t of bp.standardWork) {
    if (!bp.kpis.some((k) => k.key === t.kpiKey)) {
      defects.push({ rule: "No activity without business purpose.", detail: `Task ${t.key} references unknown KPI ${t.kpiKey}` });
    }
    if (!t.evidence) defects.push({ rule: "No critical task without evidence.", detail: `Task ${t.key} has no evidence requirement` });
    const known = new Set(bp.standardWork.map((x) => x.key));
    for (const d of t.dependsOn ?? []) {
      if (!known.has(d)) defects.push({ rule: "No work without an owner.", detail: `Task ${t.key} depends on unknown ${d}` });
    }
  }
  return defects;
}

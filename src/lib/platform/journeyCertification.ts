/**
 * SAFARID — Business Journey Certification
 * ------------------------------------------------
 * Navigation governance certifies *routes*. This module certifies *journeys*:
 * the real sequences a persona walks to produce a business outcome.
 *
 * A journey is certified when:
 *   1. Every step maps to a route that exists in src/lib/routes.ts.
 *   2. Every non-terminal step can continue — the route declares an exit point
 *      or is reachable from primary navigation (see navigationGovernance).
 *   3. The journey declares an owner, a measurable outcome and its KPI.
 *
 * This is evidence, not decoration: `certifyJourneys()` is asserted in CI
 * (src/lib/platform/__tests__/journeyCertification.test.ts) so a route rename
 * or a removed navigation entry breaks the build instead of silently breaking
 * an operator's day.
 */
import { ROUTES } from "@/lib/routes";
import { buildNavigationGovernance, journeyExceptionFor, type NavGovernanceRecord } from "./navigationGovernance";

export interface JourneyStep {
  /** Route the persona lands on for this step. */
  path: string;
  /** The action they perform there. */
  action: string;
  /** The state change / artefact produced. */
  outcome: string;
}

export interface BusinessJourney {
  key: string;
  name: string;
  persona: string;
  executiveOwner: string;
  /** Business outcome the journey exists to produce. */
  outcome: string;
  /** KPI the outcome moves. */
  kpi: string;
  steps: JourneyStep[];
}

export const BUSINESS_JOURNEYS: BusinessJourney[] = [
  {
    key: "sales_corporate_charter",
    name: "Sales — Corporate charter deal to signed contract",
    persona: "Commercial / Sales Manager",
    executiveOwner: "Chief Commercial Officer",
    outcome: "Signed mobility service contract with an approved rate card",
    kpi: "contract_win_rate",
    steps: [
      { path: "/staff/workspace", action: "Start my day and pick the ranked next best action", outcome: "Work item claimed" },
      { path: "/staff/customers/accounts", action: "Open Account 360 and log the qualification interaction", outcome: "Interaction + next action recorded" },
      { path: "/staff/commercial/charter", action: "Generate a charter quotation from rate card v1.0", outcome: "Server-priced quotation issued" },
      { path: "/staff/customers/documents", action: "Issue the contract for approval and signature", outcome: "Approved contract version" },
      { path: "/staff/closure", action: "Confirm commercial lineage and revenue closure", outcome: "Deal closed with financial terms captured" },
    ],
  },
  {
    key: "customer_success_escalation",
    name: "Customer Success — corporate escalation to resolution",
    persona: "Customer Success Manager",
    executiveOwner: "Chief Customer Officer",
    outcome: "Escalation resolved with an auditable decision trail",
    kpi: "escalation_resolution_time",
    steps: [
      { path: "/staff/workspace", action: "Open the escalation work item from MY WORK", outcome: "Ownership assigned" },
      { path: "/staff/customers/accounts", action: "Review relationship memory and commitments", outcome: "Context established" },
      { path: "/dashboard/admin/corporates/support", action: "Action the corporate support case", outcome: "Case updated" },
      { path: "/dashboard/admin/corporates/approvals", action: "Route the exception for approval", outcome: "Decision recorded" },
      { path: "/staff/org/work", action: "Record the outcome and close the loop", outcome: "Outcome + audit entry" },
    ],
  },
  {
    key: "travel_desk_assisted_booking",
    name: "Travel Desk — assisted corporate booking",
    persona: "Travel Desk Coordinator",
    executiveOwner: "Head of Corporate Operations",
    outcome: "Confirmed corporate trip billed to the right cost centre",
    kpi: "assisted_booking_fulfilment_rate",
    steps: [
      { path: "/staff/workspace", action: "Pick up the booking request", outcome: "Request claimed" },
      { path: "/dashboard/admin/corporates/assisted-booking", action: "Capture traveller, policy and cost centre", outcome: "Compliant booking intent" },
      { path: "/dashboard/corporate-charter/booking", action: "Complete the enterprise booking wizard", outcome: "Booking confirmed" },
      { path: "/dashboard/admin/charter-booking-audit", action: "Verify the settlement and audit event", outcome: "Booking auditable end to end" },
    ],
  },
  {
    key: "recruitment_hire",
    name: "Recruitment — vacancy to onboarded hire",
    persona: "Talent Acquisition Partner",
    executiveOwner: "Chief People Officer",
    outcome: "Accepted offer and onboarded employee",
    kpi: "time_to_hire",
    steps: [
      { path: "/staff/recruitment/vacancies", action: "Create and publish an approved vacancy linked to a position", outcome: "Vacancy live" },
      { path: "/staff/recruitment/publication-health", action: "Confirm public publication health", outcome: "Vacancy visible on Careers" },
      { path: "/careers", action: "Candidate discovers and applies publicly", outcome: "Application captured" },
      { path: "/staff/recruitment/screening", action: "Screen and progress applications", outcome: "Stage progression logged" },
      { path: "/staff/recruitment/shortlist", action: "Shortlist with AI evidence and human decision", outcome: "Shortlist approved" },
      { path: "/staff/recruitment/interviews", action: "Run structured interviews and evaluations", outcome: "Scored evaluations" },
      { path: "/staff/recruitment/offers", action: "Issue and track the offer", outcome: "Offer accepted" },
      { path: "/staff/recruitment/onboarding", action: "Trigger Day-1 launchpad", outcome: "Employee activated" },
    ],
  },
  {
    key: "corporate_self_serve",
    name: "Corporate client — onboarding to invoice settlement",
    persona: "Corporate Administrator",
    executiveOwner: "Chief Commercial Officer",
    outcome: "Funded corporate account with governed employee travel",
    kpi: "corporate_activation_rate",
    steps: [
      { path: "/corporate/login", action: "Sign in to the corporate portal", outcome: "Authenticated session" },
      { path: "/dashboard/corporate", action: "Review the corporate control dashboard", outcome: "Account state visible" },
      { path: "/dashboard/corporate/employees", action: "Invite employees and assign policies", outcome: "Governed travellers" },
      { path: "/dashboard/corporate/wallet", action: "Fund the wallet via M-Pesa", outcome: "Verified wallet credit" },
      { path: "/dashboard/corporate/approvals", action: "Approve trip and spend exceptions", outcome: "Policy enforced" },
      { path: "/dashboard/corporate/invoicing", action: "Reconcile and settle the invoice", outcome: "Invoice settled" },
    ],
  },
  {
    key: "finance_closure",
    name: "Finance — payment to economic closure",
    persona: "Finance Controller",
    executiveOwner: "Chief Financial Officer",
    outcome: "Reconciled, closed financial period",
    kpi: "reconciliation_completeness",
    steps: [
      { path: "/dashboard/admin/finance-center", action: "Review revenue and settlement position", outcome: "Position understood" },
      { path: "/dashboard/admin/reconciliation", action: "Clear reconciliation mismatches", outcome: "Ledger balanced" },
      { path: "/dashboard/admin/payment-ops", action: "Resolve payment failures and DLQ items", outcome: "Payments settled" },
      { path: "/staff/closure", action: "Certify economic closure", outcome: "Period closed with evidence" },
    ],
  },
  {
    key: "driver_activation",
    name: "Driver — application to first earning trip",
    persona: "Driver Partner",
    executiveOwner: "Head of Supply",
    outcome: "Compliant, activated, earning driver",
    kpi: "driver_activation_time",
    steps: [
      { path: "/drivers", action: "Discover the driver value proposition", outcome: "Intent created" },
      { path: "/driver/apply", action: "Submit the application and documents", outcome: "Application captured" },
      { path: "/driver/onboarding", action: "Complete compliance and vehicle checks", outcome: "Documents verified" },
      { path: "/driver/training", action: "Complete academy and assessments", outcome: "Certified driver" },
      { path: "/driver/dashboard", action: "Go online and start earning", outcome: "First trip completed" },
    ],
  },
  {
    key: "rider_booking",
    name: "Rider — discovery to completed ride",
    persona: "Rider",
    executiveOwner: "Chief Customer Officer",
    outcome: "Completed, paid ride",
    kpi: "booking_conversion_rate",
    steps: [
      { path: "/", action: "Discover SAFARID and choose Book SAFARID", outcome: "Booking intent" },
      { path: "/rider", action: "Review rider experience and pricing", outcome: "Confidence to book" },
      { path: "/app/riders", action: "Book a trip with address autocomplete", outcome: "Trip requested" },
      { path: "/rider/trips", action: "Track and complete the trip", outcome: "Trip completed" },
      { path: "/rider/wallet", action: "Settle payment and view receipt", outcome: "Payment settled" },
    ],
  },
  {
    key: "delivery_fulfilment",
    name: "Delivery — order to proof of delivery",
    persona: "Logistics Operations Coordinator",
    executiveOwner: "Head of Delivery & Logistics",
    outcome: "Delivered package with proof of delivery",
    kpi: "on_time_delivery_rate",
    steps: [
      { path: "/delivery", action: "Enter the delivery proposition", outcome: "Intent created" },
      { path: "/delivery/portal", action: "Create the shipment", outcome: "Package booked" },
      { path: "/delivery/ops/dispatch", action: "Assign courier and route", outcome: "Assignment made" },
      { path: "/delivery/ops/routes", action: "Monitor route execution", outcome: "Route progressing" },
      { path: "/delivery/ops/pod", action: "Capture proof of delivery", outcome: "POD recorded" },
    ],
  },
  {
    key: "rentals_charter_booking",
    name: "Rentals & Charter — enquiry to confirmed asset",
    persona: "Corporate Charter Buyer",
    executiveOwner: "Head of Charter & Leasing",
    outcome: "Confirmed charter or lease booking",
    kpi: "charter_quote_to_book_rate",
    steps: [
      { path: "/rentals", action: "Explore rentals and leasing options", outcome: "Requirement shaped" },
      { path: "/rentals/marketplace", action: "Compare assets and indicative pricing", outcome: "Shortlist formed" },
      { path: "/charter/search", action: "Request availability and pricing", outcome: "Quotation requested" },
      { path: "/charter/booking-status", action: "Track approval and confirmation", outcome: "Booking confirmed" },
    ],
  },
  {
    key: "operations_incident",
    name: "Operations — live incident to service restoration",
    persona: "Operations Manager",
    executiveOwner: "Chief Operating Officer",
    outcome: "Incident resolved within SLA with a post-incident record",
    kpi: "incident_resolution_sla",
    steps: [
      { path: "/dashboard/admin/ops-center", action: "Detect the degradation in the live board", outcome: "Signal triaged" },
      { path: "/dashboard/admin/noc-incidents", action: "Open and own the incident", outcome: "Incident tracked" },
      { path: "/dashboard/admin/dispatch", action: "Rebalance supply and reassign trips", outcome: "Service restored" },
      { path: "/staff/org/work", action: "Record actions and follow-ups", outcome: "Post-incident evidence" },
    ],
  },
  {
    key: "trust_safety_case",
    name: "Trust & Safety — signal to enforced decision",
    persona: "Trust & Safety Analyst",
    executiveOwner: "Chief Risk Officer",
    outcome: "Enforced, auditable trust decision",
    kpi: "fraud_loss_rate",
    steps: [
      { path: "/dashboard/admin/trust-center", action: "Review risk posture and signals", outcome: "Priorities set" },
      { path: "/dashboard/admin/fraud-cases", action: "Investigate and decide the case", outcome: "Decision enforced" },
      { path: "/dashboard/admin/security-findings", action: "Confirm platform findings are remediated", outcome: "Findings closed" },
    ],
  },
  {
    key: "executive_review",
    name: "Executive — performance review to intervention",
    persona: "Executive Leadership",
    executiveOwner: "Chief Executive Officer",
    outcome: "Decided and assigned executive intervention",
    kpi: "executive_decision_latency",
    steps: [
      { path: "/dashboard/admin/home", action: "Open command home", outcome: "Daily posture reviewed" },
      { path: "/dashboard/admin/executive", action: "Review revenue, supply and health KPIs", outcome: "Variance identified" },
      { path: "/dashboard/admin/executive-intelligence", action: "Inspect AI recommendations with evidence", outcome: "Recommendation accepted" },
      { path: "/dashboard/admin/navigation-health", action: "Verify platform governance certification", outcome: "Assurance confirmed" },
    ],
  },
  {
    key: "charter_operator_partner",
    name: "Charter operator — partner onboarding to earnings",
    persona: "Charter Operator Partner",
    executiveOwner: "Head of Charter & Leasing",
    outcome: "Active operator earning from fulfilled charters",
    kpi: "operator_utilisation",
    steps: [
      { path: "/charter/login", action: "Sign in to the operator portal", outcome: "Authenticated session" },
      { path: "/dashboard/charter/portal", action: "Maintain fleet, pricing and availability", outcome: "Supply published" },
      { path: "/dashboard/charter/business", action: "Accept and fulfil charter demand", outcome: "Charters fulfilled" },
      { path: "/dashboard/charter/analytics", action: "Review utilisation and settlements", outcome: "Earnings reconciled" },
    ],
  },
];

export interface JourneyCertification {
  key: string;
  name: string;
  persona: string;
  executiveOwner: string;
  outcome: string;
  kpi: string;
  steps: number;
  status: "certified" | "broken";
  issues: string[];
}

export interface JourneyCertificationReport {
  passed: boolean;
  totalJourneys: number;
  certifiedJourneys: number;
  completionPct: number;
  journeys: JourneyCertification[];
}

function canContinue(record: NavGovernanceRecord | undefined): boolean {
  if (!record) return false;
  return record.exitPoints.length > 0 || record.entryPoints.includes("navigation_menu");
}

export function certifyJourneys(
  records: NavGovernanceRecord[] = buildNavigationGovernance(),
): JourneyCertificationReport {
  const routePaths = new Set(ROUTES.map((r) => r.path));
  const byPath = new Map(records.map((r) => [r.path, r]));

  const journeys = BUSINESS_JOURNEYS.map<JourneyCertification>((j) => {
    const issues: string[] = [];
    j.steps.forEach((step, i) => {
      if (!routePaths.has(step.path)) {
        issues.push(`missing_route:${step.path}`);
        return;
      }
      const isTerminal = i === j.steps.length - 1;
      if (!isTerminal && !canContinue(byPath.get(step.path)) && !journeyExceptionFor(step.path)) {
        issues.push(`dead_end:${step.path}`);
      }
    });
    if (!j.executiveOwner) issues.push("no_executive_owner");
    if (!j.kpi) issues.push("no_kpi");

    return {
      key: j.key,
      name: j.name,
      persona: j.persona,
      executiveOwner: j.executiveOwner,
      outcome: j.outcome,
      kpi: j.kpi,
      steps: j.steps.length,
      status: issues.length === 0 ? "certified" : "broken",
      issues,
    };
  });

  const certified = journeys.filter((j) => j.status === "certified").length;
  return {
    passed: certified === journeys.length,
    totalJourneys: journeys.length,
    certifiedJourneys: certified,
    completionPct: Math.round((certified / Math.max(1, journeys.length)) * 100),
    journeys,
  };
}

/**
 * End-to-end marketplace workflow model.
 *
 * TaxiD's value chain is traced as one connected flow:
 * Demand → Customer → Marketplace matching → Resource owner/operator →
 * Service fulfilment → Payment → Customer lifetime value.
 *
 * Each stage declares the question it answers, the records that evidence it,
 * the handoff to the next stage, and the failure modes that break the chain.
 * No stage carries an invented figure — measures are named, and their values
 * come from `dataState` metrics resolved elsewhere.
 */

export type WorkflowStageId =
  | "demand"
  | "customer"
  | "matching"
  | "supply"
  | "fulfilment"
  | "payment"
  | "lifetime_value";

export interface WorkflowStage {
  id: WorkflowStageId;
  label: string;
  question: string;
  description: string;
  /** Record classes that evidence the stage. */
  records: readonly string[];
  /** Named measures for the stage — values resolve from live sources only. */
  measures: readonly string[];
  /** What is handed to the next stage. */
  handoff: string;
  /** Ways the chain breaks here. */
  failureModes: readonly string[];
  owner: string;
}

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  {
    id: "demand",
    label: "Demand",
    question: "Where is mobility demand originating, and of what kind?",
    description:
      "Demand arrives from individual riders, corporate travel programmes, logistics shippers, rental and leasing enquiries and charter requests, through app, web, enterprise portal and sales-assisted channels.",
    records: ["Enquiries", "Quotation requests", "Booking intents", "Corporate trip requests"],
    measures: ["Demand volume by segment", "Demand by geography", "Channel mix", "Unmet demand"],
    handoff: "A qualified request attached to an identified or newly created customer.",
    failureModes: ["Unattributed channel", "Duplicate request", "Demand outside served geography"],
    owner: "Growth & Commercial",
  },
  {
    id: "customer",
    label: "Customer",
    question: "Who is the customer, and what are they entitled to?",
    description:
      "One common customer core with specialised archetypes — individual, corporate, logistics, rental and charter — carrying policy, credit, approval and billing entitlements.",
    records: ["Customer accounts", "Corporate employees", "Policies & approval routes", "Credit terms"],
    measures: ["Active accounts in scope", "Policy compliance rate", "Approval cycle time"],
    handoff: "An authorised, policy-checked request eligible for matching.",
    failureModes: ["Policy violation", "Credit limit exceeded", "Approval never actioned"],
    owner: "Customer Experience & Success",
  },
  {
    id: "matching",
    label: "Marketplace matching",
    question: "Can TaxiD match this demand to verified marketplace supply?",
    description:
      "Dispatch and marketplace matching pair the request with verified independent supply across service, geography, time, vehicle class and compliance state.",
    records: ["Dispatch requests", "Candidate sets", "Offers & acceptances", "Quotations issued"],
    measures: ["Match rate", "Time to match", "Offer acceptance rate", "Fallback to manual"],
    handoff: "An assignment to a specific resource owner or operator.",
    failureModes: ["No verified supply available", "Repeated rejection", "Match outside policy or price floor"],
    owner: "Marketplace & Partner Success",
  },
  {
    id: "supply",
    label: "Resource owner / operator",
    question: "Which independent participant will deliver the service?",
    description:
      "Drivers, fleet owners, operators and logistics partners are independent marketplace participants — never TaxiD assets or employees. Verification, documents and insurance gate participation.",
    records: ["Partner & operator records", "Driver onboarding", "Compliance documents", "Assignments"],
    measures: ["Verified supply availability", "Acceptance behaviour", "Compliance expiry exposure"],
    handoff: "A confirmed, compliant assignment ready for fulfilment.",
    failureModes: ["Expired document", "Insurance lapse", "Assignment abandoned"],
    owner: "Marketplace & Partner Success",
  },
  {
    id: "fulfilment",
    label: "Service fulfilment",
    question: "Was the service delivered to the promised standard?",
    description:
      "Execution across ride, charter, delivery and rental: trip or shipment progress, milestones, proof of delivery, exceptions and service-level adherence.",
    records: ["Trips & shipments", "Milestones & proofs", "Exceptions & incidents", "SLA records"],
    measures: ["Completion rate", "On-time performance", "Exception rate", "Customer-reported quality"],
    handoff: "A completed, priced service event ready for settlement.",
    failureModes: ["Cancellation after assignment", "SLA breach", "Unresolved exception or dispute"],
    owner: "Operations",
  },
  {
    id: "payment",
    label: "Payment",
    question: "Was the service paid for, settled and recognised correctly?",
    description:
      "Collection, corporate invoicing, wallet debits, partner settlement, tax treatment and ledger recognition. Wallet credits arise only from verified payment callbacks; the ledger is append-only.",
    records: ["Payments & callbacks", "Invoices", "Wallet ledger entries", "Settlement batches", "Journals"],
    measures: ["Collection rate", "Days sales outstanding", "Settlement accuracy", "Reconciliation exceptions"],
    handoff: "Recognised revenue, settled supply cost and a reconciled ledger position.",
    failureModes: ["Failed or reversed payment", "Unreconciled callback", "Settlement mismatch", "Chargeback"],
    owner: "Finance",
  },
  {
    id: "lifetime_value",
    label: "Customer lifetime value",
    question: "What is this relationship worth, and where does it go next?",
    description:
      "Lifetime value is computed only from actual platform behaviour — acquisition, frequency, spend, service mix, retention, margin, expansion and renewal — never from an assumed figure.",
    records: ["Transaction history", "Service mix", "Retention & renewal events", "Expansion signals"],
    measures: ["Lifetime value", "Retention rate", "Expansion rate", "Contribution margin", "Churn risk"],
    handoff: "Explained next-best-action signals returned to the demand stage.",
    failureModes: ["Silent disengagement", "Margin erosion", "Renewal missed"],
    owner: "Commercial & Intelligence",
  },
];

export const WORKFLOW_CHAIN = WORKFLOW_STAGES.map((s) => s.label);

/** Service lines that traverse the same chain with different fulfilment shapes. */
export const WORKFLOW_SERVICE_LINES = [
  { label: "Ride hailing", fulfilment: "Driver-delivered trip", payment: "Rider wallet, card or M-Pesa" },
  { label: "Corporate mobility", fulfilment: "Policy-governed trip", payment: "Corporate wallet or invoice" },
  { label: "Delivery & logistics", fulfilment: "Shipment with proof of delivery", payment: "Prepaid or invoiced" },
  { label: "Charter", fulfilment: "Quoted charter movement", payment: "Quotation to settled invoice" },
  { label: "Rental & leasing", fulfilment: "Asset handover and return", payment: "Deposit, term billing" },
] as const;

/** Cross-stage integrity checks that prove the chain is unbroken. */
export const WORKFLOW_INTEGRITY_CHECKS = [
  "Every fulfilled service resolves to exactly one payment record",
  "Every wallet credit traces to a verified payment callback",
  "Every assignment traces to a compliant, verified participant",
  "Every recognised revenue line traces to a balanced journal",
  "Every lifetime-value figure traces to transaction history only",
] as const;

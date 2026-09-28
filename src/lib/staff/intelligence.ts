/**
 * TaxiD Intelligence Layer — contextual intelligence families for Staff 360.
 *
 * There is no generic chatbot. Each family answers a specific class of
 * question, and every recommendation must carry why, evidence, confidence,
 * expected impact, recommended action and an owner. AI never autonomously makes
 * sensitive employment decisions.
 */

export type SignalFamily = "revenue" | "people" | "marketplace" | "organisation";

export interface SignalKind {
  family: SignalFamily;
  label: string;
  question: string;
}

export const SIGNAL_KINDS: SignalKind[] = [
  { family: "revenue", label: "Next best customer", question: "Which customer should we engage next?" },
  { family: "revenue", label: "Next best opportunity", question: "Which opportunity has the highest expected value?" },
  { family: "revenue", label: "Next best action", question: "What is the highest-value action on this account?" },
  { family: "revenue", label: "Next best service", question: "Which TaxiD service should we introduce next?" },
  { family: "revenue", label: "Revenue risk", question: "Where is committed revenue at risk?" },
  { family: "revenue", label: "Expansion signal", question: "Which accounts show expansion behaviour?" },
  { family: "revenue", label: "Churn risk", question: "Which customers are disengaging?" },
  { family: "people", label: "Capability gap", question: "Which capabilities are constrained relative to demand?" },
  { family: "people", label: "Talent opportunity", question: "Who is ready for a larger contribution?" },
  { family: "people", label: "Workforce risk", question: "Where is the organisation under-resourced?" },
  { family: "people", label: "Succession risk", question: "Which critical positions lack a successor?" },
  { family: "people", label: "Learning recommendation", question: "What learning closes a measured gap?" },
  { family: "marketplace", label: "Demand forecast", question: "Where is demand heading by geography and service?" },
  { family: "marketplace", label: "Supply gap", question: "Where is verified marketplace supply constrained?" },
  { family: "marketplace", label: "Liquidity risk", question: "Where might we fail to match demand to supply?" },
  { family: "marketplace", label: "Partner risk", question: "Which operators threaten service quality?" },
  { family: "marketplace", label: "Pricing intelligence", question: "Where do configured prices misalign with demand?" },
  { family: "organisation", label: "Bottleneck", question: "Which function constrains end-to-end flow?" },
  { family: "organisation", label: "Workload imbalance", question: "Where is work unevenly distributed?" },
  { family: "organisation", label: "Key-person dependency", question: "Where is knowledge concentrated in one person?" },
  { family: "organisation", label: "Knowledge risk", question: "Which critical knowledge is undocumented?" },
  { family: "organisation", label: "Organisational scenario", question: "What happens if we change structure or scale?" },
];

export const SIGNAL_FAMILY_LABEL: Record<SignalFamily, string> = {
  revenue: "Revenue AI",
  people: "People AI",
  marketplace: "Marketplace AI",
  organisation: "Organisation AI",
};

/** Mandatory explanation contract for any surfaced recommendation. */
export interface IntelligenceRecommendation {
  kind: string;
  family: SignalFamily;
  summary: string;
  why: string;
  evidence: string[];
  /** 0–1. */
  confidence: number;
  expectedImpact: string;
  recommendedAction: string;
  owner: string;
}

export const RECOMMENDATION_CONTRACT = [
  "Why",
  "Evidence",
  "Confidence",
  "Expected impact",
  "Recommended action",
  "Owner",
] as const;

/**
 * Recommendations require the platform's intelligence services to be wired to
 * live commercial, marketplace and people data. Until a family has a resolved
 * data source, Staff 360 shows the family and its questions with no fabricated
 * output — the honest state per the data principle.
 */
export function recommendationsFor(_family: SignalFamily): IntelligenceRecommendation[] {
  return [];
}

/** Executive attention domains for the Enterprise Intelligence surface. */
export const EXECUTIVE_DOMAINS = [
  { label: "People", detail: "Headcount, capability, talent, leadership, organisational health." },
  { label: "Customers", detail: "Acquisition, retention, satisfaction, lifetime value." },
  { label: "Marketplace", detail: "Demand, supply, liquidity, partners." },
  { label: "Revenue", detail: "Revenue, pipeline, margin, collections, expansion." },
  { label: "Operations", detail: "Fulfilment, SLA, exceptions." },
  { label: "Technology", detail: "Platform health, product performance." },
  { label: "Risk", detail: "Fraud, safety, compliance." },
  { label: "Innovation", detail: "Ideas, pilots, experiments." },
] as const;

/** Customer lifetime value inputs — computed only from actual platform data. */
export const CLV_INPUTS = [
  "Acquisition",
  "Transaction frequency",
  "Average spend",
  "Service mix",
  "Retention",
  "Margin",
  "Expansion",
  "Renewal",
] as const;

/** Organisational digital twin nodes. */
export const TWIN_NODES = [
  "Employees",
  "Positions",
  "Departments",
  "Capabilities",
  "Customers",
  "Revenue",
  "Marketplace",
  "Partners",
  "Projects",
  "Workflows",
  "Systems",
  "Strategic objectives",
] as const;

/**
 * Enterprise Policy Registry — Enterprise Operating Model, Layer 2.
 *
 * Rules answer "should this specific thing happen?". Policies define
 * organizational behaviour: they are versioned, owned, dated, traceable to the
 * rules that enforce them and to the processes they govern.
 *
 * Pure configuration + certification. No state, no network.
 */
import { BUSINESS_RULES, type RuleDomain } from "./rulesEngine";
import { BUSINESS_PROCESS_CATALOG, type ProcessId } from "./processCatalog";

export type PolicyStatus = "draft" | "active" | "superseded";

export interface PolicyVersion {
  version: string;
  effectiveFrom: string;   // ISO date
  status: PolicyStatus;
  changeSummary: string;
  approvedBy: string;
}

export interface EnterprisePolicy {
  id: string;
  name: string;
  domain: RuleDomain | "data" | "corporate" | "ai";
  purpose: string;
  owner: string;
  /** Regulatory or contractual driver, if any. */
  regulatoryBasis?: string;
  /** Statements the organisation commits to. */
  statements: string[];
  /** Business rule IDs that mechanically enforce this policy. */
  enforcedByRules: string[];
  /** Processes governed by this policy. */
  appliesToProcesses: ProcessId[];
  /** Evidence used to prove compliance during audit. */
  evidence: string[];
  reviewCadenceMonths: number;
  lastReviewed: string;    // ISO date
  versions: PolicyVersion[];
}

const v1 = (effectiveFrom: string, approvedBy: string): PolicyVersion[] => [
  { version: "1.0.0", effectiveFrom, status: "active", changeSummary: "Initial ratified policy", approvedBy },
];

export const POLICY_REGISTRY: EnterprisePolicy[] = [
  {
    id: "pol_refund",
    name: "Refund Policy",
    domain: "finance",
    purpose: "Define when refunds are granted, at what value and under which approval authority.",
    owner: "Head of Finance",
    regulatoryBasis: "Consumer Protection Act (Kenya), internal financial controls",
    statements: [
      "Refunds below the auto-approval limit are settled without manual review when evidence is sufficient.",
      "Refunds above the dual-approval threshold require maker-checker by two distinct approvers.",
      "No refund is paid without a linked case and retained evidence.",
      "Refund decisions are irreversible once the wallet credit is posted; corrections require a new adjustment entry.",
    ],
    enforcedByRules: BUSINESS_RULES.filter((r) => r.domain === "finance").map((r) => r.id),
    appliesToProcesses: ["refund_to_resolution", "ride_to_cash"],
    evidence: ["refund_requests", "audit_logs", "wallet_transactions"],
    reviewCadenceMonths: 6,
    lastReviewed: "2026-07-01",
    versions: v1("2026-01-15", "Finance Committee"),
  },
  {
    id: "pol_corporate_travel",
    name: "Corporate Travel Policy",
    domain: "corporate",
    purpose: "Govern which corporate trips are permitted, funded and billable.",
    owner: "Head of Corporate",
    statements: [
      "Every corporate trip must carry a trip intent and a valid cost centre.",
      "Corporate trips are only authorised against a pre-funded wallet balance.",
      "Out-of-policy trips are booked to the personal wallet, never the corporate wallet.",
      "Corporate administrators can restrict hours, zones and vehicle classes per cost centre.",
    ],
    enforcedByRules: [],
    appliesToProcesses: ["booking_to_settlement", "corporate_lead_to_invoice"],
    evidence: ["trip_bookings", "corporate_wallets", "cost_centers"],
    reviewCadenceMonths: 12,
    lastReviewed: "2026-06-01",
    versions: v1("2026-02-01", "Corporate Governance Board"),
  },
  {
    id: "pol_driver_suspension",
    name: "Driver Suspension Policy",
    domain: "trust_safety",
    purpose: "Define grounds, duration and due process for suspending a driver.",
    owner: "Head of Trust & Safety",
    regulatoryBasis: "NTSA TNC regulations",
    statements: [
      "Critical safety allegations trigger immediate precautionary suspension pending investigation.",
      "Every suspension records a reason code, an evidence reference and a review date.",
      "Drivers are notified and may appeal; appeals are decided by a reviewer who did not issue the suspension.",
      "Expired compliance documents suspend dispatch eligibility, not the account.",
    ],
    enforcedByRules: BUSINESS_RULES.filter((r) => r.domain === "trust_safety").map((r) => r.id),
    appliesToProcesses: ["driver_onboard_to_active", "support_to_closure"],
    evidence: ["driver_suspensions", "support_cases", "audit_logs"],
    reviewCadenceMonths: 6,
    lastReviewed: "2026-07-01",
    versions: v1("2026-01-20", "Trust & Safety Board"),
  },
  {
    id: "pol_pricing",
    name: "Pricing & Surge Policy",
    domain: "finance",
    purpose: "Bound fare construction, surge multipliers and promotional discounting.",
    owner: "Head of Marketplace",
    statements: [
      "Surge multipliers are capped and every applied multiplier is logged with its trigger.",
      "Quoted fares are binding; upward recomputation after trip completion is prohibited.",
      "Promotions must declare a budget, an audience and an end date.",
    ],
    enforcedByRules: [],
    appliesToProcesses: ["ride_to_cash", "delivery_to_cash"],
    evidence: ["fare_quotes", "surge_events", "promotions"],
    reviewCadenceMonths: 3,
    lastReviewed: "2026-07-01",
    versions: v1("2026-03-01", "Pricing Committee"),
  },
  {
    id: "pol_data_retention",
    name: "Data Retention & Privacy Policy",
    domain: "data",
    purpose: "Define how long each data class is retained and who may access it.",
    owner: "Data Protection Officer",
    regulatoryBasis: "Kenya Data Protection Act 2019",
    statements: [
      "Financial records are retained for 7 years; operational telemetry for 90 days.",
      "Personal data is minimised in events; identifiers are referenced, never duplicated.",
      "Restricted-classification events are accessible only to roles with an audited business need.",
      "Deletion requests are honoured except where a legal retention obligation applies.",
    ],
    enforcedByRules: [],
    appliesToProcesses: ["support_to_closure", "corporate_lead_to_invoice"],
    evidence: ["event registry retention settings", "RLS policies", "audit_logs"],
    reviewCadenceMonths: 12,
    lastReviewed: "2026-05-01",
    versions: v1("2026-01-10", "Executive Committee"),
  },
  {
    id: "pol_delivery_sla",
    name: "Delivery Service Level Policy",
    domain: "delivery",
    purpose: "Define promised delivery windows, exception handling and partner accountability.",
    owner: "Head of Delivery & Logistics",
    statements: [
      "Every order carries a committed delivery window at dispatch.",
      "SLA breaches raise an exception within 15 minutes and notify the customer.",
      "Partners below the on-time floor for two consecutive periods enter remediation.",
    ],
    enforcedByRules: BUSINESS_RULES.filter((r) => r.domain === "delivery").map((r) => r.id),
    appliesToProcesses: ["delivery_to_cash"],
    evidence: ["delivery_orders", "delivery_exceptions", "partner scorecards"],
    reviewCadenceMonths: 6,
    lastReviewed: "2026-06-15",
    versions: v1("2026-02-10", "Operations Board"),
  },
  {
    id: "pol_customer_resolution",
    name: "Customer Resolution Policy",
    domain: "customer_operations",
    purpose: "Define response commitments, escalation authority and closure standards.",
    owner: "Head of Customer Operations",
    statements: [
      "Safety cases are answered within 5 minutes, 24/7.",
      "No case closes without a disposition and a root cause.",
      "Goodwill credits above the agent limit require supervisor approval.",
    ],
    enforcedByRules: BUSINESS_RULES.filter((r) => r.domain === "customer_operations").map((r) => r.id),
    appliesToProcesses: ["support_to_closure", "refund_to_resolution"],
    evidence: ["support_cases", "support_sla_policies", "support_case_events"],
    reviewCadenceMonths: 6,
    lastReviewed: "2026-07-10",
    versions: v1("2026-02-05", "Operations Board"),
  },
  {
    id: "pol_ai_use",
    name: "Responsible AI Use Policy",
    domain: "ai",
    purpose: "Define where AI may act, with what confidence and under what human oversight.",
    owner: "Chief Technology Officer",
    statements: [
      "AI never issues an irreversible financial or safety decision without human confirmation.",
      "Every AI-assisted decision records model, version, confidence and inputs.",
      "Low-confidence outputs fall back to the deterministic rule path.",
      "AI use cases are registered before deployment and reviewed quarterly.",
    ],
    enforcedByRules: [],
    appliesToProcesses: ["support_to_closure", "refund_to_resolution", "delivery_to_cash"],
    evidence: ["ai decision log", "AI governance registry", "audit_logs"],
    reviewCadenceMonths: 3,
    lastReviewed: "2026-07-20",
    versions: v1("2026-04-01", "Executive Committee"),
  },
];

export interface PolicyIssue {
  policy: string;
  severity: "p0" | "p1" | "p2";
  message: string;
}

export interface PolicyRegistryReport {
  passed: boolean;
  score: number;
  policies: number;
  activePolicies: number;
  overdueReviews: string[];
  unenforcedPolicies: string[];
  issues: PolicyIssue[];
}

const KNOWN_RULES = new Set(BUSINESS_RULES.map((r) => r.id));
const KNOWN_PROCESSES = new Set(BUSINESS_PROCESS_CATALOG.map((p) => p.id as string));

function monthsSince(iso: string, now: Date): number {
  const then = new Date(iso);
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

export function certifyPolicyRegistry(
  policies: EnterprisePolicy[] = POLICY_REGISTRY,
  now: Date = new Date(),
): PolicyRegistryReport {
  const issues: PolicyIssue[] = [];
  const overdueReviews: string[] = [];
  const unenforcedPolicies: string[] = [];
  let active = 0;

  for (const p of policies) {
    const activeVersions = p.versions.filter((v) => v.status === "active");
    if (activeVersions.length === 0) issues.push({ policy: p.id, severity: "p0", message: "no active version" });
    if (activeVersions.length > 1) issues.push({ policy: p.id, severity: "p0", message: "more than one active version" });
    if (activeVersions.length === 1) active += 1;

    if (!p.owner.trim()) issues.push({ policy: p.id, severity: "p0", message: "no accountable owner" });
    if (p.statements.length === 0) issues.push({ policy: p.id, severity: "p0", message: "policy declares no statements" });
    if (p.evidence.length === 0) issues.push({ policy: p.id, severity: "p1", message: "no audit evidence declared" });

    for (const r of p.enforcedByRules) {
      if (!KNOWN_RULES.has(r)) issues.push({ policy: p.id, severity: "p1", message: `references unknown rule '${r}'` });
    }
    for (const pr of p.appliesToProcesses) {
      if (!KNOWN_PROCESSES.has(pr)) issues.push({ policy: p.id, severity: "p1", message: `references unknown process '${pr}'` });
    }
    if (p.enforcedByRules.length === 0) {
      unenforcedPolicies.push(p.id);
      issues.push({ policy: p.id, severity: "p2", message: "no mechanical rule enforcement — compliance is manual" });
    }
    if (monthsSince(p.lastReviewed, now) > p.reviewCadenceMonths) {
      overdueReviews.push(p.id);
      issues.push({ policy: p.id, severity: "p1", message: `review overdue (cadence ${p.reviewCadenceMonths}m)` });
    }
  }

  const p0 = issues.filter((i) => i.severity === "p0").length;
  const p1 = issues.filter((i) => i.severity === "p1").length;
  const p2 = issues.filter((i) => i.severity === "p2").length;
  const score = Math.max(0, 100 - p0 * 30 - p1 * 7 - p2 * 2);

  return {
    passed: p0 === 0,
    score,
    policies: policies.length,
    activePolicies: active,
    overdueReviews,
    unenforcedPolicies,
    issues,
  };
}

export function policiesForProcess(process: ProcessId): EnterprisePolicy[] {
  return POLICY_REGISTRY.filter((p) => p.appliesToProcesses.includes(process));
}

/**
 * Enterprise Business Rules Engine.
 *
 * Configuration-driven policy evaluation: thresholds, auto-approval limits and
 * routing live as data, not code. Callers submit a fact set; the engine returns
 * the winning decision plus a full explainable trace of every rule considered.
 *
 * Pure functions. No network, no state, no side effects.
 */

export const RULE_DOMAINS = [
  "finance",
  "customer_operations",
  "delivery",
  "trust_safety",
  "fleet",
  "mobility",
  "corporate",
  "marketplace",
] as const;

export type RuleDomain = (typeof RULE_DOMAINS)[number];

export type RuleOutcome =
  | "auto_approve"
  | "require_approval"
  | "require_dual_approval"
  | "escalate"
  | "reject"
  | "route";

export type Comparator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "exists";

export interface RuleCondition {
  fact: string;
  op: Comparator;
  value?: string | number | boolean | Array<string | number>;
}

export interface BusinessRule {
  id: string;
  domain: RuleDomain;
  name: string;
  /** Higher priority wins when several rules match. */
  priority: number;
  /** All conditions must hold (AND). Use several rules for OR. */
  when: RuleCondition[];
  outcome: RuleOutcome;
  /** Owning team / approver group for the resulting action. */
  owner: string;
  rationale: string;
  /** Free-form policy parameters surfaced to the caller (limits, tiers, SLAs). */
  params?: Record<string, string | number>;
}

export type FactValue = string | number | boolean | null | undefined;
export type FactSet = Record<string, FactValue>;

function matches(cond: RuleCondition, facts: FactSet): boolean {
  const actual = facts[cond.fact];
  switch (cond.op) {
    case "exists": return actual !== undefined && actual !== null;
    case "eq": return actual === cond.value;
    case "neq": return actual !== cond.value;
    case "lt": return typeof actual === "number" && typeof cond.value === "number" && actual < cond.value;
    case "lte": return typeof actual === "number" && typeof cond.value === "number" && actual <= cond.value;
    case "gt": return typeof actual === "number" && typeof cond.value === "number" && actual > cond.value;
    case "gte": return typeof actual === "number" && typeof cond.value === "number" && actual >= cond.value;
    case "in": return Array.isArray(cond.value) && (cond.value as Array<string | number>).includes(actual as string | number);
    case "not_in": return Array.isArray(cond.value) && !(cond.value as Array<string | number>).includes(actual as string | number);
    default: return false;
  }
}

export interface RuleEvaluation {
  rule: BusinessRule;
  matched: boolean;
  failedConditions: string[];
}

export interface PolicyDecision {
  outcome: RuleOutcome;
  /** Rule that produced the decision, or null when the default applied. */
  ruleId: string | null;
  owner: string;
  rationale: string;
  params: Record<string, string | number>;
  /** Every rule considered, for audit/explainability. */
  trace: RuleEvaluation[];
}

/**
 * Canonical policy inventory. Add rules here — never branch in callers.
 */
export const BUSINESS_RULES: readonly BusinessRule[] = [
  // ── Finance · refunds ─────────────────────────────────────────────────────
  {
    id: "fin.refund.corporate_gold_auto",
    domain: "finance",
    name: "Corporate Gold refunds auto-approve under KES 50,000",
    priority: 90,
    when: [
      { fact: "account_tier", op: "eq", value: "corporate_gold" },
      { fact: "amount_kes", op: "lte", value: 50000 },
      { fact: "fraud_score", op: "lt", value: 40 },
    ],
    outcome: "auto_approve",
    owner: "finance_ops",
    rationale: "Contracted enterprise tier with low fraud exposure and a capped ticket size.",
    params: { limit_kes: 50000, sla_minutes: 60 },
  },
  {
    id: "fin.refund.retail_auto",
    domain: "finance",
    name: "Retail refunds auto-approve under KES 2,000",
    priority: 70,
    when: [
      { fact: "amount_kes", op: "lte", value: 2000 },
      { fact: "fraud_score", op: "lt", value: 50 },
      { fact: "evidence_confidence", op: "gte", value: 70 },
    ],
    outcome: "auto_approve",
    owner: "customer_ops",
    rationale: "Low-value, evidence-backed refunds cost more to review than to pay.",
    params: { limit_kes: 2000, sla_minutes: 30 },
  },
  {
    id: "fin.refund.high_value_dual",
    domain: "finance",
    name: "Refunds over KES 100,000 require dual approval",
    priority: 95,
    when: [{ fact: "amount_kes", op: "gt", value: 100000 }],
    outcome: "require_dual_approval",
    owner: "finance_controller",
    rationale: "Material financial exposure requires maker-checker plus controller sign-off.",
    params: { approvers: 2, sla_minutes: 240 },
  },
  {
    id: "fin.refund.fraud_block",
    domain: "finance",
    name: "High fraud score blocks refund execution",
    priority: 99,
    when: [{ fact: "fraud_score", op: "gte", value: 80 }],
    outcome: "escalate",
    owner: "trust_safety",
    rationale: "Fraud engine confidence is high enough to require investigation before payout.",
    params: { queue: "fraud_investigation", sla_minutes: 120 },
  },

  // ── Customer operations ───────────────────────────────────────────────────
  {
    id: "cops.safety.immediate_escalation",
    domain: "customer_operations",
    name: "Safety cases escalate immediately",
    priority: 99,
    when: [{ fact: "case_type", op: "in", value: ["safety_incident", "harassment", "accident"] }],
    outcome: "escalate",
    owner: "trust_safety",
    rationale: "Safety-of-life cases bypass queueing and route to the on-call safety tier.",
    params: { tier: "T2", response_minutes: 5 },
  },
  {
    id: "cops.evidence.insufficient",
    domain: "customer_operations",
    name: "Insufficient evidence requires human review",
    priority: 60,
    when: [{ fact: "evidence_confidence", op: "lt", value: 60 }],
    outcome: "require_approval",
    owner: "customer_ops",
    rationale: "Decision confidence below threshold — an agent must gather missing evidence.",
    params: { sla_minutes: 120 },
  },

  // ── Delivery ──────────────────────────────────────────────────────────────
  {
    id: "del.sla_breach.route_ops",
    domain: "delivery",
    name: "SLA-breached shipments route to dispatch control",
    priority: 85,
    when: [{ fact: "sla_state", op: "eq", value: "breached" }],
    outcome: "route",
    owner: "dispatch_control",
    rationale: "Breached deliveries need active recovery, not passive queueing.",
    params: { queue: "dispatch_recovery", response_minutes: 15 },
  },
  {
    id: "del.pod_missing.investigate",
    domain: "delivery",
    name: "Delivered parcels without POD open an investigation",
    priority: 80,
    when: [
      { fact: "delivery_state", op: "eq", value: "delivered" },
      { fact: "pod_present", op: "eq", value: false },
    ],
    outcome: "escalate",
    owner: "logistics_ops",
    rationale: "Chain-of-custody gap: delivery cannot be certified without proof.",
    params: { queue: "parcel_investigation", sla_minutes: 240 },
  },

  // ── Trust & Safety ────────────────────────────────────────────────────────
  {
    id: "ts.safety.sos_immediate",
    domain: "trust_safety",
    name: "SOS or severe safety signal escalates immediately",
    priority: 99,
    when: [{ fact: "safety_severity", op: "in", value: ["critical", "severe"] }],
    outcome: "escalate",
    owner: "safety_duty_manager",
    rationale: "Physical safety outranks every other queue; response is measured in minutes.",
    params: { queue: "safety_response", sla_minutes: 5 },
  },
  {
    id: "ts.fraud.high_score_dual",
    domain: "trust_safety",
    name: "High-confidence fraud enforcement requires dual approval",
    priority: 90,
    when: [
      { fact: "fraud_score", op: "gte", value: 80 },
      { fact: "enforcement", op: "eq", value: "permanent_ban" },
    ],
    outcome: "require_dual_approval",
    owner: "trust_safety_lead",
    rationale: "Permanent removal is irreversible and must survive an appeal review.",
    params: { approvers: 2, sla_minutes: 240 },
  },
  {
    id: "ts.fraud.low_score_auto_release",
    domain: "trust_safety",
    name: "Low-score signals with clean history auto-release",
    priority: 60,
    when: [
      { fact: "fraud_score", op: "lt", value: 30 },
      { fact: "prior_confirmed_cases", op: "eq", value: 0 },
    ],
    outcome: "auto_approve",
    owner: "trust_safety",
    rationale: "Noise suppression: unsupported low-score signals consume analyst capacity.",
    params: { sla_minutes: 15 },
  },
  {
    id: "ts.conduct.repeat_offender_route",
    domain: "trust_safety",
    name: "Repeat conduct offenders route to the conduct panel",
    priority: 80,
    when: [{ fact: "prior_confirmed_cases", op: "gte", value: 3 }],
    outcome: "route",
    owner: "conduct_panel",
    rationale: "Pattern behaviour needs a panel decision, not another single-case warning.",
    params: { queue: "conduct_panel", sla_minutes: 1440 },
  },

  // ── Fleet ─────────────────────────────────────────────────────────────────
  {
    id: "fleet.compliance.expired_block",
    domain: "fleet",
    name: "Expired compliance documents block driver availability",
    priority: 99,
    when: [{ fact: "document_state", op: "eq", value: "expired" }],
    outcome: "reject",
    owner: "compliance_officer",
    rationale: "Operating with expired documents is a regulatory and insurance breach.",
    params: { action: "availability_block", sla_minutes: 60 },
  },
  {
    id: "fleet.compliance.expiring_soon_route",
    domain: "fleet",
    name: "Documents expiring within 30 days route to compliance review",
    priority: 70,
    when: [
      { fact: "days_to_expiry", op: "lte", value: 30 },
      { fact: "days_to_expiry", op: "gt", value: 0 },
    ],
    outcome: "route",
    owner: "compliance_ops",
    rationale: "Renewal lead time prevents avoidable availability loss.",
    params: { queue: "compliance_renewals", sla_minutes: 2880 },
  },
  {
    id: "fleet.defect.severe_ground_vehicle",
    domain: "fleet",
    name: "Severe vehicle defects ground the asset",
    priority: 95,
    when: [{ fact: "defect_severity", op: "eq", value: "severe" }],
    outcome: "escalate",
    owner: "maintenance_lead",
    rationale: "An unsafe vehicle must leave service before the next assignment.",
    params: { queue: "maintenance_urgent", sla_minutes: 240 },
  },
  {
    id: "fleet.activation.auto_approve",
    domain: "fleet",
    name: "Fully verified applicants activate automatically",
    priority: 65,
    when: [
      { fact: "documents_verified", op: "eq", value: true },
      { fact: "inspection_result", op: "eq", value: "pass" },
      { fact: "training_complete", op: "eq", value: true },
    ],
    outcome: "auto_approve",
    owner: "fleet_ops",
    rationale: "Every gating control has already passed; manual activation adds delay, not assurance.",
    params: { sla_minutes: 60 },
  },

  // ── Mobility · dispatch & surge ───────────────────────────────────────────
  {
    id: "mob.surge.auto_publish",
    domain: "mobility",
    name: "Surge multipliers up to 1.8x auto-publish",
    priority: 90,
    when: [
      { fact: "surge_multiplier", op: "lte", value: 1.8 },
      { fact: "supply_demand_ratio", op: "lt", value: 0.8 },
      { fact: "zone_incident_open", op: "eq", value: false },
    ],
    outcome: "auto_approve",
    owner: "dispatch_ops",
    rationale: "Within the published fare envelope and justified by a measured supply shortfall.",
    params: { max_multiplier: 1.8, review_minutes: 15 },
  },
  {
    id: "mob.surge.high_multiplier_approval",
    domain: "mobility",
    name: "Surge above 1.8x requires dispatch approval",
    priority: 95,
    when: [{ fact: "surge_multiplier", op: "gt", value: 1.8 }],
    outcome: "require_approval",
    owner: "dispatch_ops",
    rationale: "Fare-fairness exposure grows non-linearly above the published envelope.",
    params: { sla_minutes: 10 },
  },
  {
    id: "mob.trip.gps_integrity_escalate",
    domain: "mobility",
    name: "GPS-integrity anomalies escalate before fare capture",
    priority: 98,
    when: [{ fact: "gps_integrity_score", op: "lt", value: 60 }],
    outcome: "escalate",
    owner: "trust_safety",
    rationale: "A degraded trip trace cannot substantiate distance-based fare or dispute evidence.",
    params: { hold_fare: 1, sla_minutes: 30 },
  },
  {
    id: "mob.dispatch.manual_override_dual",
    domain: "mobility",
    name: "Manual dispatch override outside ranked candidates needs dual approval",
    priority: 92,
    when: [
      { fact: "manual_override", op: "eq", value: true },
      { fact: "candidate_rank", op: "gt", value: 3 },
    ],
    outcome: "require_dual_approval",
    owner: "dispatch_ops",
    rationale: "Overriding the ranking engine bypasses fairness and reliability controls.",
    params: { sla_minutes: 15 },
  },

  // ── Corporate · spend & KYB ───────────────────────────────────────────────
  {
    id: "corp.trip.within_policy_auto",
    domain: "corporate",
    name: "In-policy corporate trips auto-approve against a funded budget",
    priority: 90,
    when: [
      { fact: "policy_violation", op: "eq", value: false },
      { fact: "budget_remaining_kes", op: "gte", value: 0 },
      { fact: "kyb_status", op: "eq", value: "verified" },
    ],
    outcome: "auto_approve",
    owner: "corporate_ops",
    rationale: "Policy, budget and KYB controls have all passed; approval adds no assurance.",
    params: { sla_minutes: 5 },
  },
  {
    id: "corp.budget.exhausted_reject",
    domain: "corporate",
    name: "Reject corporate dispatch when the reserved budget is exhausted",
    priority: 97,
    when: [{ fact: "budget_remaining_kes", op: "lt", value: 0 }],
    outcome: "reject",
    owner: "corporate_ops",
    rationale: "Spend beyond the reservation is unrecoverable and drives invoice disputes.",
    params: {},
  },
  {
    id: "corp.kyb.expired_escalate",
    domain: "corporate",
    name: "Expired KYB documents escalate to compliance",
    priority: 99,
    when: [{ fact: "kyb_status", op: "in", value: ["expired", "suspended"] }],
    outcome: "escalate",
    owner: "compliance",
    rationale: "Billing an account with lapsed KYB evidence is a regulatory exposure.",
    params: { sla_minutes: 60 },
  },
  {
    id: "corp.spend.anomaly_review",
    domain: "corporate",
    name: "Spend anomalies above 3x the cost-centre baseline require review",
    priority: 93,
    when: [{ fact: "spend_vs_baseline", op: "gte", value: 3 }],
    outcome: "require_approval",
    owner: "corporate_ops",
    rationale: "Sharp deviation from the cost-centre baseline is the leading abuse signal.",
    params: { sla_minutes: 120 },
  },

  // ── Marketplace · incentives & partner health ────────────────────────────
  {
    id: "mkt.incentive.small_budget_auto",
    domain: "marketplace",
    name: "Zone incentives under KES 100,000 auto-approve",
    priority: 88,
    when: [
      { fact: "incentive_budget_kes", op: "lte", value: 100000 },
      { fact: "zone_coverage_pct", op: "lt", value: 85 },
      { fact: "partner_integrity_flag", op: "eq", value: false },
    ],
    outcome: "auto_approve",
    owner: "marketplace_ops",
    rationale: "Bounded spend against a measured coverage gap with no integrity flag open.",
    params: { limit_kes: 100000 },
  },
  {
    id: "mkt.incentive.large_budget_dual",
    domain: "marketplace",
    name: "Zone incentives above KES 500,000 require dual approval",
    priority: 96,
    when: [{ fact: "incentive_budget_kes", op: "gt", value: 500000 }],
    outcome: "require_dual_approval",
    owner: "marketplace_ops",
    rationale: "Large incentive envelopes materially move unit economics and need finance sign-off.",
    params: { sla_minutes: 240 },
  },
  {
    id: "mkt.partner.gaming_escalate",
    domain: "marketplace",
    name: "Incentive-gaming signals escalate to trust & safety",
    priority: 98,
    when: [{ fact: "partner_integrity_flag", op: "eq", value: true }],
    outcome: "escalate",
    owner: "trust_safety",
    rationale: "Paying an incentive on gamed supply compounds the loss and rewards the behaviour.",
    params: { hold_payout: 1, sla_minutes: 60 },
  },
  {
    id: "mkt.commission.out_of_band_review",
    domain: "marketplace",
    name: "Commission outside the 10–25% band requires review",
    priority: 91,
    when: [{ fact: "commission_pct", op: "not_in", value: [10, 15, 18, 20, 25] }],
    outcome: "require_approval",
    owner: "finance_ops",
    rationale: "Commission outside the published band breaks partner-contract parity.",
    params: { sla_minutes: 120 },
  },
] as const;


export const DEFAULT_DECISION: Omit<PolicyDecision, "trace"> = {
  outcome: "require_approval",
  ruleId: null,
  owner: "customer_ops",
  rationale: "No policy matched — safe default is human review.",
  params: {},
};

export function evaluatePolicy(domain: RuleDomain, facts: FactSet): PolicyDecision {
  const candidates = BUSINESS_RULES.filter((r) => r.domain === domain);
  const trace: RuleEvaluation[] = candidates.map((rule) => {
    const failed = rule.when.filter((c) => !matches(c, facts)).map((c) => `${c.fact} ${c.op} ${String(c.value ?? "")}`.trim());
    return { rule, matched: failed.length === 0, failedConditions: failed };
  });

  const winner = trace
    .filter((t) => t.matched)
    .sort((a, b) => b.rule.priority - a.rule.priority)[0];

  if (!winner) return { ...DEFAULT_DECISION, trace };

  return {
    outcome: winner.rule.outcome,
    ruleId: winner.rule.id,
    owner: winner.rule.owner,
    rationale: winner.rule.rationale,
    params: winner.rule.params ?? {},
    trace,
  };
}

/** Inventory used by the maturity gate: rule count per domain. */
export function ruleInventory(): Record<RuleDomain, number> {
  const acc = Object.fromEntries(RULE_DOMAINS.map((d) => [d, 0])) as Record<RuleDomain, number>;
  for (const r of BUSINESS_RULES) acc[r.domain] += 1;
  return acc;
}

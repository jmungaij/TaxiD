/**
 * Customer Operations — analytics intelligence.
 *
 * Deterministic aggregation over the loaded case set: root-cause analysis,
 * workforce intelligence, executive decision-support answers, predictive
 * operations signals and knowledge suggestions. No backend AI.
 */
import { CASE_TYPES, classifyCase, type CaseType } from "./taxonomy";

export interface AnalyticsCase {
  id: string;
  case_number: string;
  subject: string;
  description: string | null;
  category: string;
  channel: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  assigned_team: string | null;
  corporate_account_id: string | null;
  requester_user_id: string | null;
  requester_email: string | null;
  fraud_risk_score: number;
  escalation_level: number;
  sla_resolution_breached: boolean;
  sla_resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  tags: string[];
}

const OPEN = new Set(["new", "triaged", "assigned", "in_progress", "pending_customer", "pending_approval", "escalated"]);
export const isOpen = (c: AnalyticsCase) => OPEN.has(c.status);

const mins = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);

/* ----------------------------- root cause -------------------------------- */

export interface RootCauseRow {
  type: CaseType;
  label: string;
  count: number;
  share: number;
  breached: number;
  /** Week-over-week direction from the loaded window. */
  trend: "up" | "down" | "flat";
  delta: number;
  recommendation: string;
}

const RECOMMENDATIONS: Record<CaseType, string> = {
  fraud: "Tighten fraud rules for the dominant device/channel pattern and pre-verify high-risk payouts.",
  driver_conduct: "Enrol repeat-offending drivers into Academy conduct modules before reassignment.",
  lost_parcel: "Enforce warehouse scan completeness and mandatory OTP capture at handover.",
  delayed_ride: "Publish the supply gap to Marketplace and pre-position incentives in affected zones.",
  payment_issue: "Reduce STK timeout failures via retry tuning and DLQ auto-replay.",
  refund_dispute: "Automate refund eligibility checks to cut manual dispute volume.",
  corporate_policy: "Clarify policy rules and approval routing in the corporate onboarding pack.",
  safety_incident: "Increase pre-trip safety screening and re-train drivers flagged by trust scores.",
  vehicle_issue: "Shorten inspection intervals for vehicles generating repeated defect reports.",
  delivery_failure: "Validate addresses at booking and rebalance courier load in peak windows.",
  general_enquiry: "Publish self-service knowledge articles for the top repeated questions.",
};

export function rootCauseAnalysis(cases: AnalyticsCase[]): RootCauseRow[] {
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  const buckets = new Map<CaseType, { count: number; breached: number; recent: number; prior: number }>();

  for (const c of cases) {
    const t = classifyCase({ subject: c.subject, description: c.description, category: c.category, channel: c.channel }).type;
    const b = buckets.get(t) ?? { count: 0, breached: 0, recent: 0, prior: 0 };
    b.count++;
    if (c.sla_resolution_breached) b.breached++;
    const age = now - new Date(c.created_at).getTime();
    if (age <= week) b.recent++;
    else if (age <= 2 * week) b.prior++;
    buckets.set(t, b);
  }

  const total = cases.length || 1;
  return [...buckets.entries()]
    .map(([type, b]) => {
      const delta = b.recent - b.prior;
      return {
        type,
        label: CASE_TYPES.find((t) => t.type === type)?.label ?? type,
        count: b.count,
        share: Math.round((b.count / total) * 100),
        breached: b.breached,
        trend: (delta > 0 ? "up" : delta < 0 ? "down" : "flat") as RootCauseRow["trend"],
        delta,
        recommendation: RECOMMENDATIONS[type],
      };
    })
    .sort((a, b) => b.count - a.count);
}

/* -------------------------- workforce intelligence ------------------------ */

export interface AgentPerformance {
  agent: string;
  assigned: number;
  open: number;
  resolved: number;
  escalated: number;
  breached: number;
  avgHandleMinutes: number | null;
  slaCompliance: number;
  utilisation: number;
}

export function workforceIntelligence(cases: AnalyticsCase[], capacityPerAgent = 12): AgentPerformance[] {
  const map = new Map<string, AnalyticsCase[]>();
  for (const c of cases) {
    const key = c.assigned_to ?? "unassigned";
    map.set(key, [...(map.get(key) ?? []), c]);
  }
  return [...map.entries()]
    .map(([agent, list]) => {
      const resolvedList = list.filter((c) => c.resolved_at);
      const handled = resolvedList.map((c) => mins(c.created_at, c.resolved_at!));
      const breached = list.filter((c) => c.sla_resolution_breached).length;
      const open = list.filter(isOpen).length;
      return {
        agent,
        assigned: list.length,
        open,
        resolved: resolvedList.length,
        escalated: list.filter((c) => c.escalation_level > 0).length,
        breached,
        avgHandleMinutes: handled.length ? Math.round(handled.reduce((a, b) => a + b, 0) / handled.length) : null,
        slaCompliance: list.length ? Math.round(((list.length - breached) / list.length) * 100) : 100,
        utilisation: Math.min(200, Math.round((open / capacityPerAgent) * 100)),
      };
    })
    .sort((a, b) => b.assigned - a.assigned);
}

export interface TeamPerformance {
  team: string;
  cases: number;
  open: number;
  slaCompliance: number;
  escalationRate: number;
}

export function teamIntelligence(cases: AnalyticsCase[]): TeamPerformance[] {
  const map = new Map<string, AnalyticsCase[]>();
  for (const c of cases) {
    const key = c.assigned_team ?? "Unrouted";
    map.set(key, [...(map.get(key) ?? []), c]);
  }
  return [...map.entries()]
    .map(([team, list]) => {
      const breached = list.filter((c) => c.sla_resolution_breached).length;
      return {
        team,
        cases: list.length,
        open: list.filter(isOpen).length,
        slaCompliance: Math.round(((list.length - breached) / list.length) * 100),
        escalationRate: Math.round((list.filter((c) => c.escalation_level > 0).length / list.length) * 100),
      };
    })
    .sort((a, b) => b.cases - a.cases);
}

/* --------------------------- executive insights --------------------------- */

export interface ExecutiveInsight {
  question: string;
  answer: string;
  evidence: string;
}

export function executiveInsights(cases: AnalyticsCase[]): ExecutiveInsight[] {
  if (cases.length === 0) return [];
  const rc = rootCauseAnalysis(cases);
  const top = rc[0];
  const rising = rc.filter((r) => r.trend === "up").sort((a, b) => b.delta - a.delta)[0];

  const byCorp = new Map<string, number>();
  cases.forEach((c) => { if (c.corporate_account_id) byCorp.set(c.corporate_account_id, (byCorp.get(c.corporate_account_id) ?? 0) + 1); });
  const topCorp = [...byCorp.entries()].sort((a, b) => b[1] - a[1])[0];

  const byChannel = new Map<string, number>();
  cases.forEach((c) => byChannel.set(c.channel, (byChannel.get(c.channel) ?? 0) + 1));
  const topChannel = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0];

  const breached = cases.filter((c) => c.sla_resolution_breached).length;
  const disputes = cases.filter((c) => /refund|dispute|chargeback/i.test(c.subject)).length;

  const out: ExecutiveInsight[] = [
    {
      question: "Why are complaints increasing?",
      answer: rising
        ? `${rising.label} volume rose by ${rising.delta} case(s) week-over-week and now represents ${rising.share}% of all cases.`
        : "No case category is trending up in the loaded window.",
      evidence: "Root cause distribution, 7d vs prior 7d",
    },
    {
      question: "What drives the most support load?",
      answer: `${top.label} — ${top.count} cases (${top.share}%), ${top.breached} of them SLA-breached.`,
      evidence: "Deterministic classification over support_cases",
    },
    {
      question: "Which corporate client consumes the most support resource?",
      answer: topCorp ? `Account ${topCorp[0].slice(0, 8)}… with ${topCorp[1]} case(s).` : "No corporate-attributed cases in the window.",
      evidence: "support_cases.corporate_account_id",
    },
    {
      question: "Where is demand entering the organisation?",
      answer: topChannel ? `${topChannel[0]} is the dominant channel with ${topChannel[1]} case(s).` : "No channel data.",
      evidence: "support_cases.channel",
    },
    {
      question: "What operational change would reduce tickets fastest?",
      answer: `${top.recommendation} Addressing ${top.label} alone targets ${top.share}% of total volume.`,
      evidence: "Root cause recommendation engine",
    },
    {
      question: "What is our current SLA and dispute exposure?",
      answer: `${breached} SLA breach(es) and ${disputes} financial dispute(s) in the loaded window.`,
      evidence: "support_cases SLA flags + subject classification",
    },
  ];
  return out;
}

/* --------------------------- predictive operations ------------------------ */

/**
 * Improvement #4 — a prediction is not a flag. Every signal carries confidence,
 * the rationale behind it, the recommended action, the owner and the expected
 * business impact.
 */
export interface PredictiveSignal {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  horizon: string;
  /** 0-100 confidence in the prediction. */
  confidence: number;
  /** Why the model reached this conclusion — always evidence-backed. */
  rationale: string;
  recommendedAction: string;
  owner: string;
  expectedImpact: string;
}

/** Confidence scales with the size of the evidence base behind the signal. */
const confidenceFor = (observations: number, base: number) =>
  Math.min(95, Math.round(base + Math.min(25, observations * 5)));

export function predictiveSignals(cases: AnalyticsCase[]): PredictiveSignal[] {
  const out: PredictiveSignal[] = [];
  const now = Date.now();

  const nearBreach = cases.filter((c) => {
    if (!isOpen(c) || !c.sla_resolution_due_at) return false;
    const left = (new Date(c.sla_resolution_due_at).getTime() - now) / 60000;
    return left > 0 && left <= 120;
  });
  if (nearBreach.length) {
    out.push({
      id: "sla_breach",
      title: `${nearBreach.length} case(s) will breach SLA within 2 hours`,
      detail: nearBreach.slice(0, 5).map((c) => c.case_number).join(", "),
      severity: "critical",
      horizon: "2h",
      confidence: confidenceFor(nearBreach.length, 70),
      rationale: "Deterministic countdown against support_cases.sla_resolution_due_at for open cases.",
      recommendedAction: "Re-prioritise these cases to the top of the queue and reassign from over-utilised agents.",
      owner: "Customer Operations · Queue Management",
      expectedImpact: `Prevents ${nearBreach.length} SLA breach(es) and the associated contractual credit exposure.`,
    });
  }

  const repeat = new Map<string, number>();
  cases.forEach((c) => {
    const k = c.requester_user_id ?? c.requester_email;
    if (k) repeat.set(k, (repeat.get(k) ?? 0) + 1);
  });
  const churnRisk = [...repeat.entries()].filter(([, n]) => n >= 3);
  if (churnRisk.length) {
    out.push({
      id: "churn",
      title: `${churnRisk.length} customer(s) at churn risk`,
      detail: "Three or more support contacts in the loaded window.",
      severity: "warn",
      horizon: "30d",
      confidence: confidenceFor(churnRisk.length, 55),
      rationale: "Repeat-contact frequency is the strongest observable churn precursor in the loaded window.",
      recommendedAction: "Route to retention outreach with a goodwill offer sized to the customer's lifetime value.",
      owner: "Rider Operations · Retention",
      expectedImpact: `Protects revenue from ${churnRisk.length} at-risk relationship(s).`,
    });
  }

  const fraudProne = cases.filter((c) => c.fraud_risk_score >= 60 && isOpen(c));
  if (fraudProne.length) {
    out.push({
      id: "refund_fraud",
      title: `${fraudProne.length} open case(s) carry elevated refund-fraud probability`,
      detail: "Fraud risk score at or above 60 while the case remains open.",
      severity: "critical",
      horizon: "now",
      confidence: confidenceFor(fraudProne.length, 65),
      rationale: "Stored fraud_risk_score combined with an open financial disposition path.",
      recommendedAction: "Hold automatic refunds and require Fraud Intelligence review before disbursement.",
      owner: "Trust & Safety · Fraud Intelligence",
      expectedImpact: "Avoids leakage on refunds that would otherwise auto-disburse.",
    });
  }

  const corpOpen = new Map<string, number>();
  cases.filter(isOpen).forEach((c) => { if (c.corporate_account_id) corpOpen.set(c.corporate_account_id, (corpOpen.get(c.corporate_account_id) ?? 0) + 1); });
  const corpAtRisk = [...corpOpen.entries()].filter(([, n]) => n >= 3);
  if (corpAtRisk.length) {
    out.push({
      id: "corp_sla",
      title: `${corpAtRisk.length} corporate account(s) approaching contractual SLA pressure`,
      detail: "Three or more concurrent open cases on the same account.",
      severity: "warn",
      horizon: "7d",
      confidence: confidenceFor(corpAtRisk.length, 60),
      rationale: "Concurrent open-case density per corporate_account_id exceeds the contractual comfort threshold.",
      recommendedAction: "Notify the corporate success manager and pre-brief the account before the next review.",
      owner: "Corporate Success",
      expectedImpact: "Protects contract renewal and avoids SLA credit claims.",
    });
  }

  const deliveryLoad = cases.filter((c) => c.category === "delivery" && isOpen(c)).length;
  if (deliveryLoad >= 5) {
    out.push({
      id: "warehouse_overload",
      title: "Logistics exception load is elevated",
      detail: `${deliveryLoad} open delivery exceptions in the window.`,
      severity: "warn",
      horizon: "24h",
      confidence: confidenceFor(deliveryLoad, 50),
      rationale: "Open delivery-category exception count exceeds the dispatch-window tolerance of 5.",
      recommendedAction: "Rebalance courier assignments and add warehouse capacity for the next dispatch window.",
      owner: "Delivery & Logistics",
      expectedImpact: "Reduces downstream lost-parcel and delivery-failure case creation.",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "clear",
      title: "No predictive risks detected",
      detail: "All open cases are within SLA budget and risk thresholds.",
      severity: "info",
      horizon: "—",
      confidence: 90,
      rationale: "No case crossed an SLA, fraud, churn, corporate or logistics threshold.",
      recommendedAction: "Maintain current staffing and monitoring cadence.",
      owner: "Customer Operations",
      expectedImpact: "Baseline maintained.",
    });
  }
  return out;
}


/* -------------------------- knowledge intelligence ------------------------ */

export interface KnowledgeSuggestion {
  title: string;
  kind: "policy" | "article" | "rule" | "agreement" | "legal";
  summary: string;
}

const KNOWLEDGE: Record<CaseType, KnowledgeSuggestion[]> = {
  refund_dispute: [
    { title: "Refund eligibility policy", kind: "policy", summary: "Refunds require a verified payment attempt, a completed or cancelled trip record and ledger consistency." },
    { title: "Maker-checker separation of duties", kind: "rule", summary: "The requester of a refund can never approve it — enforced at database level." },
    { title: "M-Pesa reversal window", kind: "legal", summary: "Reversals must be initiated within the operator's permitted window; beyond it, use wallet credit." },
  ],
  payment_issue: [
    { title: "STK push failure classes", kind: "article", summary: "Timeout, insufficient funds, cancelled by user and callback loss each have distinct recovery paths." },
    { title: "DLQ replay procedure", kind: "policy", summary: "Replay only idempotent payment callbacks; never re-charge without customer consent." },
  ],
  lost_parcel: [
    { title: "Chain of custody requirements", kind: "policy", summary: "Every handover must have a scan event and an OTP or signature capture." },
    { title: "Parcel compensation matrix", kind: "rule", summary: "Compensation is capped at declared value unless premium cover was purchased." },
  ],
  delivery_failure: [
    { title: "SLA thresholds by service type", kind: "policy", summary: "Express, standard and bulk each carry distinct breach thresholds configured in Logistics." },
    { title: "Redelivery entitlement", kind: "rule", summary: "One free redelivery per order where the failure is attributable to the platform." },
  ],
  safety_incident: [
    { title: "Rapid response protocol", kind: "policy", summary: "Life safety first, then evidence preservation, then driver suspension pending investigation." },
    { title: "NTSA reporting duties", kind: "legal", summary: "Reportable incidents must be submitted to the regulator within the statutory window." },
  ],
  fraud: [
    { title: "Account containment playbook", kind: "policy", summary: "Freeze wallet and suspend payouts before notifying the account holder." },
    { title: "Evidence pack standard", kind: "rule", summary: "Device fingerprints, transaction trail and hash-chained audit entries are mandatory." },
  ],
  driver_conduct: [
    { title: "Progressive discipline matrix", kind: "policy", summary: "Coaching → written warning → suspension → deactivation, escalated by severity and recurrence." },
    { title: "Driver appeal rights", kind: "legal", summary: "Drivers may appeal any deactivation within 14 days with supporting evidence." },
  ],
  corporate_policy: [
    { title: "Corporate agreement terms", kind: "agreement", summary: "Policy exceptions require both corporate admin and finance approval." },
    { title: "Budget overrun handling", kind: "rule", summary: "Rides above the department budget are blocked unless a pre-approved exception exists." },
  ],
  delayed_ride: [
    { title: "Goodwill credit thresholds", kind: "rule", summary: "Credits are capped per rider per month and require Tier 2 approval above the threshold." },
  ],
  vehicle_issue: [
    { title: "Vehicle compliance standard", kind: "policy", summary: "Any safety-affecting defect removes the vehicle from service until inspection clears it." },
  ],
  general_enquiry: [
    { title: "Tier 1 response standards", kind: "policy", summary: "Acknowledge within the response SLA and resolve in one touch wherever knowledge allows." },
  ],
};

export function knowledgeFor(type: CaseType): KnowledgeSuggestion[] {
  return KNOWLEDGE[type] ?? KNOWLEDGE.general_enquiry;
}

/* ------------------------- continuous improvement ------------------------- */

/**
 * Improvement #6 — a closed CAPA loop, not a recommendation list:
 *
 *   Problem → Root Cause → Corrective Action → Owner → Target Date →
 *   Verification → Measured Improvement
 */
export type CapaStatus = "open" | "in_progress" | "verifying" | "closed";

export interface ImprovementAction {
  id: string;
  theme: string;
  /** Observable problem statement. */
  problem: string;
  /** Attributed root cause, not the symptom. */
  rootCause: string;
  /** Corrective action to remove the root cause. */
  action: string;
  owner: string;
  /** ISO date the action is due. */
  targetDate: string;
  /** How completion will be proven. */
  verification: string;
  /** Metric that proves the loop actually closed. */
  measurement: string;
  /** Current measured value of that metric. */
  baseline: string;
  /** Value that closes the CAPA. */
  target: string;
  status: CapaStatus;
  expectedImpact: string;
}

const ROOT_CAUSE_STATEMENT: Record<CaseType, string> = {
  fraud: "Detection rules trail the current abuse pattern (control gap).",
  driver_conduct: "Conduct standards are not reinforced between trips (training gap).",
  lost_parcel: "Chain-of-custody capture is optional in practice (process gap).",
  delayed_ride: "Supply does not meet demand in the affected zones (capacity shortfall).",
  payment_issue: "Payment retry and callback handling degrade under load (system defect).",
  refund_dispute: "Refund eligibility is assessed manually and inconsistently (process gap).",
  corporate_policy: "Policy and approval rules are ambiguous to end users (policy ambiguity).",
  safety_incident: "Pre-trip screening does not surface known risk indicators (control gap).",
  vehicle_issue: "Inspection intervals are longer than the observed defect cycle (process gap).",
  delivery_failure: "Address quality is not validated at booking (process gap).",
  general_enquiry: "Self-service knowledge does not cover the top repeated questions (content gap).",
};

const TARGET_DAYS: Record<string, number> = {
  trust_safety: 14,
  finance: 21,
  logistics: 30,
  driver_ops: 30,
  corporate: 45,
  fleet: 45,
  marketplace: 30,
  rider_ops: 45,
  support: 30,
};

export function improvementLoop(cases: AnalyticsCase[]): ImprovementAction[] {
  const rc = rootCauseAnalysis(cases).slice(0, 4);
  const owners: Record<string, string> = {
    finance: "Finance Operations",
    logistics: "Delivery & Logistics",
    driver_ops: "Driver Operations",
    rider_ops: "Rider Operations",
    trust_safety: "Trust & Safety",
    corporate: "Corporate Success",
    fleet: "Fleet Operations",
    marketplace: "Marketplace",
    support: "Customer Operations",
  };
  const now = Date.now();
  return rc.map((r) => {
    const def = CASE_TYPES.find((t) => t.type === r.type)!;
    const days = TARGET_DAYS[def.domain] ?? 30;
    const targetShare = Math.max(0, r.share - Math.ceil(r.share * 0.3));
    return {
      id: `capa_${r.type}`,
      theme: r.label,
      problem: `${r.label} accounts for ${r.share}% of case volume (${r.count} cases, ${r.breached} SLA-breached).`,
      rootCause: ROOT_CAUSE_STATEMENT[r.type],
      action: r.recommendation,
      owner: owners[def.domain],
      targetDate: new Date(now + days * 24 * 3600 * 1000).toISOString().slice(0, 10),
      verification: `Re-run root cause analysis after the target date and confirm the ${r.label} share has fallen.`,
      measurement: `${r.label} share of total case volume`,
      baseline: `${r.share}% (${r.count} cases)`,
      target: `≤ ${targetShare}%`,
      status: r.trend === "up" ? "open" : r.breached > 0 ? "in_progress" : "verifying",
      expectedImpact: `Targets ${r.share}% of case volume (${r.count} cases, ${r.breached} breached).`,
    };
  });
}


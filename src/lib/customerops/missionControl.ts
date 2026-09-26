/**
 * Enterprise Mission Control + Decision Intelligence.
 *
 * Aggregates the existing operational domains into one composite operating view
 * with predictive signals, revenue intelligence, account health and explainable
 * AI recommendations. Pure functions over snapshots supplied by the caller so
 * the same logic drives the UI, exports and certification.
 */
import { DOMAIN_LABEL, type BusinessDomain } from "./taxonomy";

export type DomainHealthState = "healthy" | "attention" | "critical" | "unknown";

export interface DomainSnapshot {
  domain: BusinessDomain;
  /** Live volume for the domain (open cases, active trips, parcels…). */
  active: number;
  /** Breaching or failing items. */
  breaching: number;
  /** Backlog awaiting action. */
  backlog: number;
  /** Integration / service availability 0-100. */
  availabilityPct: number;
  updatedAt: string;
}

export interface DomainHealth extends DomainSnapshot {
  label: string;
  score: number;
  state: DomainHealthState;
  drivers: string[];
}

export function domainHealth(s: DomainSnapshot): DomainHealth {
  const drivers: string[] = [];
  let score = 100;
  const breachRate = s.active > 0 ? s.breaching / s.active : 0;
  if (breachRate > 0) {
    const penalty = Math.round(Math.min(45, breachRate * 90));
    score -= penalty;
    drivers.push(`${Math.round(breachRate * 100)}% breaching −${penalty}`);
  }
  if (s.availabilityPct < 99.5) {
    const penalty = Math.round(Math.min(35, (99.5 - s.availabilityPct) * 6));
    score -= penalty;
    drivers.push(`Availability ${s.availabilityPct.toFixed(2)}% −${penalty}`);
  }
  if (s.backlog > 25) {
    const penalty = Math.min(20, Math.round((s.backlog - 25) / 5));
    score -= penalty;
    drivers.push(`Backlog ${s.backlog} −${penalty}`);
  }
  score = Math.max(0, Math.min(100, score));
  const state: DomainHealthState = score >= 85 ? "healthy" : score >= 65 ? "attention" : "critical";
  if (drivers.length === 0) drivers.push("All indicators within target");
  return { ...s, label: DOMAIN_LABEL[s.domain], score, state, drivers };
}

/* --------------------------- revenue intelligence -------------------------- */

export interface RevenueSignals {
  revenueTodayKes: number;
  revenueYesterdayKes: number;
  /** Value of bookings pending payment / approval. */
  pipelineKes: number;
  /** Exposure sitting in disputed or failed payment states. */
  atRiskKes: number;
  refundsKes: number;
}

export interface RevenueIntelligence extends RevenueSignals {
  deltaPct: number;
  netKes: number;
  riskRatioPct: number;
  band: "growing" | "flat" | "declining";
}

export function revenueIntelligence(s: RevenueSignals): RevenueIntelligence {
  const deltaPct = s.revenueYesterdayKes > 0
    ? Math.round(((s.revenueTodayKes - s.revenueYesterdayKes) / s.revenueYesterdayKes) * 1000) / 10
    : 0;
  const netKes = s.revenueTodayKes - s.refundsKes;
  const base = s.revenueTodayKes + s.pipelineKes;
  return {
    ...s, deltaPct, netKes,
    riskRatioPct: base > 0 ? Math.round((s.atRiskKes / base) * 1000) / 10 : 0,
    band: deltaPct > 3 ? "growing" : deltaPct < -3 ? "declining" : "flat",
  };
}

/* ---------------------------- predictive signals --------------------------- */

export interface AccountHealthInput {
  accountId: string;
  name: string
  monthlySpendKes: number;
  spendTrendPct: number;
  slaCompliancePct: number;
  openDisputes: number;
  daysSinceLastBooking: number;
  contractRenewalDays: number;
}

export interface AccountRisk extends AccountHealthInput {
  churnRiskPct: number;
  revenueAtRiskKes: number;
  band: "stable" | "watch" | "at_risk" | "critical";
  drivers: string[];
}

export function accountRisk(a: AccountHealthInput): AccountRisk {
  const drivers: string[] = [];
  let risk = 5;
  if (a.spendTrendPct < 0) { const d = Math.min(30, Math.round(Math.abs(a.spendTrendPct))); risk += d; drivers.push(`Spend down ${Math.abs(a.spendTrendPct)}% +${d}`); }
  if (a.slaCompliancePct < 95) { const d = Math.min(25, Math.round((95 - a.slaCompliancePct) * 2)); risk += d; drivers.push(`SLA ${a.slaCompliancePct}% +${d}`); }
  if (a.openDisputes > 0) { const d = Math.min(20, a.openDisputes * 5); risk += d; drivers.push(`${a.openDisputes} open dispute(s) +${d}`); }
  if (a.daysSinceLastBooking > 14) { const d = Math.min(20, Math.round((a.daysSinceLastBooking - 14) / 2)); risk += d; drivers.push(`${a.daysSinceLastBooking}d since last booking +${d}`); }
  if (a.contractRenewalDays <= 60) { risk += 10; drivers.push("Renewal within 60 days +10"); }
  const churnRiskPct = Math.max(0, Math.min(99, risk));
  return {
    ...a, churnRiskPct,
    revenueAtRiskKes: Math.round(a.monthlySpendKes * 12 * (churnRiskPct / 100)),
    band: churnRiskPct >= 70 ? "critical" : churnRiskPct >= 45 ? "at_risk" : churnRiskPct >= 25 ? "watch" : "stable",
    drivers: drivers.length ? drivers : ["No negative signals"],
  };
}

export interface SlaForecastInput {
  openCases: number;
  atRiskCases: number;
  breachedCases: number;
  /** Cases resolved per hour by the current roster. */
  throughputPerHour: number;
  horizonHours: number;
}

export interface SlaForecast {
  predictedBreaches: number;
  capacityGap: number;
  compliancePctForecast: number;
  band: "on_track" | "pressured" | "storm";
  recommendation: string;
}

export function slaForecast(i: SlaForecastInput): SlaForecast {
  const capacity = Math.max(0, i.throughputPerHour * i.horizonHours);
  const demand = i.openCases + i.atRiskCases;
  const capacityGap = Math.max(0, demand - capacity);
  const predictedBreaches = i.breachedCases + Math.round(Math.min(i.atRiskCases, capacityGap));
  const total = Math.max(1, i.openCases + i.breachedCases);
  const compliancePctForecast = Math.max(0, Math.round(((total - predictedBreaches) / total) * 1000) / 10);
  const band: SlaForecast["band"] = predictedBreaches >= 10 ? "storm" : capacityGap > 0 ? "pressured" : "on_track";
  return {
    predictedBreaches, capacityGap, compliancePctForecast, band,
    recommendation: band === "storm"
      ? `Activate surge roster: ${capacityGap} cases beyond capacity in ${i.horizonHours}h`
      : band === "pressured"
        ? `Re-prioritise queue; ${capacityGap} case(s) beyond current throughput`
        : "Current roster covers the forecast horizon",
  };
}

/* --------------------------- AI recommendations ---------------------------- */

export interface MissionRecommendation {
  id: string;
  title: string;
  rationale: string;
  domain: BusinessDomain | "governance";
  severity: "info" | "warn" | "critical";
  /** Explainable confidence 0-100. */
  confidence: number;
  ctaPath?: string;
  evidence: string[];
}

export interface MissionControlInput {
  domains: DomainSnapshot[];
  revenue: RevenueSignals;
  accounts: AccountHealthInput[];
  sla: SlaForecastInput;
}

export interface MissionControlView {
  generatedAt: string;
  compositeScore: number;
  state: DomainHealthState;
  domains: DomainHealth[];
  revenue: RevenueIntelligence;
  accounts: AccountRisk[];
  sla: SlaForecast;
  recommendations: MissionRecommendation[];
  totals: { active: number; breaching: number; backlog: number; revenueAtRiskKes: number };
}

export function buildMissionControl(input: MissionControlInput, now = new Date().toISOString()): MissionControlView {
  const domains = input.domains.map(domainHealth);
  const revenue = revenueIntelligence(input.revenue);
  const accounts = input.accounts.map(accountRisk).sort((a, b) => b.churnRiskPct - a.churnRiskPct);
  const sla = slaForecast(input.sla);

  const compositeScore = domains.length
    ? Math.round(domains.reduce((sum, d) => sum + d.score, 0) / domains.length)
    : 0;
  const state: DomainHealthState = compositeScore >= 85 ? "healthy" : compositeScore >= 65 ? "attention" : "critical";

  const recommendations: MissionRecommendation[] = [];
  for (const d of domains.filter((x) => x.state !== "healthy").slice(0, 4)) {
    recommendations.push({
      id: `domain-${d.domain}`,
      title: `${d.label}: ${d.state === "critical" ? "intervene now" : "review pressure"}`,
      rationale: `Health ${d.score}/100 with ${d.breaching} breaching of ${d.active} active items.`,
      domain: d.domain,
      severity: d.state === "critical" ? "critical" : "warn",
      confidence: Math.min(95, 60 + Math.round((100 - d.score) / 3)),
      evidence: d.drivers,
    });
  }
  if (sla.band !== "on_track") {
    recommendations.push({
      id: "sla-forecast", title: sla.recommendation,
      rationale: `${sla.predictedBreaches} predicted breaches in ${input.sla.horizonHours}h; forecast compliance ${sla.compliancePctForecast}%.`,
      domain: "support", severity: sla.band === "storm" ? "critical" : "warn",
      confidence: 78, ctaPath: "/dashboard/admin/customer-operations",
      evidence: [`Capacity gap ${sla.capacityGap}`, `Throughput ${input.sla.throughputPerHour}/h`],
    });
  }
  if (revenue.riskRatioPct >= 5) {
    recommendations.push({
      id: "revenue-at-risk", title: `Recover KES ${revenue.atRiskKes.toLocaleString()} of at-risk revenue`,
      rationale: `${revenue.riskRatioPct}% of today's revenue plus pipeline sits in disputed or failed payment states.`,
      domain: "finance", severity: revenue.riskRatioPct >= 12 ? "critical" : "warn",
      confidence: 82, ctaPath: "/dashboard/admin/payment-ops",
      evidence: [`At risk KES ${revenue.atRiskKes}`, `Refunds KES ${revenue.refundsKes}`],
    });
  }
  for (const a of accounts.filter((x) => x.band === "at_risk" || x.band === "critical").slice(0, 3)) {
    recommendations.push({
      id: `account-${a.accountId}`, title: `Engage ${a.name} — churn risk ${a.churnRiskPct}%`,
      rationale: `KES ${a.revenueAtRiskKes.toLocaleString()} annualised revenue at risk.`,
      domain: "corporate", severity: a.band === "critical" ? "critical" : "warn",
      confidence: Math.min(92, 55 + Math.round(a.churnRiskPct / 3)),
      ctaPath: "/dashboard/admin/corporates", evidence: a.drivers,
    });
  }

  return {
    generatedAt: now, compositeScore, state, domains, revenue, accounts, sla,
    recommendations: recommendations.sort((x, y) => (y.severity === "critical" ? 1 : 0) - (x.severity === "critical" ? 1 : 0) || y.confidence - x.confidence),
    totals: {
      active: domains.reduce((s, d) => s + d.active, 0),
      breaching: domains.reduce((s, d) => s + d.breaching, 0),
      backlog: domains.reduce((s, d) => s + d.backlog, 0),
      revenueAtRiskKes: revenue.atRiskKes + accounts.reduce((s, a) => s + a.revenueAtRiskKes, 0),
    },
  };
}

/* --------------------------- decision intelligence ------------------------- */

export type ReportId =
  | "operational_kpis" | "financial_health" | "customer_experience" | "fleet_utilisation"
  | "conversion_funnel" | "account_health" | "churn_prediction" | "revenue_at_risk" | "sla_forecast";

export interface DecisionReport {
  id: ReportId;
  title: string;
  /** Governance policy required to open / download the report. */
  policyId: string;
  formats: ("csv" | "pdf")[];
  schedules: ("daily" | "weekly" | "monthly")[];
  rows: (view: MissionControlView) => Record<string, string | number>[];
}

export const DECISION_REPORTS: DecisionReport[] = [
  { id: "operational_kpis", title: "Operational KPIs", policyId: "page:decision_intelligence", formats: ["csv", "pdf"], schedules: ["daily", "weekly", "monthly"],
    rows: (v) => v.domains.map((d) => ({ domain: d.label, health: d.score, state: d.state, active: d.active, breaching: d.breaching, backlog: d.backlog })) },
  { id: "financial_health", title: "Financial health", policyId: "widget:revenue_intelligence", formats: ["csv", "pdf"], schedules: ["daily", "monthly"],
    rows: (v) => [{ revenue_today_kes: v.revenue.revenueTodayKes, net_kes: v.revenue.netKes, refunds_kes: v.revenue.refundsKes, pipeline_kes: v.revenue.pipelineKes, at_risk_kes: v.revenue.atRiskKes, delta_pct: v.revenue.deltaPct, band: v.revenue.band }] },
  { id: "customer_experience", title: "Customer experience", policyId: "page:decision_intelligence", formats: ["csv", "pdf"], schedules: ["weekly"],
    rows: (v) => [{ open_cases: v.sla.predictedBreaches + v.totals.active, predicted_breaches: v.sla.predictedBreaches, forecast_compliance_pct: v.sla.compliancePctForecast }] },
  { id: "fleet_utilisation", title: "Fleet utilisation", policyId: "widget:fleet_utilisation", formats: ["csv"], schedules: ["daily", "weekly"],
    rows: (v) => {
      const fleetish = v.domains.filter((d) => d.domain === "fleet" || d.domain === "marketplace");
      return (fleetish.length ? fleetish : v.domains).map((d) => ({ domain: d.label, active: d.active, availability_pct: d.availabilityPct, health: d.score }));
    } },
  { id: "conversion_funnel", title: "Conversion funnel", policyId: "page:decision_intelligence", formats: ["csv", "pdf"], schedules: ["weekly", "monthly"],
    rows: (v) => [{ pipeline_kes: v.revenue.pipelineKes, revenue_today_kes: v.revenue.revenueTodayKes, conversion_ratio_pct: v.revenue.pipelineKes > 0 ? Math.round((v.revenue.revenueTodayKes / (v.revenue.revenueTodayKes + v.revenue.pipelineKes)) * 100) : 100 }] },
  { id: "account_health", title: "Corporate account health", policyId: "widget:churn_risk", formats: ["csv", "pdf"], schedules: ["weekly", "monthly"],
    rows: (v) => v.accounts.map((a) => ({ account: a.name, monthly_spend_kes: a.monthlySpendKes, sla_pct: a.slaCompliancePct, churn_risk_pct: a.churnRiskPct, band: a.band })) },
  { id: "churn_prediction", title: "Churn prediction", policyId: "widget:churn_risk", formats: ["csv"], schedules: ["weekly"],
    rows: (v) => v.accounts.map((a) => ({ account: a.name, churn_risk_pct: a.churnRiskPct, drivers: a.drivers.join(" | ") })) },
  { id: "revenue_at_risk", title: "Revenue at risk", policyId: "widget:revenue_intelligence", formats: ["csv", "pdf"], schedules: ["daily", "weekly"],
    rows: (v) => v.accounts.map((a) => ({ account: a.name, revenue_at_risk_kes: a.revenueAtRiskKes, band: a.band })) },
  { id: "sla_forecast", title: "SLA forecast", policyId: "widget:sla_forecast", formats: ["csv"], schedules: ["daily"],
    rows: (v) => [{ predicted_breaches: v.sla.predictedBreaches, capacity_gap: v.sla.capacityGap, forecast_compliance_pct: v.sla.compliancePctForecast, band: v.sla.band, recommendation: v.sla.recommendation }] },
];

export function reportToCsv(report: DecisionReport, view: MissionControlView): string {
  const rows = report.rows(view);
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n");
}

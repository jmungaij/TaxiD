/**
 * Corporate account command centre + customer success intelligence.
 *
 * Aggregates one corporate account's operational, financial and adoption state
 * into a single health picture, and scores the whole portfolio so customer
 * success knows who is at risk of churn and who is ready to expand.
 *
 * Pure aggregation over rows the operational systems already recorded.
 */

export interface AccountFacts {
  corporateId: string;
  name: string;
  status: string | null;
  /** Pre-funded wallet balance in KES. */
  walletBalanceKes: number;
  /** Approved credit limit in KES (0 when prepaid only). */
  creditLimitKes: number;
  /** Invoiced but unpaid amount in KES. */
  arrearsKes: number;
  /** Trips completed in the current window. */
  tripsThisPeriod: number;
  /** Trips completed in the previous comparable window. */
  tripsPrevPeriod: number;
  spendThisPeriodKes: number;
  spendPrevPeriodKes: number;
  /** Employees with at least one trip in the window. */
  activeEmployees: number;
  /** Employees enrolled on the account. */
  enrolledEmployees: number;
  openApprovals: number;
  /** Approvals past their SLA. */
  overdueApprovals: number;
  /** Trips that failed, cancelled by the platform, or were never allocated. */
  failedTrips: number;
  openTickets: number;
  policyViolations: number;
  expiringDocuments: number;
  expiredDocuments: number;
  lastBookingAt: string | null;
  onboardedAt: string | null;
}

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const pctChange = (now: number, prev: number) =>
  prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : now > 0 ? 100 : 0;

export type HealthBand = "thriving" | "healthy" | "watch" | "at_risk" | "critical";

export interface AccountHealth {
  corporateId: string;
  name: string;
  /** Composite 0..100. */
  score: number;
  band: HealthBand;
  adoptionPct: number;
  tripGrowthPct: number;
  spendGrowthPct: number;
  /** Wallet + credit head-room measured against last period's spend. */
  runwayDays: number;
  reliabilityPct: number;
  daysSinceLastBooking: number | null;
  /** Ranked reasons the score is not 100. */
  risks: string[];
  /** Concrete next actions for the account manager. */
  recommendations: string[];
  expansionReady: boolean;
}

export function accountHealth(f: AccountFacts, now = Date.now()): AccountHealth {
  const adoptionPct = f.enrolledEmployees
    ? Math.round((f.activeEmployees / f.enrolledEmployees) * 1000) / 10 : 0;
  const tripGrowthPct = pctChange(f.tripsThisPeriod, f.tripsPrevPeriod);
  const spendGrowthPct = pctChange(f.spendThisPeriodKes, f.spendPrevPeriodKes);
  const dailyBurn = f.spendPrevPeriodKes > 0 ? f.spendPrevPeriodKes / 30 : f.spendThisPeriodKes / 30;
  const headroom = Math.max(0, f.walletBalanceKes + f.creditLimitKes - f.arrearsKes);
  const runwayDays = dailyBurn > 0 ? Math.round(headroom / dailyBurn) : headroom > 0 ? 90 : 0;
  const totalTrips = f.tripsThisPeriod + f.failedTrips;
  const reliabilityPct = totalTrips ? Math.round(((totalTrips - f.failedTrips) / totalTrips) * 1000) / 10 : 100;
  const daysSinceLastBooking = f.lastBookingAt
    ? Math.floor((now - new Date(f.lastBookingAt).getTime()) / DAY) : null;

  const risks: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (adoptionPct < 40) {
    score -= 18; risks.push(`Only ${adoptionPct}% of enrolled employees booked this period`);
    recommendations.push("Run an employee activation campaign and re-share the booking link");
  }
  if (runwayDays < 7) {
    score -= 20; risks.push(`Wallet runway is ${runwayDays} day(s)`);
    recommendations.push("Request a wallet top-up or review the credit limit");
  } else if (runwayDays < 14) {
    score -= 8; risks.push(`Wallet runway is under two weeks (${runwayDays} days)`);
  }
  if (f.arrearsKes > 0) {
    score -= f.arrearsKes > f.creditLimitKes * 0.5 ? 15 : 7;
    risks.push(`Arrears of KES ${Math.round(f.arrearsKes).toLocaleString("en-KE")}`);
    recommendations.push("Escalate outstanding invoices to the finance contact");
  }
  if (f.overdueApprovals > 0) {
    score -= Math.min(15, f.overdueApprovals * 3);
    risks.push(`${f.overdueApprovals} approval(s) past SLA`);
    recommendations.push("Reassign or delegate overdue approvals to a backup approver");
  }
  if (reliabilityPct < 95) {
    score -= 12; risks.push(`Trip reliability at ${reliabilityPct}%`);
    recommendations.push("Review failed trips with operations and confirm fleet coverage");
  }
  if (tripGrowthPct < -20) {
    score -= 12; risks.push(`Trip volume down ${Math.abs(tripGrowthPct)}% period on period`);
    recommendations.push("Book a usage review with the travel manager");
  }
  if (f.expiredDocuments > 0) {
    score -= 12; risks.push(`${f.expiredDocuments} expired compliance document(s)`);
    recommendations.push("Request fresh KYB documents before the next billing cycle");
  } else if (f.expiringDocuments > 0) {
    score -= 4; risks.push(`${f.expiringDocuments} document(s) expiring within 30 days`);
  }
  if (f.openTickets > 2) {
    score -= 8; risks.push(`${f.openTickets} open support tickets`);
    recommendations.push("Hold a service review to clear the open ticket backlog");
  }
  if (f.policyViolations > 0) {
    score -= 5; risks.push(`${f.policyViolations} policy violation(s) recorded`);
  }
  if (daysSinceLastBooking !== null && daysSinceLastBooking > 30) {
    score -= 15; risks.push(`No bookings for ${daysSinceLastBooking} days`);
    recommendations.push("Re-engage the account owner — dormancy risk");
  }
  if ((f.status ?? "").toLowerCase() === "suspended") {
    score -= 30; risks.push("Account is suspended");
  }

  score = clamp(Math.round(score));
  const band: HealthBand =
    score >= 90 ? "thriving" : score >= 75 ? "healthy" : score >= 60 ? "watch"
    : score >= 40 ? "at_risk" : "critical";

  const expansionReady =
    score >= 80 && tripGrowthPct >= 15 && adoptionPct >= 60 && f.arrearsKes === 0;
  if (expansionReady) recommendations.push("Propose expansion: additional departments or a shuttle programme");
  if (!risks.length) recommendations.push("Account is healthy — schedule a quarterly business review");

  return {
    corporateId: f.corporateId, name: f.name, score, band,
    adoptionPct, tripGrowthPct, spendGrowthPct, runwayDays, reliabilityPct,
    daysSinceLastBooking, risks, recommendations, expansionReady,
  };
}

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  thriving: "Thriving", healthy: "Healthy", watch: "Watch",
  at_risk: "At risk", critical: "Critical",
};

export const HEALTH_BAND_CLASS: Record<HealthBand, string> = {
  thriving: "bg-primary/15 text-primary border-primary/30",
  healthy: "bg-primary/15 text-primary border-primary/30",
  watch: "bg-muted text-muted-foreground border-border",
  at_risk: "bg-destructive/10 text-destructive border-destructive/30",
  critical: "bg-destructive/20 text-destructive border-destructive/40",
};

export interface PortfolioHealth {
  accounts: AccountHealth[];
  count: number;
  avgScore: number;
  byBand: Record<HealthBand, number>;
  atRisk: AccountHealth[];
  expansionReady: AccountHealth[];
  /** Spend of accounts scoring below 60 — revenue exposed to churn. */
  revenueAtRiskKes: number;
}

export function portfolioHealth(facts: AccountFacts[], now = Date.now()): PortfolioHealth {
  const accounts = facts.map((f) => accountHealth(f, now)).sort((a, b) => a.score - b.score);
  const byBand = (Object.keys(HEALTH_BAND_LABEL) as HealthBand[]).reduce((acc, b) => {
    acc[b] = accounts.filter((a) => a.band === b).length;
    return acc;
  }, {} as Record<HealthBand, number>);
  const riskIds = new Set(accounts.filter((a) => a.score < 60).map((a) => a.corporateId));
  return {
    accounts,
    count: accounts.length,
    avgScore: accounts.length
      ? Math.round(accounts.reduce((s, a) => s + a.score, 0) / accounts.length) : 0,
    byBand,
    atRisk: accounts.filter((a) => a.band === "at_risk" || a.band === "critical"),
    expansionReady: accounts.filter((a) => a.expansionReady),
    revenueAtRiskKes: facts
      .filter((f) => riskIds.has(f.corporateId))
      .reduce((s, f) => s + f.spendThisPeriodKes, 0),
  };
}

export type SuccessPlayKind =
  | "activation" | "funding" | "collections" | "approval_hygiene"
  | "service_review" | "compliance" | "reengagement" | "expansion";

export interface SuccessPlay {
  corporateId: string;
  name: string;
  kind: SuccessPlayKind;
  title: string;
  detail: string;
  priority: 1 | 2 | 3;
  /** Suggested owner role. */
  owner: string;
}

/** Turns health signals into a prioritised customer-success task list. */
export function successPlaybook(facts: AccountFacts[], now = Date.now()): SuccessPlay[] {
  const plays: SuccessPlay[] = [];
  for (const f of facts) {
    const h = accountHealth(f, now);
    const add = (kind: SuccessPlayKind, title: string, detail: string, priority: 1 | 2 | 3, owner: string) =>
      plays.push({ corporateId: f.corporateId, name: f.name, kind, title, detail, priority, owner });

    if (h.runwayDays < 7) add("funding", "Wallet top-up required", `Runway ${h.runwayDays} day(s) at current burn.`, 1, "Finance");
    if (f.arrearsKes > 0) add("collections", "Recover arrears", `KES ${Math.round(f.arrearsKes).toLocaleString("en-KE")} outstanding.`, 1, "Finance");
    if (f.expiredDocuments > 0) add("compliance", "Refresh expired documents", `${f.expiredDocuments} document(s) expired.`, 1, "Compliance");
    if (f.overdueApprovals > 0) add("approval_hygiene", "Clear overdue approvals", `${f.overdueApprovals} approval(s) past SLA.`, 2, "Account manager");
    if (h.adoptionPct < 40) add("activation", "Drive employee activation", `${h.adoptionPct}% of enrolled employees active.`, 2, "Customer success");
    if (h.reliabilityPct < 95) add("service_review", "Service quality review", `Reliability ${h.reliabilityPct}%.`, 2, "Operations");
    if (h.daysSinceLastBooking !== null && h.daysSinceLastBooking > 30) {
      add("reengagement", "Re-engage dormant account", `No bookings for ${h.daysSinceLastBooking} days.`, 1, "Account manager");
    }
    if (h.expansionReady) add("expansion", "Expansion opportunity", `Trips up ${h.tripGrowthPct}% with clean billing.`, 3, "Sales");
  }
  return plays.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

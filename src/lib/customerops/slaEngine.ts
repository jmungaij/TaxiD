/**
 * Customer Operations — SLA engine.
 *
 * Deterministic metrics over the loaded case set: first response, average
 * response, average resolution, reopen rate, escalation time, agent
 * utilisation and segmented SLA compliance (department, corporate, VIP).
 *
 * Operates on the same `AnalyticsCase` shape already used by the intelligence
 * layer, so nothing new has to be fetched.
 */
import type { AnalyticsCase } from "./intelligence";
import { resolveBusinessLine, type SlaTier } from "./businessLines";

const OPEN = new Set([
  "new", "triaged", "assigned", "in_progress",
  "pending_customer", "pending_approval", "escalated",
]);

const minutesBetween = (from: string, to: string): number =>
  Math.max(0, (Date.parse(to) - Date.parse(from)) / 60_000);

const avg = (values: number[]): number | null =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
};

export interface SlaMetrics {
  cases: number;
  open: number;
  /** Average minutes to first agent response. */
  firstResponseMinutes: number | null;
  /** 90th percentile first response — the number that actually breaches. */
  firstResponseP90: number | null;
  /** Average minutes from creation to resolution. */
  resolutionMinutes: number | null;
  resolutionP90: number | null;
  /** Share of cases that met the response SLA (0-100). */
  responseCompliance: number;
  /** Share of cases that met the resolution SLA (0-100). */
  resolutionCompliance: number;
  /** Share of resolved cases that were reopened (0-100). */
  reopenRate: number;
  /** Average minutes from creation to first escalation. */
  escalationMinutes: number | null;
  escalatedShare: number;
  /** Cases resolved without any escalation (0-100). */
  firstContactResolution: number;
}

const REOPEN_TAGS = new Set(["reopened", "reopen", "recurrence"]);

const wasReopened = (c: AnalyticsCase): boolean =>
  (c.tags ?? []).some((t) => REOPEN_TAGS.has(t.toLowerCase())) || c.status === "reopened";

/** Core SLA metric bundle for any case slice. */
export function slaMetrics(cases: AnalyticsCase[]): SlaMetrics {
  const responded = cases.filter((c) => c.first_response_at);
  const resolved = cases.filter((c) => c.resolved_at);

  const firstResponses = responded.map((c) => minutesBetween(c.created_at, c.first_response_at!));
  const resolutions = resolved.map((c) => minutesBetween(c.created_at, c.resolved_at!));
  const escalated = cases.filter((c) => c.escalation_level > 0);
  // Escalation timestamp is not stored per level; resolution/response time on
  // escalated cases is the best available proxy and is labelled as such in UI.
  const escalationTimes = escalated
    .map((c) => (c.first_response_at ? minutesBetween(c.created_at, c.first_response_at) : null))
    .filter((v): v is number => v != null);

  const responseBreaches = cases.filter((c) => c.sla_resolution_breached && !c.first_response_at).length;
  const resolutionBreaches = cases.filter((c) => c.sla_resolution_breached).length;
  const reopened = cases.filter(wasReopened).length;

  const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : 100);

  return {
    cases: cases.length,
    open: cases.filter((c) => OPEN.has(c.status)).length,
    firstResponseMinutes: avg(firstResponses),
    firstResponseP90: percentile(firstResponses, 90),
    resolutionMinutes: avg(resolutions),
    resolutionP90: percentile(resolutions, 90),
    responseCompliance: pct(cases.length - responseBreaches, cases.length),
    resolutionCompliance: pct(cases.length - resolutionBreaches, cases.length),
    reopenRate: resolved.length ? Math.round((reopened / resolved.length) * 100) : 0,
    escalationMinutes: avg(escalationTimes),
    escalatedShare: pct(escalated.length, cases.length) === 100 && !escalated.length ? 0 : Math.round((escalated.length / (cases.length || 1)) * 100),
    firstContactResolution: resolved.length
      ? Math.round((resolved.filter((c) => c.escalation_level === 0).length / resolved.length) * 100)
      : 0,
  };
}

export type SegmentKind = "department" | "corporate" | "tier";

export interface SlaSegment {
  kind: SegmentKind;
  key: string;
  label: string;
  metrics: SlaMetrics;
  /** Target resolution compliance for the segment (0-100). */
  target: number;
  meetsTarget: boolean;
}

const TIER_TARGET: Record<SlaTier, number> = { vip: 98, priority: 95, standard: 90 };

/**
 * SLA compliance by department (assigned team), corporate account and
 * service tier — the three views management reviews.
 */
export function slaSegments(cases: AnalyticsCase[]): SlaSegment[] {
  const segments: SlaSegment[] = [];

  const byTeam = new Map<string, AnalyticsCase[]>();
  const byCorporate = new Map<string, AnalyticsCase[]>();
  const byTier = new Map<SlaTier, AnalyticsCase[]>();

  for (const c of cases) {
    const team = c.assigned_team ?? "Unassigned";
    byTeam.set(team, [...(byTeam.get(team) ?? []), c]);
    if (c.corporate_account_id) {
      byCorporate.set(c.corporate_account_id, [...(byCorporate.get(c.corporate_account_id) ?? []), c]);
    }
    const tier = resolveBusinessLine(c).line.slaTier;
    byTier.set(tier, [...(byTier.get(tier) ?? []), c]);
  }

  for (const [team, list] of byTeam) {
    const metrics = slaMetrics(list);
    segments.push({ kind: "department", key: team, label: team, metrics, target: 90, meetsTarget: metrics.resolutionCompliance >= 90 });
  }
  for (const [id, list] of byCorporate) {
    const metrics = slaMetrics(list);
    segments.push({ kind: "corporate", key: id, label: `Corporate ${id.slice(0, 8)}`, metrics, target: 95, meetsTarget: metrics.resolutionCompliance >= 95 });
  }
  for (const [tier, list] of byTier) {
    const metrics = slaMetrics(list);
    const target = TIER_TARGET[tier];
    segments.push({
      kind: "tier",
      key: tier,
      label: tier === "vip" ? "VIP SLA" : tier === "priority" ? "Priority SLA" : "Standard SLA",
      metrics,
      target,
      meetsTarget: metrics.resolutionCompliance >= target,
    });
  }

  return segments.sort((a, b) => a.metrics.resolutionCompliance - b.metrics.resolutionCompliance);
}

export interface UtilizationRow {
  agent: string;
  open: number;
  capacity: number;
  utilisation: number;
  state: "idle" | "healthy" | "stretched" | "overloaded";
}

/** Agent load against desk capacity — drives staffing decisions. */
export function agentUtilization(cases: AnalyticsCase[], capacityPerAgent = 12): UtilizationRow[] {
  const byAgent = new Map<string, number>();
  for (const c of cases) {
    if (!OPEN.has(c.status)) continue;
    const key = c.assigned_to ?? "unassigned";
    byAgent.set(key, (byAgent.get(key) ?? 0) + 1);
  }
  return [...byAgent.entries()]
    .map(([agent, open]) => {
      const utilisation = Math.round((open / capacityPerAgent) * 100);
      const state: UtilizationRow["state"] =
        utilisation >= 120 ? "overloaded" : utilisation >= 85 ? "stretched" : utilisation >= 25 ? "healthy" : "idle";
      return { agent, open, capacity: capacityPerAgent, utilisation, state };
    })
    .sort((a, b) => b.utilisation - a.utilisation);
}

export interface SlaBreachRisk {
  caseId: string;
  caseNumber: string;
  subject: string;
  minutesRemaining: number | null;
  level: "breached" | "critical" | "at_risk" | "ok";
  tier: SlaTier;
}

/** Live breach radar for the operations status strip. */
export function breachRadar(cases: AnalyticsCase[], now = Date.now()): SlaBreachRisk[] {
  return cases
    .filter((c) => OPEN.has(c.status))
    .map((c) => {
      const tier = resolveBusinessLine(c).line.slaTier;
      const due = c.sla_resolution_due_at ? Date.parse(c.sla_resolution_due_at) : null;
      const minutesRemaining = due == null ? null : Math.round((due - now) / 60_000);
      const level: SlaBreachRisk["level"] =
        c.sla_resolution_breached || (minutesRemaining != null && minutesRemaining < 0)
          ? "breached"
          : minutesRemaining != null && minutesRemaining <= 30
            ? "critical"
            : minutesRemaining != null && minutesRemaining <= 120
              ? "at_risk"
              : "ok";
      return { caseId: c.id, caseNumber: c.case_number, subject: c.subject, minutesRemaining, level, tier };
    })
    .filter((r) => r.level !== "ok")
    .sort((a, b) => (a.minutesRemaining ?? -9999) - (b.minutesRemaining ?? -9999));
}

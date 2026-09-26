/**
 * Customer Operations — agent performance & SLA management.
 *
 * Per-agent, per-role and per-business-line performance built from the same
 * loaded case set the rest of the Operations Center uses: SLA compliance,
 * first response, resolution, reopen rate, escalation time, CSAT and
 * utilisation. Deterministic — no extra fetching, safe to unit test.
 */
import type { AnalyticsCase } from "./intelligence";
import { slaMetrics, type SlaMetrics } from "./slaEngine";
import { resolveBusinessLine } from "./businessLines";

/** Case row enriched with the fields performance reporting needs. */
export interface PerformanceCase extends AnalyticsCase {
  satisfaction_score?: number | null;
  assigned_agent_name?: string | null;
  agent_role?: string | null;
}

const OPEN = new Set([
  "new", "triaged", "assigned", "in_progress",
  "pending_customer", "pending_approval", "escalated",
]);

const avg = (v: number[]): number | null =>
  v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;

export type PerformanceGrade = "exemplary" | "on_target" | "watch" | "off_target";

export interface AgentScorecard {
  agentId: string;
  agentName: string;
  role: string;
  cases: number;
  open: number;
  resolved: number;
  metrics: SlaMetrics;
  /** Mean CSAT (1-5) where captured. */
  csat: number | null;
  csatResponses: number;
  utilisation: number;
  capacity: number;
  /** 0-100 blended quality score. */
  score: number;
  grade: PerformanceGrade;
  /** Business lines this agent handled, busiest first. */
  lines: { id: string; label: string; cases: number }[];
}

const gradeFor = (score: number): PerformanceGrade =>
  score >= 90 ? "exemplary" : score >= 75 ? "on_target" : score >= 60 ? "watch" : "off_target";

export const GRADE_LABEL: Record<PerformanceGrade, string> = {
  exemplary: "Exemplary",
  on_target: "On target",
  watch: "Watch",
  off_target: "Off target",
};

/**
 * Blended agent score: resolution compliance (40%), response compliance
 * (25%), CSAT (20%), reopen penalty (15%).
 */
export function agentScore(metrics: SlaMetrics, csat: number | null): number {
  const csatPct = csat == null ? 80 : Math.round((csat / 5) * 100);
  const reopenScore = Math.max(0, 100 - metrics.reopenRate * 4);
  return Math.round(
    metrics.resolutionCompliance * 0.4 +
      metrics.responseCompliance * 0.25 +
      csatPct * 0.2 +
      reopenScore * 0.15,
  );
}

export function agentScorecards(
  cases: PerformanceCase[],
  opts: { capacityPerAgent?: number } = {},
): AgentScorecard[] {
  const capacity = opts.capacityPerAgent ?? 12;
  const byAgent = new Map<string, PerformanceCase[]>();
  for (const c of cases) {
    const key = c.assigned_to ?? "unassigned";
    byAgent.set(key, [...(byAgent.get(key) ?? []), c]);
  }

  return [...byAgent.entries()]
    .map(([agentId, list]) => {
      const metrics = slaMetrics(list);
      const scores = list
        .map((c) => c.satisfaction_score)
        .filter((s): s is number => typeof s === "number" && s > 0);
      const csat = avg(scores);
      const open = list.filter((c) => OPEN.has(c.status)).length;

      const lineCounts = new Map<string, { label: string; cases: number }>();
      for (const c of list) {
        const { line } = resolveBusinessLine(c);
        const row = lineCounts.get(line.id) ?? { label: line.label, cases: 0 };
        row.cases += 1;
        lineCounts.set(line.id, row);
      }

      const score = agentScore(metrics, csat);
      return {
        agentId,
        agentName:
          list.find((c) => c.assigned_agent_name)?.assigned_agent_name ??
          (agentId === "unassigned" ? "Unassigned queue" : `Agent ${agentId.slice(0, 8)}`),
        role: list.find((c) => c.agent_role)?.agent_role ?? list.find((c) => c.assigned_team)?.assigned_team ?? "Unassigned",
        cases: list.length,
        open,
        resolved: list.filter((c) => c.resolved_at).length,
        metrics,
        csat,
        csatResponses: scores.length,
        utilisation: Math.round((open / capacity) * 100),
        capacity,
        score,
        grade: gradeFor(score),
        lines: [...lineCounts.entries()]
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => b.cases - a.cases),
      } satisfies AgentScorecard;
    })
    .sort((a, b) => b.score - a.score || b.cases - a.cases);
}

export interface PerformanceGroup {
  key: string;
  label: string;
  cases: number;
  open: number;
  agents: number;
  metrics: SlaMetrics;
  csat: number | null;
  utilisation: number;
  score: number;
  grade: PerformanceGrade;
}

const groupRows = (
  buckets: Map<string, { label: string; cases: PerformanceCase[] }>,
  capacity: number,
): PerformanceGroup[] =>
  [...buckets.entries()]
    .map(([key, { label, cases }]) => {
      const metrics = slaMetrics(cases);
      const scores = cases
        .map((c) => c.satisfaction_score)
        .filter((s): s is number => typeof s === "number" && s > 0);
      const csat = avg(scores);
      const agents = new Set(cases.map((c) => c.assigned_to ?? "unassigned")).size;
      const open = cases.filter((c) => OPEN.has(c.status)).length;
      const score = agentScore(metrics, csat);
      return {
        key,
        label,
        cases: cases.length,
        open,
        agents,
        metrics,
        csat,
        utilisation: Math.round((open / (capacity * Math.max(1, agents))) * 100),
        score,
        grade: gradeFor(score),
      } satisfies PerformanceGroup;
    })
    .sort((a, b) => a.score - b.score);

/** Performance rolled up by role / owning team. */
export function performanceByRole(cases: PerformanceCase[], capacityPerAgent = 12): PerformanceGroup[] {
  const buckets = new Map<string, { label: string; cases: PerformanceCase[] }>();
  for (const c of cases) {
    const key = c.agent_role ?? c.assigned_team ?? "Unassigned";
    const row = buckets.get(key) ?? { label: key, cases: [] };
    row.cases.push(c);
    buckets.set(key, row);
  }
  return groupRows(buckets, capacityPerAgent);
}

/** Performance rolled up by commercial business line. */
export function performanceByLine(cases: PerformanceCase[], capacityPerAgent = 12): PerformanceGroup[] {
  const buckets = new Map<string, { label: string; cases: PerformanceCase[] }>();
  for (const c of cases) {
    const { line } = resolveBusinessLine(c);
    const row = buckets.get(line.id) ?? { label: line.label, cases: [] };
    row.cases.push(c);
    buckets.set(line.id, row);
  }
  return groupRows(buckets, capacityPerAgent);
}

export interface DeskPerformance {
  agents: number;
  cases: number;
  open: number;
  metrics: SlaMetrics;
  csat: number | null;
  csatResponses: number;
  utilisation: number;
  offTargetAgents: number;
  /** Agents above 85% of capacity. */
  stretchedAgents: number;
}

/** Whole-desk headline used for the KPI strip. */
export function deskPerformance(cases: PerformanceCase[], capacityPerAgent = 12): DeskPerformance {
  const cards = agentScorecards(cases, { capacityPerAgent });
  const scores = cases
    .map((c) => c.satisfaction_score)
    .filter((s): s is number => typeof s === "number" && s > 0);
  const open = cases.filter((c) => OPEN.has(c.status)).length;
  const realAgents = cards.filter((c) => c.agentId !== "unassigned");
  return {
    agents: realAgents.length,
    cases: cases.length,
    open,
    metrics: slaMetrics(cases),
    csat: avg(scores),
    csatResponses: scores.length,
    utilisation: Math.round((open / (capacityPerAgent * Math.max(1, realAgents.length))) * 100),
    offTargetAgents: realAgents.filter((c) => c.grade === "off_target").length,
    stretchedAgents: realAgents.filter((c) => c.utilisation >= 85).length,
  };
}

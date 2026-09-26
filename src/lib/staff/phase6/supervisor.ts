/**
 * Phase 6 — Agent Supervisor and AI circuit breakers.
 *
 * The supervisor is the safety layer between an agent's intent and the business.
 * Breakers trip on measured conditions only, and a tripped breaker withdraws
 * autonomy immediately — the agent drops to proposing work for humans rather
 * than acting. A breaker whose condition cannot be measured is reported as
 * UNMONITORED, which itself caps autonomy: unobservable safety is not safety.
 */
import type { Coverage } from "@/lib/staff/phase2/readiness";
import type { AgentConfidence } from "@/lib/staff/phase5/outcomes";
import type { AgentEvaluation } from "./qualityGates";

export type BreakerState = "closed" | "tripped" | "unmonitored";

export interface Breaker {
  key: string;
  label: string;
  /** The condition that trips it. */
  condition: string;
  /** Table that observes the condition. */
  observedBy: string | null;
  /** What happens when it trips. */
  onTrip: string;
}

export const BREAKERS: readonly Breaker[] = [
  { key: "accuracy_collapse", label: "Accuracy collapse", condition: "Measured outcomes diverge from predictions beyond tolerance", observedBy: "staff_action_outcomes", onTrip: "Agent drops to advise-only; open proposals are held for review" },
  { key: "unauthorised_write", label: "Unauthorised write attempt", condition: "Any access denial attributable to agent activity", observedBy: "access_denials", onTrip: "Execution authority withdrawn pending governance review" },
  { key: "decision_backlog", label: "Authority backlog", condition: "Human decisions queued beyond their SLA", observedBy: "staff_decisions", onTrip: "Agent stops generating new A3+ proposals until the queue drains" },
  { key: "financial_exposure", label: "Financial exposure", condition: "Wallet or settlement mismatch detected", observedBy: "charter_wallet_reconciliation_findings", onTrip: "All financial actions frozen; finance authority notified" },
  { key: "compliance_breach", label: "Compliance breach", condition: "Open compliance alert in the agent's domain", observedBy: "compliance_alerts", onTrip: "Domain actions frozen; compliance authority notified" },
  { key: "reliability_loss", label: "Platform reliability loss", condition: "Availability below the service objective", observedBy: "availability_metrics", onTrip: "Non-essential agent activity suspended to protect the platform" },
  { key: "audit_gap", label: "Audit gap", condition: "Actions executing without a readable audit trail", observedBy: "staff_decision_audit", onTrip: "Execution halted — no action may run unaudited" },
];

export interface BreakerStatus {
  breaker: Breaker;
  state: BreakerState;
  /** Measured value behind the state. */
  observed: number | null;
  detail: string;
}

/**
 * Evaluate every breaker from readable evidence. Row presence in an adverse
 * table (denials, findings, alerts) trips the breaker; unreadable evidence
 * leaves it unmonitored.
 */
export function evaluateBreakers(coverage: Coverage, learning: readonly AgentConfidence[] = []): BreakerStatus[] {
  return BREAKERS.map((breaker): BreakerStatus => {
    const probe = breaker.observedBy ? coverage[breaker.observedBy] : undefined;
    if (!probe || probe.rows === null) {
      return {
        breaker,
        state: "unmonitored",
        observed: null,
        detail: breaker.observedBy
          ? `${breaker.observedBy} ${probe ? probe.error ?? "unreadable" : "not probed"} — condition cannot be observed`
          : "No system of record observes this condition",
      };
    }
    const rows = probe.rows;
    if (breaker.key === "accuracy_collapse") {
      const reducing = learning.filter((l) => l.recommendation === "reduce");
      return reducing.length > 0
        ? { breaker, state: "tripped", observed: reducing.length, detail: `${reducing.length} agent(s) show measured failure rates that require reduced autonomy` }
        : { breaker, state: "closed", observed: rows, detail: `No agent's measured accuracy is below tolerance across ${rows} outcome row(s)` };
    }
    const adverse = ["unauthorised_write", "financial_exposure", "compliance_breach", "reliability_loss"].includes(breaker.key);
    if (adverse) {
      return rows > 0
        ? { breaker, state: "tripped", observed: rows, detail: `${rows} row(s) in ${breaker.observedBy} match the trip condition` }
        : { breaker, state: "closed", observed: 0, detail: `No matching rows in ${breaker.observedBy}` };
    }
    return { breaker, state: "closed", observed: rows, detail: `${breaker.observedBy} readable (${rows} row(s)) — condition not met` };
  });
}

export interface SupervisorVerdict {
  /** Breakers currently preventing autonomous execution. */
  tripped: BreakerStatus[];
  unmonitored: BreakerStatus[];
  /** True only when every breaker is closed and monitored. */
  executionPermitted: boolean;
  /** The ceiling the supervisor imposes regardless of earned gates. */
  ceiling: "observe" | "advise" | "prepare" | "execute";
  statement: string;
}

export function supervise(statuses: readonly BreakerStatus[]): SupervisorVerdict {
  const tripped = statuses.filter((s) => s.state === "tripped");
  const unmonitored = statuses.filter((s) => s.state === "unmonitored");
  const ceiling = tripped.length > 0 ? "advise" : unmonitored.length > 0 ? "prepare" : "execute";
  const statement =
    tripped.length > 0
      ? `Execution withdrawn — ${tripped.length} circuit breaker(s) tripped.`
      : unmonitored.length > 0
        ? `Execution capped at prepare-only — ${unmonitored.length} safety condition(s) cannot be observed.`
        : "All safety conditions monitored and closed — earned autonomy applies.";
  return { tripped, unmonitored, executionPermitted: tripped.length === 0 && unmonitored.length === 0, ceiling, statement };
}

/** The effective autonomy of an agent: earned tier, capped by the supervisor. */
export interface EffectiveAutonomy {
  agentKey: string;
  agentLabel: string;
  earned: string;
  effective: string;
  cappedBy: string | null;
}

const TIER_RANK: Record<string, number> = {
  observe: 0, advise: 1, prepare: 2, execute_reversible: 3, execute_scoped: 4,
};
const CEILING_TIER: Record<SupervisorVerdict["ceiling"], string> = {
  observe: "observe", advise: "advise", prepare: "prepare", execute: "execute_scoped",
};

export function effectiveAutonomy(
  evaluations: readonly AgentEvaluation[],
  verdict: SupervisorVerdict,
): EffectiveAutonomy[] {
  const cap = CEILING_TIER[verdict.ceiling];
  return evaluations.map((e) => {
    const capped = TIER_RANK[e.tier] > TIER_RANK[cap];
    return {
      agentKey: e.agent.key,
      agentLabel: e.agent.name,
      earned: e.tierLabel,
      effective: capped ? cap.replace(/_/g, " ") : e.tierLabel,
      cappedBy: capped ? verdict.statement : null,
    };
  });
}

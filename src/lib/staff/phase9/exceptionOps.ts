/**
 * Phase 9 §12 — exception-first operations.
 *
 * Dispatchers do not stare at maps. The queue answers one question: what
 * requires intervention, and in what order? Ordering is by consequence
 * (revenue, customer, SLA, safety) and time criticality — never by recency.
 */
import { clamp } from "../phase8/provenance";

export const EXCEPTION_KINDS = [
  "late_pickup", "no_driver", "vehicle_unavailable", "route_disruption",
  "customer_unreachable", "package_exception", "airport_delay",
  "sla_risk", "payment_failure",
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  late_pickup: "Late pickup",
  no_driver: "No driver assigned",
  vehicle_unavailable: "Vehicle unavailable",
  route_disruption: "Route disruption",
  customer_unreachable: "Customer unreachable",
  package_exception: "Package exception",
  airport_delay: "Airport / flight delay",
  sla_risk: "SLA at risk",
  payment_failure: "Payment failure",
};

/** Base consequence weight: safety and revenue outrank convenience. */
const CONSEQUENCE: Record<ExceptionKind, number> = {
  no_driver: 95,
  payment_failure: 85,
  airport_delay: 80,
  sla_risk: 78,
  vehicle_unavailable: 75,
  late_pickup: 70,
  package_exception: 60,
  route_disruption: 58,
  customer_unreachable: 45,
};

/** The single action that resolves each kind — no generic "investigate". */
const PLAYBOOK: Record<ExceptionKind, string> = {
  no_driver: "Re-run matching with widened radius; if still unmatched, escalate to supply acquisition for this cell.",
  payment_failure: "Re-attempt collection on the authorised instrument, then hold operator settlement until reconciled.",
  airport_delay: "Recompute driver on-site time from the live flight estimate and notify the passenger and operator.",
  sla_risk: "Reassign to the nearest compliant candidate with SLA headroom, or renegotiate the commitment now.",
  vehicle_unavailable: "Substitute an equivalent-capability unit; if none, contact the customer before the pickup window.",
  late_pickup: "Contact the assigned driver, publish a revised ETA, and record the cause against the operator's reliability.",
  package_exception: "Capture evidence, classify the exception, and route to the claims workflow if liability is possible.",
  route_disruption: "Re-route and re-publish the ETA; notify the receiving party if the time window moves.",
  customer_unreachable: "Attempt the recorded contact channels, then apply the waiting and no-show policy.",
};

export interface OperationalException {
  id: string;
  kind: ExceptionKind;
  bookingId: string | null;
  customerName: string | null;
  operatorName: string | null;
  location: string | null;
  /** Revenue exposed by the exception, KES. */
  revenueAtRisk: number | null;
  /** Minutes until the consequence becomes irreversible; null when unknown. */
  minutesToImpact: number | null;
  /** Is this a corporate/contracted customer with penalty exposure? */
  contractualPenalty: boolean;
  detectedAt: string;
  detail: string;
  source: string;
}

export interface TriagedException extends OperationalException {
  /** 0-100 intervention priority. */
  priority: number;
  severity: "act_now" | "act_today" | "monitor";
  /** Explainable score breakdown. */
  factors: { factor: string; contribution: number; observed: string }[];
  action: string;
}

export function triageException(e: OperationalException, revenueScale = 20_000): TriagedException {
  const base = CONSEQUENCE[e.kind];
  const revenueTerm = e.revenueAtRisk === null ? 0 : clamp((e.revenueAtRisk / revenueScale) * 20, 0, 25);
  const timeTerm = e.minutesToImpact === null ? 5 : clamp(25 - e.minutesToImpact / 4, 0, 25);
  const penaltyTerm = e.contractualPenalty ? 12 : 0;

  const priority = clamp(base * 0.6 + revenueTerm + timeTerm + penaltyTerm, 0, 100);
  return {
    ...e,
    priority,
    severity: priority >= 80 ? "act_now" : priority >= 60 ? "act_today" : "monitor",
    factors: [
      { factor: "Consequence class", contribution: base * 0.6, observed: `${EXCEPTION_LABEL[e.kind]} carries a base consequence of ${base}/100` },
      { factor: "Revenue at risk", contribution: revenueTerm, observed: e.revenueAtRisk === null ? "not quantified" : `KES ${e.revenueAtRisk.toLocaleString()}` },
      { factor: "Time to impact", contribution: timeTerm, observed: e.minutesToImpact === null ? "unknown — treated conservatively" : `${e.minutesToImpact} min` },
      { factor: "Contractual penalty", contribution: penaltyTerm, observed: e.contractualPenalty ? "contracted customer with penalty exposure" : "no contractual penalty" },
    ],
    action: PLAYBOOK[e.kind],
  };
}

export interface ExceptionQueue {
  items: TriagedException[];
  actNow: number;
  /** Total quantified revenue exposure in the queue. */
  revenueAtRisk: number | null;
  /** Kind driving most of the queue — the systemic fix, not the individual one. */
  dominantKind: ExceptionKind | null;
  headline: string;
}

export function buildExceptionQueue(exceptions: readonly OperationalException[]): ExceptionQueue {
  const items = exceptions.map((e) => triageException(e)).sort((a, b) => b.priority - a.priority);
  const quantified = items.filter((i) => i.revenueAtRisk !== null);
  const counts = new Map<ExceptionKind, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const actNow = items.filter((i) => i.severity === "act_now").length;

  return {
    items,
    actNow,
    revenueAtRisk: quantified.length ? quantified.reduce((a, i) => a + (i.revenueAtRisk ?? 0), 0) : null,
    dominantKind: dominant,
    headline: items.length === 0
      ? "Nothing requires intervention from the evidenced signals in this window."
      : `${actNow} of ${items.length} exception(s) require action now${dominant ? `; ${EXCEPTION_LABEL[dominant]} dominates the queue and should be fixed as a systemic cause, not case by case` : ""}.`,
  };
}

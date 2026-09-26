/**
 * Operational Control Plane — Enterprise Operating Model, Layer 3.
 *
 * Capability certification proves a capability EXISTS. The control plane proves
 * it is HEALTHY: workflow success rate, event latency, queue depth, SLA
 * breaches, failed retries, reconciliation lag and integration health.
 *
 * Pure scoring over supplied observations — callers fetch the telemetry.
 */
import { BUSINESS_PROCESS_CATALOG, type ProcessId } from "./processCatalog";

export type SignalKind =
  | "workflow_success_rate"
  | "event_latency_p95_minutes"
  | "queue_depth"
  | "sla_breaches"
  | "failed_retries"
  | "reconciliation_lag_minutes"
  | "integration_health";

export type HealthState = "healthy" | "degraded" | "breached" | "unknown";

export interface ControlSignal {
  kind: SignalKind;
  /** Process, capability or integration the signal belongs to. */
  subject: string;
  value: number;
  observedAt?: string;
}

interface Threshold {
  /** true when higher is better. */
  higherIsBetter: boolean;
  warn: number;
  breach: number;
  unit: string;
  label: string;
}

export const CONTROL_THRESHOLDS: Record<SignalKind, Threshold> = {
  workflow_success_rate: { higherIsBetter: true, warn: 98, breach: 95, unit: "%", label: "Workflow success rate" },
  event_latency_p95_minutes: { higherIsBetter: false, warn: 5, breach: 15, unit: "m", label: "Event latency (p95)" },
  queue_depth: { higherIsBetter: false, warn: 500, breach: 2000, unit: "msgs", label: "Queue depth" },
  sla_breaches: { higherIsBetter: false, warn: 5, breach: 20, unit: "count", label: "SLA breaches" },
  failed_retries: { higherIsBetter: false, warn: 10, breach: 50, unit: "count", label: "Failed retries" },
  reconciliation_lag_minutes: { higherIsBetter: false, warn: 60, breach: 240, unit: "m", label: "Reconciliation lag" },
  integration_health: { higherIsBetter: true, warn: 98, breach: 95, unit: "%", label: "Integration health" },
};

export function evaluateSignal(signal: ControlSignal): HealthState {
  const t = CONTROL_THRESHOLDS[signal.kind];
  if (!Number.isFinite(signal.value)) return "unknown";
  if (t.higherIsBetter) {
    if (signal.value < t.breach) return "breached";
    if (signal.value < t.warn) return "degraded";
    return "healthy";
  }
  if (signal.value > t.breach) return "breached";
  if (signal.value > t.warn) return "degraded";
  return "healthy";
}

export interface SignalAssessment extends ControlSignal {
  state: HealthState;
  label: string;
  unit: string;
  /** 0-100 contribution to the control plane score. */
  score: number;
}

const STATE_SCORE: Record<HealthState, number> = { healthy: 100, degraded: 75, breached: 30, unknown: 50 };

export interface ProcessHealth {
  process: ProcessId | string;
  state: HealthState;
  score: number;
  signals: SignalAssessment[];
}

export interface ControlPlaneReport {
  score: number;
  state: HealthState;
  observed: number;
  /** Process/capability subjects with zero telemetry — blind spots. */
  blindSpots: string[];
  breaches: SignalAssessment[];
  processes: ProcessHealth[];
}

function assess(signal: ControlSignal): SignalAssessment {
  const state = evaluateSignal(signal);
  const t = CONTROL_THRESHOLDS[signal.kind];
  return { ...signal, state, label: t.label, unit: t.unit, score: STATE_SCORE[state] };
}

function worst(states: HealthState[]): HealthState {
  if (states.includes("breached")) return "breached";
  if (states.includes("degraded")) return "degraded";
  if (states.length === 0) return "unknown";
  return states.every((s) => s === "unknown") ? "unknown" : "healthy";
}

/**
 * Roll observations up into a control-plane view. Subjects with no signal at
 * all are reported as blind spots rather than silently scoring 100.
 */
export function assessControlPlane(
  signals: ControlSignal[],
  subjects: string[] = BUSINESS_PROCESS_CATALOG.map((p) => p.id),
): ControlPlaneReport {
  const assessments = signals.map(assess);
  const processes: ProcessHealth[] = subjects.map((subject) => {
    const own = assessments.filter((a) => a.subject === subject);
    return {
      process: subject,
      state: worst(own.map((a) => a.state)),
      score: own.length === 0 ? 50 : Math.round(own.reduce((s, a) => s + a.score, 0) / own.length),
      signals: own,
    };
  });

  const blindSpots = processes.filter((p) => p.signals.length === 0).map((p) => String(p.process));
  const score = processes.length === 0 ? 0 : Math.round(processes.reduce((s, p) => s + p.score, 0) / processes.length);

  return {
    score,
    state: worst(processes.map((p) => p.state)),
    observed: assessments.length,
    blindSpots,
    breaches: assessments.filter((a) => a.state === "breached"),
    processes,
  };
}

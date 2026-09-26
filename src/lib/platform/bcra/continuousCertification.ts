/**
 * BCRA Phase 6 — Continuous Certification.
 *
 * Replaces point-in-time release certification with rolling operational
 * assurance. Windows (1h / 24h / 7d / 30d) are computed from control-plane
 * telemetry already emitted by the platform; when no observation exists the
 * window is reported as `unobserved` rather than silently scoring 100.
 */
import { assessControlPlane, type ControlSignal } from "../controlPlane";
import type { BcraCapabilityRegister } from "./capabilityRelease";
import type { ValueStreamRegister } from "./valueStreams";
import type { DependencyMatrixReport } from "./dependencyIntelligence";
import type { BcraAiGovernanceReport } from "./aiGovernanceRegistries";

export const CONTINUOUS_VERSION = "1.0.0";

export const CERTIFICATION_WINDOWS = ["1h", "24h", "7d", "30d"] as const;
export type CertificationWindow = (typeof CERTIFICATION_WINDOWS)[number];

export const DRIFT_KINDS = ["capability", "policy", "operational", "ai", "risk", "sla"] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

/** A prior certification snapshot used to compute drift. Optional by design. */
export interface CertificationSnapshot {
  window: CertificationWindow;
  capability: number;
  policy: number;
  operational: number;
  ai: number;
  risk: number;
  sla: number;
}

export interface WindowResult {
  window: CertificationWindow;
  observed: boolean;
  score: number;
  state: "healthy" | "degraded" | "breached" | "unobserved";
  signals: number;
  breaches: string[];
}

export interface DriftResult {
  kind: DriftKind;
  current: number;
  previous: number | null;
  deltaPct: number;
  trend: "improving" | "stable" | "degrading" | "unknown";
  breached: boolean;
}

export interface ContinuousCertificationReport {
  version: string;
  windows: WindowResult[];
  drift: DriftResult[];
  /** Continuous assurance score — the worst observed window governs. */
  score: number;
  passed: boolean;
  operational: boolean;
  blindSpots: string[];
  blockers: string[];
}

const DRIFT_TOLERANCE = 5;

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function windowState(score: number): WindowResult["state"] {
  if (score >= 90) return "healthy";
  if (score >= 75) return "degraded";
  return "breached";
}

export function certifyContinuous(
  register: BcraCapabilityRegister,
  streams: ValueStreamRegister,
  dependencies: DependencyMatrixReport,
  ai: BcraAiGovernanceReport,
  signalsByWindow: Partial<Record<CertificationWindow, ControlSignal[]>> = {},
  previous: CertificationSnapshot[] = [],
): ContinuousCertificationReport {
  const baseline = clamp(register.score * 0.4 + streams.score * 0.3 + dependencies.score * 0.3);

  const windows: WindowResult[] = CERTIFICATION_WINDOWS.map((window) => {
    const signals = signalsByWindow[window] ?? [];
    if (signals.length === 0) {
      return { window, observed: false, score: baseline, state: "unobserved", signals: 0, breaches: [] };
    }
    const cp = assessControlPlane(signals);
    const score = clamp(baseline * 0.5 + cp.score * 0.5);
    return {
      window,
      observed: true,
      score,
      state: cp.state === "unknown" ? "unobserved" : windowState(score),
      signals: cp.observed,
      breaches: cp.breaches.map((b) => `${b.subject}: ${b.label} ${b.value}${b.unit}`),
    };
  });

  const current: Record<DriftKind, number> = {
    capability: register.score,
    policy: clamp(register.dimensionAverages.find((d) => d.dimension === "compliance")?.score ?? 0),
    operational: clamp(register.dimensionAverages.find((d) => d.dimension === "operational")?.score ?? 0),
    ai: ai.score,
    risk: dependencies.score,
    sla: clamp((streams.streams.filter((s) => s.slaHonoured).length / Math.max(1, streams.streams.length)) * 100),
  };

  const drift: DriftResult[] = DRIFT_KINDS.map((kind) => {
    const prevs = previous.map((p) => p[kind]).filter((v) => typeof v === "number");
    const prev = prevs.length === 0 ? null : Math.round(prevs.reduce((a, b) => a + b, 0) / prevs.length);
    const delta = prev === null ? 0 : current[kind] - prev;
    return {
      kind,
      current: current[kind],
      previous: prev,
      deltaPct: delta,
      trend: prev === null ? "unknown" : delta > DRIFT_TOLERANCE ? "improving" : delta < -DRIFT_TOLERANCE ? "degrading" : "stable",
      breached: prev !== null && delta < -DRIFT_TOLERANCE,
    };
  });

  const observed = windows.filter((w) => w.observed);
  const score = observed.length === 0 ? baseline : clamp(Math.min(...observed.map((w) => w.score)));
  const blockers = [
    ...windows.filter((w) => w.state === "breached").map((w) => `window ${w.window} breached at ${w.score}/100`),
    ...drift.filter((d) => d.breached).map((d) => `${d.kind} drift ${d.deltaPct}% below the previous snapshot`),
  ];

  return {
    version: CONTINUOUS_VERSION,
    windows,
    drift,
    score,
    passed: blockers.length === 0 && score >= 80,
    operational: true,
    blindSpots: windows.filter((w) => !w.observed).map((w) => `no telemetry for the ${w.window} window`),
    blockers,
  };
}

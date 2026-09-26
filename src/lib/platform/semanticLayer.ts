/**
 * IEOS Phase 7 · Workstream 4 — Enterprise Semantic Layer & Metric Contracts.
 *
 * Every executive number in the platform must resolve to exactly one governed
 * definition: one formula, one grain, one owner, one source of truth. This
 * module is that registry plus the certification that detects duplicate,
 * undefined, unowned, ungrounded or drifting metrics.
 *
 * Pure and deterministic. No state, no network, no schema access.
 */
import {
  clamp,
  round,
  pct,
  grade,
  makeFinding,
  sortFindings,
  type Grade,
  type PlatformFinding,
} from "./_shared";
import { eventRegistry } from "./eventRegistry";
import { BUSINESS_PROCESS_CATALOG, type ProcessId } from "./processCatalog";

export type MetricDomain =
  | "finance"
  | "operations"
  | "customer"
  | "supply"
  | "trust"
  | "platform";

export type MetricGrain = "event" | "trip" | "order" | "day" | "customer" | "partner" | "process";

export type MetricUnit = "count" | "percent" | "minutes" | "kes" | "score" | "ratio";

export interface MetricContract {
  id: string;
  label: string;
  domain: MetricDomain;
  /** Plain-language definition — this is the wording executives see. */
  definition: string;
  /** Deterministic formula expressed over named inputs. */
  formula: string;
  grain: MetricGrain;
  unit: MetricUnit;
  /** Accountable business owner role. */
  owner: string;
  /** Canonical events the metric is derived from (must exist in the registry). */
  sourceEvents: string[];
  /** Processes this metric reports on. */
  processes: ProcessId[];
  /** Tolerated variance (%) between independent computations before drift is raised. */
  driftTolerancePct: number;
  version: string;
}

export const METRIC_CONTRACTS: MetricContract[] = [
  {
    id: "gross_bookings",
    label: "Gross bookings",
    domain: "finance",
    definition: "Total customer-charged value of completed trips and deliveries before deductions.",
    formula: "sum(trip.fare_total) + sum(delivery.fare_total)",
    grain: "day",
    unit: "kes",
    owner: "Head of Finance",
    sourceEvents: ["ride.completed", "wallet.debited"],
    processes: ["ride_to_cash"],
    driftTolerancePct: 0.5,
    version: "1.0.0",
  },
  {
    id: "net_revenue",
    label: "Net revenue",
    domain: "finance",
    definition: "Gross bookings less driver/partner earnings, refunds and promotional spend.",
    formula: "gross_bookings - partner_earnings - refunds - promotions",
    grain: "day",
    unit: "kes",
    owner: "Head of Finance",
    sourceEvents: ["wallet.debited", "settlement.completed", "refund.approved"],
    processes: ["ride_to_cash", "procure_to_pay"],
    driftTolerancePct: 0.5,
    version: "1.0.0",
  },
  {
    id: "payment_success_rate",
    label: "Payment success rate",
    domain: "finance",
    definition: "Share of payment attempts reaching a captured terminal state.",
    formula: "captured_attempts / total_attempts * 100",
    grain: "day",
    unit: "percent",
    owner: "Head of Payments",
    sourceEvents: ["ride.booked", "wallet.debited", "wallet.credited"],
    processes: ["ride_to_cash"],
    driftTolerancePct: 0.2,
    version: "1.0.0",
  },
  {
    id: "trip_completion_rate",
    label: "Trip completion rate",
    domain: "operations",
    definition: "Share of accepted trips that reach completion without cancellation.",
    formula: "completed_trips / accepted_trips * 100",
    grain: "day",
    unit: "percent",
    owner: "Head of Operations",
    sourceEvents: ["ride.started", "ride.completed", "ride.cancelled"],
    processes: ["ride_to_cash"],
    driftTolerancePct: 0.5,
    version: "1.0.0",
  },
  {
    id: "sla_attainment",
    label: "SLA attainment",
    domain: "operations",
    definition: "Share of process instances completing inside their declared SLA window.",
    formula: "instances_within_sla / total_instances * 100",
    grain: "process",
    unit: "percent",
    owner: "Head of Operations",
    sourceEvents: ["package.delivered", "ride.completed"],
    processes: ["ride_to_cash", "delivery_to_cash"],
    driftTolerancePct: 1,
    version: "1.0.0",
  },
  {
    id: "case_resolution_time",
    label: "Case resolution time",
    domain: "customer",
    definition: "Mean elapsed minutes from support case intake to verified resolution.",
    formula: "mean(case.resolved_at - case.created_at)",
    grain: "customer",
    unit: "minutes",
    owner: "Head of Customer Operations",
    sourceEvents: ["case.opened", "case.resolved"],
    processes: ["support_to_closure"],
    driftTolerancePct: 2,
    version: "1.0.0",
  },
  {
    id: "active_supply_hours",
    label: "Active supply hours",
    domain: "supply",
    definition: "Total hours partners were online and eligible to receive dispatch.",
    formula: "sum(partner.online_minutes) / 60",
    grain: "partner",
    unit: "count",
    owner: "Head of Supply",
    sourceEvents: ["driver.incident.recorded", "driver.suspended"],
    processes: ["driver_onboard_to_active"],
    driftTolerancePct: 2,
    version: "1.0.0",
  },
  {
    id: "fraud_loss_rate",
    label: "Fraud loss rate",
    domain: "trust",
    definition: "Confirmed fraudulent value as a share of gross bookings.",
    formula: "confirmed_fraud_value / gross_bookings * 100",
    grain: "day",
    unit: "percent",
    owner: "Head of Trust & Safety",
    sourceEvents: ["fraud.signal.raised", "refund.approved"],
    processes: ["ride_to_cash"],
    driftTolerancePct: 0.1,
    version: "1.0.0",
  },
];

/** A metric as actually computed somewhere in the platform. */
export interface MetricImplementation {
  metricId: string;
  /** Where the number is produced — dashboard, RPC, report. */
  surface: string;
  /** Formula the surface actually uses. */
  formula: string;
  /** Value produced for the certification window, if observed. */
  value?: number;
}

export interface MetricAssessment {
  metricId: string;
  label: string;
  registered: boolean;
  owner: string | null;
  /** All events referenced exist in the canonical event registry. */
  grounded: boolean;
  ungroundedEvents: string[];
  implementations: number;
  /** Distinct formulas observed across surfaces — >1 means a definition conflict. */
  formulaVariants: string[];
  /** Max observed variance between implementations, in percent. */
  observedDriftPct: number;
  withinTolerance: boolean;
  score: number;
}

export interface SemanticLayerReport {
  score: number;
  grade: Grade;
  /** Share of registered metrics with at least one implementation. */
  implementationCoveragePct: number;
  /** Share of registered metrics grounded in canonical events. */
  groundingCoveragePct: number;
  conflictedMetrics: string[];
  unregisteredSurfaces: string[];
  assessments: MetricAssessment[];
  findings: PlatformFinding[];
}

const NS = "sem";

function eventExists(name: string): boolean {
  return eventRegistry().some((e) => e.name === name);
}

export function certifySemanticLayer(input: {
  implementations?: MetricImplementation[];
}): SemanticLayerReport {
  const implementations = input.implementations ?? [];
  const findings: PlatformFinding[] = [];

  const unregisteredSurfaces = [
    ...new Set(
      implementations
        .filter((i) => !METRIC_CONTRACTS.some((m) => m.id === i.metricId))
        .map((i) => `${i.surface}:${i.metricId}`),
    ),
  ].sort();

  for (const surface of unregisteredSurfaces) {
    findings.push(
      makeFinding(
        NS,
        "p1",
        surface,
        "Surface publishes a metric that has no governed contract.",
        "Register the metric in METRIC_CONTRACTS with an owner, formula and source events, or retire the surface.",
      ),
    );
  }

  const assessments: MetricAssessment[] = METRIC_CONTRACTS.map((contract) => {
    const impls = implementations.filter((i) => i.metricId === contract.id);
    const formulaVariants = [...new Set(impls.map((i) => i.formula))].sort();
    const values = impls.map((i) => i.value).filter((v): v is number => Number.isFinite(v));

    let observedDriftPct = 0;
    if (values.length > 1) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const base = Math.abs(max) || 1;
      observedDriftPct = round(((max - min) / base) * 100, 3);
    }

    const ungroundedEvents = contract.sourceEvents.filter((e) => !eventExists(e)).sort();
    const grounded = ungroundedEvents.length === 0;
    const conflicted = formulaVariants.length > 1;
    const withinTolerance = observedDriftPct <= contract.driftTolerancePct;

    let score = 100;
    if (impls.length === 0) score -= 40;
    if (!grounded) score -= 25;
    if (conflicted) score -= 30;
    if (!withinTolerance) score -= 20;
    score = clamp(score);

    if (impls.length === 0) {
      findings.push(
        makeFinding(
          NS,
          "p2",
          contract.id,
          "Governed metric has no observed implementation.",
          `Wire ${contract.label} into at least one certified surface or deprecate the contract.`,
        ),
      );
    }
    if (!grounded) {
      findings.push(
        makeFinding(
          NS,
          "p1",
          contract.id,
          `Metric references events absent from the canonical registry: ${ungroundedEvents.join(", ")}.`,
          "Register the missing events in eventRegistry.ts or correct the contract's source events.",
        ),
      );
    }
    if (conflicted) {
      findings.push(
        makeFinding(
          NS,
          "p0",
          contract.id,
          `Metric is computed ${formulaVariants.length} different ways across surfaces.`,
          `Collapse every surface onto the governed formula: ${contract.formula}.`,
        ),
      );
    }
    if (!withinTolerance) {
      findings.push(
        makeFinding(
          NS,
          "p0",
          contract.id,
          `Observed variance ${observedDriftPct}% exceeds tolerance ${contract.driftTolerancePct}%.`,
          `Reconcile implementations with ${contract.owner} before the number is published externally.`,
        ),
      );
    }

    return {
      metricId: contract.id,
      label: contract.label,
      registered: true,
      owner: contract.owner,
      grounded,
      ungroundedEvents,
      implementations: impls.length,
      formulaVariants,
      observedDriftPct,
      withinTolerance,
      score,
    };
  });

  const implemented = assessments.filter((a) => a.implementations > 0).length;
  const groundedCount = assessments.filter((a) => a.grounded).length;
  const conflictedMetrics = assessments.filter((a) => a.formulaVariants.length > 1).map((a) => a.metricId);

  const base = assessments.reduce((sum, a) => sum + a.score, 0) / (assessments.length || 1);
  const p0Drag = findings.filter((f) => f.severity === "p0").length * 5;
  const score = round(clamp(base - p0Drag));

  return {
    score,
    grade: grade(score),
    implementationCoveragePct: round(pct(implemented, assessments.length)),
    groundingCoveragePct: round(pct(groundedCount, assessments.length)),
    conflictedMetrics,
    unregisteredSurfaces,
    assessments,
    findings: sortFindings(findings),
  };
}

/** Metrics that report on a given business process — used by the cockpit. */
export function metricsForProcess(processId: ProcessId): MetricContract[] {
  const known = BUSINESS_PROCESS_CATALOG.some((p) => p.id === processId);
  if (!known) return [];
  return METRIC_CONTRACTS.filter((m) => m.processes.includes(processId));
}

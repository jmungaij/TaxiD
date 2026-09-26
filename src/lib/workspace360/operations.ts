/**
 * Phase D7.9 — Enterprise Operational Qualification.
 *
 * Pure, network-free certifier that extends architectural + business
 * governance (D7.7 / D7.8) with OPERATIONAL guarantees. It answers: is
 * the platform ready to run under real production conditions —
 * concurrency, partial failures, replay, and full observability?
 *
 * Four sub-certifications, all declarative and contract-driven:
 *   1. Load & Scalability    — SLOs, rate limits, circuit breakers declared
 *   2. Resilience            — chaos scenarios + dead-letter queues declared
 *   3. Recovery & Replay     — replay certifications + idempotency declared
 *   4. Observability         — outbox tracing + audit + correlation declared
 *
 * No new tables. No new dashboards. No new edge functions. The declared
 * requirements below are the CI ratchet — adding one immediately raises
 * the operational bar for every future domain adoption.
 */
import type { Workspace360HealthContract } from "./health";

/* ----------------------------------------------------------------------- *
 * 1. Load & Scalability Certification.
 * Requires SLO tracking, rate-limiting, and circuit-breaker infra to be
 * registered in the schema contract so a domain cannot "adopt" without
 * inheriting the platform's concurrency guardrails.
 * ----------------------------------------------------------------------- */
export const REQUIRED_LOAD_INFRA: readonly string[] = [
  "payment_slos",
  "payment_slo_measurements",
  "payment_infra_slos",
  "payment_circuit_breakers",
  "mpesa_rate_limit_buckets",
  "mpesa_idempotency_keys",
] as const;

export interface LoadCertificationReport {
  passed: boolean;
  score: number;
  required: string[];
  missing: string[];
}

export function certifyLoadCapacity(
  contract: Workspace360HealthContract,
): LoadCertificationReport {
  const tables = new Set(contract.tables ?? []);
  const missing = REQUIRED_LOAD_INFRA.filter((t) => !tables.has(t));
  const score = Math.round(
    ((REQUIRED_LOAD_INFRA.length - missing.length) / REQUIRED_LOAD_INFRA.length) * 100,
  );
  return {
    passed: missing.length === 0,
    score,
    required: [...REQUIRED_LOAD_INFRA],
    missing,
  };
}

/* ----------------------------------------------------------------------- *
 * 2. Resilience Certification.
 * Requires chaos scenarios and dead-letter capture so failures are
 * simulated ahead of time and captured, not silently lost.
 * ----------------------------------------------------------------------- */
export const REQUIRED_RESILIENCE_INFRA: readonly string[] = [
  "payment_chaos_scenarios",
  "payment_chaos_runs",
  "payment_dead_letters",
  "event_outbox_dlq",
  "alert_dispatch_dlq",
] as const;

export interface ResilienceCertificationReport {
  passed: boolean;
  score: number;
  required: string[];
  missing: string[];
}

export function certifyResilience(
  contract: Workspace360HealthContract,
): ResilienceCertificationReport {
  const tables = new Set(contract.tables ?? []);
  const missing = REQUIRED_RESILIENCE_INFRA.filter((t) => !tables.has(t));
  const score = Math.round(
    ((REQUIRED_RESILIENCE_INFRA.length - missing.length) / REQUIRED_RESILIENCE_INFRA.length) * 100,
  );
  return {
    passed: missing.length === 0,
    score,
    required: [...REQUIRED_RESILIENCE_INFRA],
    missing,
  };
}

/* ----------------------------------------------------------------------- *
 * 3. Recovery & Replay Certification.
 * Interrupted workflows must recover, and replay must not duplicate
 * financial effects. Requires the replay-certification registry AND
 * idempotency-key infrastructure to be present.
 * ----------------------------------------------------------------------- */
export const REQUIRED_RECOVERY_TABLES: readonly string[] = [
  "payment_replay_certifications",
  "payment_replay_simulations",
  "payment_replay_cert_divergences",
  "projection_replay_certifications",
  "idempotency_keys",
  "idempotency_events",
] as const;

export interface RecoveryCertificationReport {
  passed: boolean;
  score: number;
  required: string[];
  missing: string[];
}

export function certifyRecoveryReplay(
  contract: Workspace360HealthContract,
): RecoveryCertificationReport {
  const tables = new Set(contract.tables ?? []);
  const missing = REQUIRED_RECOVERY_TABLES.filter((t) => !tables.has(t));
  const score = Math.round(
    ((REQUIRED_RECOVERY_TABLES.length - missing.length) / REQUIRED_RECOVERY_TABLES.length) * 100,
  );
  return {
    passed: missing.length === 0,
    score,
    required: [...REQUIRED_RECOVERY_TABLES],
    missing,
  };
}

/* ----------------------------------------------------------------------- *
 * 4. Observability Qualification.
 * Every critical workflow must emit correlation id, trace id, audit
 * record, and structured metrics. Enforced by verifying the observability
 * substrate exists AND that outbox events carry the tracing columns.
 * ----------------------------------------------------------------------- */
export const REQUIRED_OBSERVABILITY_TABLES: readonly string[] = [
  "event_outbox",
  "audit_logs",
  "audit_hash_chain",
  "edge_function_invocations",
  "event_processing_metrics",
  "service_health_metrics",
] as const;

export const REQUIRED_OBSERVABILITY_COLUMNS: readonly { table: string; column: string }[] = [
  { table: "event_outbox", column: "correlation_id" },
  { table: "event_outbox", column: "trace_id" },
  { table: "audit_logs",   column: "correlation_id" },
] as const;

export interface ObservabilityCertificationReport {
  passed: boolean;
  score: number;
  requiredTables: string[];
  missingTables: string[];
  requiredColumns: Array<{ table: string; column: string }>;
  missingColumns: Array<{ table: string; column: string }>;
}

export function certifyObservability(
  contract: Workspace360HealthContract,
): ObservabilityCertificationReport {
  const tables = new Set(contract.tables ?? []);
  const cols = new Set(
    (contract.columns ?? []).map((c) => `${c.table}.${c.column}`),
  );
  const missingTables = REQUIRED_OBSERVABILITY_TABLES.filter((t) => !tables.has(t));
  const missingColumns = REQUIRED_OBSERVABILITY_COLUMNS.filter(
    (c) => !cols.has(`${c.table}.${c.column}`),
  );
  const totalChecks =
    REQUIRED_OBSERVABILITY_TABLES.length + REQUIRED_OBSERVABILITY_COLUMNS.length;
  const passedChecks = totalChecks - missingTables.length - missingColumns.length;
  const score = Math.round((passedChecks / totalChecks) * 100);
  return {
    passed: missingTables.length === 0 && missingColumns.length === 0,
    score,
    requiredTables: [...REQUIRED_OBSERVABILITY_TABLES],
    missingTables,
    requiredColumns: [...REQUIRED_OBSERVABILITY_COLUMNS],
    missingColumns,
  };
}

/* ----------------------------------------------------------------------- *
 * Aggregate operational qualification report.
 * ----------------------------------------------------------------------- */
export interface OperationalQualificationReport {
  passed: boolean;
  score: number;
  load: LoadCertificationReport;
  resilience: ResilienceCertificationReport;
  recovery: RecoveryCertificationReport;
  observability: ObservabilityCertificationReport;
  failures: string[];
}

export function certifyOperationalQualification(
  contract: Workspace360HealthContract,
): OperationalQualificationReport {
  const load = certifyLoadCapacity(contract);
  const resilience = certifyResilience(contract);
  const recovery = certifyRecoveryReplay(contract);
  const observability = certifyObservability(contract);

  const failures: string[] = [];
  if (!load.passed)          failures.push(`load: missing ${load.missing.join(", ")}`);
  if (!resilience.passed)    failures.push(`resilience: missing ${resilience.missing.join(", ")}`);
  if (!recovery.passed)      failures.push(`recovery: missing ${recovery.missing.join(", ")}`);
  if (!observability.passed) {
    if (observability.missingTables.length)
      failures.push(`observability: missing tables ${observability.missingTables.join(", ")}`);
    if (observability.missingColumns.length)
      failures.push(
        `observability: missing columns ${observability.missingColumns
          .map((c) => `${c.table}.${c.column}`).join(", ")}`,
      );
  }

  const score = Math.round(
    (load.score + resilience.score + recovery.score + observability.score) / 4,
  );
  return {
    passed: load.passed && resilience.passed && recovery.passed && observability.passed,
    score, load, resilience, recovery, observability, failures,
  };
}

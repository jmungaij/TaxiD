/**
 * Enterprise Event Registry.
 *
 * Evolves the canonical event catalog (an event dictionary) into a governed
 * registry: every canonical event carries schema version, publisher, consumers,
 * retention, replay support, idempotency, ordering guarantees, security
 * classification and observability requirements.
 *
 * The registry is DERIVED — publishers/consumers come from capability
 * contracts, governance defaults come from criticality/domain, and explicit
 * overrides live in one table below. Pure functions, no state, no network.
 */
import { CAPABILITY_CONTRACTS } from "@/lib/contracts";
import { ENTERPRISE_EVENT_CATALOG, type CanonicalEvent, type EventDomain } from "./eventCatalog";

export type RetentionPolicy = "30d" | "90d" | "1y" | "7y";
export type OrderingGuarantee = "none" | "per_key" | "global";
export type SecurityClassification = "public" | "internal" | "confidential" | "restricted";

export interface EventGovernance {
  /** Schema version of the payload contract. Bump only additively. */
  schemaVersion: number;
  retention: RetentionPolicy;
  replaySupported: boolean;
  /** Consumers MUST deduplicate on this key. */
  idempotencyKey: string;
  ordering: OrderingGuarantee;
  classification: SecurityClassification;
  /** Signals that must exist before the event is allowed in production. */
  observability: string[];
}

export interface RegisteredEvent extends CanonicalEvent, EventGovernance {
  publishers: string[];
  consumers: string[];
}

/** Financial and safety domains attract the strictest defaults. */
const REGULATED_DOMAINS: EventDomain[] = ["finance", "corporate", "trust_safety"];

/** Explicit overrides where the derived default is not strict enough. */
const OVERRIDES: Record<string, Partial<EventGovernance>> = {
  "wallet.credited": { retention: "7y", ordering: "per_key", classification: "restricted" },
  "wallet.debited": { retention: "7y", ordering: "per_key", classification: "restricted" },
  "settlement.completed": { retention: "7y", ordering: "per_key", classification: "restricted" },
  "corporate.invoice.issued": { retention: "7y", classification: "restricted" },
  "refund.approved": { retention: "7y", ordering: "per_key", classification: "restricted" },
  "safety.escalation.published": { retention: "7y", classification: "restricted", replaySupported: false },
  "driver.suspended": { retention: "7y", classification: "restricted" },
  "fraud.signal.raised": { retention: "1y", classification: "restricted", replaySupported: false },
  "pod.captured": { retention: "7y", classification: "confidential" },
};

/** Primary payload identifier used as the natural dedup key. */
function idempotencyKeyFor(event: CanonicalEvent): string {
  return event.payload[0] ?? "event_id";
}

function defaultGovernance(event: CanonicalEvent): EventGovernance {
  const regulated = REGULATED_DOMAINS.includes(event.domain);
  const critical = event.criticality === "critical";
  return {
    schemaVersion: event.version,
    retention: regulated ? "7y" : critical ? "1y" : "90d",
    replaySupported: true,
    idempotencyKey: idempotencyKeyFor(event),
    ordering: critical ? "per_key" : "none",
    classification: regulated ? "restricted" : critical ? "confidential" : "internal",
    observability: [
      "emit_count",
      "consumer_lag_seconds",
      `latency_p95_vs_${event.latencyBudgetMinutes}m_budget`,
      ...(critical ? ["dlq_depth", "replay_success_rate"] : []),
    ],
  };
}

function wiring(name: string): { publishers: string[]; consumers: string[] } {
  return {
    publishers: CAPABILITY_CONTRACTS.filter((c) => c.publishes.some((e) => e.name === name)).map((c) => c.module),
    consumers: CAPABILITY_CONTRACTS.filter((c) => c.consumes.some((e) => e.name === name)).map((c) => c.module),
  };
}

export function eventRegistry(): RegisteredEvent[] {
  return ENTERPRISE_EVENT_CATALOG.map((e) => ({
    ...e,
    ...defaultGovernance(e),
    ...(OVERRIDES[e.name] ?? {}),
    ...wiring(e.name),
  }));
}

export function registeredEvent(name: string): RegisteredEvent | undefined {
  return eventRegistry().find((e) => e.name === name);
}

export interface RegistryIssue {
  event: string;
  severity: "p0" | "p1" | "p2";
  message: string;
}

export interface RegistryCertification {
  passed: boolean;
  score: number;
  events: number;
  orphanEvents: number;
  issues: RegistryIssue[];
}

/**
 * Registry health: single-writer violations are P0, unconsumed critical events
 * are P1, events with no producer at all are P2 (roadmap, not drift).
 */
export function certifyEventRegistry(registry: RegisteredEvent[] = eventRegistry()): RegistryCertification {
  const issues: RegistryIssue[] = [];
  let orphanEvents = 0;

  for (const e of registry) {
    if (e.publishers.length > 1) {
      issues.push({ event: e.name, severity: "p0", message: `multiple publishers (${e.publishers.join(", ")}) — single-writer violated` });
    }
    if (e.publishers.length === 1 && e.publishers[0] !== e.owner) {
      issues.push({ event: e.name, severity: "p1", message: `published by '${e.publishers[0]}' but owned by '${e.owner}'` });
    }
    if (e.criticality === "critical" && e.publishers.length > 0 && e.consumers.length === 0) {
      issues.push({ event: e.name, severity: "p1", message: "critical event has no registered consumer" });
    }
    if (e.publishers.length === 0 && e.consumers.length === 0) {
      orphanEvents += 1;
      issues.push({ event: e.name, severity: "p2", message: "registered but not yet wired to a capability" });
    }
  }

  const p0 = issues.filter((i) => i.severity === "p0").length;
  const p1 = issues.filter((i) => i.severity === "p1").length;
  const p2 = issues.filter((i) => i.severity === "p2").length;
  const score = Math.max(0, 100 - p0 * 25 - p1 * 6 - Math.min(20, p2));
  return { passed: p0 === 0, score, events: registry.length, orphanEvents, issues };
}

// ══════════════════════════════════════════════════════════════════════════
// Event Registry 2.0 — live operational registry (IEOS Phase 7, Workstream 1)
// ──────────────────────────────────────────────────────────────────────────
// The static registry above answers "how is this event governed?".  The layer
// below answers "how is this event BEHAVING right now?".  It is pure: callers
// supply observations (edge_function_invocations, outbox/DLQ counters, event
// store timestamps) and receive a live, scored enterprise asset per event.
// ══════════════════════════════════════════════════════════════════════════

export type CompatibilityMode = "backward" | "forward" | "full" | "none";
export type IdempotencyStrategy = "natural_key" | "dedup_table" | "upsert" | "none";
export type EventHealth = "healthy" | "degraded" | "breached" | "unobserved";

export interface RetryPolicy {
  maxAttempts: number;
  backoff: "exponential" | "linear" | "none";
  /** Base delay in seconds before the first retry. */
  baseDelaySeconds: number;
}

/** Runtime observation for one canonical event over an evaluation window. */
export interface EventTelemetry {
  event: string;
  published?: number;
  failed?: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  dlqDepth?: number;
  replaysAttempted?: number;
  replaysSucceeded?: number;
  correlationIdCoverage?: number;
  traceIdCoverage?: number;
  lastPublishedAt?: string | null;
  lastFailureAt?: string | null;
}

export interface LiveEvent extends RegisteredEvent {
  /** Wire-compatibility contract for consumers on an older schema version. */
  compatibility: CompatibilityMode;
  idempotencyStrategy: IdempotencyStrategy;
  deadLetterQueue: string;
  retryPolicy: RetryPolicy;
  correlationIdSupported: boolean;
  traceIdSupported: boolean;
  documentationLink: string;
  capabilityContractLink: string;

  // live metrics
  published: number;
  failed: number;
  successRate: number;
  failureRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  latencyBudgetMs: number;
  dlqDepth: number;
  replayStatus: "not_supported" | "never_replayed" | "replaying" | "replay_degraded";
  replaySuccessRate: number;
  observabilityCoverage: number;
  lastPublishedAt: string | null;
  lastFailureAt: string | null;

  // rollups
  health: EventHealth;
  operationalScore: number;
  riskScore: number;
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, backoff: "exponential", baseDelaySeconds: 30 };
const CRITICAL_RETRY: RetryPolicy = { maxAttempts: 8, backoff: "exponential", baseDelaySeconds: 15 };

function idempotencyStrategyFor(e: RegisteredEvent): IdempotencyStrategy {
  if (e.classification === "restricted") return "dedup_table";
  if (e.ordering === "per_key") return "natural_key";
  return "upsert";
}

function pct(part: number, total: number, fallback: number): number {
  return total <= 0 ? fallback : Math.round((part / total) * 1000) / 10;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Fuse governance with runtime observations. Events with no telemetry are
 * reported as `unobserved` rather than silently scoring 100 — an unobserved
 * critical event is itself an operational risk.
 */
export function liveEventRegistry(
  telemetry: EventTelemetry[] = [],
  registry: RegisteredEvent[] = eventRegistry(),
): LiveEvent[] {
  const byName = new Map(telemetry.map((t) => [t.event, t]));

  return registry.map((e) => {
    const t = byName.get(e.name);
    const critical = e.criticality === "critical";
    const published = t?.published ?? 0;
    const failed = t?.failed ?? 0;
    const attempted = published + failed;
    const observed = Boolean(t) && attempted > 0;

    const successRate = pct(published, attempted, 0);
    const failureRate = observed ? Math.round((100 - successRate) * 10) / 10 : 0;
    const latencyBudgetMs = e.latencyBudgetMinutes * 60_000;
    const p95 = t?.p95LatencyMs ?? 0;
    const dlqDepth = t?.dlqDepth ?? 0;

    const replaysAttempted = t?.replaysAttempted ?? 0;
    const replaySuccessRate = pct(t?.replaysSucceeded ?? 0, replaysAttempted, 100);
    const replayStatus: LiveEvent["replayStatus"] = !e.replaySupported
      ? "not_supported"
      : replaysAttempted === 0
        ? "never_replayed"
        : replaySuccessRate < 95
          ? "replay_degraded"
          : "replaying";

    const signals = [
      t?.correlationIdCoverage ?? 0,
      t?.traceIdCoverage ?? 0,
      observed ? 100 : 0,
      t?.lastPublishedAt ? 100 : 0,
    ];
    const observabilityCoverage = clamp(signals.reduce((s, v) => s + v, 0) / signals.length);

    let health: EventHealth = "unobserved";
    if (observed) {
      const latencyBreached = p95 > latencyBudgetMs;
      const successBreached = successRate < (critical ? 99 : 95);
      const dlqBreached = dlqDepth > (critical ? 0 : 25);
      if (latencyBreached || successBreached || dlqBreached) health = "breached";
      else if (p95 > latencyBudgetMs * 0.8 || successRate < (critical ? 99.9 : 98) || dlqDepth > 0) health = "degraded";
      else health = "healthy";
    }

    const latencyScore = observed ? clamp(100 - (p95 / Math.max(1, latencyBudgetMs)) * 60) : 50;
    const operationalScore = clamp(
      observed
        ? successRate * 0.45 + latencyScore * 0.25 + observabilityCoverage * 0.2 + Math.max(0, 100 - dlqDepth * 5) * 0.1
        : 40,
    );

    const riskScore = clamp(
      (100 - operationalScore) * (critical ? 1 : 0.7) +
        (e.classification === "restricted" ? 10 : 0) +
        (replayStatus === "replay_degraded" ? 10 : 0) +
        (health === "unobserved" && critical ? 15 : 0),
    );

    return {
      ...e,
      compatibility: e.classification === "restricted" ? "full" : "backward",
      idempotencyStrategy: idempotencyStrategyFor(e),
      deadLetterQueue: `dlq.${e.domain}.${e.name}`,
      retryPolicy: critical ? CRITICAL_RETRY : DEFAULT_RETRY,
      correlationIdSupported: true,
      traceIdSupported: true,
      documentationLink: `docs/platform/events/${e.name}.md`,
      capabilityContractLink: `src/lib/contracts/${e.owner}.contract.ts`,
      published,
      failed,
      successRate,
      failureRate,
      avgLatencyMs: t?.avgLatencyMs ?? 0,
      p95LatencyMs: p95,
      latencyBudgetMs,
      dlqDepth,
      replayStatus,
      replaySuccessRate,
      observabilityCoverage,
      lastPublishedAt: t?.lastPublishedAt ?? null,
      lastFailureAt: t?.lastFailureAt ?? null,
      health,
      operationalScore,
      riskScore,
    };
  });
}

export interface LiveRegistryReport {
  score: number;
  events: number;
  observed: number;
  unobserved: string[];
  breached: string[];
  degraded: string[];
  criticalAtRisk: string[];
  avgObservabilityCoverage: number;
  governance: RegistryCertification;
}

/** Executive rollup over the live registry — safe to render in Mission Control. */
export function certifyLiveRegistry(events: LiveEvent[] = liveEventRegistry()): LiveRegistryReport {
  const observed = events.filter((e) => e.health !== "unobserved");
  const avgOps = events.length === 0 ? 0 : events.reduce((s, e) => s + e.operationalScore, 0) / events.length;
  return {
    score: clamp(avgOps),
    events: events.length,
    observed: observed.length,
    unobserved: events.filter((e) => e.health === "unobserved").map((e) => e.name),
    breached: events.filter((e) => e.health === "breached").map((e) => e.name),
    degraded: events.filter((e) => e.health === "degraded").map((e) => e.name),
    criticalAtRisk: events.filter((e) => e.criticality === "critical" && e.riskScore >= 50).map((e) => e.name),
    avgObservabilityCoverage: clamp(
      events.length === 0 ? 0 : events.reduce((s, e) => s + e.observabilityCoverage, 0) / events.length,
    ),
    governance: certifyEventRegistry(),
  };
}


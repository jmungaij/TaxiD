/**
 * Integration resilience for the Corporate Mobility operating system.
 *
 * Every critical outbound dependency (M-Pesa, email, maps, eTIMS, storage,
 * dispatch) is declared with its retry policy, circuit-breaker thresholds,
 * idempotency requirement and customer-visible degraded behaviour. The helpers
 * are pure so the same policy drives runtime callers, the ops console and the
 * resilience tests.
 */

export type IntegrationKey =
  | "mpesa" | "email" | "maps" | "etims" | "storage" | "dispatch" | "sms";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Exponential factor applied per attempt. */
  factor: number;
  /** Fraction of the delay applied as random jitter, 0..1. */
  jitter: number;
}

export interface IntegrationPolicy {
  key: IntegrationKey;
  label: string;
  /** Non-idempotent calls MUST carry an idempotency key. */
  requiresIdempotencyKey: boolean;
  retry: RetryPolicy;
  /** Consecutive failures before the breaker opens. */
  breakerThreshold: number;
  /** How long the breaker stays open before probing again. */
  breakerCooldownMs: number;
  /** What the customer experiences while the dependency is down. */
  degradedMode: string;
  /** Whether work is queued for replay after recovery. */
  queueOnFailure: boolean;
}

const retry = (maxAttempts: number, baseDelayMs: number, maxDelayMs: number): RetryPolicy =>
  ({ maxAttempts, baseDelayMs, maxDelayMs, factor: 2, jitter: 0.2 });

export const INTEGRATION_POLICIES: IntegrationPolicy[] = [
  {
    key: "mpesa", label: "M-Pesa Daraja",
    requiresIdempotencyKey: true, retry: retry(4, 1_000, 15_000),
    breakerThreshold: 5, breakerCooldownMs: 60_000,
    degradedMode: "Booking is held as payment pending; the customer is told to expect the STK prompt shortly.",
    queueOnFailure: true,
  },
  {
    key: "email", label: "Transactional email",
    requiresIdempotencyKey: true, retry: retry(5, 2_000, 60_000),
    breakerThreshold: 8, breakerCooldownMs: 120_000,
    degradedMode: "In-app notification is shown and the email is queued for retry.",
    queueOnFailure: true,
  },
  {
    key: "sms", label: "SMS delivery",
    requiresIdempotencyKey: true, retry: retry(4, 2_000, 30_000),
    breakerThreshold: 8, breakerCooldownMs: 120_000,
    degradedMode: "Falls back to email and in-app notification.",
    queueOnFailure: true,
  },
  {
    key: "maps", label: "Maps & geocoding",
    requiresIdempotencyKey: false, retry: retry(3, 400, 4_000),
    breakerThreshold: 6, breakerCooldownMs: 45_000,
    degradedMode: "Manual address entry with saved places; distance falls back to the governed pricing table.",
    queueOnFailure: false,
  },
  {
    key: "etims", label: "KRA eTIMS",
    requiresIdempotencyKey: true, retry: retry(5, 5_000, 120_000),
    breakerThreshold: 4, breakerCooldownMs: 300_000,
    degradedMode: "Invoice is issued as pending-fiscalisation and submitted on recovery.",
    queueOnFailure: true,
  },
  {
    key: "storage", label: "Document storage",
    requiresIdempotencyKey: false, retry: retry(4, 800, 10_000),
    breakerThreshold: 6, breakerCooldownMs: 60_000,
    degradedMode: "Upload is retried in the background; previously issued documents stay downloadable.",
    queueOnFailure: true,
  },
  {
    key: "dispatch", label: "Dispatch engine",
    requiresIdempotencyKey: true, retry: retry(3, 500, 5_000),
    breakerThreshold: 4, breakerCooldownMs: 30_000,
    degradedMode: "Trip routes to the manual assisted-booking desk for operator allocation.",
    queueOnFailure: true,
  },
];

const POLICIES = new Map(INTEGRATION_POLICIES.map((p) => [p.key, p]));
export const integrationPolicy = (key: IntegrationKey): IntegrationPolicy =>
  POLICIES.get(key) ?? INTEGRATION_POLICIES[0];

/** Deterministic backoff delay for attempt `n` (1-based); jitter is applied by the caller. */
export function backoffDelayMs(policy: RetryPolicy, attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * policy.factor ** (n - 1)));
}

/** 5xx, 429, timeouts and network faults are retryable; 4xx business errors are not. */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500 && status < 600;
}

export const shouldRetry = (
  key: IntegrationKey,
  attempt: number,
  outcome: { status?: number; networkError?: boolean },
): boolean => {
  const p = integrationPolicy(key);
  if (attempt >= p.retry.maxAttempts) return false;
  if (outcome.networkError) return true;
  return typeof outcome.status === "number" ? isRetryableStatus(outcome.status) : false;
};

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerSnapshot {
  key: IntegrationKey;
  consecutiveFailures: number;
  openedAt: number | null;
}

export const newBreaker = (key: IntegrationKey): BreakerSnapshot =>
  ({ key, consecutiveFailures: 0, openedAt: null });

export function breakerState(b: BreakerSnapshot, now = Date.now()): BreakerState {
  if (b.openedAt === null) return "closed";
  const cooldown = integrationPolicy(b.key).breakerCooldownMs;
  return now - b.openedAt >= cooldown ? "half_open" : "open";
}

export const breakerAllows = (b: BreakerSnapshot, now = Date.now()): boolean =>
  breakerState(b, now) !== "open";

export function recordFailure(b: BreakerSnapshot, now = Date.now()): BreakerSnapshot {
  const failures = b.consecutiveFailures + 1;
  const threshold = integrationPolicy(b.key).breakerThreshold;
  return {
    key: b.key,
    consecutiveFailures: failures,
    openedAt: failures >= threshold ? now : b.openedAt,
  };
}

export const recordSuccess = (b: BreakerSnapshot): BreakerSnapshot =>
  ({ key: b.key, consecutiveFailures: 0, openedAt: null });

export interface DegradationNotice {
  key: IntegrationKey;
  label: string;
  /** Customer-facing message — never exposes internal errors. */
  message: string;
  /** Whether the customer's action was preserved for automatic replay. */
  workPreserved: boolean;
  severity: "warning" | "critical";
}

/** The message shown to the customer when a dependency is unavailable. */
export function degradationNotice(key: IntegrationKey, breakerOpen = false): DegradationNotice {
  const p = integrationPolicy(key);
  return {
    key: p.key,
    label: p.label,
    message: p.degradedMode,
    workPreserved: p.queueOnFailure,
    severity: breakerOpen ? "critical" : "warning",
  };
}

/** Certification check used by the resilience tests and the ops console. */
export function certifyIntegrationCoverage(): { passed: boolean; findings: string[] } {
  const findings: string[] = [];
  for (const p of INTEGRATION_POLICIES) {
    if (p.retry.maxAttempts < 3) findings.push(`${p.key}: fewer than 3 attempts configured`);
    if (p.retry.maxDelayMs < p.retry.baseDelayMs) findings.push(`${p.key}: max delay below base delay`);
    if (!p.degradedMode.trim()) findings.push(`${p.key}: no declared degraded mode`);
    if (p.requiresIdempotencyKey && !p.queueOnFailure) {
      findings.push(`${p.key}: idempotent writes must be queued for replay`);
    }
  }
  return { passed: findings.length === 0, findings };
}

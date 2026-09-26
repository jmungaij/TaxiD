/**
 * Automatic retry policy for tax report loading.
 *
 * Pure functions only — the hook layer supplies timers. Decisions combine:
 *   • the classified failure (some kinds are permanently fatal),
 *   • the eTIMS sync health snapshot (if KRA sync is failing, back off harder
 *     and never retry faster than the scheduled retry the backend already has),
 *   • the attempt count (exponential growth with jitter and a hard ceiling).
 */
import type { TaxLoadFailure } from "@/lib/tax/reportErrors";

export interface SyncHealthSnapshot {
  last_success?: { created_at?: string } | null;
  last_error?: { created_at?: string; response_status?: number | null; error_message?: string | null } | null;
  next_retry_at?: string | null;
  retry_by_status?: Record<string, number> | null;
}

export interface RetryPlan {
  /** Whether an automatic retry should be scheduled. */
  retry: boolean;
  /** Delay before the next automatic attempt, in ms (0 when retry === false). */
  delayMs: number;
  /** Attempt number the scheduled retry will represent (1-based). */
  attempt: number;
  /** Operator-readable justification, surfaced in the UI and the audit log. */
  reason: string;
}

export const TAX_RETRY_BASE_MS = 2_000;
export const TAX_RETRY_MAX_MS = 120_000;
/** Automatic attempts only. The manual Retry button is always available. */
export const TAX_RETRY_MAX_ATTEMPTS = 5;

/** Pure exponential backoff: base * 2^(attempt-1), capped, with optional jitter. */
export function backoffDelayMs(attempt: number, jitter = 0, baseMs = TAX_RETRY_BASE_MS, maxMs = TAX_RETRY_MAX_MS): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = baseMs * 2 ** (n - 1);
  const capped = Math.min(raw, maxMs);
  const spread = Math.min(1, Math.max(0, jitter));
  // Jitter only ever adds up to 25% so the delay never shrinks below the curve.
  return Math.round(Math.min(maxMs, capped * (1 + spread * 0.25)));
}

const healthIsDegraded = (health?: SyncHealthSnapshot | null): boolean => {
  if (!health) return false;
  const errAt = health.last_error?.created_at ? new Date(health.last_error.created_at).getTime() : null;
  if (errAt == null) return false;
  const okAt = health.last_success?.created_at ? new Date(health.last_success.created_at).getTime() : null;
  return okAt == null || errAt > okAt;
};

/**
 * Decides whether the failed load should be retried automatically, and when.
 *
 * `now` and `jitter` are injected so the behaviour is deterministic in tests.
 */
export function planTaxRetry(input: {
  failure: TaxLoadFailure;
  attempt: number;
  health?: SyncHealthSnapshot | null;
  now?: number;
  jitter?: number;
  maxAttempts?: number;
}): RetryPlan {
  const { failure, health } = input;
  const attempt = Math.max(1, Math.floor(input.attempt));
  const maxAttempts = input.maxAttempts ?? TAX_RETRY_MAX_ATTEMPTS;
  const now = input.now ?? Date.now();
  const jitter = input.jitter ?? 0;

  if (!failure.retryable) {
    return { retry: false, delayMs: 0, attempt, reason: `${failure.kind} failures are not retryable — operator action required.` };
  }
  if (attempt > maxAttempts) {
    return { retry: false, delayMs: 0, attempt, reason: `Gave up after ${maxAttempts} automatic attempts. Use Retry to try again.` };
  }

  let delayMs = backoffDelayMs(attempt, jitter);
  let reason = `Automatic attempt ${attempt} of ${maxAttempts} in ${Math.round(delayMs / 1000)}s (exponential backoff).`;

  if (healthIsDegraded(health)) {
    delayMs = Math.min(TAX_RETRY_MAX_MS, delayMs * 2);
    reason = `eTIMS sync is degraded (last run errored) — backing off to ${Math.round(delayMs / 1000)}s before attempt ${attempt}.`;
  }

  // Never retry ahead of the backend's own scheduled retry: there is nothing new to read yet.
  const scheduled = health?.next_retry_at ? new Date(health.next_retry_at).getTime() : null;
  if (scheduled != null && Number.isFinite(scheduled) && scheduled > now) {
    const wait = Math.min(TAX_RETRY_MAX_MS, scheduled - now);
    if (wait > delayMs) {
      delayMs = wait;
      reason = `Waiting for the scheduled eTIMS retry at ${new Date(scheduled).toLocaleTimeString("en-KE")} before attempt ${attempt}.`;
    }
  }

  return { retry: true, delayMs, attempt, reason };
}

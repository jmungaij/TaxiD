/**
 * Recruitment 360 — resumable import job helpers.
 *
 * Pure shaping over the run + step spine (`rec_import_runs` /
 * `rec_import_job_steps`): progress, resume eligibility, backoff maths and
 * human-readable step states. No I/O — safe to unit test.
 */

export interface StepLike {
  step_no: number;
  step_key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | string;
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
}

export interface StepProgress {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  running: number;
  skipped: number;
  /** Percentage of steps completed (0-100). */
  pct: number;
}

export function stepProgress(steps: StepLike[]): StepProgress {
  const count = (s: string) => steps.filter((x) => x.status === s).length;
  const completed = count("completed");
  return {
    total: steps.length,
    completed,
    pending: count("pending"),
    failed: count("failed"),
    running: count("running"),
    skipped: count("skipped"),
    pct: steps.length ? Math.round((completed / steps.length) * 100) : 0,
  };
}

/** Lowest-numbered step the worker can still run; null when nothing is actionable. */
export function nextActionableStep(steps: StepLike[]): StepLike | null {
  return (
    steps
      .filter((s) => (s.status === "pending" || s.status === "failed") && s.attempts < s.max_attempts)
      .sort((a, b) => a.step_no - b.step_no)[0] ?? null
  );
}

/** Steps that exhausted every attempt and need human attention. */
export function exhaustedSteps(steps: StepLike[]): StepLike[] {
  return steps.filter((s) => s.status === "failed" && s.attempts >= s.max_attempts);
}

/**
 * A run is resumable when it is not paused (circuit breaker) and at least one
 * step can still be attempted.
 */
export function canResume(run: { paused_reason?: string | null }, steps: StepLike[]): boolean {
  return !run.paused_reason && nextActionableStep(steps) !== null;
}

/**
 * Backoff before a step may be retried, seconds. Honours a server-supplied
 * Retry-After, otherwise linear 60s per completed attempt.
 */
export function retryBackoffSeconds(attemptsDone: number, retryAfter?: number): number {
  return Math.max(retryAfter ?? 0, 60 * Math.max(attemptsDone, 1));
}

/** Human-readable state for the step table. */
export function stepStateLabel(step: StepLike): string {
  switch (step.status) {
    case "completed":
      return "Completed";
    case "running":
      return "Running";
    case "skipped":
      return "Skipped";
    case "failed":
      return step.attempts >= step.max_attempts
        ? `Failed permanently after ${step.attempts} attempt${step.attempts === 1 ? "" : "s"}`
        : `Failed — attempt ${step.attempts} of ${step.max_attempts}`;
    default:
      return step.attempts > 0
        ? `Waiting to retry (attempt ${step.attempts + 1} of ${step.max_attempts})`
        : "Pending";
  }
}

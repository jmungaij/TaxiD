/**
 * Canonical recruitment scorecard scale.
 *
 * Interviews and Evaluations MUST submit on the same scale, otherwise averages
 * and comparisons across the funnel are meaningless. This module is the single
 * source of truth: 1–5, half-point steps, one decimal stored.
 */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;
export const SCORE_STEP = 0.5;
export const SCORE_DEFAULT = 3;
export const SCORE_SCALE_LABEL = "1–5";

export class ScoreScaleError extends Error {}

/**
 * Normalises raw form input to the canonical scale.
 * Returns `undefined` for a blank (not-scored) entry and throws on out-of-range
 * input so the caller can surface a single consistent message.
 */
export function normalizeScore(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    throw new ScoreScaleError(`Overall score must be a number between ${SCORE_MIN} and ${SCORE_MAX}.`);
  }
  if (n < SCORE_MIN || n > SCORE_MAX) {
    throw new ScoreScaleError(`Overall score must be between ${SCORE_MIN} and ${SCORE_MAX}.`);
  }
  // Snap to the half-point grid and store a single decimal.
  return Math.round(n / SCORE_STEP) * SCORE_STEP;
}

/** Mean of scored entries on the canonical scale, one decimal. */
export function averageScore(scores: Array<number | null | undefined>): number | null {
  const vals = scores.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export const scoreInputProps = {
  type: "number" as const,
  min: SCORE_MIN,
  max: SCORE_MAX,
  step: SCORE_STEP,
};

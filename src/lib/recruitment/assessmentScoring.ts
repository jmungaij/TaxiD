/**
 * Recruitment 360 — assessment scoring vocabulary and presentation rules.
 *
 * These are pure helpers for DISPLAY and pre-flight validation only. The
 * authoritative total, percentage, band and critical-gate result are computed by
 * `rec_assessment_submit` / `rec_assessment_amend` in the database; this module
 * mirrors those rules so the interface can show the interviewer the same answer
 * the server will produce. It never becomes the source of truth.
 */

export type VerificationStatus =
  | "claimed"
  | "verified"
  | "demonstrated"
  | "partially_verified"
  | "unverified"
  | "contradicted"
  | "not_applicable";

export type EvidenceConfidence = "high" | "medium" | "low" | "unverified";

export type ScoreBand = "exceptional" | "strong" | "competent" | "borderline" | "not_recommended" | "unassessed";

export const VERIFICATION_OPTIONS: { value: VerificationStatus; label: string }[] = [
  { value: "demonstrated", label: "Demonstrated in the interview" },
  { value: "verified", label: "Verified from CV and interview" },
  { value: "partially_verified", label: "Partially verified" },
  { value: "claimed", label: "Claimed, not yet verified" },
  { value: "unverified", label: "Unverified" },
  { value: "contradicted", label: "Contradicted by evidence" },
  { value: "not_applicable", label: "Not applicable" },
];

export const CONFIDENCE_OPTIONS: { value: EvidenceConfidence; label: string }[] = [
  { value: "high", label: "High confidence" },
  { value: "medium", label: "Medium confidence" },
  { value: "low", label: "Low confidence" },
  { value: "unverified", label: "Unverified" },
];

export const RECOMMENDATION_OPTIONS = [
  { value: "strong_advance", label: "Strong advance" },
  { value: "advance", label: "Advance" },
  { value: "hold", label: "Hold" },
  { value: "reject", label: "Do not advance" },
  { value: "strong_reject", label: "Strong do not advance" },
] as const;

export const BAND_LABEL: Record<ScoreBand, string> = {
  exceptional: "Exceptional — priority hiring consideration",
  strong: "Strong — hiring consideration",
  competent: "Competent — further validation / conditional",
  borderline: "Borderline — additional assessment required",
  not_recommended: "Not recommended",
  unassessed: "Unassessed",
};

/** Mirrors `public.rec_assessment_band`. */
export function bandFor(score: number | null | undefined, max: number | null | undefined): ScoreBand {
  if (score == null || !max) return "unassessed";
  const ratio = score / max;
  if (ratio >= 0.9) return "exceptional";
  if (ratio >= 0.8) return "strong";
  if (ratio >= 0.7) return "competent";
  if (ratio >= 0.6) return "borderline";
  return "not_recommended";
}

export interface ScorableAnswer {
  competency_code: string;
  competency_label: string;
  max_marks: number;
  critical_min: number | null;
  mandatory: boolean;
  score: number | null;
  evidence_text: string | null;
}

export interface RunningTotals {
  total: number;
  max: number;
  percentage: number | null;
  band: ScoreBand;
  /** Questions still missing a score or evidence. */
  outstanding: number;
  scored: number;
  questions: number;
}

export function runningTotals(answers: ScorableAnswer[]): RunningTotals {
  const max = answers.reduce((s, a) => s + a.max_marks, 0);
  const total = answers.reduce((s, a) => s + (a.score ?? 0), 0);
  const outstanding = answers.filter(
    (a) => a.mandatory && (a.score == null || !(a.evidence_text ?? "").trim()),
  ).length;
  return {
    total,
    max,
    percentage: max > 0 ? Math.round((total / max) * 1000) / 10 : null,
    band: bandFor(total, max),
    outstanding,
    scored: answers.filter((a) => a.score != null).length,
    questions: answers.length,
  };
}

export interface GateResult {
  competency: string;
  label: string;
  minimum: number;
  maxMarks: number;
  score: number | null;
  passed: boolean;
}

/** Critical competency gates. A gate with no score yet is not passed. */
export function gateResults(answers: ScorableAnswer[]): GateResult[] {
  return answers
    .filter((a) => a.critical_min != null)
    .map((a) => ({
      competency: a.competency_code,
      label: a.competency_label,
      minimum: a.critical_min as number,
      maxMarks: a.max_marks,
      score: a.score,
      passed: (a.score ?? 0) >= (a.critical_min as number),
    }));
}

export const gatesPassed = (answers: ScorableAnswer[]) => gateResults(answers).every((g) => g.passed);

/** A score outside 0..max is refused before it reaches the server. */
export function validateScore(value: number, max: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(value)) return { ok: false, message: "Enter a numeric score." };
  if (value < 0) return { ok: false, message: "A score cannot be negative." };
  if (value > max) return { ok: false, message: `The maximum for this competency is ${max}.` };
  return { ok: true };
}

/** Whether an interviewer may submit. Mirrors the server's completeness check. */
export function canSubmit(answers: ScorableAnswer[], recommendation: string | null): { allowed: boolean; reason?: string } {
  const missing = runningTotals(answers).outstanding;
  if (missing > 0) {
    return { allowed: false, reason: `${missing} required question(s) still need a score and recorded evidence.` };
  }
  if (!recommendation) return { allowed: false, reason: "Record your recommendation before submitting." };
  return { allowed: true };
}

/**
 * Tie-break order for equal totals: solution selling, objection handling,
 * verified sales experience, productivity, then operational discipline. Never
 * name, age or any protected characteristic.
 */
export const TIE_BREAK_ORDER = [
  "solution_selling",
  "objection_handling",
  "verified_sales",
  "productivity",
  "operational_discipline",
] as const;

export interface RankableCandidate {
  assessed: boolean;
  total_score: number | null;
  tie_break: Partial<Record<(typeof TIE_BREAK_ORDER)[number], number | null>> | null;
}

export function compareCandidates(a: RankableCandidate, b: RankableCandidate): number {
  if (a.assessed !== b.assessed) return a.assessed ? -1 : 1;
  if (!a.assessed) return 0;
  const byTotal = (b.total_score ?? 0) - (a.total_score ?? 0);
  if (byTotal !== 0) return byTotal;
  for (const key of TIE_BREAK_ORDER) {
    const diff = (b.tie_break?.[key] ?? 0) - (a.tie_break?.[key] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Panel disagreement of 20% of the scale or more must be reviewed, not averaged. */
export function raterDiscrepancy(scores: number[], scale: number): boolean {
  if (scores.length < 2 || !scale) return false;
  return (Math.max(...scores) - Math.min(...scores)) / scale >= 0.2;
}

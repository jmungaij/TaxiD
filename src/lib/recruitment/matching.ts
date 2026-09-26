/**
 * Recruitment 360 — deterministic candidate/vacancy matching.
 *
 * This is an explainable scorer, not a black box: every point is attributable
 * to a named factor with the evidence that produced it, so a recruiter can see
 * exactly why a candidate ranks where they do — and override it. The human
 * decision is always stored separately from this suggestion.
 */
import type { RecCandidate, RecVacancy } from "./types";

export interface MatchFactor {
  label: string;
  weight: number;
  earned: number;
  evidence: string;
}

export interface MatchResult {
  score: number;
  band: "strong" | "possible" | "weak";
  recommendation: "advance" | "review" | "reject";
  factors: MatchFactor[];
  missingRequired: string[];
}

const norm = (v: string) => v.trim().toLowerCase();

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b.map(norm));
  return a.filter((x) => set.has(norm(x)));
}

export interface MatchInput {
  candidate: Pick<RecCandidate, "years_experience" | "location" | "headline" | "summary" | "current_title">;
  candidateSkills: string[];
  candidateQualifications: string[];
  vacancy: Pick<
    RecVacancy,
    "required_skills" | "preferred_skills" | "qualifications" | "min_years_experience" | "location" | "title"
  >;
}

export function matchCandidate({
  candidate,
  candidateSkills,
  candidateQualifications,
  vacancy,
}: MatchInput): MatchResult {
  const factors: MatchFactor[] = [];

  // 1. Required skills — the dominant factor.
  const required = vacancy.required_skills ?? [];
  const requiredHit = overlap(required, candidateSkills);
  const requiredWeight = 40;
  const requiredEarned = required.length === 0 ? requiredWeight : Math.round((requiredHit.length / required.length) * requiredWeight);
  factors.push({
    label: "Required skills",
    weight: requiredWeight,
    earned: requiredEarned,
    evidence: required.length
      ? `${requiredHit.length} of ${required.length} matched${requiredHit.length ? `: ${requiredHit.join(", ")}` : ""}`
      : "No required skills declared on the vacancy",
  });

  // 2. Preferred skills — differentiator, not a gate.
  const preferred = vacancy.preferred_skills ?? [];
  const preferredHit = overlap(preferred, candidateSkills);
  const preferredWeight = 15;
  const preferredEarned = preferred.length === 0 ? Math.round(preferredWeight / 2) : Math.round((preferredHit.length / preferred.length) * preferredWeight);
  factors.push({
    label: "Preferred skills",
    weight: preferredWeight,
    earned: preferredEarned,
    evidence: preferred.length
      ? `${preferredHit.length} of ${preferred.length} matched`
      : "None declared — neutral credit applied",
  });

  // 3. Experience depth against the stated minimum.
  const minYears = vacancy.min_years_experience ?? 0;
  const years = candidate.years_experience ?? 0;
  const expWeight = 20;
  let expEarned = expWeight;
  let expEvidence = `${years} years experience, no minimum stated`;
  if (minYears > 0) {
    const ratio = Math.min(1.25, years / minYears);
    expEarned = Math.round(Math.min(1, ratio) * expWeight);
    expEvidence = `${years} of ${minYears} years required`;
  }
  factors.push({ label: "Experience", weight: expWeight, earned: expEarned, evidence: expEvidence });

  // 4. Qualifications.
  const quals = vacancy.qualifications ?? [];
  const qualHit = overlap(quals, candidateQualifications);
  const qualWeight = 15;
  const qualEarned = quals.length === 0 ? qualWeight : Math.round((qualHit.length / quals.length) * qualWeight);
  factors.push({
    label: "Qualifications",
    weight: qualWeight,
    earned: qualEarned,
    evidence: quals.length ? `${qualHit.length} of ${quals.length} matched` : "None required",
  });

  // 5. Location alignment.
  const locWeight = 10;
  const sameLocation =
    !!candidate.location && !!vacancy.location && norm(candidate.location) === norm(vacancy.location);
  factors.push({
    label: "Location",
    weight: locWeight,
    earned: sameLocation ? locWeight : candidate.location ? 5 : 0,
    evidence: sameLocation
      ? `Candidate is in ${candidate.location}`
      : candidate.location
        ? `Candidate in ${candidate.location}, role in ${vacancy.location ?? "unspecified"}`
        : "Candidate location unknown",
  });

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.earned, 0)));
  const missingRequired = required.filter((r) => !requiredHit.some((h) => norm(h) === norm(r)));

  const band = score >= 75 ? "strong" : score >= 50 ? "possible" : "weak";
  const recommendation = band === "strong" ? "advance" : band === "possible" ? "review" : "reject";

  return { score, band, recommendation, factors, missingRequired };
}

/** Rank applications for a vacancy by score, then by how long they have waited. */
export function rankByScoreThenWait<T extends { ai_match_score: number | null; score: number | null; stage_entered_at: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sa = a.score ?? a.ai_match_score ?? 0;
    const sb = b.score ?? b.ai_match_score ?? 0;
    if (sb !== sa) return sb - sa;
    return new Date(a.stage_entered_at).getTime() - new Date(b.stage_entered_at).getTime();
  });
}

/**
 * Recruitment 360 — identity matching rules for imported documents.
 *
 * Pure, deterministic, explainable: every suggestion carries the evidence that
 * produced it (exact ID hit, name variant, token overlap). The matcher never
 * writes anything — it proposes pipeline slots; a human or a governed routine
 * disposes.
 */

export interface ExtractedIdentity {
  name?: string | null;
  idNumber?: string | null;
}

export interface CandidateSlot {
  id: string;
  full_name: string;
}

export interface IdentitySuggestion {
  candidateId: string;
  candidateName: string;
  confidence: number; // 0..1
  band: "exact" | "strong" | "possible" | "ambiguous" | "no_match";
  reasons: string[];
}

/** Lowercase, strip punctuation and collapse whitespace. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein distance (DP, O(n·m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Name similarity 0..1 — blends edit distance with token overlap so
 * "Ruth Wairimu Kung'u" ≈ "Ruth Wairimu Kungu" and reordered token sets score well.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const editScore = 1 - dist / Math.max(na.length, nb.length);
  const tokensA = new Set(na.split(" "));
  const tokensB = new Set(nb.split(" "));
  const shared = [...tokensA].filter((t) => tokensB.has(t)).length;
  const tokenScore = (2 * shared) / (tokensA.size + tokensB.size);
  return Math.max(editScore, tokenScore * 0.95);
}

/** Normalise a Kenyan national ID for comparison (digits only). */
export function normalizeIdNumber(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Rank pipeline slots for an extracted identity. `knownIdNumbers` maps a
 * candidate id to any national IDs already on file for them.
 */
export function matchIdentity(
  extracted: ExtractedIdentity,
  candidates: CandidateSlot[],
  knownIdNumbers: Record<string, string[]> = {},
): IdentitySuggestion[] {
  const idNumber = extracted.idNumber ? normalizeIdNumber(extracted.idNumber) : "";
  const suggestions: IdentitySuggestion[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    let confidence = 0;

    if (idNumber) {
      const ids = (knownIdNumbers[c.id] ?? []).map(normalizeIdNumber);
      if (ids.includes(idNumber)) {
        confidence = 1;
        reasons.push(`National ID ${extracted.idNumber} is on file for this candidate`);
      }
    }

    if (extracted.name) {
      const sim = nameSimilarity(extracted.name, c.full_name);
      if (sim === 1) {
        confidence = Math.max(confidence, 1);
        reasons.push("Exact name match");
      } else if (sim >= 0.85) {
        confidence = Math.max(confidence, sim);
        reasons.push(`Name variant match (${Math.round(sim * 100)}% similar)`);
      } else if (sim >= 0.6) {
        confidence = Math.max(confidence, sim * 0.9);
        reasons.push(`Partial name overlap (${Math.round(sim * 100)}% similar)`);
      }
    }

    if (confidence > 0) {
      suggestions.push({
        candidateId: c.id,
        candidateName: c.full_name,
        confidence: Math.round(confidence * 100) / 100,
        band: "possible",
        reasons,
      });
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);

  // Band assignment + ambiguity detection: two slots within 5 points of each
  // other are never silently resolved — the top one is flagged ambiguous.
  const top = suggestions[0];
  const second = suggestions[1];
  const ambiguous = !!top && !!second && top.confidence - second.confidence <= 0.05;

  return suggestions.map((s, i) => ({
    ...s,
    band: ambiguous && i < 2
      ? "ambiguous"
      : s.confidence >= 0.99
        ? "exact"
        : s.confidence >= 0.85
          ? "strong"
          : "possible",
  }));
}

/** The single best suggestion, or an explicit no-match marker. */
export function bestSuggestion(suggestions: IdentitySuggestion[]): IdentitySuggestion {
  return (
    suggestions[0] ?? {
      candidateId: "",
      candidateName: "",
      confidence: 0,
      band: "no_match",
      reasons: ["No Recruitment 360 record resembles the extracted identity"],
    }
  );
}

/**
 * Customer Operations — pluggable classification pipeline (Improvement #2).
 *
 * Keyword rules become one classifier among many. Callers depend only on
 * `runClassification(input)`; new classifiers (statistical, LLM, historical
 * similarity) register themselves without any caller change.
 *
 *   Result = Rules + Statistical Signals + Historical Similarity + LLM
 *
 * The pipeline is synchronous and deterministic today. Async classifiers are
 * supported through `runClassificationAsync`, so the LLM classifier can be
 * dropped in later without touching the contract.
 */
import { classifyCase, type CaseType, type ClassificationInput, CASE_TYPE_BY_KEY, type CaseTypeDefinition } from "./taxonomy";
import { defaultPathForType, findReasonCode, type HierarchyPath } from "./hierarchy";

export type ClassifierKind = "rules" | "statistical" | "similarity" | "llm";

export interface ClassifierVote {
  classifier: string;
  kind: ClassifierKind;
  type: CaseType;
  /** 0-100 confidence this classifier assigns to its own vote. */
  confidence: number;
  /** Weight applied when blending votes; higher = more trusted. */
  weight: number;
  rationale: string;
  reasonCode?: string;
}

export interface ClassifierContext extends ClassificationInput {
  /** Prior cases from the same requester, newest first. */
  priorCases?: { subject: string; reasonCode?: string | null; type?: CaseType | null }[];
  /** Historical frequency of each case type in the current window. */
  typeFrequency?: Partial<Record<CaseType, number>>;
}

export interface Classifier {
  id: string;
  kind: ClassifierKind;
  /** Preview classifiers are declared but never contribute to the result. */
  enabled: boolean;
  classify(ctx: ClassifierContext): ClassifierVote | null;
}

export interface ClassificationResult {
  type: CaseType;
  definition: CaseTypeDefinition;
  confidence: number;
  /** Blended agreement across contributing classifiers (0-100). */
  agreement: number;
  votes: ClassifierVote[];
  /** Classifiers registered but not yet active. */
  pending: { id: string; kind: ClassifierKind }[];
  hierarchy: HierarchyPath | null;
  fallbackUsed: boolean;
}

/* ------------------------------ classifiers ------------------------------ */

const rulesClassifier: Classifier = {
  id: "keyword-rules-v1",
  kind: "rules",
  enabled: true,
  classify(ctx) {
    const base = classifyCase(ctx);
    return {
      classifier: this.id,
      kind: "rules",
      type: base.type,
      confidence: base.confidence,
      weight: 1,
      rationale: base.matchedSignals.length
        ? `Matched signals: ${base.matchedSignals.join(", ")}`
        : "No keyword evidence — category fallback applied",
    };
  },
};

/** Statistical prior: what this channel/category usually turns out to be. */
const statisticalClassifier: Classifier = {
  id: "frequency-prior-v1",
  kind: "statistical",
  enabled: true,
  classify(ctx) {
    const freq = ctx.typeFrequency;
    if (!freq) return null;
    const entries = Object.entries(freq) as [CaseType, number][];
    const total = entries.reduce((a, [, n]) => a + n, 0);
    if (total < 5) return null;
    const [type, n] = entries.sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((n / total) * 100);
    if (share < 25) return null;
    return {
      classifier: this.id,
      kind: "statistical",
      type,
      confidence: Math.min(70, share),
      weight: 0.5,
      rationale: `${share}% of comparable cases in the window resolved as this type`,
    };
  },
};

/** Historical similarity: reuse the outcome of this customer's prior cases. */
const similarityClassifier: Classifier = {
  id: "requester-history-v1",
  kind: "similarity",
  enabled: true,
  classify(ctx) {
    const prior = ctx.priorCases?.filter((p) => p.type) ?? [];
    if (prior.length < 2) return null;
    const counts = new Map<CaseType, number>();
    prior.forEach((p) => counts.set(p.type!, (counts.get(p.type!) ?? 0) + 1));
    const [type, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n < 2) return null;
    const match = prior.find((p) => p.type === type && p.reasonCode);
    return {
      classifier: this.id,
      kind: "similarity",
      type,
      confidence: Math.min(75, 40 + n * 10),
      weight: 0.7,
      rationale: `${n} prior case(s) from this requester classified as this type`,
      reasonCode: match?.reasonCode ?? undefined,
    };
  },
};

/** Declared, not active — swapped in when the AI service ships. */
const llmClassifier: Classifier = {
  id: "llm-intent-v0",
  kind: "llm",
  enabled: false,
  classify: () => null,
};

export const CLASSIFIERS: Classifier[] = [
  rulesClassifier,
  statisticalClassifier,
  similarityClassifier,
  llmClassifier,
];

/* -------------------------------- pipeline -------------------------------- */

function blend(votes: ClassifierVote[]): { type: CaseType; confidence: number; agreement: number } {
  const scores = new Map<CaseType, number>();
  let totalWeight = 0;
  for (const v of votes) {
    scores.set(v.type, (scores.get(v.type) ?? 0) + (v.confidence * v.weight) / 100);
    totalWeight += v.weight;
  }
  const [type, score] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = Math.round(Math.min(98, (score / Math.max(totalWeight, 1)) * 100));
  const agreeing = votes.filter((v) => v.type === type).length;
  return { type, confidence, agreement: Math.round((agreeing / votes.length) * 100) };
}

export function runClassification(ctx: ClassifierContext): ClassificationResult {
  const active = CLASSIFIERS.filter((c) => c.enabled);
  const votes = active.map((c) => c.classify(ctx)).filter((v): v is ClassifierVote => v != null);

  const fallbackUsed = votes.length <= 1;
  const blended = votes.length
    ? blend(votes)
    : { type: "general_enquiry" as CaseType, confidence: 20, agreement: 0 };

  const definition = CASE_TYPE_BY_KEY.get(blended.type) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  const suggestedCode = votes.find((v) => v.reasonCode)?.reasonCode;
  const hierarchy = (suggestedCode ? findReasonCode(suggestedCode) : null) ?? defaultPathForType(blended.type);

  return {
    type: blended.type,
    definition,
    confidence: blended.confidence,
    agreement: blended.agreement,
    votes,
    pending: CLASSIFIERS.filter((c) => !c.enabled).map((c) => ({ id: c.id, kind: c.kind })),
    hierarchy,
    fallbackUsed,
  };
}

/** Async entry point — identical contract, ready for model-backed classifiers. */
export async function runClassificationAsync(ctx: ClassifierContext): Promise<ClassificationResult> {
  return runClassification(ctx);
}

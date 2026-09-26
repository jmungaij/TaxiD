/**
 * Explained-AI evaluation and feedback.
 *
 * Users can flag an insight whose declared sources are wrong, missing or stale.
 * Each flag is persisted against the insight key and then drives a *confidence
 * recalculation* — a deterministic, auditable rule, not a re-guess:
 *
 *  - a disputed source is treated as unverified and removed from the evidence base;
 *  - a missing source raises the evidence requirement, so the base cannot be complete;
 *  - once any required source is unverified or unavailable, confidence is WITHHELD
 *    and the conclusion is blocked rather than restated at a lower number.
 *
 * Nothing is invented: recalculation can only lower confidence or withhold it.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { writeAuditLog } from "@/lib/platform/auditWrite";
import type { ExplainedInsight, ExplainedSource } from "@/components/staff/ExplainedAiPanel";

export type FeedbackIssue = "incorrect_source" | "missing_source" | "stale_source" | "wrong_conclusion";

export const FEEDBACK_ISSUE_LABEL: Record<FeedbackIssue, string> = {
  incorrect_source: "A declared source is incorrect",
  missing_source: "A required source is missing",
  stale_source: "A source is stale or out of date",
  wrong_conclusion: "The conclusion does not follow from the sources",
};

export interface InsightFeedback {
  id: string;
  insight_key: string;
  insight_title: string | null;
  reporter_id: string;
  issue_type: FeedbackIssue;
  source_label: string | null;
  comment: string | null;
  status: "open" | "accepted" | "rejected";
  confidence_before: number | null;
  confidence_after: number | null;
  created_at: string;
}

export interface FeedbackResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
}

const table = () =>
  (untypedDb).from("staff_insight_feedback");

export async function listInsightFeedback(insightKey: string): Promise<FeedbackResult<InsightFeedback[]>> {
  const { data, error } = await table()
    .select("*")
    .eq("insight_key", insightKey)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, data: (data ?? []) as InsightFeedback[] };
}

export interface SubmitFeedbackInput {
  insightKey: string;
  insightTitle: string;
  issue: FeedbackIssue;
  sourceLabel?: string;
  comment?: string;
  confidenceBefore?: number;
}

export async function submitInsightFeedback(
  input: SubmitFeedbackInput,
): Promise<FeedbackResult<InsightFeedback>> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return { ok: false, reason: "Your session has expired — sign in again to submit feedback." };
  if (input.issue !== "wrong_conclusion" && !input.sourceLabel) {
    return { ok: false, reason: "Select which data source the issue concerns." };
  }

  const { data, error } = await table()
    .insert({
      insight_key: input.insightKey,
      insight_title: input.insightTitle,
      reporter_id: uid,
      issue_type: input.issue,
      source_label: input.sourceLabel ?? null,
      comment: input.comment?.trim().slice(0, 1000) || null,
      confidence_before: input.confidenceBefore ?? null,
    })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };

  await writeAuditLog("staff_explained_ai", {
    action: "insight_feedback_raised",
    entity_type: "staff_insight",
    entity_id: input.insightKey,
    after_data: {
      issue: input.issue,
      source: input.sourceLabel ?? null,
      confidence_before: input.confidenceBefore ?? null,
    },
  });

  return { ok: true, data: data as InsightFeedback };
}

/* ------------------------------------------------ confidence recalculation */

export interface Recalculation {
  /** Recalculated confidence, or undefined when it must be withheld. */
  confidence?: number;
  /** Whether the insight can still present a conclusion. */
  blocked: boolean;
  /** Plain-language account of how the number changed, or why it was withheld. */
  rationale: string;
  /** Sources treated as unverified because of accepted or open feedback. */
  disputedSources: string[];
  /** Additional sources requested by reviewers but not yet declared. */
  requestedSources: string[];
}

/**
 * Deterministic recalculation. Open and accepted feedback both count — a report
 * that has not been reviewed cannot be assumed to be wrong.
 */
export function recalculateConfidence(
  insight: ExplainedInsight,
  feedback: readonly InsightFeedback[],
): Recalculation {
  const counted = feedback.filter((f) => f.status !== "rejected");
  const disputed = new Set<string>();
  const requested = new Set<string>();
  let staleCount = 0;
  let conclusionDisputed = false;

  for (const f of counted) {
    if (f.issue_type === "incorrect_source" && f.source_label) disputed.add(f.source_label);
    if (f.issue_type === "missing_source") requested.add(f.source_label || "Unnamed source");
    if (f.issue_type === "stale_source") staleCount += 1;
    if (f.issue_type === "wrong_conclusion") conclusionDisputed = true;
  }

  const verified = insight.sources.filter(
    (s: ExplainedSource) => s.state !== "unavailable" && !disputed.has(s.label),
  );
  const unresolved = insight.sources.length - verified.length;
  const base = insight.confidence;

  if (unresolved > 0 || requested.size > 0 || insight.sources.length === 0) {
    return {
      blocked: true,
      rationale:
        `Confidence is withheld: ${unresolved} declared source${unresolved === 1 ? "" : "s"} ` +
        `${unresolved === 1 ? "is" : "are"} unresolved or disputed` +
        (requested.size ? `, and ${requested.size} further source${requested.size === 1 ? " was" : "s were"} requested by reviewers` : "") +
        ". The conclusion is blocked rather than restated at a lower number.",
      disputedSources: [...disputed],
      requestedSources: [...requested],
    };
  }

  if (base == null) {
    return {
      blocked: true,
      rationale: "No prior confidence was stated, so there is nothing to recalculate from.",
      disputedSources: [...disputed],
      requestedSources: [...requested],
    };
  }

  // Every accepted concern lowers confidence; nothing can raise it.
  const stalePenalty = Math.min(0.3, staleCount * 0.1);
  const conclusionPenalty = conclusionDisputed ? 0.25 : 0;
  const next = Math.max(0, Number((base - stalePenalty - conclusionPenalty).toFixed(2)));

  return {
    confidence: next,
    blocked: next < 0.5,
    rationale:
      next === base
        ? "No counted feedback affects the evidence base; confidence is unchanged."
        : `Confidence lowered from ${Math.round(base * 100)}% to ${Math.round(next * 100)}%: ` +
          `${staleCount} staleness report${staleCount === 1 ? "" : "s"}` +
          (conclusionDisputed ? " and a disputed conclusion" : "") +
          `. Recalculation can only lower confidence.`,
    disputedSources: [...disputed],
    requestedSources: [...requested],
  };
}

/** Persist the recalculated confidence against the open feedback that caused it. */
export async function recordRecalculation(
  insightKey: string,
  result: Recalculation,
  confidenceBefore?: number,
): Promise<FeedbackResult<true>> {
  const { error } = await table()
    .update({ confidence_after: result.confidence ?? null, status: "accepted" })
    .eq("insight_key", insightKey)
    .eq("status", "open");

  // A non-admin reviewer cannot close the loop; the flag stays open for review.
  const persisted = !error;

  await writeAuditLog("staff_explained_ai", {
    action: "insight_confidence_recalculated",
    entity_type: "staff_insight",
    entity_id: insightKey,
    before_data: { confidence: confidenceBefore ?? null },
    after_data: {
      confidence: result.confidence ?? null,
      blocked: result.blocked,
      rationale: result.rationale,
      persisted,
    },
  });

  if (!persisted) {
    return {
      ok: false,
      reason:
        "Recalculated for this session. Closing the flags requires an administrator, so they remain open for review.",
    };
  }
  return { ok: true, data: true };
}

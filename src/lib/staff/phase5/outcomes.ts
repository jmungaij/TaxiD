/**
 * Phase 5 — Outcome measurement and the learning engine.
 *
 * Phase 4 could only report "NOT YET MEASURED". This module records what
 * actually happened after an authorised action and recomputes each agent
 * measure from those records, so confidence, risk signals and autonomy
 * eligibility move on evidence rather than assertion.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { AGENT_MEASURES, type AgentMeasure } from "@/lib/staff/phase4/learning";

export interface OutcomeRecord {
  id: string;
  decision_id: string | null;
  agent_key: string;
  measure_key: string;
  unit: string;
  expected_value: number | null;
  actual_value: number | null;
  succeeded: boolean | null;
  lesson: string | null;
  adaptation: string | null;
  recorded_at: string;
}

export interface OutcomeInput {
  decisionId: string | null;
  agentKey: string;
  measureKey: string;
  unit?: string;
  expected: number | null;
  actual: number | null;
  succeeded: boolean;
  lesson: string;
  adaptation: string;
}

 
const db = () => untypedDb;

export async function recordOutcome(input: OutcomeInput, userId: string | null): Promise<string | null> {
  if (!userId) return "Not signed in — an outcome must have an accountable recorder";
  if (!input.lesson.trim()) return "A lesson is required: an unexplained outcome teaches nothing";
  const { error } = await db().from("staff_action_outcomes").insert({
    decision_id: input.decisionId,
    agent_key: input.agentKey,
    measure_key: input.measureKey,
    unit: input.unit ?? "count",
    expected_value: input.expected,
    actual_value: input.actual,
    succeeded: input.succeeded,
    lesson: input.lesson.trim(),
    adaptation: input.adaptation.trim() || null,
    recorded_by: userId,
  });
  if (error) return error.message;
  if (input.decisionId) {
    await db().from("staff_decision_audit").insert({
      decision_id: input.decisionId,
      step: "measured",
      actor: userId,
      detail: { measure: input.measureKey, expected: input.expected, actual: input.actual, succeeded: input.succeeded, lesson: input.lesson.trim() },
    });
    await db().from("staff_decisions").update({ status: "measured" }).eq("id", input.decisionId);
  }
  return null;
}

export async function listOutcomes(limit = 200): Promise<{ data: OutcomeRecord[] | null; error: string | null }> {
  const { data, error } = await db().from("staff_action_outcomes")
    .select("*").order("recorded_at", { ascending: false }).limit(limit);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as OutcomeRecord[], error: null };
}
 

export interface MeasuredValue {
  measure: AgentMeasure;
  /** Observations backing the value. Zero means still unmeasured. */
  observations: number;
  /** Success rate across observations, 0–1, or null when unmeasured. */
  successRate: number | null;
  /** Mean variance of actual against expected, or null. */
  meanVariance: number | null;
  state: "measured" | "unmeasured";
}

/** Recompute every declared measure from recorded outcomes. */
export function measureFromOutcomes(outcomes: readonly OutcomeRecord[]): MeasuredValue[] {
  return AGENT_MEASURES.map((measure) => {
    const rows = outcomes.filter((o) => o.measure_key === measure.key);
    if (rows.length === 0) {
      return { measure, observations: 0, successRate: null, meanVariance: null, state: "unmeasured" as const };
    }
    const successes = rows.filter((r) => r.succeeded === true).length;
    const withBoth = rows.filter((r) => r.expected_value !== null && r.actual_value !== null);
    const meanVariance = withBoth.length
      ? Math.round((withBoth.reduce((n, r) => n + ((r.actual_value as number) - (r.expected_value as number)), 0) / withBoth.length) * 100) / 100
      : null;
    return {
      measure,
      observations: rows.length,
      successRate: Math.round((successes / rows.length) * 100) / 100,
      meanVariance,
      state: "measured" as const,
    };
  });
}

export interface AgentConfidence {
  agent: string;
  observations: number;
  /** 0–1 measured confidence, or null when nothing has been recorded. */
  confidence: number | null;
  /** Adverse signal: outcomes that failed against expectation. */
  failures: number;
  /** Autonomy movement the evidence supports. */
  recommendation: "increase" | "maintain" | "reduce" | "insufficient_evidence";
  lessons: string[];
}

/**
 * Continuous confidence update. Deliberately conservative: fewer than five
 * recorded outcomes is insufficient evidence, and a failure rate above 20%
 * recommends reducing autonomy rather than merely noting it.
 */
export function agentConfidence(agentKey: string, outcomes: readonly OutcomeRecord[]): AgentConfidence {
  const rows = outcomes.filter((o) => o.agent_key === agentKey);
  const failures = rows.filter((r) => r.succeeded === false).length;
  if (rows.length < 5) {
    return {
      agent: agentKey, observations: rows.length, confidence: rows.length ? Math.round((1 - failures / rows.length) * 100) / 100 : null,
      failures, recommendation: "insufficient_evidence",
      lessons: rows.map((r) => r.lesson).filter((l): l is string => !!l).slice(0, 5),
    };
  }
  const confidence = Math.round((1 - failures / rows.length) * 100) / 100;
  const recommendation = confidence >= 0.9 ? "increase" : confidence >= 0.8 ? "maintain" : "reduce";
  return {
    agent: agentKey, observations: rows.length, confidence, failures, recommendation,
    lessons: rows.map((r) => r.lesson).filter((l): l is string => !!l).slice(0, 5),
  };
}

export interface LearningLoopEntry {
  decisionId: string | null;
  agent: string;
  expected: number | null;
  actual: number | null;
  variance: number | null;
  succeeded: boolean | null;
  lesson: string | null;
  adaptation: string | null;
  at: string;
}

/** Prediction → action → outcome → variance → lesson → adaptation, per record. */
export function learningLoop(outcomes: readonly OutcomeRecord[]): LearningLoopEntry[] {
  return outcomes.map((o) => ({
    decisionId: o.decision_id,
    agent: o.agent_key,
    expected: o.expected_value,
    actual: o.actual_value,
    variance: o.expected_value !== null && o.actual_value !== null ? Math.round((o.actual_value - o.expected_value) * 100) / 100 : null,
    succeeded: o.succeeded,
    lesson: o.lesson,
    adaptation: o.adaptation,
    at: o.recorded_at,
  }));
}

/**
 * Phase 6 — Experiment engine.
 *
 * An experiment turns an opinion into a measurable claim: a hypothesis, the
 * control and treatment, and how the result will be measured. Results are read
 * back from `staff_experiments`; an experiment with no recorded measured result
 * is reported as PENDING, never as a success, and one whose measurement has no
 * readable system of record is rejected at design time rather than run
 * unmeasurable.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { Coverage } from "@/lib/staff/phase2/readiness";

export type ExperimentStatus = "designed" | "running" | "measured" | "abandoned";

export interface ExperimentRow {
  id: string;
  title: string;
  domain: string;
  hypothesis: string;
  baseline: string | null;
  control: string | null;
  treatment: string | null;
  /** The table (or method) that measures the result. */
  measurement: string | null;
  status: string;
  decision: string | null;
  measured_result: string | null;
  expected_value: string | null;
  owner_role: string | null;
  created_at: string;
}

export interface ExperimentFeed {
  rows: ExperimentRow[];
  error: string | null;
}

 
const client = () => untypedDb;

export async function listExperiments(limit = 50): Promise<ExperimentFeed> {
  const { data, error } = await client()
    .from("staff_experiments")
    .select("id, title, domain, hypothesis, baseline, control, treatment, measurement, status, decision, measured_result, expected_value, owner_role, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ExperimentRow[], error: null };
}

export interface ExperimentDesign {
  title: string;
  domain: string;
  hypothesis: string;
  baseline: string;
  control: string;
  treatment: string;
  /** Table that will measure the result. */
  measurement: string;
  expectedValue: string;
  ownerRole: string;
}

export type DesignVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Gate an experiment before it runs: without a readable measurement source
 * there is no way to know whether it worked, so it may not be created.
 */
export function validateDesign(design: ExperimentDesign, coverage: Coverage): DesignVerdict {
  if (design.title.trim().length < 4) return { ok: false, reason: "A title is required" };
  if (design.hypothesis.trim().length < 10) return { ok: false, reason: "State the hypothesis as a testable claim" };
  if (!design.control.trim() || !design.treatment.trim()) {
    return { ok: false, reason: "Both the control and the treatment must be stated" };
  }
  const probe = coverage[design.measurement];
  if (!probe) return { ok: false, reason: `${design.measurement} is not a probed system of record` };
  if (probe.rows === null) {
    return {
      ok: false,
      reason: `${design.measurement} is unreadable for this identity (${probe.error ?? "no access"}) — the result could not be measured`,
    };
  }
  return { ok: true };
}

export async function createExperiment(design: ExperimentDesign): Promise<{ ok: boolean; reason?: string }> {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await client()
    .from("staff_experiments")
    .insert({
      title: design.title.trim(),
      domain: design.domain,
      hypothesis: design.hypothesis.trim(),
      baseline: design.baseline.trim() || null,
      control: design.control.trim(),
      treatment: design.treatment.trim(),
      measurement: design.measurement,
      expected_value: design.expectedValue.trim() || null,
      owner_role: design.ownerRole,
      status: "designed",
      created_by: userRes.user?.id ?? null,
    });
  return error ? { ok: false, reason: error.message } : { ok: true };
}
 

export interface ExperimentSummary {
  total: number;
  measured: number;
  running: number;
  designed: number;
  /** Share of experiments whose result is actually known. */
  measurementRate: number | null;
}

const isMeasured = (r: ExperimentRow) => r.status === "measured" && !!r.measured_result;

export function summariseExperiments(feed: ExperimentFeed): ExperimentSummary {
  const rows = feed.rows;
  const measured = rows.filter(isMeasured);
  return {
    total: rows.length,
    measured: measured.length,
    running: rows.filter((r) => r.status === "running").length,
    designed: rows.filter((r) => r.status === "designed").length,
    measurementRate: rows.length === 0 ? null : Math.round((measured.length / rows.length) * 100),
  };
}

/** Lessons that can be stated from measured results only. */
export function experimentLessons(feed: ExperimentFeed): string[] {
  return feed.rows
    .filter(isMeasured)
    .map((r) => `${r.title}: ${r.measured_result}${r.decision ? ` → ${r.decision}` : ""}`)
    .slice(0, 8);
}

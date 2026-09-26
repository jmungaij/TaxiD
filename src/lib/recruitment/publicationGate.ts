/**
 * Careers publication gate.
 *
 * A vacancy may only go public when three independent gates pass:
 *
 *   1. VALIDATION — approval, open status, public slug, org position, an active
 *      application blueprint. (Structural readiness.)
 *   2. CONTRACT   — an active document requirement set bound to the CURRENT
 *      vacancy content version, plus a registered authoritative careers build.
 *      This is the control that makes the 31 Aug stale-bundle mechanism
 *      impossible to publish into.
 *   3. E2E        — a recorded, passing synthetic application run for the
 *      current content version, no older than 14 days.
 *
 * The verdict is computed in the database (`rec_publication_gate_status`) and
 * enforced inside `rec_vacancy_set_publication`, so publishing cannot be
 * achieved by calling a different client path. This module is the read model.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type GateName = "validation" | "contract" | "e2e";

export interface GateResult {
  passed: boolean;
  blockers: string[];
  requirement_version?: number | null;
  authoritative_build_id?: string | null;
  run_id?: string | null;
  suite?: string | null;
  cases_total?: number | null;
  cases_passed?: number | null;
  executed_at?: string | null;
}

export interface PublicationGateStatus {
  vacancy_id: string;
  vacancy_no: string;
  title: string;
  public_slug: string | null;
  content_version: number | null;
  publication_status: string;
  checked_at: string;
  gates: Record<GateName, GateResult>;
  blockers: string[];
  verdict: "READY" | "BLOCKED" | "UNKNOWN";
}

export const GATE_LABELS: Record<GateName, string> = {
  validation: "Validation",
  contract: "Contract handshake",
  e2e: "Live end-to-end run",
};

export const GATE_DESCRIPTIONS: Record<GateName, string> = {
  validation: "Approved, open, publicly addressable and backed by an application form.",
  contract:
    "The document requirement set matches the current vacancy content and a careers build is registered as authoritative.",
  e2e: "A synthetic application was executed end to end against this exact vacancy version.",
};

export async function fetchPublicationGate(vacancyId: string): Promise<PublicationGateStatus> {
  const { data, error } = await db.rpc("rec_publication_gate_status", { p_vacancy: vacancyId });
  if (error) throw new Error(error.message);
  return data as PublicationGateStatus;
}

export interface GateRunInput {
  vacancyId: string;
  gate: "VALIDATION" | "CONTRACT" | "E2E";
  outcome: "PASS" | "FAIL";
  suite?: string;
  casesTotal?: number;
  casesPassed?: number;
  buildId?: string;
  evidence?: Record<string, unknown>;
}

/** Records gate evidence. Append-only in the database — never edited. */
export async function recordGateRun(input: GateRunInput): Promise<{ run_id: string }> {
  const { data, error } = await db.rpc("rec_record_publication_gate_run", {
    p_vacancy: input.vacancyId,
    p_gate: input.gate,
    p_outcome: input.outcome,
    p_suite: input.suite ?? null,
    p_cases_total: input.casesTotal ?? null,
    p_cases_passed: input.casesPassed ?? null,
    p_build_id: input.buildId ?? null,
    p_evidence: input.evidence ?? {},
  });
  if (error) throw new Error(error.message);
  return data as { run_id: string };
}

export interface GateRunRow {
  id: string;
  vacancy_id: string;
  vacancy_slug: string | null;
  gate: string;
  outcome: string;
  content_version: number | null;
  requirement_version: number | null;
  suite: string | null;
  cases_total: number | null;
  cases_passed: number | null;
  build_id: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
}

export async function fetchGateRuns(vacancyId: string, limit = 20): Promise<GateRunRow[]> {
  const { data, error } = await db
    .from("rec_publication_gate_runs")
    .select("*")
    .eq("vacancy_id", vacancyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as GateRunRow[];
}

/** True only when every gate reports pass — the read model never infers a pass. */
export function gateReady(status: PublicationGateStatus | undefined): boolean {
  if (!status) return false;
  return status.verdict === "READY";
}

export function gateOrder(): GateName[] {
  return ["validation", "contract", "e2e"];
}

/**
 * ST CERTIFICATION — client orchestration contract.
 *
 * Every state rendered here is a server verdict read from `st_overview`, and
 * every action terminates in the existing `di00-orchestrator` edge function.
 * There is deliberately no client path that can mark a control as passed:
 * `runStCertification` only asks the orchestrator to execute, and the result it
 * displays is whatever the database observed.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import {
  ST_CONTROLS,
  stExecutionWaves,
  type StControlDefinition,
  type StResult,
} from "./stControls";

const db = untypedDb;

export interface StAssertion { key: string; expected: string; observed: string; passed: boolean }

export interface StExecutionRecord {
  id: string;
  control_id: string;
  run_id: string | null;
  environment_key: string | null;
  environment_fingerprint: string | null;
  schema_version: string | null;
  state: string;
  result: StResult;
  assertions: StAssertion[];
  evidence: Record<string, unknown>;
  first_failure: { assertion: string; expected: string; observed: string } | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  attempt: number;
  correlation_id: string;
  request_id: string;
  evidence_sha256: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  expires_at: string | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  expired: boolean;
}

export interface StGate {
  staging_registered: boolean;
  restore_registered: boolean;
  staging_key: string | null;
  restore_key: string | null;
  staging_verification: string;
  restore_verification: string;
  staging_fingerprint: string | null;
  restore_fingerprint: string | null;
  staging_schema_version: string | null;
  restore_schema_version: string | null;
  staging_production_flag: boolean;
  restore_production_flag: boolean;
  targets_independent: boolean;
  synthetic_fixtures_loaded: boolean;
  verified_backup: boolean;
  verified_restore: boolean;
  di00_certified: boolean;
}

export interface StRun {
  id: string;
  run_key: string;
  trigger_source: string;
  state: string;
  correlation_id: string;
  summary: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface StOverview {
  ok: boolean;
  code?: string;
  can_certify: boolean;
  gate: StGate;
  executions: StExecutionRecord[];
  runs: StRun[];
  generated_at: string;
}

export async function loadStOverview(): Promise<StOverview> {
  const { data, error } = await db.rpc("st_overview");
  if (error) throw new Error(error.message);
  return data as StOverview;
}

/* ------------------------------ derived view ------------------------------ */

export interface StControlView {
  definition: StControlDefinition;
  /** Authoritative state: never invented, never upgraded on the client. */
  result: StResult;
  latest: StExecutionRecord | null;
  /** The controls that must pass first and have not. */
  unmet_dependencies: string[];
  /** DI-00 gate facts this control still needs. */
  unmet_requirements: string[];
  /** Whether the engine can execute it right now. */
  executable: boolean;
  reason: string;
}

const requirementReason: Record<string, (g: StGate) => string | null> = {
  STAGING_VERIFIED: (g) =>
    g.staging_verification === "PASS" && !g.staging_production_flag
      ? null
      : "The isolated staging database is not verified as a reachable non-production instance.",
  RESTORE_VERIFIED: (g) =>
    g.restore_verification === "PASS" && !g.restore_production_flag
      ? null
      : "The independent restore database is not verified as a reachable non-production instance.",
  SCHEMA: (g) => (g.staging_schema_version ? null : "The canonical certification schema is not deployed to staging."),
  FIXTURES: (g) => (g.synthetic_fixtures_loaded ? null : "The deterministic synthetic fixture set is not loaded on staging."),
  BACKUP: (g) => (g.verified_backup ? null : "No integrity-verified backup of the staging instance exists."),
  RESTORE_RUN: (g) => (g.verified_restore ? null : "No verified restore into the restore target exists."),
};

const evidenceValid = (e: StExecutionRecord | null | undefined): boolean =>
  !!e && e.result === "PASS" && !e.invalidated_at && !e.expired;

export function buildStView(overview: StOverview): {
  controls: StControlView[];
  waves: string[][];
  passed: number;
  total: number;
  certified: boolean;
} {
  const byControl = new Map(overview.executions.map((e) => [e.control_id, e]));
  const controls: StControlView[] = ST_CONTROLS.map((definition) => {
    const latest = byControl.get(definition.control_id) ?? null;
    const unmet_dependencies = definition.depends_on.filter((d) => !evidenceValid(byControl.get(d)));
    const unmet_requirements: string[] = definition.requires.filter(
      (r) => !!requirementReason[r]?.(overview.gate),
    );

    let result: StResult = latest ? latest.result : "NOT_TESTED";
    if (latest && latest.result === "PASS" && (latest.invalidated_at || latest.expired)) result = "EVIDENCE_EXPIRED";

    const reason = latest?.invalidated_at
      ? `Evidence invalidated: ${latest.invalidated_reason ?? "environment changed"}`
      : latest?.expired
        ? "Recorded evidence has expired and the control must be re-executed."
        : unmet_dependencies.length > 0
          ? `Waiting on ${unmet_dependencies.join(", ")}.`
          : unmet_requirements.length > 0
            ? (definition.requires
                .map((r) => requirementReason[r]?.(overview.gate))
                .find((m) => !!m) as string)
            : latest?.error_message ??
              (latest?.first_failure
                ? `${latest.first_failure.assertion}: expected ${latest.first_failure.expected}, observed ${latest.first_failure.observed}`
                : latest?.result === "PASS"
                  ? "Executed against the isolated database with authoritative evidence."
                  : "Not yet executed.");

    return {
      definition,
      result,
      latest,
      unmet_dependencies,
      unmet_requirements,
      executable: unmet_dependencies.length === 0 && unmet_requirements.length === 0,
      reason,
    };
  });

  const passed = controls.filter((c) => c.result === "PASS").length;
  return { controls, waves: stExecutionWaves(), passed, total: controls.length, certified: passed === controls.length };
}

/* ------------------------------- operations ------------------------------- */

async function orchestrate(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("di00-orchestrator", { body });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, unknown>;
  return result;
}

export interface StRunStep {
  step: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** Executes a single ST control. `force` re-executes even when evidence exists. */
export async function runStControl(controlId: string, force = false): Promise<Record<string, unknown>> {
  return orchestrate({ action: "st_execute", control_id: controlId, force });
}

/**
 * RUN ST CERTIFICATION — one command.
 *
 * Resolves DI-00 in dependency order using the existing orchestrator actions
 * (health → schema → fixtures → backup → restore), then executes the ST
 * dependency graph. Steps that are already satisfied are skipped; a step that
 * legitimately cannot complete stops the chain and is reported verbatim.
 */
export async function runStCertification(
  onStep?: (step: StRunStep) => void,
): Promise<{ run_id: string | null; steps: StRunStep[]; results: Record<string, unknown>[] }> {
  const steps: StRunStep[] = [];
  const emit = (s: StRunStep) => {
    steps.push(s);
    onStep?.(s);
  };

  const push = async (step: string, label: string, fn: () => Promise<Record<string, unknown>>) => {
    try {
      const r = await fn();
      const ok = r.ok !== false;
      emit({ step, label, ok, detail: ok ? "completed" : String(r.code ?? r.message ?? "refused") });
      return r;
    } catch (e) {
      emit({ step, label, ok: false, detail: e instanceof Error ? e.message : String(e) });
      return { ok: false } as Record<string, unknown>;
    }
  };

  let overview = await loadStOverview();
  const gate = overview.gate;

  await push("health-staging", "Verify isolated staging identity", () =>
    orchestrate({ action: "health", environment_key: "logistics-staging" }));
  await push("health-restore", "Verify independent restore identity", () =>
    orchestrate({ action: "health", environment_key: "logistics-restore" }));

  overview = await loadStOverview();
  if (overview.gate.staging_verification === "PASS") {
    await push("schema-staging", "Deploy canonical certification schema to staging", () =>
      orchestrate({ action: "deploy_schema", environment_key: "logistics-staging" }));
    await push("fixtures-staging", "Load deterministic synthetic fixtures", () =>
      orchestrate({ action: "load_fixtures", environment_key: "logistics-staging", scenario: "st-certification", seed: "stcert1" }));
    if (!gate.verified_backup) {
      await push("backup", "Back up the isolated staging instance", () =>
        orchestrate({ action: "backup", idempotency_key: `stcert-${new Date().toISOString().slice(0, 13)}` }));
    }
  }

  overview = await loadStOverview();
  if (overview.gate.restore_verification === "PASS" && overview.gate.verified_backup) {
    await push("restore", "Restore into the independent restore target", async () => {
      const latest = await latestBackupReference();
      if (!latest) return { ok: false, code: "BACKUP_REQUIRED" };
      return orchestrate({
        action: "restore",
        backup_reference: latest,
        idempotency_key: `stcert-restore-${latest}`,
      });
    });
  }

  const started = await db.rpc("st_run_start", { _trigger_source: "MANUAL" });
  if (started.error) throw new Error(started.error.message);
  const runId = ((started.data as { run?: { id: string } } | null)?.run?.id ?? null) as string | null;
  emit({ step: "run-start", label: "Open certification run", ok: !!runId, detail: runId ? "run opened" : "refused" });

  const run = await orchestrate({ action: "st_run", run_id: runId });
  const results = (run.results ?? []) as Record<string, unknown>[];
  emit({
    step: "st-run",
    label: "Execute the ST dependency graph",
    ok: results.length > 0,
    detail: `${results.filter((r) => r.result === "PASS").length}/${results.length} controls passed`,
  });

  return { run_id: runId, steps, results };
}

async function latestBackupReference(): Promise<string | null> {
  const { data } = await (untypedDb)
    .from("infra_backups")
    .select("backup_reference")
    .eq("state", "SUCCEEDED")
    .order("completed_at", { ascending: false })
    .limit(1);
  return data?.[0]?.backup_reference ?? null;
}

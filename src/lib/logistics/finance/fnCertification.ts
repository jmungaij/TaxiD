/**
 * FN FINANCIAL CERTIFICATION — client projection of the sealed evidence.
 *
 * The browser NEVER decides a financial control's outcome. It reads the sealed
 * executions the DI-00 orchestrator wrote to `st_control_executions` and
 * projects them. Two distinct facts are shown side by side and never conflated:
 *
 *  1. TECHNICAL VERIFICATION — a real execution against the isolated staging
 *     instance (or an explicit, named provider dependency that blocks it).
 *  2. BUSINESS ACCEPTANCE — the CFO / Finance Controller's approved evidence
 *     record in the readiness register.
 *
 * A control is production-ready only when both hold. There is no control here
 * that marks either of them by hand.
 */
import { supabase } from "@/integrations/supabase/client";
import { FN_CONTROLS, type FnControlDefinition, type FnResult } from "./fnControls";

export interface FnAssertion {
  key: string;
  expected: string;
  observed: string;
  passed: boolean;
}

export interface FnExecutionRow {
  id: string;
  control_id: string;
  result: string;
  assertions: FnAssertion[] | null;
  evidence: Record<string, unknown> | null;
  first_failure: { assertion: string; expected: string; observed: string } | null;
  error_code: string | null;
  error_message: string | null;
  environment_key: string | null;
  environment_fingerprint: string | null;
  evidence_sha256: string | null;
  schema_version: string | null;
  finished_at: string | null;
  expires_at: string | null;
  invalidated_at: string | null;
}

export type FnTechnicalState =
  | "VERIFIED"
  | "FAILED"
  | "PROVIDER_BLOCKED"
  | "DEPENDENCY_NOT_READY"
  | "STALE"
  | "NOT_EXECUTED";

export interface FnControlView {
  definition: FnControlDefinition;
  latest: FnExecutionRow | null;
  result: FnResult;
  technical: FnTechnicalState;
  /** Plain-language state of the technical half. */
  reason: string;
  /** What is still outstanding before this control can be accepted. */
  outstanding: string[];
  assertionsPassed: number;
  assertionsTotal: number;
}

const FN_IDS = FN_CONTROLS.map((c) => c.control_id);

export async function loadFnExecutions(): Promise<FnExecutionRow[]> {
  const { data, error } = await supabase
    .from("st_control_executions")
    .select("id, control_id, result, assertions, evidence, first_failure, error_code, error_message, environment_key, environment_fingerprint, evidence_sha256, schema_version, finished_at, expires_at, invalidated_at")
    .in("control_id", FN_IDS)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FnExecutionRow[];
}

const stale = (row: FnExecutionRow, now: string) =>
  !!row.invalidated_at || (!!row.expires_at && new Date(row.expires_at) < new Date(now));

export function buildFnView(rows: FnExecutionRow[], now: string = new Date().toISOString()): FnControlView[] {
  return FN_CONTROLS.map((definition) => {
    const latest = rows
      .filter((r) => r.control_id === definition.control_id && r.finished_at)
      .sort((a, b) => ((a.finished_at ?? "") < (b.finished_at ?? "") ? 1 : -1))[0] ?? null;

    const assertions = latest?.assertions ?? [];
    const assertionsTotal = assertions.length;
    const assertionsPassed = assertions.filter((a) => a.passed).length;
    const outstanding: string[] = [];

    let technical: FnTechnicalState = "NOT_EXECUTED";
    let reason = "Never executed against the isolated staging instance.";

    if (latest && stale(latest, now)) {
      technical = "STALE";
      reason = latest.invalidated_at
        ? "The database identity changed after this execution, so its evidence is no longer authoritative. Re-execute."
        : "The recorded evidence has passed its freshness window. Re-execute.";
      outstanding.push("Re-execute the control against the isolated staging instance.");
    } else if (latest) {
      switch (latest.result) {
        case "PASS":
          technical = "VERIFIED";
          reason = `Executed on ${(latest.finished_at ?? "").slice(0, 10)} against ${latest.environment_key ?? "the isolated instance"} — ${assertionsPassed}/${assertionsTotal} assertions observed.`;
          break;
        case "PROVIDER_CONFIGURATION_REQUIRED":
        case "EXTERNAL_EXECUTION_REQUIRED":
          technical = "PROVIDER_BLOCKED";
          reason = latest.error_message
            ?? "A real execution against a non-production provider application is required and has not happened.";
          outstanding.push(
            latest.first_failure
              ? `${latest.first_failure.assertion}: expected ${latest.first_failure.expected}; observed ${latest.first_failure.observed}.`
              : "Provision the non-production provider application, then re-execute.",
          );
          break;
        case "DEPENDENCY_NOT_READY":
          technical = "DEPENDENCY_NOT_READY";
          reason = latest.error_message ?? "A prerequisite is not satisfied.";
          outstanding.push(reason);
          break;
        default:
          technical = "FAILED";
          reason = latest.first_failure
            ? `${latest.first_failure.assertion}: expected ${latest.first_failure.expected}; observed ${latest.first_failure.observed}.`
            : latest.error_message ?? "The execution failed.";
          outstanding.push("Repair the defect, then re-execute the control.");
      }
    } else {
      outstanding.push("Execute the control against the isolated staging instance.");
    }

    return {
      definition,
      latest,
      result: (latest?.result ?? "NOT_TESTED") as FnResult,
      technical,
      reason,
      outstanding,
      assertionsPassed,
      assertionsTotal,
    };
  });
}

interface OrchestratorResponse {
  ok: boolean;
  code?: string;
  message?: string;
  results?: { control_id: string; result: string; remediation?: string | null }[];
  fin_schema_version?: string;
}

async function invokeOrchestrator(body: Record<string, unknown>): Promise<OrchestratorResponse> {
  const { data, error } = await supabase.functions.invoke("di00-orchestrator", { body });
  if (error) throw new Error(error.message);
  return (data ?? {}) as OrchestratorResponse;
}

/** Deploys the finance certification schema onto the isolated staging instance. */
export function deployFinanceSchema() {
  return invokeOrchestrator({ action: "fin_deploy_schema", environment_key: "logistics-staging" });
}

/** Executes the whole FN wave in dependency order. */
export function runFnCertification(runId?: string | null) {
  return invokeOrchestrator({ action: "fn_run", run_id: runId ?? null });
}

/**
 * Options for controls that collect from a real payer.
 *
 * The platform never holds a default payer number: the paying party (rider,
 * business, corporate or logistics customer) supplies the M-Pesa number that
 * receives the STK prompt, exactly as in the production checkout flow.
 */
export interface FnProviderExecutionOptions {
  /** The payer's M-Pesa number — always entered by the paying party. */
  payerMsisdn?: string;
  /** "sandbox" cannot move money; "live" debits the payer's real M-Pesa account. */
  providerMode?: "sandbox" | "live";
  /** Explicit owner confirmation, required before any live-money execution. */
  liveExecutionConfirmed?: boolean;
  /** Certification amount in KES (live executions are capped server-side). */
  amountKes?: number;
}

/** Executes one FN control. `force` re-executes even when evidence exists. */
export function runFnControl(controlId: string, force = false, options: FnProviderExecutionOptions = {}) {
  return invokeOrchestrator({
    action: "fn_execute",
    control_id: controlId,
    force,
    payer_msisdn: options.payerMsisdn ?? null,
    provider_mode: options.providerMode ?? "sandbox",
    live_execution_confirmed: options.liveExecutionConfirmed === true,
    amount_kes: options.amountKes ?? null,
  });
}


/** Summary counters for the panel header. */
export function fnSummary(views: FnControlView[]) {
  return {
    total: views.length,
    verified: views.filter((v) => v.technical === "VERIFIED").length,
    providerBlocked: views.filter((v) => v.technical === "PROVIDER_BLOCKED").length,
    failed: views.filter((v) => v.technical === "FAILED").length,
    notExecuted: views.filter((v) => v.technical === "NOT_EXECUTED").length,
    stale: views.filter((v) => v.technical === "STALE").length,
  };
}

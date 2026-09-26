/**
 * Stage 10B — AI operations pipeline client contract.
 *
 * The full governed loop lives in the database:
 *
 *   AUTHORITATIVE EVENT → DETECTOR → CONTEXT ASSEMBLY (hashed) → REASONING
 *   → RECOMMENDATION (grounded) → POLICY → APPROVAL → ACTION REQUEST
 *   → DOMAIN ADAPTER → AUTHORITATIVE ENGINE → VERIFICATION → OUTCOME
 *
 * LAWS mirrored here so no surface can suggest an ungoverned path:
 *   - Detectors, context snapshots, model invocations, grounding and execution
 *     are worker-only (service role). There is deliberately no client function.
 *   - Adapters translate intent into calls on existing engines. They contain no
 *     business logic, and an adapter with `automation_allowed = false` refuses.
 *   - An action is EXECUTED only when the engine accepted the command AND
 *     authoritative state actually changed as intended.
 *   - Approvals are bound to action + entity + context hash + policy version +
 *     expiry, and are revalidated at execution.
 *   - When no model is configured, capability is NOT CONFIGURED — never "active".
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export type AiNonActionCode =
  | "ACTION_NOT_REQUIRED"
  | "ACTION_NOT_POSSIBLE"
  | "ACTION_BLOCKED"
  | "ACTION_EXPIRED"
  | "STALE_CONTEXT"
  | "INSUFFICIENT_EVIDENCE";

export const AI_NON_ACTION_LABEL: Record<AiNonActionCode, string> = {
  ACTION_NOT_REQUIRED: "No action needed",
  ACTION_NOT_POSSIBLE: "Action not possible",
  ACTION_BLOCKED: "Blocked by policy",
  ACTION_EXPIRED: "Approval window closed",
  STALE_CONTEXT: "Operational state changed",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
};

export type AiModelOutcome =
  | "OK" | "FAILED" | "TIMEOUT" | "UNAVAILABLE" | "NOT_CONFIGURED"
  | "FALLBACK_USED" | "LOW_CONFIDENCE";

export interface AiPipelineHealth {
  active_detectors: number;
  findings: number;
  findings_open: number;
  context_snapshots: number;
  grounded_recommendations: number;
  ungrounded_recommendations: number;
  non_actions: number;
  automating_adapters: number;
  refusing_adapters: number;
  configured_models: number;
  open_security_blockers: number;
}

export interface AiNonActionRow {
  id: string;
  code: AiNonActionCode;
  reason: string;
  evidence: Record<string, unknown>;
  candidates_evaluated: unknown[];
  next_step: string | null;
  created_at: string;
  detector_code: string | null;
  finding_severity: string | null;
  entity_type: string | null;
  entity_ref: string | null;
  recommendation_type: string | null;
  action_type: string | null;
  action_state: string | null;
}

export interface AiAdapterRow {
  action_type: string;
  domain: string;
  adapter_code: string;
  target_service: string;
  target_function: string | null;
  automation_allowed: boolean;
  refusal_reason: string | null;
  revalidation_kind: string;
}

export interface AiRevalidation {
  action_request_id: string;
  valid: boolean;
  reasons: string[];
  live_state: Record<string, unknown>;
  live_hash: string;
  adapter_code: string | null;
  automation_allowed: boolean;
}

/**
 * Capability state for the UI. `configuredModels === 0` MUST render as
 * "AI CAPABILITY NOT CONFIGURED" — never as an active AI feature.
 */
export function describeAiCapability(health: Pick<AiPipelineHealth, "configured_models" | "active_detectors">): {
  state: "NOT_CONFIGURED" | "DETECTION_ONLY" | "ACTIVE";
  label: string;
} {
  if (health.configured_models === 0) {
    return {
      state: health.active_detectors > 0 ? "DETECTION_ONLY" : "NOT_CONFIGURED",
      label:
        health.active_detectors > 0
          ? "AI CAPABILITY NOT CONFIGURED — detection and governance only"
          : "AI CAPABILITY NOT CONFIGURED",
    };
  }
  return { state: "ACTIVE", label: "AI reasoning configured" };
}

/** Plain-language explanation for a revalidation refusal reason. */
export const AI_REVALIDATION_REASONS: Record<string, string> = {
  NO_ADAPTER: "No approved adapter maps this action to an authoritative engine.",
  AUTOMATION_NOT_PERMITTED: "This domain does not permit automated execution; a person must decide.",
  ACTION_EXPIRED: "The action's window closed before it was executed.",
  ENTITY_NOT_FOUND: "The affected record no longer exists.",
  CONTEXT_CHANGED: "Authoritative state changed after the recommendation was produced.",
  NO_CONTEXT_SNAPSHOT: "No hashed context snapshot is bound to this action.",
  APPROVAL_STALE_OR_MISSING: "No valid, in-date approval is bound to the current state.",
};

export function describeRevalidation(reasons: string[]): string[] {
  return reasons.map(
    (r) => AI_REVALIDATION_REASONS[r] ?? (r.startsWith("MISSING_PAYLOAD_")
      ? `Required input is missing: ${r.replace("MISSING_PAYLOAD_", "").toLowerCase()}.`
      : r),
  );
}

export async function fetchAiPipelineHealth(): Promise<AiPipelineHealth> {
  const { data, error } = await untypedDb
    .from("v_ai_pipeline_health").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data as AiPipelineHealth;
}

export async function fetchAiNonActions(limit = 100): Promise<AiNonActionRow[]> {
  const { data, error } = await untypedDb
    .from("v_ai_non_action_register").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AiNonActionRow[];
}

export async function fetchAiAdapters(): Promise<AiAdapterRow[]> {
  const { data, error } = await untypedDb
    .from("ai_adapters").select("*").eq("active", true).order("domain");
  if (error) throw new Error(error.message);
  return (data ?? []) as AiAdapterRow[];
}

/** Non-mutating: re-reads authoritative state and reports whether the action may still run. */
export async function revalidateAiAction(actionRequestId: string): Promise<AiRevalidation> {
  const { data, error } = await untypedDb
    .rpc("ai_context_revalidate", { _action_request_id: actionRequestId });
  if (error) throw new Error(error.message);
  return data as AiRevalidation;
}

/** Record why the system deliberately did not act. Reason is mandatory. */
export async function recordAiNonAction(args: {
  code: AiNonActionCode;
  reason: string;
  evidence?: Record<string, unknown>;
  findingId?: string;
  recommendationId?: string;
  actionRequestId?: string;
  candidates?: unknown[];
  nextStep?: string;
}): Promise<{ non_action_id: string; code: AiNonActionCode }> {
  const { data, error } = await untypedDb.rpc("ai_non_action_record", {
    _code: args.code,
    _reason: args.reason,
    _evidence: args.evidence ?? {},
    _finding_id: args.findingId ?? null,
    _recommendation_id: args.recommendationId ?? null,
    _action_request_id: args.actionRequestId ?? null,
    _candidates: args.candidates ?? [],
    _next_step: args.nextStep ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { non_action_id: string; code: AiNonActionCode };
}

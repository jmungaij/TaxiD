/**
 * Stage 10 — AI operations orchestration client contract.
 *
 * GOVERNANCE (enforced in the database, mirrored here so the UI can never
 * suggest an ungoverned path):
 *   - The AI layer NEVER mutates transactional data. Recommendations become
 *     action requests, which are policy-evaluated, approved where required and
 *     executed only by the existing Stage 2–9 engines.
 *   - Recommendations are created only by the server-side orchestration worker
 *     (service role). There is deliberately no client function for that.
 *   - Executions are performed only by the worker; operators approve, they do
 *     not execute.
 *   - Financial, ledger, tariff, quote and claim decisions are HUMAN_ONLY or
 *     BLOCKED and can never be executed by this layer.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export type AiPriority = "P0" | "P1" | "P2" | "P3";
export type AiActionClass = "AUTO_SAFE" | "APPROVAL_REQUIRED" | "HUMAN_ONLY" | "BLOCKED";
export type AiActionState =
  | "PROPOSED" | "APPROVAL_PENDING" | "APPROVED" | "EXECUTING"
  | "EXECUTED" | "FAILED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface AiControlTowerRow {
  recommendation_id: string;
  priority: AiPriority;
  recommendation_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_ref: string | null;
  observation: string;
  evidence: Record<string, unknown>;
  reasoning_summary: string;
  alternatives: unknown[];
  expected_impact: Record<string, unknown>;
  confidence: number;
  classification: AiActionClass;
  policy_status: string;
  requires_approval: boolean;
  recommendation_status: "OPEN" | "ACTIONED" | "DISMISSED" | "EXPIRED" | "SUPERSEDED";
  created_at: string;
  expires_at: string | null;
  agent_code: string;
  agent_name: string;
  action_request_id: string | null;
  action_state: AiActionState | null;
  target_service: string | null;
  approvals: number;
  verified: boolean | null;
  outcome_success: boolean | null;
}

/** Human-readable explanation for each governance refusal the layer can return. */
export const AI_GOVERNANCE_REFUSALS: Record<string, string> = {
  NO_POLICY: "No active policy covers this action, so it is blocked until one is registered.",
  BLOCKED: "System policy forbids this action for the AI layer entirely.",
  HUMAN_ONLY: "This action is reserved for a human decision through the owning domain service.",
  NOT_APPROVED: "Only an approved action may execute.",
  EXPIRED: "The approval window closed; regenerate the recommendation against current data.",
  SELF_APPROVAL: "The requester may not approve their own action.",
  NO_ADAPTER: "No approved execution adapter exists for this action, so the AI layer cannot execute it.",
};

export function describeAiRefusal(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("no active policy")) return AI_GOVERNANCE_REFUSALS.NO_POLICY;
  if (m.includes("policy blocks")) return AI_GOVERNANCE_REFUSALS.BLOCKED;
  if (m.includes("may never be executed")) return AI_GOVERNANCE_REFUSALS.HUMAN_ONLY;
  if (m.includes("only an approved action")) return AI_GOVERNANCE_REFUSALS.NOT_APPROVED;
  if (m.includes("expired")) return AI_GOVERNANCE_REFUSALS.EXPIRED;
  if (m.includes("own action")) return AI_GOVERNANCE_REFUSALS.SELF_APPROVAL;
  if (m.includes("execution adapter")) return AI_GOVERNANCE_REFUSALS.NO_ADAPTER;
  return message;
}

/** Read the governed control-tower projection. RLS restricts it to operations governors. */
export async function fetchAiControlTower(limit = 100): Promise<AiControlTowerRow[]> {
  const { data, error } = await untypedDb
    .from("v_ai_control_tower")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AiControlTowerRow[];
}

/** Non-mutating policy check used to render "what would happen" before acting. */
export async function evaluateAiPolicy(actionType: string): Promise<Record<string, unknown>> {
  const { data, error } = await untypedDb.rpc("ai_policy_evaluate", { _action_type: actionType });
  if (error) throw new Error(describeAiRefusal(error.message));
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * Convert an open recommendation into a governed action request.
 * The database evaluates policy; blocked action types are refused here, not queued.
 */
export async function openAiActionRequest(args: {
  recommendationId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ action_request_id: string; duplicate: boolean; state?: AiActionState }> {
  const { data, error } = await untypedDb.rpc("ai_action_request_open", {
    _recommendation_id: args.recommendationId,
    _payload: args.payload,
    _idempotency_key: args.idempotencyKey,
  });
  if (error) throw new Error(describeAiRefusal(error.message));
  return data as { action_request_id: string; duplicate: boolean; state?: AiActionState };
}

/** Record an approval decision. Evidence must have been reviewed; self-approval is refused. */
export async function decideAiAction(args: {
  actionRequestId: string;
  decision: "APPROVED" | "REJECTED" | "DEFERRED" | "ESCALATED";
  reason: string;
  evidenceReviewed: boolean;
}): Promise<{ action_request_id: string; state: AiActionState; decision: string }> {
  const { data, error } = await untypedDb.rpc("ai_action_decide", {
    _action_request_id: args.actionRequestId,
    _decision: args.decision,
    _reason: args.reason,
    _evidence_reviewed: args.evidenceReviewed,
  });
  if (error) throw new Error(describeAiRefusal(error.message));
  return data as { action_request_id: string; state: AiActionState; decision: string };
}

/** Record the measured outcome of an executed action (expected vs actual). */
export async function measureAiOutcome(args: {
  actionRequestId: string;
  actual: Record<string, unknown>;
  success: boolean;
  notes?: string;
}): Promise<{ action_request_id: string; success: boolean }> {
  const { data, error } = await untypedDb.rpc("ai_action_measure_outcome", {
    _action_request_id: args.actionRequestId,
    _actual: args.actual,
    _success: args.success,
    _notes: args.notes ?? null,
  });
  if (error) throw new Error(describeAiRefusal(error.message));
  return data as { action_request_id: string; success: boolean };
}

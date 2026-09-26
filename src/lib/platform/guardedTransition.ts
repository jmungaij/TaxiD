/**
 * Guarded status transitions for privileged review queues
 * (fraud cases, suspicious transactions, compliance alerts, delivery fraud signals).
 *
 * Two production guarantees:
 *  1. Optimistic lock — the UPDATE only matches rows still in one of the
 *     expected states, so two reviewers acting on the same row cannot silently
 *     overwrite each other. A zero-row result is reported as a conflict.
 *  2. Audit trail — every successful transition writes an `audit_logs` entry via
 *     the shared `writeAuditLog` entry point.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { writeAuditLog } from "@/lib/platform/auditWrite";

export type GuardedTransitionOutcome = "applied" | "conflict" | "error";

export interface GuardedTransitionResult {
  outcome: GuardedTransitionOutcome;
  /** Human-readable reason for conflict/error outcomes. */
  message?: string;
  /** True when the audit write was rejected (transition still applied). */
  auditFailed?: boolean;
}

export interface GuardedTransitionInput {
  table: string;
  id: string;
  /** Column holding the lifecycle state. Defaults to `status`. */
  statusColumn?: string;
  /** States the row must currently be in for the transition to be legal. */
  expectedStates: readonly (string | boolean)[];
  patch: Record<string, unknown>;
  audit: { flow: string; action: string; entity_type: string };
}

export const CONFLICT_MESSAGE =
  "Already actioned by another reviewer — refreshing to show the current state.";

export async function applyGuardedTransition(
  input: GuardedTransitionInput,
): Promise<GuardedTransitionResult> {
  const statusColumn = input.statusColumn ?? "status";
  const client = untypedDb;

  const { data, error } = await client
    .from(input.table)
    .update(input.patch)
    .eq("id", input.id)
    .in(statusColumn, input.expectedStates as unknown[])
    .select("id");

  if (error) return { outcome: "error", message: error.message };
  if (!data || data.length === 0) return { outcome: "conflict", message: CONFLICT_MESSAGE };

  const audit = await writeAuditLog(input.audit.flow, {
    action: input.audit.action,
    entity_type: input.audit.entity_type,
    entity_id: input.id,
    before_data: { [statusColumn]: input.expectedStates },
    after_data: input.patch,
  });

  return { outcome: "applied", auditFailed: !audit.ok };
}

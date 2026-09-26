/**
 * Operator portal audit trail.
 *
 * Every crew-side action (status advance, ticket verification refresh,
 * reconciliation refresh, manifest export) is written to `audit_logs` with the
 * actor and before/after values, and can be read back into the portal.
 */
import { writeAuditLog } from "@/lib/platform/auditWrite";
import { supabase } from "@/integrations/supabase/client";

export type OperatorAuditAction =
  | "charter_operator_status_advanced"
  | "charter_operator_reconciliation_refreshed"
  | "charter_operator_ticket_verified"
  | "charter_operator_manifest_exported"
  | "charter_operator_notification_sent";

export interface OperatorAuditEntry {
  id: string;
  action: string;
  entity_id: string | null;
  created_at: string;
  actor_user_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
}

/** Records an operator action. Never throws — audit failures are monitored. */
export async function recordOperatorAction(
  action: OperatorAuditAction,
  bookingId: string | null,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  try {
    await writeAuditLog("charter_operator", {
      action,
      entity_type: "charter_booking",
      entity_id: bookingId,
      before_data: before,
      after_data: after,
    });
  } catch {
    /* monitored inside writeAuditLog */
  }
}

/** Recent operator actions for a booking (most recent first). */
export async function listOperatorAudit(bookingId: string, limit = 20): Promise<OperatorAuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_id, created_at, actor_user_id, before_data, after_data")
    .eq("entity_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as OperatorAuditEntry[];
}

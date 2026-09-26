/**
 * Permission-aware actions on search results.
 *
 * Three real, recorded outcomes:
 *  - **Follow-up task** — a row in `staff_follow_up_tasks`, optionally assigned.
 *  - **Assign to me** — the same task, assigned to the signed-in employee.
 *  - **Recorded decision** — an approve/reject decision captured against the
 *    entity, with a reason and an audit entry.
 *
 * A recorded decision is deliberately *not* a mutation of the source record:
 * the owning module remains the only place a booking, invoice or document
 * changes state. The decision is a governed, auditable staff act that the owning
 * module can act on, and the UI says exactly that.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { writeAuditLog } from "@/lib/platform/auditWrite";
import type { SearchEntityId } from "@/lib/staff/universalSearch";
import type { WorkflowStageId } from "@/lib/staff/marketplaceWorkflow";

export type FollowUpStatus = "open" | "in_progress" | "approved" | "rejected" | "completed";

export interface FollowUpTask {
  id: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  title: string;
  notes: string | null;
  workflow_stage: string | null;
  assignee_id: string | null;
  created_by: string;
  status: FollowUpStatus;
  decision_reason: string | null;
  due_date: string | null;
  created_at: string;
}

export interface ActionResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
}

const table = () =>
  (untypedDb).from("staff_follow_up_tasks");

export interface FollowUpInput {
  entity: SearchEntityId;
  entityId?: string;
  entityLabel?: string;
  stage?: WorkflowStageId;
  title: string;
  notes?: string;
  dueDate?: string;
  /** Assign to the signed-in employee. */
  assignToSelf?: boolean;
}

export async function createFollowUpTask(input: FollowUpInput): Promise<ActionResult<FollowUpTask>> {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, reason: "Describe the follow-up before creating it." };

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return { ok: false, reason: "Your session has expired — sign in again." };

  const { data, error } = await table()
    .insert({
      entity_type: input.entity,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel?.slice(0, 200) ?? null,
      workflow_stage: input.stage ?? null,
      title,
      notes: input.notes?.trim().slice(0, 1000) || null,
      due_date: input.dueDate || null,
      assignee_id: input.assignToSelf ? uid : null,
      created_by: uid,
      status: "open",
    })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };

  await writeAuditLog("staff_follow_up", {
    action: input.assignToSelf ? "follow_up_assigned_self" : "follow_up_created",
    entity_type: input.entity,
    entity_id: input.entityId ?? null,
    after_data: { title, stage: input.stage ?? null, due_date: input.dueDate ?? null },
  });

  return { ok: true, data: data as FollowUpTask };
}

export interface DecisionInput {
  entity: SearchEntityId;
  entityId?: string;
  entityLabel?: string;
  stage?: WorkflowStageId;
  decision: "approved" | "rejected";
  reason: string;
}

/** Record a governed approve/reject decision against an entity. */
export async function recordDecision(input: DecisionInput): Promise<ActionResult<FollowUpTask>> {
  const reason = input.reason.trim().slice(0, 1000);
  if (!reason) {
    return { ok: false, reason: "A decision needs a reason so it can be audited and acted on." };
  }
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return { ok: false, reason: "Your session has expired — sign in again." };

  const { data, error } = await table()
    .insert({
      entity_type: input.entity,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel?.slice(0, 200) ?? null,
      workflow_stage: input.stage ?? null,
      title: `${input.decision === "approved" ? "Approved" : "Rejected"}: ${input.entityLabel ?? input.entity}`,
      decision_reason: reason,
      assignee_id: uid,
      created_by: uid,
      status: input.decision,
    })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };

  await writeAuditLog("staff_decision", {
    action: `decision_${input.decision}`,
    entity_type: input.entity,
    entity_id: input.entityId ?? null,
    after_data: { decision: input.decision, reason, stage: input.stage ?? null },
  });

  return { ok: true, data: data as FollowUpTask };
}

export async function listFollowUps(params: {
  entity?: SearchEntityId;
  entityId?: string;
  limit?: number;
}): Promise<ActionResult<FollowUpTask[]>> {
  let q = table().select("*").order("created_at", { ascending: false }).limit(params.limit ?? 20);
  if (params.entity) q = q.eq("entity_type", params.entity);
  if (params.entityId) q = q.eq("entity_id", params.entityId);
  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message };
  return { ok: true, data: (data ?? []) as FollowUpTask[] };
}

export async function updateFollowUpStatus(
  id: string,
  status: FollowUpStatus,
): Promise<ActionResult<true>> {
  const { error } = await table().update({ status }).eq("id", id);
  if (error) return { ok: false, reason: error.message };
  await writeAuditLog("staff_follow_up", {
    action: "follow_up_status_changed",
    entity_type: "staff_follow_up_task",
    entity_id: id,
    after_data: { status },
  });
  return { ok: true, data: true };
}

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

/** The boundary statement shown wherever a decision is recorded. */
export const DECISION_BOUNDARY_NOTE =
  "A recorded decision is a governed, audited staff act. It does not itself change the source record — the owning module remains the only place state changes.";

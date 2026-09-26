/**
 * SAFARID orchestration — data access.
 *
 * `emitPlatformEvent` is the single entry point every portal and engine uses to
 * hand a platform event to the orchestration layer. The classification happens
 * in `rules.ts` (pure, replayable) and the persistence happens atomically in
 * `ops_ingest_event` (event + work item + first audit entry, idempotent on the
 * dedupe key).
 *
 * Reads return canonical records only — the Staff Portal never stores its own
 * copy of a customer, provider, booking or payment.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { classifyEvent, type OpsQueue, type OrchestrationDecision } from "./rules";
import type { PlatformEvent } from "./events";
import { evaluateSla, bucketFor, compareWork, type SlaView, type WorkState, type WorkspaceBucket } from "./workLifecycle";
import type { ApprovalState } from "./outcomes";

const db = untypedDb;

export interface EmitResult {
  ok: boolean;
  eventId?: string;
  workItemId?: string | null;
  decision: OrchestrationDecision;
  idempotentReplay?: boolean;
  error?: string;
}

/** Deterministic dedupe key so webhook retries never duplicate work. */
export const dedupeKeyFor = (event: PlatformEvent) =>
  `${event.type}:${event.entityType}:${event.entityId}:${event.id}`;

export async function emitPlatformEvent(
  event: PlatformEvent,
  opts?: { seedBatch?: string },
): Promise<EmitResult> {
  const decision = classifyEvent(event);
  const { data, error } = await db.rpc("ops_ingest_event", {
    _event_type: decision.eventType,
    _source_portal: event.sourcePortal,
    _chain_stage: decision.stage,
    _entity_type: decision.entityType,
    _entity_id: decision.entityId,
    _disposition: decision.disposition,
    _priority: decision.priority,
    _sla_minutes: decision.slaMinutes,
    _dedupe_key: dedupeKeyFor(event),
    _title: decision.title,
    _required_action: decision.requiredAction,
    _ops_queue: decision.queue,
    _work_kind: decision.workKind,
    _needs_approval: decision.needsApproval,
    _escalate: decision.escalateImmediately,
    _service_line: event.serviceLine ?? null,
    _entity_ref: (event.payload?.entity_ref as string) ?? null,
    _signals: event.signals ?? {},
    _payload: event.payload ?? {},
    _reasons: decision.reasons,
    _occurred_at: event.occurredAt,
    _seed_batch: opts?.seedBatch ?? null,
  });

  if (error) return { ok: false, decision, error: error.message };
  return {
    ok: true,
    decision,
    eventId: data?.event_id,
    workItemId: data?.work_item_id ?? null,
    idempotentReplay: !!data?.idempotent_replay,
  };
}

/* ------------------------------------------------------------ work reads */

export interface OpsWorkItem {
  id: string;
  title: string;
  ops_queue: OpsQueue | null;
  work_kind: string;
  service_line: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_ref: string | null;
  lifecycle_state: WorkState;
  priority: "critical" | "high" | "medium" | "low";
  needs_approval: boolean;
  escalation_level: number;
  staff_id: string | null;
  required_action: string | null;
  source_event_id: string | null;
  created_at: string;
  sla_started_at: string | null;
  sla_minutes: number | null;
  sla_due_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  sla_status: SlaView["status"];
  remaining_minutes: number | null;
  approval_state: ApprovalState;
  approval_requested_by: string | null;
  approval_requested_at: string | null;
  approval_reason: string | null;
  approval_decided_by: string | null;
  approval_decided_at: string | null;
  approval_decision_note: string | null;
  writeback_outcome: string | null;
  writeback_applied_at: string | null;
}

export interface DecoratedWork extends OpsWorkItem {
  sla: SlaView;
  bucket: WorkspaceBucket;
}

export function decorateWork(items: OpsWorkItem[], now = new Date().toISOString()): DecoratedWork[] {
  return items
    .map((w) => {
      const sla = evaluateSla({
        startedAt: w.sla_started_at ?? w.created_at,
        slaMinutes: w.sla_minutes ?? 60,
        stoppedAt: w.closed_at ?? w.completed_at ?? null,
        now,
      });
      return {
        ...w,
        sla,
        bucket: bucketFor({ state: w.lifecycle_state, priority: w.priority, needsApproval: w.needs_approval, sla }),
      };
    })
    .sort(compareWork as unknown as (a: DecoratedWork, b: DecoratedWork) => number);
}

export interface WorkFilter {
  queues?: OpsQueue[];
  states?: WorkState[];
  staffId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}

export async function fetchOpsWork(filter: WorkFilter = {}): Promise<OpsWorkItem[]> {
  let q = db.from("v_ops_work_sla").select("*").not("ops_queue", "is", null);
  if (filter.queues?.length) q = q.in("ops_queue", filter.queues);
  if (filter.states?.length) q = q.in("lifecycle_state", filter.states);
  if (filter.staffId) q = q.eq("staff_id", filter.staffId);
  if (filter.entityType) q = q.eq("entity_type", filter.entityType);
  if (filter.entityId) q = q.eq("entity_id", filter.entityId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit ?? 300);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpsWorkItem[];
}

/* -------------------------------------------------------- work transitions */

export interface TransitionInput {
  workItemId: string;
  toState: WorkState;
  reason?: string;
  assigneeStaffId?: string | null;
  resolution?: string;
}

export async function transitionWork(input: TransitionInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc("ops_work_transition", {
    _work_item_id: input.workItemId,
    _to_state: input.toState,
    _reason: input.reason ?? null,
    _assignee_staff_id: input.assigneeStaffId ?? null,
    _resolution: input.resolution ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* --------------------------------------------------------------- audit + events */

export interface OpsAuditEntry {
  id: string;
  work_item_id: string;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  state_before: string | null;
  state_after: string | null;
  reason: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function fetchWorkAudit(workItemId: string): Promise<OpsAuditEntry[]> {
  const { data, error } = await db
    .from("ops_work_audit").select("*").eq("work_item_id", workItemId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpsAuditEntry[];
}

/** Full operational history for a canonical entity — events plus staff actions. */
export async function fetchEntityTrail(entityType: string, entityId: string) {
  const [events, audit] = await Promise.all([
    db.from("ops_events").select("*").eq("entity_type", entityType).eq("entity_id", entityId)
      .order("occurred_at", { ascending: true }),
    db.from("ops_work_audit").select("*").eq("entity_type", entityType).eq("entity_id", entityId)
      .order("created_at", { ascending: true }),
  ]);
  if (events.error) throw new Error(events.error.message);
  if (audit.error) throw new Error(audit.error.message);
  return { events: events.data ?? [], audit: audit.data ?? [] };
}

export interface OpsEventRow {
  id: string;
  event_type: string;
  source_portal: string;
  service_line: string | null;
  chain_stage: string;
  entity_type: string;
  entity_id: string | null;
  disposition: string;
  ops_queue: string | null;
  priority: string;
  sla_minutes: number;
  decision_reasons: string[];
  occurred_at: string;
}

export async function fetchRecentEvents(limit = 100): Promise<OpsEventRow[]> {
  const { data, error } = await db.from("ops_events").select("*")
    .order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpsEventRow[];
}

/** Staff record for the signed-in user — the Staff Portal identity. */
export async function fetchMyStaffRecord(userId: string) {
  const { data } = await db.from("staff_members").select("*").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/* --------------------------------------- approvals, write-back, propagation */

/** Maker: bind an authority decision to this work item. */
export async function requestWorkApproval(workItemId: string, reason: string) {
  const { error } = await db.rpc("ops_work_request_approval", {
    _work_item_id: workItemId,
    _reason: reason,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** Checker: record approve/decline. Server enforces maker-checker separation. */
export async function decideWorkApproval(
  workItemId: string,
  decision: "approved" | "declined",
  reason: string,
) {
  const { error } = await db.rpc("ops_work_decide_approval", {
    _work_item_id: workItemId,
    _decision: decision,
    _reason: reason,
  });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * Canonical write-back: applies a permitted outcome to the originating record
 * (trip, delivery, charter booking, corporate document) and queues downstream
 * propagation to the customer, provider and staff owner.
 */
export async function applyWorkOutcome(workItemId: string, outcome: string, reason: string) {
  const { data, error } = await db.rpc("ops_apply_writeback", {
    _work_item_id: workItemId,
    _outcome: outcome,
    _reason: reason,
  });
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, result: (data ?? {}) as Record<string, unknown> };
}

export interface OpsPropagationRow {
  id: string;
  work_item_id: string | null;
  audience: string;
  channel: string;
  subject: string;
  message: string;
  status: string;
  recipient_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  processed_at: string | null;
}

/** Downstream propagation raised by a work item — what the outside world was told. */
export async function fetchWorkPropagation(workItemId: string): Promise<OpsPropagationRow[]> {
  const { data, error } = await db
    .from("ops_propagation_outbox").select("*").eq("work_item_id", workItemId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpsPropagationRow[];
}

/** Notifications addressed to the signed-in user, in any portal. */
export async function fetchMyOpsNotifications(limit = 30) {
  const { data, error } = await db.from("v_ops_my_notifications").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpsPropagationRow[];
}

export async function markOpsNotificationRead(id: string) {
  await db.rpc("ops_notification_mark_read", { _id: id });
}

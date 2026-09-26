/**
 * Phase 8.5 operator SLA inbox (client).
 *
 * Read access is open to commercial staff; every state-changing action is
 * refused by the database unless the caller holds operations, finance or admin
 * authority, and each one writes an append-only audit entry. The client never
 * decides authority itself — it reads `can_act` from the server and hides
 * controls to match.
 */
import { supabase } from "@/integrations/supabase/client";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function obj(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export type InboxScope = "open" | "breached" | "resolved" | "all";
export type InboxAssignee = "any" | "me" | "unassigned";

export interface InboxItem {
  id: string;
  exception_ref: string;
  transaction_ref: string | null;
  stage: string;
  kind: string;
  severity: string;
  value_at_risk_cents: number | null;
  currency: string | null;
  priority_score: number | null;
  owner_team: string | null;
  sla_hours: number | null;
  sla_due_at: string | null;
  status: string;
  root_cause: string | null;
  recommended_action: string | null;
  escalation_level: number | null;
  assigned_to: string | null;
  assignee_email: string | null;
  assigned_at: string | null;
  acknowledged_at: string | null;
  triaged_at: string | null;
  triage_notes: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  breached: boolean;
  minutes_to_due: number | null;
}

export interface InboxStats {
  open: number;
  unassigned: number;
  mine: number;
  breached: number;
  acknowledged: number;
  resolved_7d: number;
  exposure_cents: number;
}

export interface Inbox {
  ok: boolean;
  canAct: boolean;
  items: InboxItem[];
  stats: InboxStats;
  asOf: string | null;
  error?: string;
}

const emptyStats: InboxStats = {
  open: 0, unassigned: 0, mine: 0, breached: 0, acknowledged: 0, resolved_7d: 0, exposure_cents: 0,
};

export async function loadExceptionInbox(
  scope: InboxScope = "open",
  assignee: InboxAssignee = "any",
  limit = 200,
): Promise<Inbox> {
  const { data, error } = await rpc("commercial_exception_inbox", {
    _scope: scope, _assignee: assignee, _limit: limit,
  });
  if (error) return { ok: false, canAct: false, items: [], stats: emptyStats, asOf: null, error: error.message };
  const d = obj(data);
  if (d.ok !== true) {
    return {
      ok: false, canAct: false, items: [], stats: emptyStats, asOf: null,
      error: typeof d.error === "string" ? d.error : "inbox_unavailable",
    };
  }
  const s = obj(d.stats);
  return {
    ok: true,
    canAct: d.can_act === true,
    items: arr<InboxItem>(d.items),
    stats: {
      open: num(s.open), unassigned: num(s.unassigned), mine: num(s.mine),
      breached: num(s.breached), acknowledged: num(s.acknowledged),
      resolved_7d: num(s.resolved_7d), exposure_cents: num(s.exposure_cents),
    },
    asOf: typeof d.as_of === "string" ? d.as_of : null,
  };
}

export interface AuditEntry {
  id: string;
  action: string;
  actor_email: string | null;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  sla_state: string | null;
  escalation_level: number | null;
  source: string;
  created_at: string;
}

export async function loadExceptionTimeline(
  exceptionId: string,
): Promise<{ ok: boolean; entries: AuditEntry[]; error?: string }> {
  const { data, error } = await rpc("commercial_exception_timeline", { _exception_id: exceptionId });
  if (error) return { ok: false, entries: [], error: error.message };
  const d = obj(data);
  if (d.ok !== true) return { ok: false, entries: [], error: typeof d.error === "string" ? d.error : "timeline_unavailable" };
  return { ok: true, entries: arr<AuditEntry>(d.entries) };
}

type ActionResult = { ok: boolean; error?: string; escalationLevel?: number; resolvedAfterBreach?: boolean };

async function action(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const { data, error } = await rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  const d = obj(data);
  if (d.ok !== true) return { ok: false, error: typeof d.error === "string" ? d.error : "action_refused" };
  return {
    ok: true,
    escalationLevel: d.escalation_level !== undefined ? num(d.escalation_level) : undefined,
    resolvedAfterBreach: d.resolved_after_breach === true,
  };
}

/** Assigns to a specific operator, or to the signed-in user when no id is given. */
export async function assignException(exceptionId: string, assignee?: string | null, note?: string) {
  let target = assignee ?? null;
  if (!target) {
    const { data } = await supabase.auth.getUser();
    target = data.user?.id ?? null;
  }
  if (!target) return { ok: false, error: "not_signed_in" } as ActionResult;
  return action("exception_assign", { _exception_id: exceptionId, _assignee: target, _note: note ?? null });
}

export async function acknowledgeException(exceptionId: string, note?: string) {
  return action("exception_acknowledge", { _exception_id: exceptionId, _note: note ?? null });
}

export async function triageException(input: {
  exceptionId: string;
  rootCause: string;
  recommendedAction?: string;
  severity?: string;
  note?: string;
}) {
  return action("exception_triage", {
    _exception_id: input.exceptionId,
    _root_cause: input.rootCause,
    _recommended_action: input.recommendedAction ?? null,
    _severity: input.severity ?? null,
    _note: input.note ?? null,
  });
}

export async function resolveException(input: {
  exceptionId: string;
  resolution: string;
  financialImpactCents?: number | null;
  learning?: string;
}) {
  return action("exception_resolve", {
    _exception_id: input.exceptionId,
    _resolution: input.resolution,
    _financial_impact_cents: input.financialImpactCents ?? null,
    _learning: input.learning ?? null,
  });
}

export async function escalateException(exceptionId: string, reason?: string) {
  return action("exception_escalate", { _exception_id: exceptionId, _reason: reason ?? null });
}

/** Escalates every SLA-breached, unresolved exception and audits each one. */
export async function sweepSlaBreaches(): Promise<{ ok: boolean; escalated: number; error?: string }> {
  const { data, error } = await rpc("sweep_exception_sla_breaches");
  if (error) return { ok: false, escalated: 0, error: error.message };
  const d = obj(data);
  if (d.ok !== true) return { ok: false, escalated: 0, error: typeof d.error === "string" ? d.error : "sweep_refused" };
  return { ok: true, escalated: num(d.escalated) };
}

export const ACTION_LABELS: Record<string, string> = {
  assigned: "Assigned",
  acknowledged: "Acknowledged",
  triaged: "Triaged",
  resolved: "Resolved",
  escalated: "Escalated",
  sla_breach_escalated: "SLA breach escalated",
};

export function slaLabel(item: InboxItem): string {
  if (!item.sla_due_at) return "No SLA";
  if (item.status === "resolved" || item.status === "closed") return "Closed";
  const mins = item.minutes_to_due ?? 0;
  if (mins < 0) {
    const h = Math.floor(Math.abs(mins) / 60);
    return h >= 1 ? `Breached ${h}h ago` : `Breached ${Math.abs(mins)}m ago`;
  }
  const h = Math.floor(mins / 60);
  return h >= 1 ? `Due in ${h}h` : `Due in ${mins}m`;
}

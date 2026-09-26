/**
 * Immutable audit trail for concierge-generated approval requests.
 *
 * Every draft, submission, failure and workflow status transition is appended
 * to `concierge_approval_audit` (append-only at the database level: updates and
 * deletes raise). The trail records the drafted policy/contract clauses, the
 * submitter identity, timestamps and status transitions so a compliance
 * reviewer can reconstruct exactly what the AI proposed and who approved it.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { ApprovalDraft } from "@/lib/corporate/conciergeApprovals";

export type ConciergeAuditEvent =
  | "drafted"
  | "submitted"
  | "submit_failed"
  | "status_changed";

export interface ConciergeAuditRow {
  id: string;
  request_id: string | null;
  reference: string;
  event: ConciergeAuditEvent | string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  actor_email: string | null;
  corporate_id: string | null;
  amount_kes: number | null;
  clauses: Array<{ id: string; title: string; category?: string; clause?: string }>;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RecordInput {
  event: ConciergeAuditEvent;
  reference: string;
  requestId?: string | null;
  corporateId?: string | null;
  amountKes?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  clauses?: ApprovalDraft["clauses"];
  payload?: Record<string, unknown>;
}

/** Appends one audit entry. Never throws — auditing must not break the flow. */
export async function recordConciergeApprovalAudit(input: RecordInput): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    await untypedDb.from("concierge_approval_audit").insert({
      request_id: input.requestId ?? null,
      reference: input.reference,
      event: input.event,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus ?? null,
      actor_id: auth?.user?.id ?? null,
      actor_email: auth?.user?.email ?? null,
      corporate_id: input.corporateId ?? null,
      amount_kes: input.amountKes ?? null,
      clauses: input.clauses ?? [],
      payload: input.payload ?? {},
    });
  } catch (e) {
    console.warn("concierge approval audit insert failed", e);
  }
}

/** Convenience wrapper for the full draft shape. */
export function auditFromDraft(
  event: ConciergeAuditEvent,
  draft: ApprovalDraft,
  extra: Omit<RecordInput, "event" | "reference" | "clauses"> = {},
): Promise<void> {
  return recordConciergeApprovalAudit({
    event,
    reference: draft.reference,
    clauses: draft.clauses,
    amountKes: draft.amountKes,
    payload: {
      justification: draft.justification,
      chain: draft.chain,
      passengers: draft.passengers,
      days: draft.days,
      workflow_context: draft.workflow.context,
      ...(extra.payload ?? {}),
    },
    ...extra,
  });
}

export interface AuditQuery {
  reference?: string;
  event?: string;
  limit?: number;
}

export async function loadConciergeApprovalAudit(q: AuditQuery = {}): Promise<ConciergeAuditRow[]> {
  let query = untypedDb
    .from("concierge_approval_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 200);
  if (q.reference) query = query.ilike("reference", `%${q.reference}%`);
  if (q.event) query = query.eq("event", q.event);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ConciergeAuditRow[]).map((r) => ({
    ...r,
    clauses: Array.isArray(r.clauses) ? r.clauses : [],
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));
}

/** Groups a flat trail into per-reference timelines, newest reference first. */
export function groupByReference(rows: ConciergeAuditRow[]): Array<{
  reference: string;
  latestAt: string;
  requestId: string | null;
  status: string | null;
  events: ConciergeAuditRow[];
}> {
  const map = new Map<string, ConciergeAuditRow[]>();
  for (const r of rows) {
    const list = map.get(r.reference) ?? [];
    list.push(r);
    map.set(r.reference, list);
  }
  return Array.from(map.entries())
    .map(([reference, events]) => {
      const ordered = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = ordered[ordered.length - 1];
      return {
        reference,
        latestAt: last.created_at,
        requestId: ordered.find((e) => e.request_id)?.request_id ?? null,
        status: [...ordered].reverse().find((e) => e.to_status)?.to_status ?? null,
        events: ordered.reverse(),
      };
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

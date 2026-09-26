/**
 * Single entry point for client-side `audit_logs` writes.
 *
 * The `audit_insert` RLS policy only accepts rows where
 * `actor_user_id = auth.uid()`, so every caller must stamp the signed-in user.
 * When an insert is still rejected we record a monitoring row in
 * `access_denials` (surface = `audit_logs:<flow>`) so operators can see, in
 * one place, which user flow was blocked and which actor id failed.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export interface AuditEntryInput {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  actor_role?: string | null;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
}

export interface AuditWriteResult {
  ok: boolean;
  /** Present when the write failed. */
  reason?: string;
  /** True when the failure was an RLS rejection (monitored). */
  rlsBlocked?: boolean;
}

export const AUDIT_DENIAL_SURFACE_PREFIX = "audit_logs:";

/** Records a blocked audit write so it surfaces in the observability console. */
export async function reportAuditDenial(flow: string, actorUserId: string | null, actorEmail: string | null, reason: string) {
  console.error(
    `[audit_logs] insert blocked — flow=${flow} actor_user_id=${actorUserId ?? "none"} reason=${reason}`,
  );
  await (untypedDb)
    .from("access_denials")
    .insert({
      user_id: actorUserId,
      user_email: actorEmail,
      user_roles: [],
      surface: `${AUDIT_DENIAL_SURFACE_PREFIX}${flow}`,
      reason,
      resource_type: "table",
      attempted_resource: "audit_logs",
      metadata: { flow, actor_user_id: actorUserId, table: "audit_logs" },
    })
    .then(() => undefined, () => undefined);
}

export async function writeAuditLog(flow: string, entry: AuditEntryInput): Promise<AuditWriteResult> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? null;
  const email = userRes.user?.email ?? null;

  if (!uid) {
    const reason = "no_active_session: audit_logs requires actor_user_id = auth.uid()";
    await reportAuditDenial(flow, null, null, reason);
    return { ok: false, reason, rlsBlocked: true };
  }

  const { error } = await (untypedDb)
    .from("audit_logs")
    .insert({ ...entry, actor_user_id: uid });

  if (!error) return { ok: true };

  const rlsBlocked = /row-level security/i.test(error.message);
  if (rlsBlocked) await reportAuditDenial(flow, uid, email, error.message);
  else console.error(`[audit_logs] insert failed — flow=${flow}:`, error.message);
  return { ok: false, reason: error.message, rlsBlocked };
}

export interface AuditDenialRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  surface: string;
  reason: string;
  metadata: Record<string, unknown>;
}

/** Recent blocked audit writes, newest first (admin-readable). */
export async function listAuditDenials(limit = 50): Promise<AuditDenialRow[]> {
  const { data, error } = await (untypedDb)
    .from("access_denials")
    .select("id, created_at, user_id, user_email, surface, reason, metadata")
    .like("surface", `${AUDIT_DENIAL_SURFACE_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditDenialRow[];
}

/** Flow label rendered in the monitoring table. */
export const denialFlow = (row: AuditDenialRow) =>
  row.surface.startsWith(AUDIT_DENIAL_SURFACE_PREFIX)
    ? row.surface.slice(AUDIT_DENIAL_SURFACE_PREFIX.length)
    : row.surface;

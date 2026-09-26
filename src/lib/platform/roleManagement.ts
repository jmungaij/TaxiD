/**
 * Governed admin role management.
 *
 * Writes to `user_roles` are restricted to `super_admin` at the RLS layer.
 * Rather than letting the UI fire a raw insert/delete (which produces an
 * opaque Postgres error and no forensic record), every grant/revoke goes
 * through the `admin_assign_role` / `admin_revoke_role` security-definer
 * functions. Those functions:
 *   - allow only super admins;
 *   - record the denial in `access_denials` (surface
 *     `role_management:user_roles`) with the failing `actor_user_id`, the
 *     target user and the requested role;
 *   - let the `user_roles` audit trigger stamp every successful mutation into
 *     `admin_audit_log` with actor, target and the RLS/constraint result.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const db = untypedDb;

export const ROLE_DENIAL_SURFACE = "role_management:user_roles";

export interface RoleMutationResult {
  ok: boolean;
  operation: "assign" | "revoke";
  targetUserId: string;
  role: string;
  /** Present when the mutation was rejected. */
  reason?: string;
  /** True when rejected by the super-admin guard / RLS. */
  denied?: boolean;
}

function classify(message: string) {
  return /forbidden|row-level security|permission denied|42501/i.test(message);
}

async function mutate(
  fn: "admin_assign_role" | "admin_revoke_role",
  operation: "assign" | "revoke",
  targetUserId: string,
  role: string,
): Promise<RoleMutationResult> {
  const { error } = await db.rpc(fn, { _target_user_id: targetUserId, _role: role });
  if (!error) return { ok: true, operation, targetUserId, role };
  const denied = classify(error.message);
  console.error(
    `[user_roles] ${operation} rejected — target_user_id=${targetUserId} role=${role} reason=${error.message}`,
  );
  return { ok: false, operation, targetUserId, role, reason: error.message, denied };
}

export const assignUserRole = (targetUserId: string, role: string) =>
  mutate("admin_assign_role", "assign", targetUserId, role);

export const revokeUserRole = (targetUserId: string, role: string) =>
  mutate("admin_revoke_role", "revoke", targetUserId, role);

/* ------------------------------------------------------------------ */
/* Audit + denial monitoring                                           */
/* ------------------------------------------------------------------ */

export interface RoleAuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
}

/** Successful role mutations, newest first. */
export async function listRoleAudit(limit = 50): Promise<RoleAuditRow[]> {
  const { data, error } = await db
    .from("admin_audit_log")
    .select("id, created_at, actor_id, actor_email, action, resource_id, metadata")
    .like("action", "user_roles.%")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as RoleAuditRow[];
}

export interface RoleDenialRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  user_roles: string[];
  reason: string;
  requested_role: string | null;
  metadata: Record<string, unknown>;
}

/** Denied role-management attempts, newest first — drives the alert panel. */
export async function listRoleDenials(limit = 50): Promise<RoleDenialRow[]> {
  const { data, error } = await db
    .from("access_denials")
    .select("id, created_at, user_id, user_email, user_roles, reason, requested_role, metadata")
    .eq("surface", ROLE_DENIAL_SURFACE)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as RoleDenialRow[];
}

/** Live notifications for new denied attempts. Returns an unsubscribe fn. */
export function subscribeRoleDenials(onDenial: (row: RoleDenialRow) => void): () => void {
  const channel = supabase
    .channel("role-management-denials")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "access_denials", filter: `surface=eq.${ROLE_DENIAL_SURFACE}` },
      (payload: { new: RoleDenialRow }) => onDenial(payload.new),
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

/** Human summary used in toasts and the alert feed. */
export const describeDenial = (row: RoleDenialRow) => {
  const md = row.metadata ?? {};
  const op = String(md.operation ?? "change");
  const target = String(md.target_user_id ?? "unknown");
  return `${row.user_email ?? row.user_id ?? "unknown actor"} tried to ${op} “${row.requested_role ?? md.role ?? "?"}” on ${target}`;
};

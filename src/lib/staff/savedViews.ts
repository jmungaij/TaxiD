/**
 * Saved searches and saved workflow views.
 *
 * A saved view is a named, owned configuration — never a copy of the data it
 * resolves. Sharing is role-based: an owner may keep a view private or share it
 * with specific platform roles, and `staff_saved_views` RLS is the enforcement
 * boundary (owner, or shared_roles overlapping the reader's granted roles).
 * Re-running a shared view therefore still resolves only what the *reader* is
 * authorised to see.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { STAFF_ROLES } from "@/lib/staff/access";
import { writeAuditLog } from "@/lib/platform/auditWrite";

export type SavedViewKind = "search" | "workflow";
export type SavedViewVisibility = "private" | "roles";

export interface SavedView {
  id: string;
  owner_id: string;
  kind: SavedViewKind;
  name: string;
  description: string | null;
  /** Serialised view configuration — search filters or workflow trace state. */
  config: Record<string, unknown>;
  visibility: SavedViewVisibility;
  shared_roles: string[];
  created_at: string;
  updated_at: string;
}

export interface SavedViewInput {
  kind: SavedViewKind;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  visibility: SavedViewVisibility;
  shared_roles: string[];
}

export interface SavedViewResult<T> {
  ok: boolean;
  /** Present on success. */
  data?: T;
  /** Present on failure. */
  reason?: string;
}

/** Roles a view may be shared with — the staff-portal role set only. */
export const SHAREABLE_ROLES = [...STAFF_ROLES] as const;

const table = () =>
  (untypedDb).from("staff_saved_views");

export async function listSavedViews(kind?: SavedViewKind): Promise<SavedViewResult<SavedView[]>> {
  let q = table().select("*").order("updated_at", { ascending: false }).limit(50);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message };
  return { ok: true, data: (data ?? []) as SavedView[] };
}

export async function saveView(input: SavedViewInput): Promise<SavedViewResult<SavedView>> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, reason: "A view needs a name before it can be saved." };

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return { ok: false, reason: "Your session has expired — sign in again to save this view." };

  const shared = input.visibility === "roles" ? dedupeRoles(input.shared_roles) : [];
  if (input.visibility === "roles" && shared.length === 0) {
    return { ok: false, reason: "Choose at least one role to share this view with." };
  }

  const { data, error } = await table()
    .insert({
      owner_id: uid,
      kind: input.kind,
      name,
      description: input.description?.trim().slice(0, 400) || null,
      config: input.config,
      visibility: input.visibility,
      shared_roles: shared,
    })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };

  await writeAuditLog("staff_saved_views", {
    action: "saved_view_created",
    entity_type: "staff_saved_view",
    entity_id: (data as SavedView | null)?.id ?? null,
    after_data: { kind: input.kind, name, visibility: input.visibility, shared_roles: shared },
  });

  return { ok: true, data: data as SavedView };
}

export async function updateViewSharing(
  id: string,
  visibility: SavedViewVisibility,
  shared_roles: string[],
): Promise<SavedViewResult<true>> {
  const shared = visibility === "roles" ? dedupeRoles(shared_roles) : [];
  if (visibility === "roles" && shared.length === 0) {
    return { ok: false, reason: "Choose at least one role to share this view with." };
  }
  const { error } = await table().update({ visibility, shared_roles: shared }).eq("id", id);
  if (error) return { ok: false, reason: error.message };
  await writeAuditLog("staff_saved_views", {
    action: "saved_view_sharing_changed",
    entity_type: "staff_saved_view",
    entity_id: id,
    after_data: { visibility, shared_roles: shared },
  });
  return { ok: true, data: true };
}

export async function deleteSavedView(id: string): Promise<SavedViewResult<true>> {
  const { error } = await table().delete().eq("id", id);
  if (error) return { ok: false, reason: error.message };
  await writeAuditLog("staff_saved_views", {
    action: "saved_view_deleted",
    entity_type: "staff_saved_view",
    entity_id: id,
  });
  return { ok: true, data: true };
}

function dedupeRoles(roles: string[]): string[] {
  return Array.from(new Set(roles.filter((r) => (SHAREABLE_ROLES as readonly string[]).includes(r))));
}

/** Human sharing summary for a view, from the reader's perspective. */
export function sharingLabel(view: SavedView, currentUserId?: string): string {
  const mine = view.owner_id === currentUserId;
  if (view.visibility === "private") return mine ? "Private to you" : "Private";
  const roles = view.shared_roles.join(", ") || "no roles";
  return `${mine ? "Shared by you with" : "Shared with"} ${roles}`;
}

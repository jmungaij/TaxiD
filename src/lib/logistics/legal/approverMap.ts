/**
 * LG APPROVER & INSURER ROLE MAPPING.
 *
 * `lg_approver_role_map` is the administered authority for who may record which
 * kind of LG determination decision, and for which controls. It is enforced in
 * the database (`lg_can_approve` inside `lg_dossier_approve`) — this module is
 * the admin transport plus the *same* pure rule, so the console can only offer
 * an approver role that the mapping actually permits.
 *
 * Fail-closed: with no mapping row for a control, nobody may approve it.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { LG_DOSSIER } from "./dossier";
import { type LgApproverKind, LG_INSURER_CONTROLS } from "./dossierControl";

export const LG_APPROVER_KINDS: LgApproverKind[] = ["legal_reviewer", "insurer", "owner"];

export const LG_APPROVER_KIND_LABEL: Record<LgApproverKind, string> = {
  legal_reviewer: "Legal reviewer",
  insurer: "Insurer",
  owner: "Owner",
};

/** Platform roles that may be mapped to an LG approver kind. */
export const LG_MAPPABLE_ROLES = [
  "super_admin",
  "admin",
  "compliance_admin",
  "operations_admin",
  "finance_admin",
  "director",
  "general_manager",
] as const;

export type LgMappableRole = (typeof LG_MAPPABLE_ROLES)[number];

export interface LgApproverMapRow {
  id: string;
  approver_kind: LgApproverKind;
  role: string;
  /** null = every LG control. */
  control_id: string | null;
  allowed: boolean;
  notify: boolean;
  notes: string | null;
  updated_at: string | null;
}

export const LG_CONTROL_IDS = LG_DOSSIER.map((d) => d.control_id);

/* ---------------------------------- rules ---------------------------------- */

/**
 * Pure mirror of `public.lg_can_approve`. True when any of the actor's roles is
 * mapped to this approver kind for this control (or for all controls).
 */
export function canApproveLg(args: {
  rows: LgApproverMapRow[];
  roles: readonly string[];
  approverKind: LgApproverKind;
  controlId: string;
}): boolean {
  return args.rows.some(
    (r) =>
      r.allowed &&
      r.approver_kind === args.approverKind &&
      args.roles.includes(r.role) &&
      (r.control_id === null || r.control_id === args.controlId),
  );
}

/**
 * The approver kinds this actor may record on a control, intersected with the
 * kinds the control actually requires (insurer only where insurance evidence is
 * part of the determination).
 */
export function allowedApproverKinds(args: {
  rows: LgApproverMapRow[];
  roles: readonly string[];
  controlId: string;
  requiresInsurer?: boolean;
}): LgApproverKind[] {
  const insurerApplies =
    args.requiresInsurer ?? (LG_INSURER_CONTROLS as readonly string[]).includes(args.controlId);
  return LG_APPROVER_KINDS.filter((kind) => {
    if (kind === "insurer" && !insurerApplies) return false;
    return canApproveLg({ ...args, approverKind: kind });
  });
}

/** Controls a given role may act on for a kind — for the admin matrix summary. */
export function mappedControlScope(rows: LgApproverMapRow[], approverKind: LgApproverKind, role: string): string {
  const scoped = rows.filter((r) => r.allowed && r.approver_kind === approverKind && r.role === role);
  if (!scoped.length) return "—";
  if (scoped.some((r) => r.control_id === null)) return "All LG controls";
  return scoped
    .map((r) => r.control_id as string)
    .sort()
    .join(", ");
}

/** Controls with no mapped approver for a required kind — a live governance gap. */
export function unmappedControls(rows: LgApproverMapRow[]): { control_id: string; missing: LgApproverKind[] }[] {
  return LG_CONTROL_IDS.map((controlId) => {
    const required: LgApproverKind[] = (LG_INSURER_CONTROLS as readonly string[]).includes(controlId)
      ? ["legal_reviewer", "insurer", "owner"]
      : ["legal_reviewer", "owner"];
    const missing = required.filter(
      (kind) =>
        !rows.some(
          (r) => r.allowed && r.approver_kind === kind && (r.control_id === null || r.control_id === controlId),
        ),
    );
    return { control_id: controlId, missing };
  }).filter((x) => x.missing.length > 0);
}

/* -------------------------------- transport -------------------------------- */

const db = () => untypedDb;

export async function fetchLgApproverMap(): Promise<LgApproverMapRow[]> {
  const { data, error } = await db()
    .from("lg_approver_role_map")
    .select("id,approver_kind,role,control_id,allowed,notify,notes,updated_at")
    .order("approver_kind")
    .order("role");
  if (error) throw new Error(error.message);
  return (data ?? []) as LgApproverMapRow[];
}

export interface LgApproverMapInput {
  approver_kind: LgApproverKind;
  role: string;
  control_id: string | null;
  allowed: boolean;
  notify: boolean;
  notes?: string | null;
}

export function validateLgApproverMapInput(input: LgApproverMapInput): string[] {
  const errs: string[] = [];
  if (!LG_APPROVER_KINDS.includes(input.approver_kind)) errs.push("Choose a valid approver kind.");
  if (!input.role.trim()) errs.push("Choose the platform role that holds this authority.");
  if (input.control_id && !LG_CONTROL_IDS.includes(input.control_id)) {
    errs.push(`${input.control_id} is not an LG control.`);
  }
  if (
    input.approver_kind === "insurer" &&
    input.control_id &&
    !(LG_INSURER_CONTROLS as readonly string[]).includes(input.control_id)
  ) {
    errs.push(`Insurer approval does not apply to ${input.control_id}.`);
  }
  return errs;
}

export async function upsertLgApproverMap(input: LgApproverMapInput): Promise<void> {
  const errs = validateLgApproverMapInput(input);
  if (errs.length) throw new Error(errs.join(" "));
  const row = {
    approver_kind: input.approver_kind,
    role: input.role,
    control_id: input.control_id,
    allowed: input.allowed,
    notify: input.notify,
    notes: input.notes ?? null,
  };
  // The uniqueness rule treats a NULL control_id as "all controls", so the
  // existing grant is matched explicitly rather than through ON CONFLICT.
  let existing = db()
    .from("lg_approver_role_map")
    .select("id")
    .eq("approver_kind", input.approver_kind)
    .eq("role", input.role);
  existing = input.control_id === null ? existing.is("control_id", null) : existing.eq("control_id", input.control_id);
  const found = await existing.maybeSingle();
  if (found.error) throw new Error(found.error.message);

  const { error } = found.data?.id
    ? await db().from("lg_approver_role_map").update(row).eq("id", found.data.id)
    : await db().from("lg_approver_role_map").insert(row);
  if (error) throw new Error(error.message);
}


export async function setLgApproverMapFlags(
  id: string,
  patch: { allowed?: boolean; notify?: boolean },
): Promise<void> {
  const { error } = await db().from("lg_approver_role_map").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteLgApproverMap(id: string): Promise<void> {
  const { error } = await db().from("lg_approver_role_map").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

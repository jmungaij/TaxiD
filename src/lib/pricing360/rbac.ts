/**
 * Pricing 360 RBAC model.
 *
 * The authority is always the database: RLS policies on `pricing_rule_sets`,
 * `commercial_rate_cards`, `asset_pricing_versions`, `pricing_audit_events` and
 * the `pricing360_*` RPCs decide what actually happens. This module mirrors that
 * enforced policy so the admin UI can *state* it, and so client surfaces can be
 * disabled before a request that the server would refuse anyway.
 *
 * `ENFORCED_MATRIX` below is the declared mirror of the server policy. Overrides
 * stored in `pricing360_role_grants` can only narrow or widen the *client* view;
 * they are labelled as such in the UI and can never grant server access.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type PricingPermission =
  | "view"
  | "view_audit"
  | "simulate"
  | "edit_rates"
  | "edit_rules"
  | "edit_bands"
  | "approve"
  | "publish"
  | "export";

export interface PricingPermissionDefinition {
  key: PricingPermission;
  label: string;
  /** Where the server enforces it. Shown in the matrix so the claim is checkable. */
  enforcedBy: string;
}

export const PRICING_PERMISSIONS: ReadonlyArray<PricingPermissionDefinition> = [
  { key: "view", label: "View Pricing 360", enforcedBy: "RequireRole on /dashboard/admin/pricing-360" },
  { key: "view_audit", label: "Read pricing audit trail", enforcedBy: "RLS: pricing_audit_events → is_platform_admin()" },
  { key: "simulate", label: "Run price simulations", enforcedBy: "RPC pricing360_calculate" },
  { key: "edit_rates", label: "Edit rate cards & rate lines", enforcedBy: "RLS: commercial_rate_cards / commercial_rate_lines" },
  { key: "edit_rules", label: "Edit commercial rules, taxes & discounts", enforcedBy: "RLS: pricing_components" },
  { key: "edit_bands", label: "Edit asset pricing bands", enforcedBy: "RPC asset_pricing_save_band" },
  { key: "approve", label: "Approve a pricing version", enforcedBy: "RPC asset_pricing_set_status (approved)" },
  { key: "publish", label: "Publish a pricing version", enforcedBy: "RPC pricing360_publish_rule_set / asset_pricing_set_status" },
  { key: "export", label: "Export pricing datasets", enforcedBy: "export_audit_log + RLS on source tables" },
];

/** Roles that can reach any Pricing 360 surface. */
export const PRICING_ROLES = [
  "super_admin",
  "admin",
  "finance_admin",
  "pricing_manager",
  "operations_admin",
  "compliance_admin",
] as const;

export type PricingRole = (typeof PRICING_ROLES)[number];

export const PRICING_ROLE_LABELS: Record<PricingRole, string> = {
  super_admin: "Super admin",
  admin: "Platform admin",
  finance_admin: "Finance admin",
  pricing_manager: "Pricing manager",
  operations_admin: "Operations admin",
  compliance_admin: "Compliance admin",
};

type Matrix = Record<PricingRole, PricingPermission[]>;

/**
 * The enforced server policy, mirrored. Separation of duties: a pricing manager
 * drafts and approves is NOT the same actor — publishing is reserved for
 * super_admin / finance_admin, which is what the RPCs enforce.
 */
export const ENFORCED_MATRIX: Matrix = {
  super_admin: ["view", "view_audit", "simulate", "edit_rates", "edit_rules", "edit_bands", "approve", "publish", "export"],
  admin: ["view", "view_audit", "simulate", "edit_rates", "edit_rules", "edit_bands", "approve", "export"],
  finance_admin: ["view", "view_audit", "simulate", "edit_rates", "edit_rules", "edit_bands", "approve", "publish", "export"],
  pricing_manager: ["view", "simulate", "edit_rates", "edit_rules", "edit_bands", "export"],
  operations_admin: ["view", "simulate"],
  compliance_admin: ["view", "view_audit", "export"],
};

export interface PricingGrantRow {
  id: string;
  role: string;
  permission: string;
  allowed: boolean;
  reason: string;
  updated_by: string | null;
  updated_at: string;
}

export interface MatrixCell {
  role: PricingRole;
  permission: PricingPermission;
  /** What the mirrored server policy says. */
  enforced: boolean;
  /** Admin override, when one has been recorded. */
  override: boolean | null;
  /** Effective client-side answer. */
  effective: boolean;
  reason: string;
}

/** Folds recorded overrides over the enforced policy. */
export function buildMatrix(grants: PricingGrantRow[] | null | undefined): MatrixCell[] {
  const byKey = new Map<string, PricingGrantRow>();
  for (const g of grants ?? []) byKey.set(`${g.role}:${g.permission}`, g);

  const cells: MatrixCell[] = [];
  for (const role of PRICING_ROLES) {
    for (const perm of PRICING_PERMISSIONS) {
      const enforced = ENFORCED_MATRIX[role].includes(perm.key);
      const g = byKey.get(`${role}:${perm.key}`);
      const override = g ? g.allowed : null;
      cells.push({
        role,
        permission: perm.key,
        enforced,
        override,
        effective: override ?? enforced,
        reason: g?.reason ?? "",
      });
    }
  }
  return cells;
}

/** Cells where an override contradicts the enforced server policy. */
export function matrixDrift(cells: MatrixCell[]): MatrixCell[] {
  return cells.filter((c) => c.override !== null && c.override !== c.enforced);
}

/** Client-side capability check for a set of roles held by the signed-in user. */
export function pricingCan(
  roles: string[],
  permission: PricingPermission,
  cells?: MatrixCell[],
): boolean {
  const applicable = (PRICING_ROLES as readonly string[]).filter((r) => roles.includes(r)) as PricingRole[];
  if (applicable.length === 0) return false;
  if (!cells) return applicable.some((r) => ENFORCED_MATRIX[r].includes(permission));
  return applicable.some((r) =>
    cells.some((c) => c.role === r && c.permission === permission && c.effective),
  );
}

export async function fetchPricingGrants(): Promise<PricingGrantRow[]> {
  const { data, error } = await (untypedDb)
    .from("pricing360_role_grants")
    .select("id,role,permission,allowed,reason,updated_by,updated_at")
    .order("role", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PricingGrantRow[];
}

/** Admin-only (RLS). Records an explicit grant/denial for a role + permission. */
export async function setPricingGrant(
  role: PricingRole,
  permission: PricingPermission,
  allowed: boolean,
  reason: string,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await (untypedDb)
    .from("pricing360_role_grants")
    .upsert(
      { role, permission, allowed, reason, updated_by: auth?.user?.id ?? null },
      { onConflict: "role,permission" },
    );
  if (error) throw new Error(error.message);
}

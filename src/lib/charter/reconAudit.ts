/**
 * Immutable reconciliation action audit.
 *
 * Every finance action on the reconciliation surface — export, rerun (real or
 * dry-run), reversal confirmation, acknowledge/resolve and alert handling — is
 * appended to `public.recon_action_audit`. The table has an append-only trigger
 * so entries can never be edited or deleted, and RLS only accepts rows whose
 * `actor_id` is the signed-in user.
 *
 * Audit failures never block the underlying finance action: the operator still
 * gets their export or run, and the failure is logged for the NOC.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { ReportTable } from "@/lib/corporate/executiveExports";
import type { ReconPermission } from "@/lib/charter/reconPermissions";

export const RECON_AUDIT_ACTIONS = [
  "export",
  "rerun",
  "rerun_dry_run",
  "reversal_confirm",
  "acknowledge",
  "resolve",
  "alert_retry",
  "alert_acknowledge",
] as const;

export type ReconAuditAction = (typeof RECON_AUDIT_ACTIONS)[number];

export interface ReconAuditInput {
  action: ReconAuditAction;
  permission?: ReconPermission;
  targetType?: string;
  targetId?: string | null;
  dataset?: string;
  rowCount?: number;
  exportFormat?: "csv" | "pdf";
  filters?: Record<string, unknown>;
  resolutionNotes?: string | null;
  detail?: Record<string, unknown>;
  outcome?: "success" | "failed" | "denied";
}

export interface ReconAuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  permission: string | null;
  target_type: string | null;
  target_id: string | null;
  dataset: string | null;
  row_count: number | null;
  export_format: string | null;
  filters: Record<string, unknown> | null;
  resolution_notes: string | null;
  detail: Record<string, unknown> | null;
  outcome: string;
}

/** Appends one audit entry. Never throws. */
export async function recordReconAction(input: ReconAuditInput): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return;
    const { error } = await (untypedDb)
      .from("recon_action_audit")
      .insert({
        actor_id: user.id,
        actor_email: user.email ?? null,
        action: input.action,
        permission: input.permission ?? null,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        dataset: input.dataset ?? null,
        row_count: input.rowCount ?? null,
        export_format: input.exportFormat ?? null,
        filters: input.filters ?? {},
        resolution_notes: input.resolutionNotes ?? null,
        detail: input.detail ?? {},
        outcome: input.outcome ?? "success",
      });
    if (error) console.warn("[reconAudit] insert rejected", error.message);
  } catch (err) {
    console.warn("[reconAudit] failed to record", err);
  }
}

/** Newest-first audit trail (readable by any role in the recon matrix). */
export async function listReconAudit(limit = 200): Promise<ReconAuditRow[]> {
  const { data, error } = await (untypedDb)
    .from("recon_action_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[reconAudit] read failed", error.message);
    return [];
  }
  return (data ?? []) as ReconAuditRow[];
}

const stamp = (s: string | null | undefined) => (s ? new Date(s).toISOString() : "");
const flat = (o: Record<string, unknown> | null | undefined) =>
  Object.entries(o ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("; ");

/** Export of the immutable action trail. */
export function reconAuditReport(rows: ReconAuditRow[]): ReportTable {
  return {
    id: "wallet-reconciliation-action-audit",
    title: "TaxiD · reconciliation action audit",
    subtitle: "Append-only record of exports, reruns, reversals and resolutions",
    meta: [
      ["Entries", String(rows.length)],
      ["Denied attempts", String(rows.filter((r) => r.outcome === "denied").length)],
      ["Generated", new Date().toISOString()],
    ],
    columns: [
      "When", "Actor", "Action", "Permission", "Outcome", "Dataset", "Format",
      "Rows", "Target type", "Target", "Filters", "Resolution notes", "Detail",
    ],
    rows: rows.map((r) => [
      stamp(r.created_at),
      r.actor_email ?? r.actor_id ?? "",
      r.action,
      r.permission ?? "",
      r.outcome,
      r.dataset ?? "",
      r.export_format ?? "",
      r.row_count ?? "",
      r.target_type ?? "",
      r.target_id ?? "",
      flat(r.filters),
      r.resolution_notes ?? "",
      flat(r.detail),
    ]),
  };
}

/**
 * Governed navigation registry lifecycle client.
 *
 * draft → validate → review → approve → publish, with audit history and
 * one-click rollback. Every transition is a SECURITY DEFINER RPC: the client
 * cannot skip a gate, cannot approve its own draft, and cannot publish an
 * unvalidated snapshot even if the UI is tampered with.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  buildNavRegistrySnapshot,
  hashSnapshot,
  validateNavRegistrySnapshot,
  type NavRegistrySnapshot,
  type NavValidationReport,
} from "./registrySnapshot";

export type NavVersionStatus =
  | "draft"
  | "validated"
  | "in_review"
  | "approved"
  | "published"
  | "superseded"
  | "rejected";

export interface NavRegistryVersion {
  id: string;
  version: number;
  status: NavVersionStatus;
  title: string;
  notes: string | null;
  snapshot: NavRegistrySnapshot;
  snapshot_hash: string;
  validation: NavValidationReport | null;
  validation_passed: boolean | null;
  is_active: boolean;
  rolled_back_from: string | null;
  created_by: string;
  created_at: string;
  validated_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  published_at: string | null;
  published_by: string | null;
}

export interface NavRegistryAuditEntry {
  id: string;
  version_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/** Stages rendered by the governance UI, in lifecycle order. */
export const NAV_LIFECYCLE: { status: NavVersionStatus; label: string; description: string }[] = [
  { status: "draft", label: "Draft", description: "Snapshot captured from the live registry" },
  { status: "validated", label: "Validated", description: "All navigation integrity gates pass" },
  { status: "in_review", label: "In review", description: "Awaiting a second pair of eyes" },
  { status: "approved", label: "Approved", description: "Signed off by a super admin (not the author)" },
  { status: "published", label: "Published", description: "Active canonical navigation contract" },
];

export function captureSnapshot(): { snapshot: NavRegistrySnapshot; hash: string; report: NavValidationReport } {
  const snapshot = buildNavRegistrySnapshot();
  return {
    snapshot,
    hash: hashSnapshot(snapshot),
    report: validateNavRegistrySnapshot(snapshot),
  };
}

export async function listVersions(): Promise<NavRegistryVersion[]> {
  const { data, error } = await supabase
    .from("nav_registry_versions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as NavRegistryVersion[];
}

export async function listAudit(versionId: string): Promise<NavRegistryAuditEntry[]> {
  const { data, error } = await supabase
    .from("nav_registry_audit")
    .select("*")
    .eq("version_id", versionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as NavRegistryAuditEntry[];
}

export async function createDraft(title: string, notes?: string): Promise<string> {
  const { snapshot, hash } = captureSnapshot();
  const { data, error } = await supabase.rpc("nav_registry_create_draft", {
    _title: title,
    _snapshot: snapshot as unknown as never,
    _snapshot_hash: hash,
    _notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Re-runs the gates against the snapshot STORED on the version (not against
 * whatever the browser currently renders), then records the verdict.
 */
export async function validateVersion(version: NavRegistryVersion): Promise<NavValidationReport> {
  const report = validateNavRegistrySnapshot(version.snapshot);
  const { error } = await supabase.rpc("nav_registry_record_validation", {
    _version_id: version.id,
    _report: report as unknown as never,
  });
  if (error) throw error;
  return report;
}

export async function submitForReview(versionId: string): Promise<void> {
  const { error } = await supabase.rpc("nav_registry_submit_for_review", { _version_id: versionId });
  if (error) throw error;
}

export async function decideVersion(versionId: string, approve: boolean, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc("nav_registry_decide", {
    _version_id: versionId,
    _approve: approve,
    _reason: reason ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function publishVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc("nav_registry_publish", { _version_id: versionId });
  if (error) throw error;
}

export async function rollbackTo(versionId: string, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc("nav_registry_rollback", {
    _to_version_id: versionId,
    _reason: reason ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Human-readable reason a transition is unavailable, or null when allowed. */
export function blockedReason(
  action: "validate" | "review" | "approve" | "publish" | "rollback",
  version: NavRegistryVersion,
  ctx: { userId?: string; canApprove: boolean },
): string | null {
  switch (action) {
    case "validate":
      return ["draft", "validated", "in_review"].includes(version.status)
        ? null
        : `A ${version.status} version cannot be re-validated`;
    case "review":
      if (version.status !== "validated") return "Only a validated version can enter review";
      return version.validation_passed ? null : "Integrity gates must pass before review";
    case "approve":
      if (!ctx.canApprove) return "Approval requires super admin";
      if (version.status !== "in_review") return "Only an in-review version can be decided";
      if (ctx.userId && version.created_by === ctx.userId)
        return "Separation of duties: you authored this version";
      return null;
    case "publish":
      if (!ctx.canApprove) return "Publishing requires super admin";
      return version.status === "approved" ? null : "Only an approved version can be published";
    case "rollback":
      if (!ctx.canApprove) return "Rollback requires super admin";
      if (!version.published_at) return "Only a previously published version can be restored";
      return version.is_active ? "This version is already active" : null;
  }
}

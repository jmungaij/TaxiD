/**
 * LG DOSSIER CONTROL LAYER — seeding, approval workflow, audit trail, gate.
 *
 * This module is the client transport + pure projection over the authoritative
 * database objects (`lg_dossier_documents`, `lg_dossier_approvals`,
 * `lg_dossier_audit`, `v_lg_dossier_gate`, `lg_dossier_publish_version`,
 * `lg_dossier_approve`). It never decides readiness and never marks anything
 * PASS: a control becomes legally EFFECTIVE only when the required authorised
 * approvals exist against the exact document version, with a real effective
 * date, and the database says so.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { LG_DOSSIER, LG_DRAFT_WATERMARK, renderLgDraft, type LgDossierEntry } from "./dossier";

/** Controls whose determination cannot become effective without insurer evidence. */
export const LG_INSURER_CONTROLS = ["LG-05", "LG-06"] as const;

export type LgApproverKind = "legal_reviewer" | "insurer" | "owner";
export type LgDecision = "approved" | "approved_with_conditions" | "rejected";
export type LgGateState = "EFFECTIVE" | "PENDING_EFFECTIVE" | "BLOCKED";

/** Operational stages an unapproved determination holds closed. */
export const LG_BLOCKING_STAGES = ["booking", "dispatch"] as const;

export interface LgGateRow {
  control_id: string;
  document_version_id: string;
  document_id: string;
  version: number;
  title: string;
  folder_path: string;
  file_name: string;
  draft_state: string;
  blocking_stages: string[];
  requires_insurer_approval: boolean;
  decision_count: number;
  legal_reviewer_approved: boolean;
  insurer_approved: boolean;
  owner_approved: boolean;
  rejected: boolean;
  effective_from: string | null;
  effective_until: string | null;
  gate_state: LgGateState;
  reason_code: string;
}

export interface LgApprovalRow {
  id: string;
  control_id: string;
  document_version_id: string;
  document_version: number;
  content_hash: string;
  approver_kind: LgApproverKind;
  decision: LgDecision;
  conditions: string | null;
  evidence_ref: string | null;
  issuing_authority: string | null;
  effective_from: string | null;
  effective_until: string | null;
  comments: string;
  decided_by_email: string | null;
  decided_at: string;
}

export interface LgAuditRow {
  id: string;
  control_id: string;
  document_version: number | null;
  content_hash: string | null;
  action: "SEEDED" | "VERSION_PUBLISHED" | "SUPERSEDED" | "APPROVAL_RECORDED";
  approver_kind: LgApproverKind | null;
  decision: LgDecision | null;
  actor_email: string | null;
  prior_version: number | null;
  prior_content_hash: string | null;
  changes: Record<string, unknown>;
  detail: string | null;
  created_at: string;
}

/* --------------------------------- pure rules -------------------------------- */

export const lgRequiresInsurer = (controlId: string): boolean =>
  (LG_INSURER_CONTROLS as readonly string[]).includes(controlId);

/** Approver roles that must all record a non-rejecting decision on a version. */
export function lgRequiredApprovers(controlId: string): LgApproverKind[] {
  return lgRequiresInsurer(controlId)
    ? ["legal_reviewer", "insurer", "owner"]
    : ["legal_reviewer", "owner"];
}

/** Watermarked Documents 360 filename — the watermark is part of the file identity. */
export function lgDraftFileName(entry: LgDossierEntry, version = 1): string {
  const mark = LG_DRAFT_WATERMARK.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
  return `${entry.document_id}-v${version}-${mark}.md`;
}

/**
 * Mirror of the SQL gate. Kept pure so the UI, the tests and the edge gate all
 * agree on when a determination is operationally effective.
 */
export function lgGateStateFor(args: {
  controlId: string;
  rejected: boolean;
  legalApproved: boolean;
  insurerApproved: boolean;
  ownerApproved: boolean;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  now?: Date;
}): { state: LgGateState; reasonCode: string } {
  const now = args.now ?? new Date();
  if (args.rejected) return { state: "BLOCKED", reasonCode: "LG_DETERMINATION_REJECTED" };
  if (!args.legalApproved) return { state: "BLOCKED", reasonCode: "LG_LEGAL_REVIEW_REQUIRED" };
  if (lgRequiresInsurer(args.controlId) && !args.insurerApproved) {
    return { state: "BLOCKED", reasonCode: "LG_INSURER_EVIDENCE_REQUIRED" };
  }
  if (!args.ownerApproved) return { state: "BLOCKED", reasonCode: "LG_OWNER_APPROVAL_REQUIRED" };
  if (!args.effectiveFrom || new Date(args.effectiveFrom) > now) {
    return { state: "PENDING_EFFECTIVE", reasonCode: "LG_NOT_YET_EFFECTIVE" };
  }
  if (args.effectiveUntil && new Date(args.effectiveUntil) <= now) {
    return { state: "BLOCKED", reasonCode: "LG_APPROVAL_EXPIRED" };
  }
  return { state: "EFFECTIVE", reasonCode: "LG_EFFECTIVE" };
}

export interface LgSpineGate {
  stage: (typeof LG_BLOCKING_STAGES)[number];
  /** True only when every dossier control that blocks this stage is effective. */
  open: boolean;
  blocking: { control_id: string; reason_code: string; title: string }[];
  /** Controls with no seeded dossier version at all — the strictest failure. */
  unseeded: string[];
}

/**
 * Operational-spine projection: booking / dispatch stay closed while any LG
 * control is unseeded, awaiting evidence or awaiting legal review.
 */
export function lgSpineGate(
  stage: (typeof LG_BLOCKING_STAGES)[number],
  rows: LgGateRow[],
  now = new Date(),
): LgSpineGate {
  const seeded = new Set(rows.map((r) => r.control_id));
  const unseeded = LG_DOSSIER.map((d) => d.control_id).filter((c) => !seeded.has(c));
  const blocking = rows
    .filter((r) => (r.blocking_stages ?? []).includes(stage))
    .map((r) => ({
      row: r,
      resolved: lgGateStateFor({
        controlId: r.control_id,
        rejected: r.rejected,
        legalApproved: r.legal_reviewer_approved,
        insurerApproved: r.insurer_approved,
        ownerApproved: r.owner_approved,
        effectiveFrom: r.effective_from,
        effectiveUntil: r.effective_until,
        now,
      }),
    }))
    .filter((x) => x.resolved.state !== "EFFECTIVE")
    .map((x) => ({ control_id: x.row.control_id, reason_code: x.resolved.reasonCode, title: x.row.title }));

  return {
    stage,
    open: blocking.length === 0 && unseeded.length === 0,
    blocking,
    unseeded,
  };
}

/** Human-readable diff of what a new dossier version changed. */
export function lgChangeSummary(row: LgAuditRow): string[] {
  const out: string[] = [];
  for (const [field, value] of Object.entries(row.changes ?? {})) {
    if (field === "body" && value && typeof value === "object") {
      const v = value as { from_hash?: string; to_hash?: string };
      out.push(`body ${String(v.from_hash).slice(0, 12)} → ${String(v.to_hash).slice(0, 12)}`);
      continue;
    }
    if (value && typeof value === "object" && "from" in (value as object)) {
      const v = value as { from?: unknown; to?: unknown };
      out.push(`${field}: ${String(v.from).slice(0, 60)} → ${String(v.to).slice(0, 60)}`);
      continue;
    }
    out.push(`${field}: ${String(value).slice(0, 60)}`);
  }
  return out;
}

/* --------------------------------- transport --------------------------------- */

const db = () => untypedDb;

export async function fetchLgGate(): Promise<LgGateRow[]> {
  const { data, error } = await db().from("v_lg_dossier_gate").select("*").order("control_id");
  if (error) throw new Error(error.message);
  return (data ?? []) as LgGateRow[];
}

export async function fetchLgApprovals(): Promise<LgApprovalRow[]> {
  const { data, error } = await db()
    .from("lg_dossier_approvals")
    .select("*")
    .order("decided_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LgApprovalRow[];
}

export async function fetchLgAudit(limit = 200): Promise<LgAuditRow[]> {
  const { data, error } = await db()
    .from("lg_dossier_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LgAuditRow[];
}

/** A stakeholder notification raised by a seed / supersession / decision. */
export interface LgNotificationRow {
  id: string;
  control_id: string;
  document_id: string | null;
  document_version: number | null;
  event: "SEEDED" | "VERSION_PUBLISHED" | "SUPERSEDED" | "APPROVAL_RECORDED" | "BECAME_EFFECTIVE";
  channel: "email" | "in_app";
  recipient_role: string | null;
  recipient_email: string | null;
  subject: string;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function fetchLgNotifications(limit = 100): Promise<LgNotificationRow[]> {
  const { data, error } = await db()
    .from("lg_dossier_notifications")
    .select(
      "id,control_id,document_id,document_version,event,channel,recipient_role,recipient_email,subject,status,attempts,last_error,created_at,sent_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as LgNotificationRow[];
}

/** Runs the email leg of the notification outbox (in-app rows are immediate). */
export async function dispatchLgNotifications(): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data, error } = await supabase.functions.invoke("lg-dossier-notify", { body: {} });
  if (error) throw new Error((error as Error).message);
  const res = (data ?? {}) as { sent?: number; failed?: number; skipped?: number };
  return { sent: res.sent ?? 0, failed: res.failed ?? 0, skipped: res.skipped ?? 0 };
}


/**
 * Files every dossier document into Documents 360 as a DRAFT version. Content
 * is rendered from the specification library, so re-running is idempotent: an
 * identical body returns the existing version instead of creating a new one.
 */
export async function seedLgDossier(entries: LgDossierEntry[] = LG_DOSSIER): Promise<{ seeded: number; failed: { control_id: string; error: string }[] }> {
  let seeded = 0;
  const failed: { control_id: string; error: string }[] = [];
  for (const entry of entries) {
    const { error } = await db().rpc("lg_dossier_publish_version", {
      p_control_id: entry.control_id,
      p_document_id: entry.document_id,
      p_title: entry.title,
      p_folder_path: entry.folder,
      p_file_name: lgDraftFileName(entry),
      p_evidence_type: entry.evidence_type,
      p_provenance: entry.provenance,
      p_issuing_authority: entry.issuing_authority,
      p_draft_state: entry.draft_state,
      p_declaration: entry.declaration,
      p_sections: entry.sections,
      p_authoritative_fields: entry.authoritative_fields,
      p_regulatory_references: entry.regulatory_references,
      p_operational_linkage: entry.operational_linkage,
      p_blocking_stages: [...LG_BLOCKING_STAGES],
      p_requires_insurer_approval: lgRequiresInsurer(entry.control_id),
      p_body_markdown: renderLgDraft(entry),
    });
    if (error) failed.push({ control_id: entry.control_id, error: error.message });
    else seeded += 1;
  }
  return { seeded, failed };
}

export interface LgApprovalInput {
  documentVersionId: string;
  approverKind: LgApproverKind;
  decision: LgDecision;
  comments: string;
  conditions?: string;
  evidenceRef?: string;
  issuingAuthority?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
}

/** Client-side mirror of the server rules — the database enforces them too. */
export function validateLgApproval(input: LgApprovalInput): string[] {
  const errs: string[] = [];
  if (input.comments.trim().length < 40) {
    errs.push("Describe the actual evidentiary basis of the decision (at least 40 characters).");
  }
  if (input.decision !== "rejected" && !input.effectiveFrom) {
    errs.push("An approval must carry the effective date shown on the authoritative evidence.");
  }
  if (input.decision === "approved_with_conditions" && !input.conditions?.trim()) {
    errs.push("A conditional approval must state its conditions.");
  }
  if (input.effectiveFrom && input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom) {
    errs.push("Expiry cannot precede the effective date.");
  }
  return errs;
}

export async function recordLgApproval(input: LgApprovalInput): Promise<void> {
  const errs = validateLgApproval(input);
  if (errs.length) throw new Error(errs.join(" "));
  const { error } = await db().rpc("lg_dossier_approve", {
    p_document_version_id: input.documentVersionId,
    p_approver_kind: input.approverKind,
    p_decision: input.decision,
    p_comments: input.comments,
    p_conditions: input.conditions ?? null,
    p_evidence_ref: input.evidenceRef ?? null,
    p_issuing_authority: input.issuingAuthority ?? null,
    p_effective_from: input.effectiveFrom ? new Date(input.effectiveFrom).toISOString() : null,
    p_effective_until: input.effectiveUntil ? new Date(input.effectiveUntil).toISOString() : null,
  });
  if (error) throw new Error(error.message);
}

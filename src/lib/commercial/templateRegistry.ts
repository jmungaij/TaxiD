/**
 * Document template registry — client contract for the governed template store.
 *
 * The database owns every rule: version status transitions, four-eyes approval,
 * one published version per template, and the append-only history. This module
 * only reads the registry and relays actions.
 */
import { supabase } from "@/integrations/supabase/client";

export type TemplateKind =
  | "CONTRACT" | "RATE_CARD" | "INVOICE" | "QUOTATION" | "SERVICE_ORDER" | "SCHEDULE" | "OTHER";

export type TemplateVersionStatus =
  | "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "REJECTED" | "RETIRED";

export type TemplateAction = "SUBMIT" | "APPROVE" | "REJECT" | "PUBLISH" | "RETIRE";

export const KIND_LABEL: Record<TemplateKind, string> = {
  CONTRACT: "Contract",
  RATE_CARD: "Rate card",
  INVOICE: "Invoice",
  QUOTATION: "Quotation",
  SERVICE_ORDER: "Service order",
  SCHEDULE: "Schedule",
  OTHER: "Other",
};

export const STATUS_LABEL: Record<TemplateVersionStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  REJECTED: "Sent back",
  RETIRED: "Retired",
};

export const STATUS_TONE: Record<TemplateVersionStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  APPROVED: "warning",
  PUBLISHED: "success",
  REJECTED: "danger",
  RETIRED: "neutral",
};

export interface TemplateClause {
  no?: string;
  heading?: string;
  text?: string;
  table?: { caption?: string; columns?: string[]; rows?: string[][] };
}

export interface TemplateSection {
  article?: number;
  title?: string;
  clauses?: TemplateClause[];
}

export interface TemplateVariable {
  key: string;
  label: string;
  required?: boolean;
}

export interface TemplateApproval {
  decision: "APPROVED" | "REJECTED";
  sole_approver: boolean;
  note: string | null;
  created_at: string;
  decided_by_name: string | null;
}

export interface TemplateEvent {
  event: string;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface TemplateVersion {
  id: string;
  version: string;
  status: TemplateVersionStatus;
  source_status: "SOURCE_VERIFIED" | "SOURCE_DOCUMENT_REQUIRED";
  notes: string | null;
  section_count: number;
  variable_count: number;
  body: TemplateSection[];
  variables: TemplateVariable[];
  execution_block: Record<string, unknown>;
  content_fingerprint: string | null;
  author_staff_id: string | null;
  author_name: string | null;
  author_user_id: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  approvals: TemplateApproval[];
  events: TemplateEvent[];
}

export interface TemplateRecord {
  id: string;
  code: string;
  name: string;
  kind: TemplateKind;
  description: string | null;
  legal_entity: string;
  jurisdiction: string;
  classification: string;
  source_reference: string | null;
  is_active: boolean;
  published_version: string | null;
  versions: TemplateVersion[];
}

export interface TemplateRegistry {
  generated_at: string;
  can_manage: boolean;
  is_admin: boolean;
  templates: TemplateRecord[];
}

/** Reasons the database refuses an action, in plain language. */
export const ACTION_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "You do not have permission to manage document templates.",
  VERSION_NOT_FOUND: "That version no longer exists.",
  ONLY_DRAFT_CAN_BE_SUBMITTED: "Only a draft can be sent for review.",
  TEMPLATE_BODY_REQUIRED: "The template has no content yet, so it cannot be reviewed.",
  SOURCE_DOCUMENT_REQUIRED:
    "The authoritative source document has not been supplied, so this version cannot be reviewed or published.",
  ONLY_IN_REVIEW_CAN_BE_DECIDED: "Only a version in review can be approved or sent back.",
  FOUR_EYES_REQUIRED: "You wrote this version, so someone else must approve it.",
  ONLY_APPROVED_CAN_BE_PUBLISHED: "Only an approved version can be published.",
  APPROVAL_RECORD_REQUIRED: "No approval is on file for this version.",
  ONLY_PUBLISHED_CAN_BE_RETIRED: "Only the published version can be retired.",
  REASON_REQUIRED: "Give a reason before retiring the published version.",
  UNKNOWN_ACTION: "That action is not recognised.",
  VERSION_REQUIRED: "Give the new version a name, for example v1.1.",
};

export function refusalMessage(message: string): string {
  const hit = Object.keys(ACTION_REFUSALS).find((k) => message.includes(k));
  return hit ? ACTION_REFUSALS[hit] : message;
}

export async function fetchTemplateRegistry(): Promise<TemplateRegistry> {
  const { data, error } = await supabase.rpc("doc_template_registry");
  if (error) throw new Error(refusalMessage(error.message));
  return data as unknown as TemplateRegistry;
}

export async function runTemplateAction(
  versionId: string,
  action: TemplateAction,
  note?: string,
): Promise<{ version_id: string; status: TemplateVersionStatus; sole_approver: boolean }> {
  const { data, error } = await supabase.rpc("doc_template_action", {
    _version_id: versionId,
    _action: action,
    _note: note?.trim() || null,
  });
  if (error) throw new Error(refusalMessage(error.message));
  return data as unknown as { version_id: string; status: TemplateVersionStatus; sole_approver: boolean };
}

export async function createTemplateVersion(
  templateId: string,
  version: string,
  notes?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("doc_template_version_create", {
    _template_id: templateId,
    _version: version,
    _notes: notes?.trim() || null,
  });
  if (error) throw new Error(refusalMessage(error.message));
  return data as unknown as string;
}

/** Which actions the current viewer may attempt on a version. */
export function availableActions(
  v: TemplateVersion,
  ctx: { canManage: boolean; isAdmin: boolean; userId: string | null },
): TemplateAction[] {
  if (!ctx.canManage) return [];
  const isAuthor = !!v.author_user_id && v.author_user_id === ctx.userId;
  switch (v.status) {
    case "DRAFT":
    case "REJECTED":
      return v.source_status === "SOURCE_DOCUMENT_REQUIRED" ? [] : ["SUBMIT"];
    case "IN_REVIEW":
      return isAuthor && !ctx.isAdmin ? [] : ["APPROVE", "REJECT"];
    case "APPROVED":
      return ["PUBLISH"];
    case "PUBLISHED":
      return ["RETIRE"];
    default:
      return [];
  }
}

export function clauseCount(v: TemplateVersion): number {
  return (v.body ?? []).reduce((sum, s) => sum + (s.clauses?.length ?? 0), 0);
}

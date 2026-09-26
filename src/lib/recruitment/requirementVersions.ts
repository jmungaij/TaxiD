/**
 * Recruitment 360 — document requirement versions.
 *
 * Requirements are versioned rows, not editable settings. Each
 * `rec_document_requirement_sets` row is one version (universal template or
 * vacancy scoped) and every application is permanently bound to the versions
 * that were active when it was created
 * (`rec_applications.document_requirement_set_id` +
 * `document_requirement_universal_set_id`).
 *
 * That binding is deliberate: publishing a new version must never retroactively
 * change what an existing candidate was asked to provide. The public form and
 * the stage gate resolve the LATEST ACTIVE version (new applicants), while the
 * staff document status resolves the application's BOUND version.
 *
 * This module only reads and shapes what the database publishes through
 * `rec_requirement_version_history` — it never decides what is mandatory.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type RequirementSetStatus =
  | "draft" | "review" | "approved" | "active" | "superseded" | "retired";

export interface RequirementVersionRow {
  set_id: string;
  scope: "universal" | "vacancy";
  vacancy_id: string | null;
  vacancy_title: string | null;
  public_slug: string | null;
  version: number;
  status: RequirementSetStatus;
  effective_from: string;
  vacancy_content_version: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  rule_count: number;
  mandatory_count: number;
  doc_keys: string[] | null;
  mandatory_doc_keys: string[] | null;
  bound_applications: number;
  verification_required_keys?: string[] | null;
  created_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  published_by?: string | null;
  published_at?: string | null;
  effective_until?: string | null;
  supersedes_set_id?: string | null;
  superseded_by_set_id?: string | null;
}

export const REQUIREMENT_VERSION_COLUMNS =
  "set_id, scope, vacancy_id, vacancy_title, public_slug, version, status, effective_from, " +
  "vacancy_content_version, notes, created_at, updated_at, rule_count, mandatory_count, " +
  "doc_keys, mandatory_doc_keys, bound_applications, verification_required_keys, " +
  "created_by, reviewed_by, reviewed_at, approved_by, approved_at, published_by, published_at, " +
  "effective_until, supersedes_set_id, superseded_by_set_id";

/** Every requirement version, newest first. Staff read (view is RLS-scoped). */
export async function listRequirementVersions(): Promise<RequirementVersionRow[]> {
  const { data, error } = await db
    .from("rec_requirement_version_history")
    .select(REQUIREMENT_VERSION_COLUMNS)
    .order("scope", { ascending: true })
    .order("effective_from", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RequirementVersionRow[];
}

export function statusLabel(status: RequirementSetStatus): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Draft — not enforced";
  if (status === "review") return "Under review — not enforced";
  if (status === "approved") return "Approved — awaiting publication";
  if (status === "retired") return "Retired";
  return "Superseded";
}

export function statusTone(status: RequirementSetStatus): "success" | "warning" | "neutral" | "info" {
  if (status === "active") return "success";
  if (status === "draft" || status === "review") return "warning";
  if (status === "approved") return "info";
  return "neutral";
}

/**
 * Requirement lifecycle. A published version is immutable: changing what a
 * vacancy demands means creating a NEW draft version, having a second person
 * approve it and publishing it. The database enforces every rule below —
 * this list only drives which controls are offered.
 */
export type LifecycleAction =
  | "submit_review" | "approve" | "publish" | "withdraw" | "retire" | "discard";

export const LIFECYCLE_ACTION_LABELS: Record<LifecycleAction, string> = {
  submit_review: "Submit for review",
  approve: "Approve",
  publish: "Publish",
  withdraw: "Withdraw to draft",
  retire: "Retire",
  discard: "Discard draft",
};

export function availableActions(status: RequirementSetStatus): LifecycleAction[] {
  if (status === "draft") return ["submit_review", "discard"];
  if (status === "review") return ["approve", "withdraw"];
  if (status === "approved") return ["publish", "withdraw"];
  if (status === "active" || status === "superseded") return ["retire"];
  return [];
}


/** True when this version is enforced by the engine for new applicants. */
export function isEnforced(status: RequirementSetStatus): boolean {
  return status === "active";
}

export interface ContractCompileResult {
  set_id: string;
  scope: string;
  vacancy_id: string | null;
  version: number;
  status: string;
  rule_count: number;
  mandatory_count: number;
  verification_required_count: number;
  errors: string[];
  warnings: string[];
  verdict: "CONTRACT_VALID" | "CONTRACT_INVALID";
  compiled_at: string;
}

export const COMPILE_REASONS: Record<string, string> = {
  REQUIREMENT_VERSION_HAS_NO_RULES: "The version carries no requirement rows.",
  NO_MANDATORY_REQUIREMENT: "No requirement is mandatory — the contract demands nothing.",
  REQUIREMENT_WITHOUT_DOCUMENT_KEY: "A requirement has no document key, so no upload can satisfy it.",
  REQUIREMENT_WITHOUT_LABEL: "A requirement has no candidate-facing label.",
  DUPLICATE_MANDATORY_DOCUMENT_KEY: "Two mandatory requirements resolve the same document key.",
  UNIVERSAL_ACTIVE_VERSION_NOT_UNIQUE: "There is not exactly one active universal template.",
  NO_ACTIVE_APPLICATION_BLUEPRINT: "The vacancy has no active application blueprint (no form to complete).",
  VACANCY_CONTENT_VERSION_MISMATCH: "The version was built for an older vacancy content version.",
  VACANCY_NOT_FOUND: "The owning vacancy no longer exists.",
  NO_MANDATORY_REQUIREMENT_NEEDS_VERIFICATION: "No mandatory requirement demands staff verification.",
};

export function compileReasonCopy(code: string): string {
  return COMPILE_REASONS[code] ?? code;
}

export async function compileRequirementContract(setId: string): Promise<ContractCompileResult> {
  const { data, error } = await db.rpc("rec_requirement_contract_compile", { p_set: setId });
  if (error) throw new Error(error.message);
  return data as ContractCompileResult;
}

export async function createRequirementDraft(input: {
  scope: "universal" | "vacancy";
  vacancyId?: string | null;
  notes?: string | null;
}): Promise<{ set_id: string; version: number; rules_copied: number }> {
  const { data, error } = await db.rpc("rec_requirement_draft_create", {
    p_scope: input.scope,
    p_vacancy: input.vacancyId ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { set_id: string; version: number; rules_copied: number };
}

export async function requirementLifecycleAction(
  setId: string, action: LifecycleAction, note?: string,
): Promise<{ set_id: string; status: string }> {
  // Withdrawal is a separate governed RPC: it only returns a not-yet-published
  // version to draft and can never touch an active (enforced) version.
  const fn = action === "withdraw"
    ? "rec_requirement_lifecycle_withdraw"
    : "rec_requirement_lifecycle_action";
  const args = action === "withdraw"
    ? { p_set: setId, p_note: note ?? null }
    : { p_set: setId, p_action: action, p_note: note ?? null };
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { set_id: string; status: string };
}


export interface RequirementRuleInput {
  id?: string;
  doc_key: string;
  label: string;
  doc_class?: string;
  doc_type?: string;
  mandatory?: boolean;
  per_completed_year?: boolean;
  allow_consolidated?: boolean;
  requires_verification?: boolean;
  why_required?: string | null;
  ord?: number;
  /** The requirement as the candidate reads it. */
  requirement_text?: string | null;
  /** A candidate who does not satisfy this is not eligible for the vacancy. */
  hard_requirement?: boolean;
  evidence_kind?: "document" | "declaration" | "document_or_declaration";
  accepted_evidence_types?: string[];
  declaration_prompt?: string | null;
  response_required?: boolean;
}

export interface RequirementRuleRow extends RequirementRuleInput {
  id: string;
  set_id: string;
}

export const REQUIREMENT_RULE_COLUMNS =
  "id, set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year, " +
  "allow_consolidated, requires_verification, why_required, ord, requirement_text, " +
  "hard_requirement, evidence_kind, accepted_evidence_types, declaration_prompt, response_required";

/** Requirement rows on one version, in candidate order. Staff read. */
export async function listRequirementRules(setId: string): Promise<RequirementRuleRow[]> {
  const { data, error } = await db
    .from("rec_document_requirement_rules")
    .select(REQUIREMENT_RULE_COLUMNS)
    .eq("set_id", setId)
    .order("ord", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RequirementRuleRow[];
}

export async function saveRequirementRule(setId: string, rule: RequirementRuleInput): Promise<string> {
  const { data, error } = await db.rpc("rec_requirement_rule_save", { p_set: setId, p_rule: rule });
  if (error) throw new Error(error.message);
  return (data as { rule_id: string }).rule_id;
}

export async function removeRequirementRule(ruleId: string): Promise<void> {
  const { error } = await db.rpc("rec_requirement_rule_remove", { p_rule: ruleId });
  if (error) throw new Error(error.message);
}


export interface VersionCompareResult {
  from_set: string;
  to_set: string;
  added: Array<{ doc_key: string; label: string; mandatory: boolean; requires_verification: boolean }>;
  removed: Array<{ doc_key: string; label: string; mandatory: boolean; requires_verification: boolean }>;
  changed: Array<{
    doc_key: string; label: string;
    from: Record<string, unknown>; to: Record<string, unknown>;
  }>;
}

/** Server-computed comparison — the client never decides what changed. */
export async function compareRequirementVersions(
  fromSet: string, toSet: string,
): Promise<VersionCompareResult> {
  const { data, error } = await db.rpc("rec_requirement_version_compare", {
    p_from: fromSet, p_to: toSet,
  });
  if (error) throw new Error(error.message);
  return data as VersionCompareResult;
}

export interface RequirementLifecycleEvent {
  id: string;
  set_id: string;
  vacancy_id: string | null;
  version: number | null;
  action: string;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

/** Append-only configuration audit trail for requirement versions. */
export async function listLifecycleEvents(setId?: string, limit = 50): Promise<RequirementLifecycleEvent[]> {
  let q = db
    .from("rec_requirement_lifecycle_events")
    .select("id, set_id, vacancy_id, version, action, status_before, status_after, note, actor_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (setId) q = q.eq("set_id", setId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as RequirementLifecycleEvent[];
}

export interface IntegrityRow {
  vacancy_id: string;
  public_slug: string | null;
  title: string;
  set_id: string | null;
  requirement_version: number | null;
  rule_count: number;
  mandatory_count: number;
  doc_keys: string[] | null;
  mandatory_doc_keys: string[] | null;
  verification_required_keys: string[] | null;
  bound_applications: number;
  result: "PASS" | "FAIL";
  reasons: string[] | null;
}

/** Machine-verifiable integrity check over every published vacancy. */
export async function runIntegrityCheck(): Promise<IntegrityRow[]> {
  const { data, error } = await db.rpc("rec_requirement_integrity_check");
  if (error) throw new Error(error.message);
  return (data ?? []) as IntegrityRow[];
}

export interface VacancyVersionGroup {
  key: string;
  scope: "universal" | "vacancy";
  vacancy_id: string | null;
  title: string;
  public_slug: string | null;
  versions: RequirementVersionRow[];
  active: RequirementVersionRow | null;
  bound_applications: number;
}

/**
 * One group per requirement owner (the universal template, then each vacancy),
 * versions newest first. An owner can legitimately have no active version — that
 * is surfaced, never hidden, because it means the engine resolves nothing.
 */
export function groupByOwner(rows: readonly RequirementVersionRow[]): VacancyVersionGroup[] {
  const groups = new Map<string, VacancyVersionGroup>();
  for (const row of rows) {
    const key = row.scope === "universal" ? "universal" : `vacancy:${row.vacancy_id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        scope: row.scope,
        vacancy_id: row.vacancy_id,
        title: row.scope === "universal"
          ? "Universal requirement template"
          : row.vacancy_title ?? "Vacancy (title unavailable)",
        public_slug: row.public_slug,
        versions: [],
        active: null,
        bound_applications: 0,
      };
      groups.set(key, group);
    }
    group.versions.push(row);
    group.bound_applications += row.bound_applications ?? 0;
    if (row.status === "active") group.active = row;
  }

  for (const group of groups.values()) {
    group.versions.sort((a, b) => b.version - a.version);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "universal" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export interface DocKeyDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/** What a version changed relative to another version's resolved document keys. */
export function docKeyDiff(
  from: readonly string[] | null | undefined,
  to: readonly string[] | null | undefined,
): DocKeyDiff {
  const a = new Set((from ?? []).filter(Boolean));
  const b = new Set((to ?? []).filter(Boolean));
  return {
    added: [...b].filter((k) => !a.has(k)).sort(),
    removed: [...a].filter((k) => !b.has(k)).sort(),
    unchanged: [...b].filter((k) => a.has(k)).sort(),
  };
}

/** True when a version still governs live applications even though superseded. */
export function stillGoverning(row: RequirementVersionRow): boolean {
  return row.status !== "active" && (row.bound_applications ?? 0) > 0;
}

export function versionSearchMatches(row: RequirementVersionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.vacancy_title, row.public_slug, row.scope, row.notes,
    `v${row.version}`, ...(row.doc_keys ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

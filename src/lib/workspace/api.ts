/**
 * Personal Operating System — data access.
 *
 * Reads only canonical records that already belong to the signed-in employee:
 * their staff identity, their assigned work (RLS-scoped), the customer promises
 * they own, and the CRM next actions pointing at their work items.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PersonalCommitment, PersonalNextAction } from "./personalOs";
import type { OpportunitySignal } from "./commercialReplan";

// CRM/commitment tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface MyStaffIdentity {
  staffId: string | null;
  fullName: string | null;
  position: string | null;
  unit: string | null;
  /**
   * Server-authoritative resolution state. "linked" is the ONLY state in which
   * personal work, customers, promises or documents may be rendered.
   */
  status: "linked" | "unlinked" | "error";
  /** Safe reference a normal employee can quote to an administrator. */
  diagnosticRef: string | null;
}

const diagnosticRef = (userId: string, code: string) =>
  `WS-${code}-${userId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/**
 * Resolves the authenticated user to their canonical staff record.
 *
 * This is the identity gate for the whole cockpit: when it does not return
 * "linked", the caller MUST withhold personal data rather than fall back to
 * role-derived queues, cached state or demonstration content.
 */
export async function fetchMyStaffIdentity(
  userId: string,
  opts: { allowClaim?: boolean } = {},
): Promise<MyStaffIdentity> {
  const allowClaim = opts.allowClaim ?? true;
  const { data, error } = await db
    .from("staff_members")
    .select("id, full_name, preferred_name, position:org_positions(title), unit:org_units!staff_members_unit_id_fkey(name)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    return {
      staffId: null,
      fullName: null,
      position: null,
      unit: null,
      status: "error",
      diagnosticRef: diagnosticRef(userId, "READ"),
    };
  if (!data?.id) {
    // Self-service claim: the server matches the caller's VERIFIED email against
    // an unlinked active staff record. It never invents a record, so an employee
    // who is not on the staff register still lands on the withheld state.
    const claimed = allowClaim ? await claimMyStaffProfile() : null;
    if (claimed) return fetchMyStaffIdentity(userId, { allowClaim: false });
    return {
      staffId: null,
      fullName: null,
      position: null,
      unit: null,
      status: "unlinked",
      diagnosticRef: diagnosticRef(userId, "LINK"),
    };
  }
  return {
    staffId: data.id,
    fullName: data.preferred_name ?? data.full_name ?? null,
    position: data.position?.title ?? null,
    unit: data.unit?.name ?? null,
    status: "linked",
    diagnosticRef: null,
  };
}

/**
 * Connects the signed-in employee to their own staff record.
 *
 * The match is made server-side on the caller's verified email address, so this
 * can never surface another employee's record. Returns null when no record
 * matches — that is a legitimate outcome, not an error to surface.
 */
export async function claimMyStaffProfile(): Promise<string | null> {
  const { data, error } = await db.rpc("staff_claim_self");
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * Admin-only self-service repair: links the signed-in platform administrator to
 * a canonical staff record when none exists. Enforced server-side.
 */
export async function linkMyStaffProfile(): Promise<string> {
  const { data, error } = await db.rpc("staff_link_self");
  if (error) throw new Error(error.message);
  return data as string;
}

/* ------------------------------------------------- identity diagnostics ---- */

export type StaffLinkReason =
  | "not_authenticated"
  | "linked"
  | "record_inactive"
  | "email_unverified"
  | "ambiguous_email_match"
  | "match_inactive"
  | "claimable"
  | "no_staff_record"
  | "unavailable";

export interface StaffLinkDiagnostics {
  reason: StaffLinkReason;
  email: string | null;
  emailVerified: boolean;
  linkedStaffId: string | null;
  linkedStatus: string | null;
  unlinkedEmailMatches: number;
  matchStatus: string | null;
  matchOrgId: string | null;
}

/**
 * Explains — from server-authoritative data about the CALLER ONLY — why the
 * workspace is withheld. It never reveals another employee's record.
 */
export async function fetchStaffLinkDiagnostics(): Promise<StaffLinkDiagnostics> {
  const { data, error } = await db.rpc("staff_link_diagnostics");
  if (error || !data) {
    return {
      reason: "unavailable",
      email: null,
      emailVerified: false,
      linkedStaffId: null,
      linkedStatus: null,
      unlinkedEmailMatches: 0,
      matchStatus: null,
      matchOrgId: null,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return {
    reason: (d.reason ?? "unavailable") as StaffLinkReason,
    email: d.email ?? null,
    emailVerified: !!d.email_verified,
    linkedStaffId: d.linked_staff_id ?? null,
    linkedStatus: d.linked_status ?? null,
    unlinkedEmailMatches: Number(d.unlinked_email_matches ?? 0),
    matchStatus: d.match_status ?? null,
    matchOrgId: d.match_org_id ?? null,
  };
}

export interface StaffBackfillRow {
  staffId: string;
  staffNo: string | null;
  fullName: string | null;
  email: string | null;
  matchedUserId: string | null;
  action: "would_link" | "linked" | "skipped";
  detail: string;
}

/**
 * Admin-only backfill of staff_members.user_id from verified account emails.
 * `dryRun` previews without writing; the role check is enforced server-side.
 */
export async function runStaffLinkBackfill(dryRun: boolean): Promise<StaffBackfillRow[]> {
  const { data, error } = await db.rpc("staff_backfill_links", { p_dry_run: dryRun });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    staffId: r.staff_id,
    staffNo: r.staff_no ?? null,
    fullName: r.full_name ?? null,
    email: r.email ?? null,
    matchedUserId: r.matched_user_id ?? null,
    action: r.action,
    detail: r.detail ?? "",
  }));
}


export async function fetchMyCommitments(staffId: string): Promise<PersonalCommitment[]> {
  const { data, error } = await db
    .from("crm_customer_commitments")
    .select("*, account:crm_accounts(name)")
    .eq("owner_staff_id", staffId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    commitment: r.commitment,
    account_id: r.account_id,
    account_name: r.account?.name ?? null,
    direction: r.direction,
    status: r.status,
    due_at: r.due_at ?? null,
    work_item_id: r.work_item_id ?? null,
    expected_outcome: r.expected_outcome ?? null,
  }));
}

export async function fetchMyNextActions(staffId: string): Promise<PersonalNextAction[]> {
  const { data, error } = await db
    .from("crm_next_actions")
    .select("*, account:crm_accounts(name)")
    .eq("staff_id", staffId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    account_id: r.account_id,
    account_name: r.account?.name ?? null,
    work_item_id: r.work_item_id,
    due_at: r.due_at ?? null,
    priority: r.priority,
    status: r.status,
  }));
}

/** Marks a customer promise fulfilled with recorded evidence. */
export async function fulfilCommitment(
  id: string,
  evidence: { kind: string; ref?: string; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("crm_customer_commitments")
    .update({
      status: "fulfilled",
      fulfilled_at: new Date().toISOString(),
      evidence_kind: evidence.kind,
      evidence_ref: evidence.ref ?? null,
      notes: evidence.note ?? null,
    })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ---------------------------------------------------------------- focus mode */

export interface FocusSession {
  id: string;
  work_item_id: string;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number | null;
  actual_minutes: number | null;
  interrupted: boolean;
  outcome_note: string | null;
}

/** Opens a focus session on a work item; the server also marks it in progress. */
export async function startFocusSession(
  workItemId: string,
  plannedMinutes?: number,
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const { data, error } = await db.rpc("focus_session_start", {
    _work_item_id: workItemId,
    _planned_minutes: plannedMinutes ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true, sessionId: data as string };
}

/** Closes a focus session, recording real effort and (optionally) completion. */
export async function endFocusSession(
  sessionId: string,
  opts: { outcomeNote?: string; completed?: boolean; interrupted?: boolean } = {},
): Promise<{ ok: boolean; actualMinutes?: number; error?: string }> {
  const { data, error } = await db.rpc("focus_session_end", {
    _session_id: sessionId,
    _outcome_note: opts.outcomeNote ?? null,
    _completed: !!opts.completed,
    _interrupted: !!opts.interrupted,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, actualMinutes: (data as { actual_minutes?: number })?.actual_minutes };
}

/** Focus sessions recorded today — the source of real effort actuals. */
export async function fetchTodayFocusSessions(staffId: string): Promise<FocusSession[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { data, error } = await db
    .from("staff_focus_sessions")
    .select("id, work_item_id, started_at, ended_at, planned_minutes, actual_minutes, interrupted, outcome_note")
    .eq("staff_id", staffId)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FocusSession[];
}

/* ------------------------------------------------------------ carry forward */

/**
 * Records that an unfinished work item is deliberately carried into tomorrow.
 * Writes to the canonical work item (next action date + recorded reason) and
 * appends an audit entry server-side.
 */
export async function carryForwardWork(
  workItemId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc("ops_work_carry_forward", {
    _work_item_id: workItemId,
    _reason: reason ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ------------------------------------------------- live commercial signals */

/**
 * Reads the LIVE pipeline rows behind the employee's carried work, so Day Close
 * replans from what actually moved (stage, probability, value, last change)
 * instead of rolling every unfinished item forward unchanged.
 */
export async function fetchOpportunitySignals(
  opportunityIds: string[],
): Promise<OpportunitySignal[]> {
  const ids = [...new Set(opportunityIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("commercial_opportunities")
    .select("id, opportunity_ref, stage, probability_pct, expected_value_cents, updated_at")
    .in("id", ids);
  if (error) return [];
  return (data ?? []).map(
    (r: {
      id: string;
      opportunity_ref: string | null;
      stage: string;
      probability_pct: number | null;
      expected_value_cents: number | null;
      updated_at: string | null;
    }) => ({
      id: r.id,
      ref: r.opportunity_ref,
      stage: r.stage,
      probabilityPct: r.probability_pct,
      valueKes: r.expected_value_cents === null ? null : r.expected_value_cents / 100,
      updatedAt: r.updated_at,
    }),
  );
}

/* ------------------------------------------------------ capacity & dispositions */

export interface CapacityProfile {
  roleKey: string;
  label: string;
  workingMinutes: number;
  productiveMinutes: number;
  focusBlockMinutes: number;
}

/**
 * The recorded capacity profile for a role. Capacity is configuration, never a
 * constant in code: if no profile matches the role, the DEFAULT profile is used
 * and the caller can say so honestly.
 */
export async function fetchCapacityProfile(roleKey?: string | null): Promise<CapacityProfile | null> {
  const keys = [roleKey?.toLowerCase(), "DEFAULT"].filter(Boolean) as string[];
  const { data, error } = await db
    .from("work_capacity_profiles")
    .select("role_key,label,working_minutes,productive_minutes,focus_block_minutes")
    .in("role_key", keys)
    .eq("is_active", true);
  if (error || !data?.length) return null;
  const rows = data as {
    role_key: string;
    label: string;
    working_minutes: number;
    productive_minutes: number;
    focus_block_minutes: number;
  }[];
  const match = rows.find((r) => r.role_key === roleKey?.toLowerCase()) ?? rows.find((r) => r.role_key === "DEFAULT");
  if (!match) return null;
  return {
    roleKey: match.role_key,
    label: match.label,
    workingMinutes: match.working_minutes,
    productiveMinutes: match.productive_minutes,
    focusBlockMinutes: match.focus_block_minutes,
  };
}

export type WorkDisposition =
  | "continue"
  | "reschedule"
  | "waiting"
  | "blocked"
  | "reassign"
  | "automate"
  | "nurture"
  | "close"
  | "disqualify"
  | "escalate";

/** Records an explicit decision about unfinished work. A reason is mandatory. */
export async function recordWorkDisposition(input: {
  workItemId: string;
  disposition: WorkDisposition;
  reason: string;
  newDueDate?: string | null;
  reassignToStaffId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc("work_disposition_record", {
    _work_item_id: input.workItemId,
    _disposition: input.disposition,
    _reason: input.reason,
    _new_due_date: input.newDueDate ?? null,
    _reassign_to: input.reassignToStaffId ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface OutstandingDisposition {
  workItemId: string;
  title: string;
  workKind: string;
  priorityBand: string;
  effortMinutes: number | null;
}

/** Open work that still has no decision recorded for the business day. */
export async function fetchOutstandingDispositions(
  businessDate?: string,
): Promise<OutstandingDisposition[]> {
  const { data, error } = await db.rpc("work_dispositions_outstanding", {
    _business_date: businessDate ?? null,
  });
  if (error || !data) return [];
  return (
    data as {
      work_item_id: string;
      title: string;
      work_kind: string;
      priority_band: string;
      effort_minutes: number | null;
    }[]
  ).map((r) => ({
    workItemId: r.work_item_id,
    title: r.title,
    workKind: r.work_kind,
    priorityBand: r.priority_band,
    effortMinutes: r.effort_minutes,
  }));
}

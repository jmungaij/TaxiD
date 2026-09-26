/**
 * CRM data access. Every write that must stay consistent with executable work
 * or opportunity truth goes through a database RPC, never a direct table write:
 *
 *   stage change   → crm_set_opportunity_stage  (single writer of stage + event)
 *   next action    → crm_create_next_action     (creates the work item atomically)
 *   chain proof    → verify_blueprint_chain
 */
import { supabase } from "@/integrations/supabase/client";
import {
  meetingCaptureCompleteness,
  type CrmAccount,
  type CrmContact,
  type CrmInteraction,
  type CrmMeetingOutcome,
  type CrmNextAction,
  type CrmOpportunityLink,
} from "./types";

// The CRM tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/* ------------------------------- accounts ------------------------------- */

export async function listAccounts(): Promise<CrmAccount[]> {
  return unwrap<CrmAccount[]>(
    await db.from("crm_accounts").select("*").order("updated_at", { ascending: false }),
  );
}

export async function getAccount(id: string): Promise<CrmAccount | null> {
  const { data, error } = await db.from("crm_accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CrmAccount) ?? null;
}

export type NewAccount = Pick<CrmAccount, "name"> &
  Partial<
    Pick<
      CrmAccount,
      | "legal_name"
      | "industry"
      | "country"
      | "city"
      | "size_band"
      | "lifecycle_stage"
      | "importance_tier"
      | "owner_staff_id"
      | "source"
      | "website"
      | "notes"
    >
  >;

export async function createAccount(input: NewAccount): Promise<CrmAccount> {
  const { data, error } = await db.from("crm_accounts").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CrmAccount;
}

export async function updateAccount(id: string, patch: Partial<CrmAccount>): Promise<void> {
  const { error } = await db.from("crm_accounts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------- contacts ------------------------------- */

export async function listContacts(accountId: string): Promise<CrmContact[]> {
  return unwrap<CrmContact[]>(
    await db
      .from("crm_contacts")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true }),
  );
}

export async function createContact(
  input: Pick<CrmContact, "account_id" | "full_name"> & Partial<CrmContact>,
): Promise<CrmContact> {
  const { data, error } = await db.from("crm_contacts").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CrmContact;
}

/* ----------------------------- interactions ----------------------------- */

export async function listInteractions(accountId: string): Promise<CrmInteraction[]> {
  return unwrap<CrmInteraction[]>(
    await db
      .from("crm_interactions")
      .select("*")
      .eq("account_id", accountId)
      .order("occurred_at", { ascending: false }),
  );
}

export async function logInteraction(
  input: Pick<CrmInteraction, "account_id" | "interaction_type" | "subject"> & Partial<CrmInteraction>,
): Promise<CrmInteraction> {
  const { data, error } = await db.from("crm_interactions").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CrmInteraction;
}

/* ---------------------------- meeting outcomes --------------------------- */

export async function listMeetingOutcomes(accountId: string): Promise<CrmMeetingOutcome[]> {
  return unwrap<CrmMeetingOutcome[]>(
    await db.from("crm_meeting_outcomes").select("*").eq("account_id", accountId),
  );
}

/** Progressive capture: completeness is derived, never typed in by a human. */
export async function saveMeetingOutcome(
  input: Pick<CrmMeetingOutcome, "interaction_id" | "account_id"> & Partial<CrmMeetingOutcome>,
): Promise<CrmMeetingOutcome> {
  const row = { ...input, capture_completeness_pct: meetingCaptureCompleteness(input) };
  const { data, error } = await db
    .from("crm_meeting_outcomes")
    .upsert(row, { onConflict: "interaction_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CrmMeetingOutcome;
}

/* ------------------------------ next actions ----------------------------- */

export async function listNextActions(accountId: string): Promise<CrmNextAction[]> {
  return unwrap<CrmNextAction[]>(
    await db
      .from("crm_next_actions")
      .select("*")
      .eq("account_id", accountId)
      .order("due_at", { ascending: true, nullsFirst: false }),
  );
}

export interface CreateNextActionInput {
  accountId: string;
  staffId: string;
  title: string;
  dueAt?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  opportunityId?: string | null;
  interactionId?: string | null;
  slaMinutes?: number | null;
}

/** Creates the CRM pointer AND the executable work item in one transaction. */
export async function createNextAction(input: CreateNextActionInput): Promise<{ nextActionId: string; workItemId: string }> {
  const { data, error } = await db.rpc("crm_create_next_action", {
    _account_id: input.accountId,
    _staff_id: input.staffId,
    _title: input.title,
    _due_at: input.dueAt ?? null,
    _priority: input.priority ?? "medium",
    _opportunity_id: input.opportunityId ?? null,
    _interaction_id: input.interactionId ?? null,
    _sla_minutes: input.slaMinutes ?? null,
  });
  if (error) throw new Error(error.message);
  const res = data as { next_action_id: string; work_item_id: string };
  return { nextActionId: res.next_action_id, workItemId: res.work_item_id };
}

export async function updateNextActionStatus(
  id: string,
  status: CrmNextAction["status"],
): Promise<void> {
  const { error } = await db.from("crm_next_actions").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* --------------------------- opportunity linkage -------------------------- */

export interface LinkedOpportunity extends CrmOpportunityLink {
  opportunity?: {
    id: string;
    opportunity_ref: string;
    title: string;
    stage: string;
    expected_value_cents: number | null;
    currency: string | null;
    probability_pct: number | null;
  } | null;
}

export async function listAccountOpportunities(accountId: string): Promise<LinkedOpportunity[]> {
  return unwrap<LinkedOpportunity[]>(
    await db
      .from("crm_opportunity_links")
      .select(
        "*, opportunity:commercial_opportunities(id,opportunity_ref,title,stage,expected_value_cents,currency,probability_pct)",
      )
      .eq("account_id", accountId),
  );
}

export async function linkOpportunity(input: {
  opportunityId: string;
  accountId: string;
  primaryContactId?: string | null;
  ownerStaffId?: string | null;
}): Promise<void> {
  const { error } = await db.from("crm_opportunity_links").insert({
    opportunity_id: input.opportunityId,
    account_id: input.accountId,
    primary_contact_id: input.primaryContactId ?? null,
    owner_staff_id: input.ownerStaffId ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Only writer of opportunity stage. Emits a spine event for downstream work. */
export async function setOpportunityStage(
  opportunityId: string,
  stage: string,
  reason?: string,
): Promise<{ from_stage: string; to_stage: string }> {
  const { data, error } = await db.rpc("crm_set_opportunity_stage", {
    _opportunity_id: opportunityId,
    _stage: stage,
    _reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { from_stage: string; to_stage: string };
}

/* ------------------------------ chain proof ------------------------------ */

export interface ChainHop {
  hop: string;
  entity: string;
  entity_id: string;
  detail: string | null;
}

export async function verifyBlueprintChain(staffId: string): Promise<ChainHop[]> {
  const { data, error } = await db.rpc("verify_blueprint_chain", { _staff_id: staffId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChainHop[];
}

export const CHAIN_HOPS = [
  "1_staff",
  "2_objective",
  "3_kpi_actual",
  "4_work_item",
  "5_next_action",
  "6_opportunity",
  "7_account",
  "8_transaction",
] as const;

/** Which hops are missing — a broken chain is a governance finding, not a UI bug. */
export function brokenChainHops(hops: ChainHop[]): string[] {
  const present = new Set(hops.map((h) => h.hop));
  return CHAIN_HOPS.filter((h) => !present.has(h));
}

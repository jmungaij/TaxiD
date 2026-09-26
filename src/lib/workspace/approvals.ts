/**
 * STAGE 11 — COMMERCIAL APPROVALS + SERVICE HANDOFF.
 *
 * Proposals, contracts and service orders may not progress on one person's
 * word. Every one of them is raised as an approval record and decided by a
 * manager in the database (`commercial_request_approval`,
 * `commercial_decide_approval`), which is also what flips the underlying
 * record's state. The browser never writes the decision itself.
 *
 * The contract → service handoff runs through `commercial_service_handoff`,
 * which refuses a contract that is not active, raises the service order for
 * approval, and records a service exception when delivery detail is missing.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function fail(message: string): never {
  throw new Error(message);
}

export type ApprovalEntityType = "proposal" | "contract" | "service_order";
export type ApprovalStatus = "pending" | "approved" | "declined" | "withdrawn";

export const APPROVAL_ENTITY_LABEL: Record<ApprovalEntityType, string> = {
  proposal: "Proposal",
  contract: "Contract",
  service_order: "Service order",
};

export interface ApprovalRecord {
  id: string;
  entity_type: ApprovalEntityType;
  entity_id: string;
  entity_ref: string | null;
  account_id: string | null;
  title: string;
  amount_cents: number | null;
  currency: string;
  justification: string | null;
  status: ApprovalStatus;
  requested_by: string | null;
  requested_staff_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, entity_type, entity_id, entity_ref, account_id, title, amount_cents, currency, justification, status, requested_by, requested_staff_id, decided_by, decided_at, decision_note, created_at, updated_at";

/** Everything the signed-in person is allowed to see: theirs, or theirs to decide. */
export async function listApprovals(): Promise<{ items: ApprovalRecord[]; authorised: boolean }> {
  const { data, error } = await db
    .from("commercial_approvals")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { items: [], authorised: false };
  return { items: (data ?? []) as ApprovalRecord[], authorised: true };
}

/** True when this person may record approve/decline decisions. */
export async function canApproveCommercial(): Promise<boolean> {
  const { data, error } = await db.rpc("commercial_can_approve", {});
  if (error) return false;
  return data === true;
}

export async function requestApproval(input: {
  entityType: ApprovalEntityType;
  entityId: string;
  justification?: string | null;
}): Promise<{ approval_id: string }> {
  const { data, error } = await db.rpc("commercial_request_approval", {
    p: {
      entity_type: input.entityType,
      entity_id: input.entityId,
      justification: input.justification ?? null,
    },
  });
  if (error) fail(error.message);
  return data as { approval_id: string };
}

export async function decideApproval(
  id: string,
  decision: "approved" | "declined",
  note?: string | null,
): Promise<void> {
  const { error } = await db.rpc("commercial_decide_approval", {
    p_id: id,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) fail(error.message);
}

export interface HandoffResult {
  service_order_id: string;
  exception_id: string | null;
  gaps: string[];
}

/** Contract → service order. Raises approval and records gaps as an exception. */
export async function handoffToService(input: {
  contractInstanceId: string;
  rateCardId?: string | null;
  title?: string | null;
  services?: string[];
  locations?: string[];
  vehicleCategories?: string[];
  validity?: string | null;
  commercialTerms?: string | null;
  specialConditions?: string | null;
}): Promise<HandoffResult> {
  const { data, error } = await db.rpc("commercial_service_handoff", {
    p: {
      contract_instance_id: input.contractInstanceId,
      rate_card_id: input.rateCardId ?? null,
      title: input.title ?? null,
      services: input.services ?? [],
      locations: input.locations ?? [],
      vehicle_categories: input.vehicleCategories ?? [],
      validity: input.validity ?? null,
      commercial_terms: input.commercialTerms ?? null,
      special_conditions: input.specialConditions ?? null,
    },
  });
  if (error) fail(error.message);
  const res = data as HandoffResult;
  return { ...res, gaps: res.gaps ?? [] };
}

/* -------------------------------- pure read ------------------------------- */

/** Whole days an approval has been waiting for a decision. */
export function approvalWaitDays(requestedAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(requestedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** Plain-language state of an approval, for badges. */
export function approvalReading(a: ApprovalRecord, now: Date = new Date()): {
  tone: "healthy" | "watch" | "risk";
  label: string;
} {
  if (a.status === "approved") return { tone: "healthy", label: "Approved" };
  if (a.status === "declined") return { tone: "risk", label: "Declined" };
  if (a.status === "withdrawn") return { tone: "watch", label: "Withdrawn" };
  const days = approvalWaitDays(a.created_at, now);
  if (days >= 3) return { tone: "risk", label: `Waiting ${days} days` };
  if (days >= 1) return { tone: "watch", label: `Waiting ${days} day${days === 1 ? "" : "s"}` };
  return { tone: "healthy", label: "Raised today" };
}

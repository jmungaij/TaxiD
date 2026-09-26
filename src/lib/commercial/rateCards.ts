/**
 * Rate-card portal — client contract for the governed price book.
 *
 * The database owns the rules: a new version starts as a draft copy, prices may
 * only be edited while the version is a draft, approval needs a second person,
 * and approving a version retires the one it replaces so exactly one card per
 * service is ever live.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type RateCardStatus = "source" | "pending_approval" | "approved" | "retired";
export type RateCardAction = "SUBMIT" | "APPROVE" | "REJECT" | "RETIRE";

export const RATE_STATUS_LABEL: Record<RateCardStatus, string> = {
  source: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Live",
  retired: "Retired",
};

export const RATE_STATUS_TONE: Record<RateCardStatus, string> = {
  source: "neutral",
  pending_approval: "warning",
  approved: "success",
  retired: "neutral",
};

export const DOMAIN_LABEL: Record<string, string> = {
  ride_hailing: "Ride hailing",
  corporate_charter: "Corporate charter",
  delivery: "Delivery",
  logistics: "Logistics",
  rentals: "Rentals",
  leasing: "Leasing",
  other: "Other",
};

export interface RateLine {
  id: string;
  rate_card_id: string;
  service_code: string | null;
  scope_label: string | null;
  category_code: string | null;
  pricing_basis: string | null;
  amount: number | null;
  currency: string | null;
  included_distance_km: number | null;
  included_distance_period: string | null;
  drive_mode: string | null;
  min_days: number | null;
  inclusion_note: string | null;
  conditions: string | null;
}

export interface RateCardEvent {
  event: string;
  status_before: string | null;
  status_after: string | null;
  note: string | null;
  sole_approver: boolean;
  created_at: string;
  actor_name: string | null;
}

export interface RateCard {
  id: string;
  code: string;
  name: string;
  product_domain: string;
  version: string;
  status: RateCardStatus;
  currency: string;
  effective_from: string | null;
  review_at: string | null;
  source_note: string | null;
  source_reference: string | null;
  provenance: string | null;
  change_reason: string | null;
  approved_at: string | null;
  retired_at: string | null;
  owner_name: string | null;
  created_by: string | null;
  line_count: number;
  lines: RateLine[];
  events: RateCardEvent[];
}

export interface RateCardPortal {
  generated_at: string;
  can_write: boolean;
  can_approve: boolean;
  kpi: {
    approved_rate_count: number;
    live_card_count: number;
    awaiting_approval: number;
    draft_count: number;
    next_review_at: string | null;
    review_overdue: number;
  };
  cards: RateCard[];
}

const REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "You do not have access to the rate-card portal.",
  RATE_CARD_NOT_FOUND: "That rate card no longer exists.",
  VERSION_REQUIRED: "Give the new version a name, for example v1.1.",
  VERSION_ALREADY_EXISTS: "That version name is already used on this card.",
  ONLY_A_DRAFT_VERSION_CAN_BE_EDITED: "Prices can only be changed while the version is a draft.",
  ONLY_A_DRAFT_VERSION_CAN_BE_SUBMITTED: "Only a draft version can be sent for approval.",
  ONLY_A_SUBMITTED_VERSION_CAN_BE_DECIDED: "Only a version awaiting approval can be approved or sent back.",
  ONLY_THE_LIVE_VERSION_CAN_BE_RETIRED: "Only the live version can be retired.",
  FOUR_EYES_REQUIRED: "You created this version, so someone else must approve it.",
  REASON_REQUIRED: "Give a reason first.",
  RATES_REQUIRED: "Add at least one rate before sending it for approval.",
  RATE_LINE_NOT_FOUND: "That rate line no longer exists.",
};

export function refusal(message: string): string {
  const hit = Object.keys(REFUSALS).find((k) => message.includes(k));
  return hit ? REFUSALS[hit] : message;
}

export async function fetchRateCardPortal(): Promise<RateCardPortal> {
  const { data, error } = await db.rpc("rate_card_portal");
  if (error) throw new Error(refusal(error.message));
  return data as RateCardPortal;
}

export async function createRateCardVersion(
  cardId: string,
  version: string,
  effectiveFrom?: string | null,
  reason?: string | null,
): Promise<string> {
  const { data, error } = await db.rpc("rate_card_version_create", {
    _card_id: cardId,
    _version: version,
    _effective_from: effectiveFrom || null,
    _reason: reason || null,
  });
  if (error) throw new Error(refusal(error.message));
  return data as string;
}

export async function saveRateLine(input: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.rpc("rate_card_line_save", { p: input });
  if (error) throw new Error(refusal(error.message));
  return data as string;
}

export async function runRateCardAction(
  cardId: string,
  action: RateCardAction,
  note?: string | null,
): Promise<{ id: string; status: RateCardStatus; sole_approver: boolean }> {
  const { data, error } = await db.rpc("rate_card_action", {
    _card_id: cardId,
    _action: action,
    _note: note || null,
  });
  if (error) throw new Error(refusal(error.message));
  return data as { id: string; status: RateCardStatus; sole_approver: boolean };
}

/**
 * Emails the managers who may approve a version once it enters review.
 * Delivery is a courtesy on top of the recorded decision, so a failure here
 * never undoes the submission — it is surfaced as a warning instead.
 */
export async function notifyRateCardReviewers(cardId: string): Promise<{ sent: number } | null> {
  const { data, error } = await supabase.functions.invoke("rate-card-review-email", {
    body: { card_id: cardId },
  });
  if (error) return null;
  return (data ?? null) as { sent: number } | null;
}

export const rate = (amount: number | null, currency = "KES") =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

/** Which actions the viewer may attempt on this version. */
export function rateCardActions(
  card: RateCard,
  ctx: { canWrite: boolean; canApprove: boolean },
): RateCardAction[] {
  if (card.status === "source") return ctx.canWrite ? ["SUBMIT"] : [];
  if (card.status === "pending_approval") return ctx.canApprove ? ["APPROVE", "REJECT"] : [];
  if (card.status === "approved") return ctx.canApprove ? ["RETIRE"] : [];
  return [];
}

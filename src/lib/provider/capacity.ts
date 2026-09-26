/**
 * PROVIDER CAPACITY — the operator side of the marketplace.
 *
 * Drivers, fleet operators, charter operators and logistics operators record
 * the capacity they can offer, submit it for approval, and see the enquiries
 * customers raise against it. Nothing is published without a staff approval,
 * and the approver may not be the operator (unless a platform administrator
 * acts alone).
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type CapacityStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "PUBLISHED"
  | "SENT_BACK"
  | "RETIRED";

export const CAPACITY_STATUS_LABEL: Record<CapacityStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  PUBLISHED: "Live in marketplace",
  SENT_BACK: "Sent back to you",
  RETIRED: "Retired",
};

export const CAPACITY_STATUS_MEANING: Record<CapacityStatus, string> = {
  DRAFT: "Only you can see this. Submit it when the details are right.",
  PENDING_APPROVAL: "With our team for review. You cannot edit it while it is under review.",
  PUBLISHED: "Customers can find and request this in the marketplace.",
  SENT_BACK: "We need a change before it can go live — see the note.",
  RETIRED: "No longer offered. It stays on record.",
};

export const PROVIDER_KINDS = [
  { key: "DRIVER", label: "Driver (my own vehicle)" },
  { key: "FLEET_OPERATOR", label: "Fleet operator" },
  { key: "CHARTER_OPERATOR", label: "Charter operator" },
  { key: "LOGISTICS_OPERATOR", label: "Logistics operator" },
] as const;

export const RATE_BASES = [
  { key: "per_trip", label: "Per trip" },
  { key: "per_hour", label: "Per hour" },
  { key: "per_day", label: "Per day" },
  { key: "per_km", label: "Per kilometre" },
  { key: "per_tonne", label: "Per tonne" },
  { key: "on_request", label: "On request" },
] as const;

export interface CapacityHistoryEntry {
  action: string;
  status_to: string | null;
  reason: string | null;
  created_at: string;
}

export interface ProviderCapacityRow {
  id: string;
  family: string;
  title: string;
  provider_name: string;
  provider_kind: string;
  vehicle_type: string;
  spec: string | null;
  seats: number | null;
  units: number;
  base_city: string;
  coverage_area: string | null;
  rate_amount: number | null;
  rate_basis: string;
  currency: string;
  available_from: string | null;
  available_to: string | null;
  registration_ref: string | null;
  notes: string | null;
  status: CapacityStatus;
  decision_reason: string | null;
  submitted_at: string | null;
  published_at: string | null;
  created_at: string;
  enquiry_count: number;
  /** Stored photo object paths for this listing (max 8). */
  photo_paths?: string[] | null;

  open_enquiries: number;
  history: CapacityHistoryEntry[];
}

export interface CapacityEnquiryRow {
  id: string;
  capacity_id: string;
  capacity_title: string;
  lead_ref: string | null;
  organisation_name: string | null;
  contact_name: string | null;
  service_date: string | null;
  passengers: number | null;
  requirement: string | null;
  status: "NEW" | "ACKNOWLEDGED" | "CLOSED";
  provider_note: string | null;
  created_at: string;
}

export interface ReviewQueueRow {
  id: string;
  family: string;
  title: string;
  provider_name: string;
  vehicle_type: string;
  seats: number | null;
  units: number;
  base_city: string;
  rate_amount: number | null;
  rate_basis: string;
  currency: string;
  submitted_at: string | null;
  is_own: boolean;
}

export interface ProviderPortal {
  accredited: boolean;
  can_approve: boolean;
  summary: {
    total: number;
    published: number;
    awaiting: number;
    drafts: number;
    retired: number;
    units_live: number;
  };
  capacity: ProviderCapacityRow[];
  enquiries: CapacityEnquiryRow[];
  awaiting_review: ReviewQueueRow[];
}

export interface CapacityDraft {
  id?: string;
  provider_name: string;
  provider_kind: string;
  family: string;
  title: string;
  vehicle_type: string;
  spec?: string;
  seats?: string;
  units?: string;
  base_city: string;
  coverage_area?: string;
  rate_amount?: string;
  rate_basis?: string;
  currency?: string;
  available_from?: string;
  available_to?: string;
  registration_ref?: string;
  notes?: string;
}

/** Refusals in the operator's own words. */
export const CAPACITY_REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in first.",
  PROVIDER_NOT_ACCREDITED:
    "Your operator record is not yet on the platform. Complete driver registration or carrier onboarding first, and once it is approved you can list capacity.",
  INCOMPLETE_CAPACITY_RECORD: "Please give the operator name, a title, the vehicle type and the base city.",
  CAPACITY_LOCKED_FOR_EDITING: "This listing is under review, so it cannot be edited right now.",
  NOT_YOUR_CAPACITY: "This listing belongs to another operator.",
  ONLY_DRAFT_CAPACITY_CAN_BE_SUBMITTED: "Only a draft or sent-back listing can be submitted.",
  CAPACITY_APPROVAL_NOT_PERMITTED: "You do not have authority to approve capacity.",
  CAPACITY_NOT_AWAITING_APPROVAL: "This listing is not waiting for a decision.",
  SEPARATE_APPROVER_REQUIRED: "Someone else must approve your own listing.",
  SEND_BACK_REASON_REQUIRED: "Please say what needs to change before sending it back.",
  RETIREMENT_REASON_REQUIRED: "Please give a reason for retiring this listing.",
  CAPACITY_ALREADY_RETIRED: "This listing is already retired.",
  CAPACITY_NOT_AVAILABLE: "That capacity is no longer available.",
  NOT_AUTHORISED_TO_RETIRE_CAPACITY: "You cannot retire this listing.",
};

export const explainRefusal = (message: string) => {
  if (message.includes("PROVIDER_DOCUMENTS_REQUIRED")) {
    const missing = (message.split("PROVIDER_DOCUMENTS_REQUIRED:")[1] ?? "")
      .split(",")
      .map((k) => DOCUMENT_LABEL[k.trim()] ?? k.trim())
      .filter(Boolean)
      .join(", ");
    return `This listing cannot go live yet — we still need a verified, in-date ${
      missing || "operator document"
    } on the operator's account.`;
  }
  return CAPACITY_REFUSAL[message] ?? message;
};

const DOCUMENT_LABEL: Record<string, string> = {
  OPERATING_LICENCE: "operating licence",
  INSURANCE: "insurance certificate",
  VEHICLE_INSPECTION: "vehicle inspection certificate",
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadProviderPortal = () => rpc<ProviderPortal>("provider_capacity_portal", {});

export const saveCapacity = (draft: CapacityDraft) =>
  rpc<{ id: string; status: CapacityStatus }>("provider_capacity_save", { p: draft });

export const submitCapacity = (id: string, note?: string) =>
  rpc<{ id: string; status: CapacityStatus }>("provider_capacity_submit", {
    _capacity_id: id,
    _note: note ?? null,
  });

export const decideCapacity = (id: string, decision: "APPROVE" | "SEND_BACK", reason?: string) =>
  rpc<{ id: string; status: CapacityStatus }>("provider_capacity_decide", {
    _capacity_id: id,
    _decision: decision,
    _reason: reason ?? null,
  });

export const retireCapacity = (id: string, reason: string) =>
  rpc<{ id: string; status: CapacityStatus }>("provider_capacity_retire", {
    _capacity_id: id,
    _reason: reason,
  });

export const updateEnquiry = (id: string, status: "ACKNOWLEDGED" | "CLOSED", note?: string) =>
  rpc<{ id: string }>("capacity_enquiry_update", {
    _enquiry_id: id,
    _status: status,
    _note: note ?? null,
  });

/** Called after a customer request is submitted against a specific listing. */
export const recordCapacityEnquiry = (p: {
  capacity_id: string;
  lead_ref?: string;
  organisation_name?: string;
  contact_name?: string;
  service_date?: string;
  passengers?: string;
  requirement?: string;
}) => rpc<{ id: string }>("capacity_enquiry_record", { p });

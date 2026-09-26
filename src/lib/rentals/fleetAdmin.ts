/**
 * RENTAL FLEET ADMINISTRATION.
 *
 * The commercial team owns the truth about the stock: which vehicles exist,
 * which rate-card class each one really belongs to, whether it is offered
 * self-drive, chauffeured or both, and whether it is available today.
 *
 * A vehicle is quotable ONLY when it is AVAILABLE and mapped to a published
 * rate-card class. Nothing here infers a class from a make or model, so a
 * vehicle can never be sold as something it is not.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type UnitStatus = "AVAILABLE" | "UNDER_SERVICE" | "RETIRED";

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  AVAILABLE: "Available",
  UNDER_SERVICE: "Under service",
  RETIRED: "Retired",
};

export interface FleetUnit {
  id: string;
  vehicle_id: string | null;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  seats: number | null;
  transmission: string | null;
  home_branch: string | null;
  asset_class: string | null;
  band_label: string | null;
  self_drive: boolean;
  chauffeur: boolean;
  status: UnitStatus;
  provenance: string;
  notes: string | null;
  created_at: string;
}

export interface UnitCommitment {
  id: string;
  unit_id: string;
  booking_id: string | null;
  start_date: string;
  end_date: string;
  source: "BOOKING" | "BLOCK" | "SERVICE";
  note: string | null;
}

export interface StaffBooking {
  id: string;
  booking_reference: string;
  unit_id: string | null;
  category: string;
  asset_class: string;
  band_label: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  company_name: string | null;
  total_kes: number;
  amount_paid_kes: number;
  currency: string;
  mpesa_receipt: string | null;
  status: string;
  picked_up_at: string | null;
  returned_at: string | null;
  change_request: string | null;
  requested_start_date: string | null;
  requested_end_date: string | null;
  change_reason: string | null;
  created_at: string;
}

/** True when this unit may be offered on a quotation. */
export const isQuotable = (u: FleetUnit) =>
  u.status === "AVAILABLE" && Boolean(u.asset_class) && Boolean(u.band_label) && (u.self_drive || u.chauffeur);

export async function listFleetUnits(): Promise<FleetUnit[]> {
  const { data, error } = await db
    .from("rental_fleet_units")
    .select("*")
    .order("status")
    .order("plate");
  if (error) throw new Error(error.message);
  return (data ?? []) as FleetUnit[];
}

export async function listCommitments(): Promise<UnitCommitment[]> {
  const { data, error } = await db
    .from("rental_unit_commitments")
    .select("id,unit_id,booking_id,start_date,end_date,source,note")
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .order("start_date");
  if (error) throw new Error(error.message);
  return (data ?? []) as UnitCommitment[];
}

export async function listStaffBookings(): Promise<StaffBooking[]> {
  const { data, error } = await db
    .from("rental_bookings")
    .select("*")
    .order("start_date", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffBooking[];
}

export interface UnitDraft {
  id?: string;
  plate: string;
  make: string;
  model: string;
  year?: string;
  seats?: string;
  transmission?: string;
  home_branch?: string;
  asset_class?: string;
  band_label?: string;
  self_drive: boolean;
  chauffeur: boolean;
  status: UnitStatus;
  notes?: string;
}

const int = (v?: string) => {
  const n = Number(v ?? "");
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

export async function saveFleetUnit(draft: UnitDraft): Promise<void> {
  const row = {
    plate: draft.plate.trim().toUpperCase(),
    make: draft.make.trim(),
    model: draft.model.trim(),
    year: int(draft.year),
    seats: int(draft.seats),
    transmission: draft.transmission?.trim() || null,
    home_branch: draft.home_branch?.trim() || null,
    asset_class: draft.asset_class?.trim().toLowerCase() || null,
    band_label: draft.band_label?.trim() || null,
    self_drive: draft.self_drive,
    chauffeur: draft.chauffeur,
    status: draft.status,
    notes: draft.notes?.trim() || null,
  };
  const query = draft.id
    ? db.from("rental_fleet_units").update(row).eq("id", draft.id)
    : db.from("rental_fleet_units").insert({ ...row, provenance: "MANUAL" });
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function setUnitStatus(id: string, status: UnitStatus): Promise<void> {
  const { error } = await db.from("rental_fleet_units").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Block a vehicle out (servicing, owner use). Refused when it clashes. */
export async function blockUnit(input: {
  unitId: string;
  startDate: string;
  endDate: string;
  source: "BLOCK" | "SERVICE";
  note?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const { error } = await db.from("rental_unit_commitments").insert({
    unit_id: input.unitId,
    start_date: input.startDate,
    end_date: input.endDate,
    source: input.source,
    note: input.note?.trim() || null,
  });
  if (!error) return { ok: true };
  if (/RENTAL_UNIT_ALREADY_COMMITTED/.test(error.message)) {
    return { ok: false, message: "That vehicle is already committed over those dates." };
  }
  return { ok: false, message: error.message };
}

export async function removeCommitment(id: string): Promise<void> {
  const { error } = await db.from("rental_unit_commitments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type StaffAction =
  | "CONFIRM_PICKUP"
  | "CONFIRM_RETURN"
  | "APPROVE_RESCHEDULE"
  | "APPROVE_CANCELLATION"
  | "DECLINE_CHANGE";

const STAFF_REFUSAL: Record<string, string> = {
  NOT_AUTHORISED: "You do not have permission to change rental bookings.",
  BOOKING_NOT_FOUND: "That booking no longer exists.",
  ONLY_A_CONFIRMED_BOOKING_CAN_BE_COLLECTED: "Only a confirmed booking can be handed over.",
  ONLY_A_COLLECTED_BOOKING_CAN_BE_RETURNED: "Confirm collection before recording the return.",
  ALLOCATE_A_VEHICLE_FIRST: "Assign a vehicle to this booking first.",
  NO_RESCHEDULE_REQUESTED: "There is no reschedule request on this booking.",
  NO_CANCELLATION_REQUESTED: "There is no cancellation request on this booking.",
  NO_CHANGE_REQUESTED: "There is no open request on this booking.",
  NO_VEHICLE_FREE_ON_THOSE_DATES: "No vehicle of this class is free on the requested dates.",
  UNKNOWN_ACTION: "That action is not recognised.",
};

export async function runStaffAction(
  bookingReference: string,
  action: StaffAction,
  note?: string,
): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await db.rpc("rental_booking_staff_action", {
    _booking_reference: bookingReference,
    _action: action,
    _note: note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  const body = (data ?? {}) as Record<string, unknown>;
  if (body.ok === true) return { ok: true };
  const code = String(body.reason_code ?? "");
  return { ok: false, message: STAFF_REFUSAL[code] ?? "We could not complete that action." };
}

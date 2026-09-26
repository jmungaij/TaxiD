/**
 * REAL RENTAL AVAILABILITY.
 *
 * Availability is never computed in the browser. `rental_fleet_availability`
 * counts the vehicles that are genuinely free for the requested window — a unit
 * must be marked AVAILABLE, mapped to a published rate-card class, offered on
 * the requested service, and free of any overlapping commitment. The function
 * returns counts by class only: no plates, no vehicle identity, no customer data.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RentalCategory } from "@/lib/marketing/rentalQuote";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface AvailableClass {
  assetClass: string;
  bandLabel: string;
  seats: number | null;
  unitsFree: number;
}

export interface RentalAvailability {
  ok: boolean;
  reasonCode?: string;
  startDate: string;
  endDate: string;
  rentalDays: number;
  classes: AvailableClass[];
  anyAvailable: boolean;
}

export const AVAILABILITY_MESSAGE: Record<string, string> = {
  UNKNOWN_CATEGORY: "We could not check availability for this service.",
  START_DATE_IN_THE_PAST: "Choose a collection date from today onwards.",
};

/** A band is identified by class + label, which is unique per class on the card. */
export const availabilityKey = (assetClass: string, bandLabel: string) =>
  `${assetClass.toLowerCase()}|${bandLabel}`;

export async function fetchRentalAvailability(
  category: RentalCategory,
  startDate: string,
  rentalDays: number,
): Promise<RentalAvailability | null> {
  const { data, error } = await db.rpc("rental_fleet_availability", {
    _category: category,
    _start_date: startDate,
    _rental_days: rentalDays,
  });
  if (error || !data) return null;

  const body = data as Record<string, unknown>;
  const rows = Array.isArray(body.classes) ? (body.classes as Record<string, unknown>[]) : [];

  return {
    ok: body.ok === true,
    reasonCode: typeof body.reason_code === "string" ? body.reason_code : undefined,
    startDate: String(body.start_date ?? startDate),
    endDate: String(body.end_date ?? startDate),
    rentalDays: Number(body.rental_days ?? rentalDays),
    anyAvailable: body.any_available === true,
    classes: rows.map((r) => ({
      assetClass: String(r.asset_class ?? ""),
      bandLabel: String(r.band_label ?? ""),
      seats: r.seats === null || r.seats === undefined ? null : Number(r.seats),
      unitsFree: Number(r.units_free ?? 0),
    })),
  };
}

/**
 * CUSTOMER RENTAL RECORDS.
 *
 * `rental_my_rentals` returns only the quotations and bookings that belong to
 * the signed-in person — matched on their user id or the email address the
 * booking was made under. Change requests are recorded, never applied: our team
 * approves a reschedule or a cancellation, and the database refuses a reschedule
 * onto dates where no vehicle of that class is actually free.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type BookingStatus =
  | "CONFIRMED"
  | "AWAITING_ALLOCATION"
  | "PICKED_UP"
  | "RETURNED"
  | "CANCELLED";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: "Confirmed",
  AWAITING_ALLOCATION: "Confirming your vehicle",
  PICKED_UP: "On rental",
  RETURNED: "Completed",
  CANCELLED: "Cancelled",
};

export interface RentalQuoteSummary {
  reference: string;
  token: string;
  category: string;
  bandLabel: string;
  startDate: string;
  endDate: string;
  rentalDays: number;
  pickupLocation: string;
  totalKes: number;
  currency: string;
  status: string;
  paymentStatus: string;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
}

export interface RentalBookingVehicle {
  make: string;
  model: string;
  year: number | null;
  transmission: string | null;
  seats: number | null;
}

export interface RentalBookingSummary {
  bookingReference: string;
  category: string;
  assetClass: string;
  bandLabel: string;
  startDate: string;
  endDate: string;
  pickupLocation: string;
  totalKes: number;
  amountPaidKes: number;
  currency: string;
  mpesaReceipt: string | null;
  status: BookingStatus;
  pickedUpAt: string | null;
  returnedAt: string | null;
  changeRequest: "RESCHEDULE" | "CANCELLATION" | null;
  changeRequestedAt: string | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  vehicle: RentalBookingVehicle | null;
  quoteToken: string | null;
  createdAt: string;
}

export interface MyRentals {
  quotes: RentalQuoteSummary[];
  bookings: RentalBookingSummary[];
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

export async function loadMyRentals(): Promise<MyRentals> {
  const { data, error } = await db.rpc("rental_my_rentals", {});
  if (error || !data || (data as Record<string, unknown>).ok !== true) {
    return { quotes: [], bookings: [] };
  }
  const body = data as Record<string, unknown>;
  const quotes = Array.isArray(body.quotes) ? (body.quotes as Record<string, unknown>[]) : [];
  const bookings = Array.isArray(body.bookings) ? (body.bookings as Record<string, unknown>[]) : [];

  return {
    quotes: quotes.map((q) => ({
      reference: str(q.reference),
      token: str(q.token),
      category: str(q.category),
      bandLabel: str(q.band_label),
      startDate: str(q.start_date),
      endDate: str(q.end_date),
      rentalDays: num(q.rental_days),
      pickupLocation: str(q.pickup_location),
      totalKes: num(q.total_kes),
      currency: str(q.currency) || "KES",
      status: str(q.status),
      paymentStatus: str(q.payment_status),
      expiresAt: str(q.expires_at),
      expired: q.expired === true,
      createdAt: str(q.created_at),
    })),
    bookings: bookings.map((b) => {
      const v = (b.vehicle ?? null) as Record<string, unknown> | null;
      return {
        bookingReference: str(b.booking_reference),
        category: str(b.category),
        assetClass: str(b.asset_class),
        bandLabel: str(b.band_label),
        startDate: str(b.start_date),
        endDate: str(b.end_date),
        pickupLocation: str(b.pickup_location),
        totalKes: num(b.total_kes),
        amountPaidKes: num(b.amount_paid_kes),
        currency: str(b.currency) || "KES",
        mpesaReceipt: (b.mpesa_receipt as string | null) ?? null,
        status: (str(b.status) || "CONFIRMED") as BookingStatus,
        pickedUpAt: (b.picked_up_at as string | null) ?? null,
        returnedAt: (b.returned_at as string | null) ?? null,
        changeRequest: (b.change_request as "RESCHEDULE" | "CANCELLATION" | null) ?? null,
        changeRequestedAt: (b.change_requested_at as string | null) ?? null,
        requestedStartDate: (b.requested_start_date as string | null) ?? null,
        requestedEndDate: (b.requested_end_date as string | null) ?? null,
        vehicle: v
          ? {
              make: str(v.make),
              model: str(v.model),
              year: v.year === null || v.year === undefined ? null : Number(v.year),
              transmission: (v.transmission as string | null) ?? null,
              seats: v.seats === null || v.seats === undefined ? null : Number(v.seats),
            }
          : null,
        quoteToken: (b.quote_token as string | null) ?? null,
        createdAt: str(b.created_at),
      };
    }),
  };
}

export const CHANGE_REFUSAL: Record<string, string> = {
  UNKNOWN_ACTION: "That is not a change we can record.",
  BOOKING_NOT_FOUND: "We could not find that booking.",
  NOT_AUTHORISED_FOR_BOOKING: "This booking is not on your account.",
  BOOKING_CLOSED: "This rental is already finished or cancelled.",
  CHANGE_ALREADY_REQUESTED: "You already have a request open on this booking.",
  NEW_DATES_REQUIRED: "Choose the new collection and return dates.",
  START_DATE_IN_THE_PAST: "Choose a collection date from today onwards.",
  RENTAL_LENGTH_MUST_MATCH:
    "Keep the same number of days. To change the length, cancel and book again so we price it correctly.",
  NO_VEHICLE_FREE_ON_THOSE_DATES: "No vehicle of this class is free on those dates.",
  CANCELLATION_REASON_REQUIRED: "Tell us briefly why you are cancelling.",
};

export type ChangeOutcome =
  | { ok: true; action: "RESCHEDULE" | "CANCELLATION" }
  | { ok: false; message: string };

export async function requestBookingChange(input: {
  bookingReference: string;
  action: "RESCHEDULE" | "CANCELLATION";
  token?: string;
  newStart?: string;
  newEnd?: string;
  reason?: string;
}): Promise<ChangeOutcome> {
  const { data, error } = await db.rpc("rental_booking_request_change", {
    _booking_reference: input.bookingReference,
    _action: input.action,
    _token: input.token ?? null,
    _new_start: input.newStart ?? null,
    _new_end: input.newEnd ?? null,
    _reason: input.reason ?? null,
  });

  if (error) return { ok: false, message: "We could not record that request. Please try again." };
  const body = (data ?? {}) as Record<string, unknown>;
  if (body.ok === true) return { ok: true, action: input.action };
  const code = String(body.reason_code ?? "");
  return { ok: false, message: CHANGE_REFUSAL[code] ?? "We could not record that request." };
}

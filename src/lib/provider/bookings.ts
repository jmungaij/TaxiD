/**
 * PROVIDER BOOKINGS — the link between a marketplace enquiry and revenue.
 *
 * An operator (or our team) turns a customer enquiry into a booking with the
 * agreed rate. Once the booking is confirmed or delivered, finance raises the
 * proforma invoice from it through the existing governed proforma engine, and
 * the issued invoice reference is recorded back against the booking. Nothing is
 * invented: no proforma is possible without a customer, dates and an agreed rate.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type BookingStatus = "REQUESTED" | "CONFIRMED" | "DELIVERED" | "CANCELLED";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  DELIVERED: "Service delivered",
  CANCELLED: "Cancelled",
};

export interface BookingHistoryEntry {
  action: string;
  status_to: string | null;
  note: string | null;
  created_at: string;
}

export interface ProviderBookingRow {
  id: string;
  booking_reference: string;
  capacity_id: string;
  capacity_title: string;
  family: string;
  provider_name: string;
  customer_company: string | null;
  customer_contact_name: string | null;
  service_from: string | null;
  service_to: string | null;
  qty: number;
  unit_rate_cents: number;
  amount_cents: number;
  currency: string;
  status: BookingStatus;
  notes: string | null;
  proforma_id: string | null;
  proforma_reference: string | null;
  invoice_id: string | null;
  invoice_reference: string | null;
  created_at: string;
  history: BookingHistoryEntry[];
}

export const BOOKING_REFUSAL: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in first.",
  CAPACITY_REQUIRED: "Choose the listing this booking is for.",
  CAPACITY_NOT_AVAILABLE: "That listing is no longer available.",
  CAPACITY_NOT_PUBLISHED: "Only a live listing can be booked.",
  NOT_YOUR_CAPACITY: "That listing belongs to another operator.",
  ENQUIRY_CAPACITY_MISMATCH: "That enquiry is for a different listing.",
  BOOKING_ALREADY_RAISED_FOR_ENQUIRY: "A booking already exists for this enquiry.",
  UNKNOWN_BOOKING: "That booking no longer exists.",
  NOT_AUTHORISED_FOR_BOOKING: "You cannot change this booking.",
  UNKNOWN_BOOKING_STATUS: "That is not a booking status we recognise.",
  BOOKING_ALREADY_CANCELLED: "This booking is already cancelled.",
  ONLY_A_REQUESTED_BOOKING_CAN_BE_CONFIRMED: "Only a requested booking can be confirmed.",
  ONLY_A_CONFIRMED_BOOKING_CAN_BE_DELIVERED: "Confirm the booking before marking it delivered.",
  CANCELLATION_REASON_REQUIRED: "Please give a reason for cancelling.",
  STAFF_RECORD_REQUIRED: "Only our commercial team can raise the proforma invoice.",
  BOOKING_NOT_BILLABLE: "Confirm the booking before raising a proforma invoice.",
  AGREED_RATE_REQUIRED: "Record the agreed rate before raising a proforma invoice.",
  CUSTOMER_COMPANY_REQUIRED: "Add the customer's company name before invoicing.",
  INVOICE_REFERENCE_REQUIRED: "Give the invoice number to record against this booking.",
};

export const explainBookingRefusal = (m: string) => BOOKING_REFUSAL[m] ?? m;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadProviderBookings = () =>
  rpc<ProviderBookingRow[]>("provider_bookings_list", {}).then((r) => r ?? []);

export interface NewBooking {
  capacity_id?: string;
  enquiry_id?: string;
  customer_company?: string;
  customer_contact_name?: string;
  customer_email?: string;
  customer_phone?: string;
  service_from?: string;
  service_to?: string;
  qty?: string;
  /** Agreed rate in whole currency units; converted to cents here. */
  unit_rate?: string;
  currency?: string;
  notes?: string;
}

export function createBooking(b: NewBooking) {
  const rate = Number(b.unit_rate ?? "0");
  return rpc<{ ok: boolean; id: string; booking_reference: string }>("provider_booking_create", {
    p: {
      capacity_id: b.capacity_id ?? "",
      enquiry_id: b.enquiry_id ?? "",
      customer_company: b.customer_company ?? "",
      customer_contact_name: b.customer_contact_name ?? "",
      customer_email: b.customer_email ?? "",
      customer_phone: b.customer_phone ?? "",
      service_from: b.service_from ?? "",
      service_to: b.service_to ?? "",
      qty: b.qty ?? "1",
      unit_rate_cents: String(Math.round((Number.isFinite(rate) ? rate : 0) * 100)),
      currency: b.currency ?? "KES",
      notes: b.notes ?? "",
    },
  });
}

export const setBookingStatus = (
  id: string,
  status: "CONFIRMED" | "DELIVERED" | "CANCELLED",
  note?: string,
) =>
  rpc<{ ok: boolean; status: BookingStatus }>("provider_booking_set_status", {
    _booking_id: id,
    _status: status,
    _note: note ?? null,
  });

export const bookingToProforma = (id: string) =>
  rpc<{ ok: boolean; proforma_id: string }>("provider_booking_to_proforma", { _booking_id: id });

export const linkBookingInvoice = (id: string, reference: string, invoiceId?: string) =>
  rpc<{ ok: boolean }>("provider_booking_link_invoice", {
    _booking_id: id,
    _invoice_id: invoiceId ?? null,
    _invoice_reference: reference,
  });

export const bookingMoney = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

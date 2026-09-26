/**
 * Client transport for public rental quotations.
 *
 * The browser never prices a rental. It submits the requested vehicle class,
 * dates and distance; the `rental-quote` function prices the request from the
 * administrator's published rate card and returns a stored quotation with a
 * reference and a private link. Payment is confirmed only from the verified
 * M-Pesa ledger — this module cannot mark anything paid.
 */
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

const FN = "rental-quote";

export type RentalCategory = "SELF_DRIVE" | "CHAUFFEUR";

export interface RentalQuoteInput {
  category: RentalCategory;
  assetClass: string;
  bandLabel: string;
  seats: number | null;
  startDate: string;
  rentalDays: number;
  extraHours: number;
  expectedKm: number;
  pickupLocation: string;
  notes?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName?: string;
  sourcePage?: string;
  website?: string;
}

export interface RentalQuoteReceipt {
  reference: string;
  token: string;
  totalKes: number;
  currency: string;
  expiresAt: string;
  rateCardVersion: number;
}

export type RentalQuoteOutcome =
  | { ok: true; receipt: RentalQuoteReceipt }
  | { ok: false; error: string; message: string; fields?: Record<string, string> };

export interface RentalQuoteLine {
  code: string;
  label: string;
  amount_kes: number;
}

export interface RentalBookingLink {
  bookingReference: string;
  status: string;
  startDate: string;
  endDate: string;
  pickedUpAt: string | null;
  returnedAt: string | null;
  changeRequest: string | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  vehicle: { make: string; model: string; year: number | null; transmission: string | null; seats: number | null } | null;
}

export interface RentalQuoteView {
  reference: string;
  category: RentalCategory;
  assetClass: string;
  bandLabel: string;
  seats: number | null;
  pricingVersion: number;
  lines: RentalQuoteLine[];
  includedKmTotal: number;
  startDate: string;
  endDate: string;
  rentalDays: number;
  extraHours: number;
  expectedKm: number;
  pickupLocation: string;
  notes: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName: string | null;
  baseKes: number;
  extraHoursKes: number;
  excessKmKes: number;
  vatKes: number;
  totalKes: number;
  currency: string;
  status: string;
  paymentStatus: "pending" | "paid";
  amountPaidKes: number;
  mpesaReceipt: string | null;
  paidAt: string | null;
  expiresAt: string;
  expired: boolean;
  /** Present once payment was verified and a vehicle reserved. */
  booking: RentalBookingLink | null;
  createdAt: string;
}

async function detail(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) return await error.context.text().catch(() => error.message);
  return error instanceof Error ? error.message : String(error);
}

function parse(raw: string): { error: string; message: string; fields?: Record<string, string> } {
  try {
    const body = JSON.parse(raw) as { error?: string; message?: string; fields?: Record<string, string> };
    return {
      error: body.error ?? "request_failed",
      message: body.message ?? "We could not price this request. Please try again.",
      fields: body.fields,
    };
  } catch {
    return { error: "request_failed", message: "We could not price this request. Please try again." };
  }
}

/** Ask the server to price and record a rental quotation. */
export async function createRentalQuote(input: RentalQuoteInput): Promise<RentalQuoteOutcome> {
  const { data, error } = await supabase.functions.invoke(FN, {
    body: {
      action: "create",
      category: input.category,
      asset_class: input.assetClass,
      band_label: input.bandLabel,
      seats: input.seats ?? undefined,
      start_date: input.startDate,
      rental_days: input.rentalDays,
      extra_hours: input.extraHours,
      expected_km: input.expectedKm,
      pickup_location: input.pickupLocation,
      notes: input.notes ?? null,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      company_name: input.companyName ?? null,
      source_page: input.sourcePage ?? null,
      website: input.website ?? "",
    },
  });

  if (error) return { ok: false, ...parse(await detail(error)) };

  const body = data as {
    created?: boolean;
    reference?: string;
    token?: string;
    total_kes?: number;
    currency?: string;
    expires_at?: string;
    rate_card_version?: number;
    message?: string;
  };

  if (!body?.created || !body.reference || !body.token) {
    return { ok: false, error: "quote_not_recorded", message: body?.message ?? "We could not record this quotation." };
  }

  return {
    ok: true,
    receipt: {
      reference: body.reference,
      token: body.token,
      totalKes: Number(body.total_kes ?? 0),
      currency: body.currency ?? "KES",
      expiresAt: String(body.expires_at ?? ""),
      rateCardVersion: Number(body.rate_card_version ?? 0),
    },
  };
}

/** Open one quotation with its private link token. */
export async function openRentalQuote(token: string): Promise<RentalQuoteView | null> {
  const { data, error } = await supabase.rpc("rental_quote_open", { _token: token });
  if (error || !data) return null;
  const q = data as Record<string, unknown>;
  if (q.found !== true) return null;

  const snapshot = (q.pricing_snapshot ?? {}) as { lines?: RentalQuoteLine[]; included_km_total?: number };
  const num = (v: unknown) => Number(v ?? 0);

  return {
    reference: String(q.reference),
    category: String(q.category) as RentalCategory,
    assetClass: String(q.asset_class),
    bandLabel: String(q.band_label),
    seats: q.seats === null || q.seats === undefined ? null : Number(q.seats),
    pricingVersion: num(q.pricing_version),
    lines: Array.isArray(snapshot.lines) ? snapshot.lines : [],
    includedKmTotal: Number(snapshot.included_km_total ?? 0),
    startDate: String(q.start_date),
    endDate: String(q.end_date),
    rentalDays: num(q.rental_days),
    extraHours: num(q.extra_hours),
    expectedKm: num(q.expected_km),
    pickupLocation: String(q.pickup_location ?? ""),
    notes: (q.notes as string | null) ?? null,
    contactName: String(q.contact_name ?? ""),
    contactEmail: String(q.contact_email ?? ""),
    contactPhone: String(q.contact_phone ?? ""),
    companyName: (q.company_name as string | null) ?? null,
    baseKes: num(q.base_kes),
    extraHoursKes: num(q.extra_hours_kes),
    excessKmKes: num(q.excess_km_kes),
    vatKes: num(q.vat_kes),
    totalKes: num(q.total_kes),
    currency: String(q.currency ?? "KES"),
    status: String(q.status ?? "QUOTED"),
    paymentStatus: q.payment_status === "paid" ? "paid" : "pending",
    amountPaidKes: num(q.amount_paid_kes),
    mpesaReceipt: (q.mpesa_receipt as string | null) ?? null,
    paidAt: (q.paid_at as string | null) ?? null,
    expiresAt: String(q.expires_at ?? ""),
    expired: q.expired === true,
    booking: readBooking(q.booking),
    createdAt: String(q.created_at ?? ""),
  };
}

function readBooking(raw: unknown): RentalBookingLink | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (!b.booking_reference) return null;
  const v = (b.vehicle ?? null) as Record<string, unknown> | null;
  return {
    bookingReference: String(b.booking_reference),
    status: String(b.status ?? "CONFIRMED"),
    startDate: String(b.start_date ?? ""),
    endDate: String(b.end_date ?? ""),
    pickedUpAt: (b.picked_up_at as string | null) ?? null,
    returnedAt: (b.returned_at as string | null) ?? null,
    changeRequest: (b.change_request as string | null) ?? null,
    requestedStartDate: (b.requested_start_date as string | null) ?? null,
    requestedEndDate: (b.requested_end_date as string | null) ?? null,
    vehicle: v
      ? {
          make: String(v.make ?? ""),
          model: String(v.model ?? ""),
          year: v.year === null || v.year === undefined ? null : Number(v.year),
          transmission: (v.transmission as string | null) ?? null,
          seats: v.seats === null || v.seats === undefined ? null : Number(v.seats),
        }
      : null,
  };
}

export type SettlementOutcome =
  | {
      settled: true;
      reasonCode: string;
      amountPaidKes?: number;
      mpesaReceipt?: string | null;
      bookingReference?: string | null;
      bookingStatus?: string | null;
    }
  | { settled: false; reasonCode: string; message: string };

const SETTLEMENT_MESSAGE: Record<string, string> = {
  NO_VERIFIED_PAYMENT:
    "We have not received your M-Pesa payment yet. If you have just paid, wait a moment and check again — M-Pesa can take up to a minute to confirm.",
  AMOUNT_SHORTFALL: "The amount received is less than the quoted total. Pay the balance and check again.",
  QUOTE_NOT_FOUND: "We could not find this quotation.",
  INVALID_REFERENCE: "This quotation reference is not valid.",
  SETTLEMENT_FAILED: "We could not check your payment just now. Please try again shortly.",
};

/**
 * Ask the server to match this quotation against the verified M-Pesa ledger.
 * A quote becomes CONFIRMED only when Safaricom's own callback recorded a
 * successful payment for its reference and full amount.
 */
export async function confirmRentalPayment(reference: string): Promise<SettlementOutcome> {
  const { data, error } = await supabase.functions.invoke(FN, {
    body: { action: "settle", reference },
  });

  if (error) {
    const raw = await detail(error);
    let code = "SETTLEMENT_FAILED";
    try {
      code = String((JSON.parse(raw) as { reason_code?: string }).reason_code ?? code);
    } catch {
      /* keep the generic code */
    }
    return { settled: false, reasonCode: code, message: SETTLEMENT_MESSAGE[code] ?? SETTLEMENT_MESSAGE.SETTLEMENT_FAILED };
  }

  const body = data as {
    settled?: boolean;
    reason_code?: string;
    amount_paid_kes?: number;
    mpesa_receipt?: string | null;
    booking_reference?: string | null;
    booking_status?: string | null;
  };
  const code = String(body?.reason_code ?? "SETTLEMENT_FAILED");
  if (body?.settled) {
    return {
      settled: true,
      reasonCode: code,
      amountPaidKes: body.amount_paid_kes === undefined ? undefined : Number(body.amount_paid_kes),
      mpesaReceipt: body.mpesa_receipt ?? null,
      bookingReference: body.booking_reference ?? null,
      bookingStatus: body.booking_status ?? null,
    };
  }
  return { settled: false, reasonCode: code, message: SETTLEMENT_MESSAGE[code] ?? SETTLEMENT_MESSAGE.SETTLEMENT_FAILED };
}

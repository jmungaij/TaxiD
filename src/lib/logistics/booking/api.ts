/**
 * Logistics booking client — thin transport over the authoritative functions.
 *
 * The browser NEVER prices, classifies goods or decides eligibility. It sends
 * shipment facts to `logistics-quote` / `logistics-book` and renders what the
 * server decided. `logistics-track` is public and returns redacted data.
 */
import { supabase } from "@/integrations/supabase/client";
import { mapLogisticsError, type MappedLogisticsError } from "@/lib/logistics/errorContract";
import { newCorrelationId, recordDiagnostic } from "@/lib/runtime/diagnostics";

/**
 * Availability decisions are produced by the server-side serviceability engine.
 * The legacy PILOT_ONLY/ENABLED/DISABLED codes remain in the union so older
 * cached responses still narrow correctly.
 */
export type ServiceAvailability =
  | "BOOKABLE"
  | "LIMITED"
  | "ENQUIRY_ONLY"
  | "CONFIGURATION_REQUIRED"
  | "SUSPENDED"
  | "UNAVAILABLE"
  | "ENABLED"
  | "PILOT_ONLY"
  | "DISABLED";
export type PackageType = "DOCUMENT" | "SMALL_PARCEL" | "PARCEL" | "PALLET" | "BULK" | "TEMPERATURE_CONTROLLED";
export type DistanceBand = "UNDER_5" | "KM_5_15" | "KM_15_30" | "OVER_30";
export type PaymentMethod = "MPESA" | "CORPORATE_ACCOUNT" | "INVOICE" | "CARD";

export interface CatalogueOffering {
  code: string;
  name: string;
  family: string;
  route: string;
  availability: ServiceAvailability;
  /**
   * Server's answer to "may this caller book online?". PILOT_ONLY offerings are
   * bookable only by enrolled pilot accounts, so the wizard must use this flag
   * rather than inferring bookability from `availability`. Older responses omit
   * it; `fetchServiceCatalogue` then derives the conservative ENABLED-only rule.
   */
  selfServiceBookable: boolean;
  /** Pilot access is a test channel, reported separately from global availability. */
  pilotOnly?: boolean;
  pilotAllowedForThisAccount?: boolean;
  enquiryAvailable?: boolean;
  /** Machine-readable reason the offering cannot be booked by this caller. */
  unavailableReason?: string | null;
  unavailableMessage?: string | null;
  segments: string[];
  allowedPackageTypes: PackageType[];
  weightLimitKg: { min: number; max: number };
  dimensionLimitCm: { maxLongestSide: number; maxGirth: number } | null;
  dimensionsRequired: boolean;
  declaredValueRequired: boolean;
  specialHandling: string[];
  slaQualifier: string;
  deliveryTargetHours: number | null;
  pickupTargetMinutes: number | null;
  podRequired: string[];
}

export interface GoodsDecision {
  decision: "ALLOW" | "ALLOW_WITH_CONDITIONS" | "MANUAL_REVIEW" | "REFUSE";
  klass: string;
  message: string;
  conditions: string[];
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  messages: string[];
  requiresManualReview: boolean;
  goods: GoodsDecision;
}

export interface PriceLine {
  code: string;
  label: string;
  kind: string;
  basis: string;
  amount_kes: number;
}

export interface QuoteSnapshot {
  rate_plan_id: string;
  rate_plan_version: number;
  pricing_version: string;
  inputs: Record<string, unknown>;
  lines: PriceLine[];
  base_amount_kes: number;
  surcharges_kes: number;
  tax_kes: number;
  quoted_amount_kes: number;
  currency: "KES";
  captured_at: string;
  expires_at?: string;
  snapshot_hash: string;
}

export interface QuoteResponse {
  quotable: boolean;
  eligibility: Eligibility;
  offering?: {
    code: string;
    name: string;
    availability: ServiceAvailability;
    slaQualifier: string;
    deliveryTargetHours: number | null;
    pickupTargetMinutes: number | null;
    podRequired: string[];
  };
  snapshot?: QuoteSnapshot;
  error?: string;
  message?: string;
}

export interface ShipmentFacts {
  offering_code: string;
  package_type: PackageType;
  weight_kg: number;
  package_count: number;
  dimensions_cm?: { l: number; w: number; h: number } | null;
  declared_value_kes?: number | null;
  goods_code?: string | null;
  handling?: string[];
  distance_band?: DistanceBand | null;
  pickup?: { lat: number; lng: number } | null;
  dropoff?: { lat: number; lng: number } | null;
}

export interface BookingRequest extends ShipmentFacts {
  goods_description?: string | null;
  pickup_details: { address: string; contact_name: string; contact_phone: string; lat?: number | null; lng?: number | null };
  dropoff_details: { address: string; contact_name: string; contact_phone: string; lat?: number | null; lng?: number | null };
  pickup_window_start?: string | null;
  payment_method: PaymentMethod;
  corporate_account_id?: string | null;
  notes?: string | null;
  idempotency_key: string;
  quoted_amount_kes: number;
}

export interface BookingResult {
  duplicate: boolean;
  order: { id: string; order_number: string; total_amount: number; status: string; payment_status: string; sla_deadline?: string };
  packages: { id: string; tracking_number: string; status: string }[];
  dispatch: { id: string; status: string } | null;
  compliance_hold: boolean;
  compliance_message: string | null;
  payment: { method: PaymentMethod; status: string; amount_kes: number; reference: string };
  quote_snapshot: QuoteSnapshot;
  correlation_id: string;
}

export interface TrackingResult {
  found: boolean;
  tracking_number?: string;
  service?: string;
  status?: string;
  recipient?: string | null;
  origin?: string | null;
  destination?: string | null;
  weight_kg?: number | null;
  booked_at?: string;
  collected_at?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
  order_reference?: string | null;
  sla_target?: string | null;
  sla_qualifier?: string;
  milestones?: { code: string; label: string; reached: boolean; at: string | null }[];
  events?: { code: string; note: string | null; at: string }[];
  proof_of_delivery_available?: boolean;
  proof_of_delivery_access?: string;
  message?: string;
  error?: string;
}

async function readError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      return await ctx.text();
    } catch {
      /* fall through */
    }
  }
  return (error as { message?: string })?.message ?? "request_failed";
}

/** Server-owned catalogue. Availability is never decided in the browser. */
export async function fetchServiceCatalogue(): Promise<CatalogueOffering[]> {
  const { data, error } = await supabase.functions.invoke("logistics-quote", { method: "GET" });
  if (error) throw new Error(await readError(error));
  const offerings = (data?.offerings ?? []) as Array<Partial<CatalogueOffering> & { availability: ServiceAvailability }>;
  return offerings.map((o) => ({
    ...(o as CatalogueOffering),
    selfServiceBookable:
      typeof o.selfServiceBookable === "boolean"
        ? o.selfServiceBookable
        : o.availability === "BOOKABLE" || o.availability === "ENABLED",

  }));
}

export async function requestQuote(facts: ShipmentFacts): Promise<QuoteResponse> {
  const { data, error } = await supabase.functions.invoke("logistics-quote", { body: facts });
  if (error) {
    const raw = await readError(error);
    try {
      return JSON.parse(raw) as QuoteResponse;
    } catch {
      throw new Error(raw);
    }
  }
  return data as QuoteResponse;
}

export type BookingOutcome =
  | { ok: true; result: BookingResult }
  | {
      ok: false;
      code: string;
      message: string;
      fields?: Record<string, string>;
      eligibility?: Eligibility;
      repriced_amount_kes?: number;
      /** Canonical interpretation — customer copy and operator facts in one object. */
      mapped: MappedLogisticsError;
    };

export async function createBooking(req: BookingRequest): Promise<BookingOutcome> {
  const body = {
    offering_code: req.offering_code,
    package_type: req.package_type,
    weight_kg: req.weight_kg,
    package_count: req.package_count,
    dimensions_cm: req.dimensions_cm ?? null,
    declared_value_kes: req.declared_value_kes ?? null,
    goods_code: req.goods_code ?? null,
    goods_description: req.goods_description ?? null,
    handling: req.handling ?? [],
    distance_band: req.distance_band ?? null,
    pickup: { ...req.pickup_details, lat: req.pickup_details.lat ?? req.pickup?.lat ?? null, lng: req.pickup_details.lng ?? req.pickup?.lng ?? null },
    dropoff: { ...req.dropoff_details, lat: req.dropoff_details.lat ?? req.dropoff?.lat ?? null, lng: req.dropoff_details.lng ?? req.dropoff?.lng ?? null },
    pickup_window_start: req.pickup_window_start ?? null,
    payment_method: req.payment_method,
    corporate_account_id: req.corporate_account_id ?? null,
    notes: req.notes ?? null,
    idempotency_key: req.idempotency_key,
    quoted_amount_kes: req.quoted_amount_kes,
  };

  // Correlation id is minted client-side and echoed by the function, so a single
  // booking is traceable UI → API → database → payment → dispatch.
  const correlationId = newCorrelationId();

  const { data, error } = await supabase.functions.invoke("logistics-book", {
    body: { ...body, correlation_id: correlationId },
    headers: {
      "Idempotency-Key": req.idempotency_key,
      "X-Correlation-ID": correlationId,
      "X-Request-ID": correlationId,
    },
  });

  if (error) {
    const raw = await readError(error);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = { message: raw.slice(0, 200) };
    }
    const mapped = mapLogisticsError(parsed, {
      operation: "BOOK",
      service: req.offering_code,
      correlationId,
    });
    recordDiagnostic({
      category: "BOOKING",
      severity: mapped.isBusinessRefusal ? "WARNING" : "ERROR",
      operation: "logistics_book_refused",
      message: mapped.envelope.message,
      service: req.offering_code,
      correlationId: mapped.envelope.correlation_id,
      errorCode: mapped.envelope.code,
      metadata: { reason: mapped.envelope.reason, details: mapped.envelope.details ?? {} },
    });
    return {
      ok: false,
      code: mapped.envelope.code,
      message: mapped.customer.detail,
      fields: mapped.envelope.fields,
      eligibility: (mapped.envelope.details?.eligibility as Eligibility) ?? undefined,
      repriced_amount_kes: (parsed.repriced_amount_kes as number) ?? undefined,
      mapped,
    };
  }
  return { ok: true, result: data as BookingResult };
}


export async function trackShipment(trackingNumber: string): Promise<TrackingResult> {
  const { data, error } = await supabase.functions.invoke("logistics-track", {
    body: { tracking_number: trackingNumber },
  });
  if (error) {
    const raw = await readError(error);
    try {
      return JSON.parse(raw) as TrackingResult;
    } catch {
      return { found: false, message: "Tracking is temporarily unavailable. Please try again shortly." };
    }
  }
  return data as TrackingResult;
}

/** Stable idempotency key for one booking attempt. */
export function bookingIdempotencyKey(seed: string): string {
  return `lbk_${seed}_${Date.now().toString(36)}`;
}

/** Customer-facing goods options, kept in sync with the server catalogue. */
export const GOODS_OPTIONS: { code: string; label: string }[] = [
  { code: "documents", label: "Documents and paperwork" },
  { code: "clothing", label: "Clothing and textiles" },
  { code: "books", label: "Books and printed matter" },
  { code: "general_merchandise", label: "General merchandise" },
  { code: "spare_parts", label: "Spare parts and hardware" },
  { code: "electronics", label: "Consumer electronics" },
  { code: "high_value_electronics", label: "High-value electronics" },
  { code: "perishable_food", label: "Perishable food" },
  { code: "batteries_lithium", label: "Lithium batteries" },
  { code: "pharmaceuticals", label: "Pharmaceuticals" },
  { code: "other", label: "Something else" },
];

export const DISTANCE_BAND_OPTIONS: { code: DistanceBand; label: string }[] = [
  { code: "UNDER_5", label: "Under 5 km" },
  { code: "KM_5_15", label: "5 – 15 km" },
  { code: "KM_15_30", label: "15 – 30 km" },
  { code: "OVER_30", label: "Over 30 km (metro edge)" },
];

/**
 * Ask the backend to settle this booking against the verified payment ledger.
 * The browser never asserts payment; it only requests a re-check and renders
 * whatever the server confirms.
 */
export interface SettlementResult {
  settled: boolean;
  reason_code: string;
  message: string;
}

export async function settleBookingPayment(
  orderNumber: string,
  checkoutRequestId: string | null,
): Promise<SettlementResult> {
  const { data, error } = await supabase.functions.invoke("logistics-payment-settle", {
    body: { order_number: orderNumber, checkout_request_id: checkoutRequestId },
  });
  if (error) {
    const raw = await readError(error);
    try {
      return JSON.parse(raw) as SettlementResult;
    } catch {
      return {
        settled: false,
        reason_code: "SETTLEMENT_UNAVAILABLE",
        message: "We could not confirm your payment just now — our team will reconcile it shortly.",
      };
    }
  }
  return data as SettlementResult;
}

/** Proof-of-delivery payload. Artefact links are short-lived signed URLs. */
export interface PodResult {
  available: boolean;
  tracking_number?: string;
  recipient_name?: string | null;
  otp_verified?: boolean;
  notes?: string | null;
  captured_at?: string | null;
  delivered_at?: string | null;
  signature_url?: string | null;
  photo_url?: string | null;
  integrity_hash?: string | null;
  expires_in_seconds?: number;
  message?: string;
  error?: string;
}

/** Retrieve proof of delivery. Authorisation is enforced entirely server-side. */
export async function fetchProofOfDelivery(trackingNumber: string): Promise<PodResult> {
  const { data, error } = await supabase.functions.invoke("logistics-pod", {
    body: { tracking_number: trackingNumber },
  });
  if (error) {
    const raw = await readError(error);
    try {
      return JSON.parse(raw) as PodResult;
    } catch {
      return { available: false, error: "pod_unavailable", message: "Proof of delivery could not be retrieved right now." };
    }
  }
  return data as PodResult;
}

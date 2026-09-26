import { supabase } from "@/integrations/supabase/client";
import type { SalesLead } from "./pipeline";

/**
 * Sales-side bridge into the existing freight engine.
 *
 * No pricing, no capacity and no dispatch logic lives here. The specialist's
 * movement request is priced by the `freight-quote` function, converted by
 * `freight_quotation_accept` and dispatched by `freight_selfbook_dispatch` —
 * exactly the same path a customer self-booking takes. The only sales-specific
 * step is attaching the resulting order to the lead.
 */

export const VEHICLE_CLASSES = ["TRUCK_3T", "TRUCK_7T", "TRUCK_14T", "TRUCK_28T"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_CLASS_LABEL: Record<VehicleClass, string> = {
  TRUCK_3T: "3 tonne truck",
  TRUCK_7T: "7 tonne truck",
  TRUCK_14T: "14 tonne truck",
  TRUCK_28T: "28 tonne truck",
};

export const CARGO_TYPES = [
  "GENERAL",
  "PALLETISED",
  "CONTAINERISED",
  "BULK",
  "REFRIGERATED",
  "FRAGILE",
  "HAZARDOUS",
  "OVERSIZED",
  "DOCUMENTS",
] as const;
export type CargoType = (typeof CARGO_TYPES)[number];

export const DISTANCE_BANDS = ["INTRA_CITY", "REGIONAL", "LONG_HAUL"] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export interface MovementRequest {
  originLabel: string;
  destinationLabel: string;
  /**
   * Collection / delivery coordinates. The dispatch matcher measures every
   * vehicle's base against the collection point and refuses anything outside
   * its operating radius, so a movement booked without coordinates can never
   * be matched to capacity (ROUTE_MISMATCH). They are therefore required.
   */
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  vehicleClass: VehicleClass;
  cargoType: CargoType;
  grossWeightKg: number;
  pieces: number;
  volumeCbm?: number;
  declaredValueKes?: number;
  distanceKm?: number;
  distanceBand?: DistanceBand;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  shipperName?: string;
  shipperPhone?: string;
  notes?: string;
}


export interface QuoteResult {
  quotable: boolean;
  code?: string;
  message?: string;
  quote_id?: string;
  quote_number?: string;
  total_amount?: number;
  base_amount?: number;
  surcharges_amount?: number;
  tax_amount?: number;
  currency?: string;
  valid_until?: string;
  distance_km?: number;
  lines?: Array<{ code?: string; label?: string; amount_kes?: number }>;
  inputs?: Record<string, unknown>;
}

function fail(payload: unknown, fallback: string): never {
  const p = (payload ?? {}) as Record<string, unknown>;
  const message =
    (typeof p.message === "string" && p.message) ||
    (typeof p.code === "string" && p.code) ||
    fallback;
  throw new Error(message);
}

/** Price the movement. Never invents a price: an unpriceable route is refused. */
export async function quoteMovement(req: MovementRequest): Promise<QuoteResult> {
  const body = {
    origin: { label: req.originLabel, lat: req.originLat, lng: req.originLng },
    destination: {
      label: req.destinationLabel,
      lat: req.destinationLat,
      lng: req.destinationLng,
    },
    vehicle_class: req.vehicleClass,
    distance_km: req.distanceKm ?? null,
    distance_band: req.distanceKm ? null : (req.distanceBand ?? null),
    cargo: {
      cargo_type: req.cargoType,
      gross_weight_kg: req.grossWeightKg,
      pieces: req.pieces,
      volume_cbm: req.volumeCbm ?? 0,
      declared_value: req.declaredValueKes ?? 0,
      service_level: "STANDARD",
      shipper_name: req.shipperName ?? null,
      shipper_phone: req.shipperPhone ?? null,
      notes: req.notes ?? null,
    },
    items: [],
    planned_legs: [
      {
        leg_type: "LINE_HAUL",
        origin_kind: "ADDRESS",
        origin_label: req.originLabel,
        origin_lat: req.originLat,
        origin_lng: req.originLng,
        destination_kind: "ADDRESS",
        destination_label: req.destinationLabel,
        destination_lat: req.destinationLat,
        destination_lng: req.destinationLng,
        planned_distance_km: req.distanceKm ?? null,
      },
    ],
  };


  const { data, error } = await supabase.functions.invoke("freight-quote", { body });
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context?.body;
    if (ctx) fail(ctx, error.message);
    throw new Error(error.message);
  }
  const result = data as QuoteResult & { error?: boolean };
  if (result?.error || result?.quotable === false) return { ...result, quotable: false };
  return result;
}

export interface BookingResult {
  quote_number: string;
  order_id: string;
  order_number: string;
  consignment_number?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  dispatch_request_id?: string | null;
  request_number?: string | null;
  matching_status?: string | null;
  match_message?: string | null;
}

/**
 * Convert a priced quote into a live booking, request capacity and attach the
 * order to the lead. Each step is the platform's own authoritative function.
 */
export async function bookQuotedMovement(args: {
  leadId: string;
  quoteId: string;
  quoteNumber: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
}): Promise<BookingResult> {
  const { data: accepted, error: acceptError } = await supabase.rpc("freight_quotation_accept", {
    _quote_id: args.quoteId,
    _pickup_window_start: args.pickupWindowStart,
    _pickup_window_end: args.pickupWindowEnd,
    _idempotency_key: `sales-${args.leadId}-${args.quoteId}`,
  });
  if (acceptError) throw new Error(acceptError.message);
  const acc = accepted as Record<string, unknown>;
  if (acc?.error) fail(acc, "The quote could not be converted into a booking.");

  const orderId = String(acc.order_id ?? "");
  const orderNumber = String(acc.order_number ?? "");

  const { data: dispatched, error: dispatchError } = await supabase.rpc(
    "freight_selfbook_dispatch",
    {
      _order_id: orderId,
      _idempotency_key: `sales-dsp-${args.leadId}-${orderId}`,
      _pickup_window_start: args.pickupWindowStart,
      _pickup_window_end: args.pickupWindowEnd,
    },
  );
  if (dispatchError) throw new Error(dispatchError.message);
  const dsp = (dispatched ?? {}) as Record<string, unknown>;
  if (dsp.error) fail(dsp, "Capacity could not be requested for this booking.");

  const { data: attached, error: attachError } = await supabase.rpc("sales_lead_attach_booking", {
    p: { lead_id: args.leadId, order_id: orderId, booking_ref: orderNumber },
  });
  if (attachError) throw new Error(attachError.message);
  const att = (attached ?? {}) as Record<string, unknown>;
  if (att.error) fail(att, "The booking was created but could not be attached to the lead.");

  const match = (dsp.match ?? {}) as Record<string, unknown>;

  return {
    quote_number: args.quoteNumber,
    order_id: orderId,
    order_number: orderNumber,
    consignment_number: (acc.consignment_number as string) ?? null,
    total_amount: (acc.total_amount as number) ?? null,
    currency: (acc.currency as string) ?? null,
    dispatch_request_id: (dsp.dispatch_request_id as string) ?? null,
    request_number: (dsp.request_number as string) ?? null,
    matching_status: (match.matching_status as string) ?? (dsp.status as string) ?? null,
    match_message: (match.message as string) ?? null,
  };
}

/** Convenience: price then book in one action. */
export async function bookMovementForLead(
  lead: SalesLead,
  req: MovementRequest,
): Promise<BookingResult> {
  const quote = await quoteMovement(req);
  if (!quote.quotable || !quote.quote_id) {
    fail(quote, "This movement cannot be priced from the published tariff.");
  }
  return bookQuotedMovement({
    leadId: lead.id,
    quoteId: quote.quote_id,
    quoteNumber: quote.quote_number ?? "",
    pickupWindowStart: req.pickupWindowStart,
    pickupWindowEnd: req.pickupWindowEnd,
  });
}

/* ------------------------------------------------------------------ */
/* Fulfilment readout: order → leg → dispatch → proof of delivery      */
/* ------------------------------------------------------------------ */

export interface FulfilmentState {
  order_id: string;
  order_number: string;
  order_status: string;
  payment_status: string | null;
  total_amount: number | null;
  currency: string | null;
  legs: Array<{
    id: string;
    leg_no: number;
    status: string;
    origin_label: string | null;
    destination_label: string | null;
    actual_departure: string | null;
    actual_arrival: string | null;
  }>;
  dispatch: Array<{
    id: string;
    request_number: string;
    status: string;
    matching_status: string | null;
  }>;
  pod: Array<{
    id: string;
    submission_reference: string;
    state: string;
    delivered_at: string | null;
    created_at: string;
  }>;
}

export async function fetchFulfilment(orderId: string): Promise<FulfilmentState | null> {
  const [order, legs, dispatch] = await Promise.all([
    supabase
      .from("delivery_orders")
      .select("id, order_number, status, payment_status, total_amount, currency")
      .eq("id", orderId)
      .maybeSingle(),
    supabase
      .from("logistics_order_legs")
      .select("id, leg_no, status, origin_label, destination_label, actual_departure, actual_arrival")
      .eq("order_id", orderId)
      .order("leg_no"),
    supabase
      .from("logistics_dispatch_requests")
      .select("id, request_number, status, matching_status")
      .eq("order_id", orderId)
      .order("created_at"),
  ]);

  if (order.error) throw new Error(order.error.message);
  if (!order.data) return null;

  const legIds = (legs.data ?? []).map((l) => l.id);
  let pod: FulfilmentState["pod"] = [];
  if (legIds.length > 0) {
    const { data } = await supabase
      .from("carrier_pod_submissions")
      .select("id, submission_reference, state, delivered_at, created_at")
      .in("leg_id", legIds)
      .order("created_at", { ascending: false });
    pod = (data ?? []) as FulfilmentState["pod"];
  }

  return {
    order_id: order.data.id,
    order_number: order.data.order_number,
    order_status: order.data.status,
    payment_status: order.data.payment_status ?? null,
    total_amount: order.data.total_amount ?? null,
    currency: order.data.currency ?? null,
    legs: (legs.data ?? []) as FulfilmentState["legs"],
    dispatch: (dispatch.data ?? []) as FulfilmentState["dispatch"],
    pod,
  };
}

/* ------------------------------------------------------------------ */
/* Service provider claims → invoices → payments                       */
/* ------------------------------------------------------------------ */

export interface ServiceProviderClaim {
  id: string;
  claim_ref: string;
  carrier_id: string;
  order_id: string | null;
  leg_id: string | null;
  pod_submission_id: string | null;
  sales_lead_id: string | null;
  customer_label: string | null;
  service_date: string | null;
  origin_label: string | null;
  destination_label: string | null;
  service_description: string | null;
  claimed_amount_kes: number | null;
  approved_amount_kes: number | null;
  currency: string | null;
  declaration_name: string | null;
  state: string;
  review_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface ServiceProviderInvoice {
  id: string;
  invoice_ref: string;
  claim_id: string;
  carrier_id: string;
  order_id: string | null;
  amount_kes: number | null;
  currency: string | null;
  state: string;
  issued_at: string | null;
}

export async function listClaims(leadId?: string): Promise<ServiceProviderClaim[]> {
  let q = supabase
    .from("service_provider_claims")
    .select(
      "id, claim_ref, carrier_id, order_id, leg_id, pod_submission_id, sales_lead_id, customer_label, service_date, origin_label, destination_label, service_description, claimed_amount_kes, approved_amount_kes, currency, declaration_name, state, review_notes, submitted_at, reviewed_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (leadId) q = q.eq("sales_lead_id", leadId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceProviderClaim[];
}

export async function listClaimInvoices(claimIds: string[]): Promise<ServiceProviderInvoice[]> {
  if (claimIds.length === 0) return [];
  const { data, error } = await supabase
    .from("service_provider_invoices")
    .select("id, invoice_ref, claim_id, carrier_id, order_id, amount_kes, currency, state, issued_at")
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceProviderInvoice[];
}

export async function reviewClaim(args: {
  claimId: string;
  action: "OPEN_REVIEW" | "QUERY" | "REJECT" | "APPROVE";
  notes?: string;
  approvedAmountKes?: number;
}) {
  const { data, error } = await supabase.rpc("service_provider_claim_review", {
    p: {
      claim_id: args.claimId,
      action: args.action,
      review_notes: args.notes ?? null,
      approved_amount_kes: args.approvedAmountKes ?? null,
    },
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) fail(res, "The claim decision was not accepted.");
  return res;
}

export async function issueClaimInvoice(claimId: string) {
  const { data, error } = await supabase.rpc("service_provider_invoice_issue", {
    p: { claim_id: claimId },
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) fail(res, "The invoice was not issued.");
  return res;
}

export interface ClaimablePod {
  id: string;
  submission_reference: string;
  leg_id: string;
  order_id: string | null;
  delivered_at: string | null;
  recipient_name: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
}

/** Approved delivery evidence for this fleet owner that has no live claim yet. */
export async function listClaimablePods(carrierId: string): Promise<ClaimablePod[]> {
  const pods = await supabase
    .from("carrier_pod_submissions")
    .select("id, submission_reference, leg_id, order_id, delivered_at, recipient_name")
    .eq("carrier_id", carrierId)
    .eq("state", "APPROVED")
    .order("delivered_at", { ascending: false })
    .limit(100);
  if (pods.error) throw new Error(pods.error.message);
  const rows = (pods.data ?? []) as ClaimablePod[];
  if (rows.length === 0) return [];

  const claimed = await supabase
    .from("service_provider_claims")
    .select("pod_submission_id, state")
    .in("pod_submission_id", rows.map((r) => r.id));
  if (claimed.error) throw new Error(claimed.error.message);
  const blocked = new Set(
    (claimed.data ?? [])
      .filter((c) => c.state !== "REJECTED")
      .map((c) => c.pod_submission_id as string),
  );

  const legs = await supabase
    .from("logistics_order_legs")
    .select("id, origin_label, destination_label")
    .in("id", rows.map((r) => r.leg_id));
  const labels = new Map((legs.data ?? []).map((l) => [l.id as string, l]));

  return rows
    .filter((r) => !blocked.has(r.id))
    .map((r) => ({
      ...r,
      origin_label: labels.get(r.leg_id)?.origin_label ?? null,
      destination_label: labels.get(r.leg_id)?.destination_label ?? null,
    }));
}

export async function submitClaim(args: {
  carrierId: string;
  podSubmissionId: string;
  serviceDescription: string;
  claimedAmountKes: number;
  declarationName: string;
  supportingDocuments?: Record<string, string>[];
}) {
  const { data, error } = await supabase.rpc("service_provider_claim_submit", {
    p: {
      carrier_id: args.carrierId,
      pod_submission_id: args.podSubmissionId,
      service_description: args.serviceDescription,
      claimed_amount_kes: args.claimedAmountKes,
      declaration_name: args.declarationName,
      supporting_documents: args.supportingDocuments ?? [],
    },
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) fail(res, "The claim was not accepted.");
  return res;
}

export interface ServiceProviderPayment {
  id: string;
  payment_ref: string;
  invoice_id: string;
  claim_id: string;
  amount_kes: number | null;
  currency: string | null;
  method: string | null;
  state: string;
  msisdn_snapshot: string | null;
  provider_reference: string | null;
  authorised_at: string | null;
  paid_at: string | null;
  failure_reason: string | null;
}

export async function listClaimPayments(claimIds: string[]): Promise<ServiceProviderPayment[]> {
  if (claimIds.length === 0) return [];
  const { data, error } = await supabase
    .from("service_provider_payments")
    .select(
      "id, payment_ref, invoice_id, claim_id, amount_kes, currency, method, state, msisdn_snapshot, provider_reference, authorised_at, paid_at, failure_reason",
    )
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceProviderPayment[];
}

export async function authoriseClaimPayment(invoiceId: string, idempotencyKey: string) {
  const { data, error } = await supabase.rpc("service_provider_payment_authorise", {
    p: { invoice_id: invoiceId, idempotency_key: idempotencyKey },
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) fail(res, "The payment was not authorised.");
  return res;
}

export async function recordClaimPaymentEvidence(args: {
  paymentId: string;
  providerReference: string;
  providerPayload: Record<string, unknown>;
}) {
  const { data, error } = await supabase.rpc("service_provider_payment_record_evidence", {
    p: {
      payment_id: args.paymentId,
      provider_reference: args.providerReference,
      provider_payload: args.providerPayload as never,
    },
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.error) fail(res, "The payment evidence was not accepted.");
  return res;
}

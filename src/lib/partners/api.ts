/**
 * YALLA PARTNERS — data access layer.
 *
 * Yalla Partners is the demand & distribution layer on top of the existing
 * execution engine (dispatch, charter, logistics, rental). A partner sells or
 * arranges mobility for its OWN customers; Yalla fulfils it.
 *
 * Every read and write below is RLS-scoped server-side:
 *   • partner team members reach only their own partner's rows
 *     (`public.is_partner_member`),
 *   • Yalla staff reach every partner (`public.yp_is_staff`).
 * Nothing in this module is an authorization boundary — it is the query
 * surface the UI is allowed to ask for.
 */
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ types */

export type PartnerType =
  | "TOUR_OPERATOR" | "DMC" | "TRAVEL_AGENCY" | "HOTEL" | "AIRLINE" | "AIR_CHARTER"
  | "CORPORATE" | "EVENT" | "ECOMMERCE" | "RETAIL" | "COURIER" | "LOGISTICS"
  | "NGO" | "SCHOOL" | "GOVERNMENT" | "TRAVEL_PLATFORM" | "OTHER";

export type PartnerStatus = "draft" | "pending" | "active" | "suspended" | "terminated";
export type PartnerVerification = "unverified" | "in_review" | "verified" | "rejected" | "expired";
export type CommercialModel = "REFER" | "BOOK" | "EMBED" | "API" | "WHITE_LABEL" | "ORCHESTRATE";
export type CommissionModel =
  | "NET_RATE" | "MARKUP" | "COMMISSION" | "REVENUE_SHARE" | "FIXED_FEE"
  | "TIERED_RATE" | "CONTRACT_RATE" | "CUSTOM";

export type ServiceType =
  | "RIDE" | "CHARTER" | "DELIVERY" | "LOGISTICS" | "AIR_CHARTER" | "MARINE"
  | "RENTAL" | "LEASING" | "MULTI_SERVICE";

export type OrderStatus =
  | "DRAFT" | "QUOTE_REQUESTED" | "QUOTED" | "CUSTOMER_APPROVAL" | "PAYMENT_PENDING"
  | "CONFIRMED" | "ALLOCATING" | "ASSIGNED" | "EN_ROUTE" | "IN_SERVICE" | "COMPLETED"
  | "RECONCILING" | "SETTLED" | "CANCELLED" | "FAILED" | "REASSIGNMENT_REQUIRED"
  | "SUPPLIER_NO_SHOW" | "CUSTOMER_NO_SHOW" | "DISPUTED" | "REFUNDED";

export interface Partner {
  id: string;
  partner_code: string;
  legal_name: string;
  trading_name: string | null;
  partner_type: PartnerType;
  status: PartnerStatus;
  verification_status: PartnerVerification;
  commercial_model: CommercialModel;
  commission_model: CommissionModel;
  partner_margin_pct: number;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  country: string;
  city: string | null;
  api_access: boolean;
  white_label: boolean;
  risk_score: number;
  trust_score: number;
  is_demo: boolean;
  created_at: string;
}

export interface PartnerCustomer {
  id: string;
  partner_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_reference: string | null;
  organisation: string | null;
  accessibility_needs: string | null;
  lifetime_spend: number;
  outstanding_balance: number;
  created_at: string;
}

export interface MobilityOrder {
  id: string;
  order_code: string;
  partner_id: string | null;
  partner_customer_id: string | null;
  journey_id: string | null;
  leg_index: number;
  service_type: ServiceType;
  status: OrderStatus;
  pickup_label: string | null;
  destination_label: string | null;
  scheduled_at: string | null;
  passengers: number;
  vehicle_class: string | null;
  service_level: string | null;
  supplier_cost: number;
  yalla_margin: number;
  partner_margin: number;
  taxes: number;
  fees: number;
  customer_price: number;
  currency: string;
  special_requirements: string | null;
  created_at: string;
}

export interface Journey {
  id: string;
  journey_code: string;
  partner_id: string;
  partner_customer_id: string | null;
  title: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  passengers: number;
  supplier_cost_total: number;
  partner_margin_total: number;
  customer_price_total: number;
  currency: string;
  created_at: string;
}

export interface CapacityRequest {
  id: string;
  request_code: string;
  partner_id: string;
  service_type: ServiceType;
  origin_label: string;
  destination_label: string | null;
  needed_at: string | null;
  passengers: number | null;
  vehicle_class: string | null;
  service_level: string | null;
  budget_amount: number | null;
  currency: string;
  requirements: string | null;
  status: string;
  created_at: string;
}

export interface PartnerApplication {
  id: string;
  reference: string;
  organisation_name: string;
  partner_type: PartnerType;
  category: string | null;
  commercial_model: CommercialModel;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  city: string | null;
  website: string | null;
  monthly_volume_estimate: number | null;
  requirements: string | null;
  status: string;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface PartnerEvent {
  id: string;
  partner_id: string;
  event_type: string;
  title: string;
  detail: string | null;
  severity: string;
  created_at: string;
}

export interface PartnerMembership {
  partner_id: string;
  partner_role: "owner" | "admin" | "agent" | "finance" | "viewer";
  partner: Partner;
}

/* ------------------------------------------------------------- vocabulary */

export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = {
  TOUR_OPERATOR: "Tour operator",
  DMC: "Destination management company",
  TRAVEL_AGENCY: "Travel agency",
  HOTEL: "Hotel / lodge",
  AIRLINE: "Airline",
  AIR_CHARTER: "Air charter operator",
  CORPORATE: "Corporate",
  EVENT: "Event organiser",
  ECOMMERCE: "E-commerce",
  RETAIL: "Retail / distribution",
  COURIER: "Courier",
  LOGISTICS: "Logistics / freight",
  NGO: "NGO / development",
  SCHOOL: "School / institution",
  GOVERNMENT: "Government",
  TRAVEL_PLATFORM: "Travel platform / OTA",
  OTHER: "Other",
};

export const COMMERCIAL_MODEL_LABEL: Record<CommercialModel, string> = {
  REFER: "Refer — send the customer to Yalla",
  BOOK: "Book — arrange on the customer's behalf",
  EMBED: "Embed — Yalla inside your product",
  API: "API — programmatic booking",
  WHITE_LABEL: "White label — your brand, our engine",
  ORCHESTRATE: "Orchestrate — multi-service journeys",
};

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  RIDE: "Ride",
  CHARTER: "Charter",
  DELIVERY: "Delivery",
  LOGISTICS: "Logistics",
  AIR_CHARTER: "Air charter",
  MARINE: "Marine",
  RENTAL: "Rental",
  LEASING: "Leasing",
  MULTI_SERVICE: "Multi-service",
};

/** Order lifecycle in execution order — used by timelines and progress rails. */
export const ORDER_LIFECYCLE: OrderStatus[] = [
  "DRAFT", "QUOTE_REQUESTED", "QUOTED", "CUSTOMER_APPROVAL", "PAYMENT_PENDING",
  "CONFIRMED", "ALLOCATING", "ASSIGNED", "EN_ROUTE", "IN_SERVICE", "COMPLETED",
  "RECONCILING", "SETTLED",
];

export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "QUOTE_REQUESTED", "QUOTED", "CUSTOMER_APPROVAL", "PAYMENT_PENDING", "CONFIRMED",
  "ALLOCATING", "ASSIGNED", "EN_ROUTE", "IN_SERVICE",
];

export const EXCEPTION_ORDER_STATUSES: OrderStatus[] = [
  "FAILED", "REASSIGNMENT_REQUIRED", "SUPPLIER_NO_SHOW", "CUSTOMER_NO_SHOW", "DISPUTED",
];

export const kes = (n: number) =>
  `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Math.round(n || 0))}`;

export function partnerName(p: Pick<Partner, "legal_name" | "trading_name">): string {
  return p.trading_name?.trim() || p.legal_name;
}

/* ------------------------------------------------------------------ reads */

/** Partner memberships of the signed-in login (drives the partner portal). */
export async function fetchMyPartnerships(userId: string): Promise<PartnerMembership[]> {
  const { data, error } = await supabase
    .from("partner_users")
    .select("partner_id, partner_role, partners:partner_id(*)")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.partners)
    .map((r) => ({
      partner_id: r.partner_id as string,
      partner_role: r.partner_role as PartnerMembership["partner_role"],
      partner: r.partners as unknown as Partner,
    }));
}

export async function fetchPartners(): Promise<Partner[]> {
  const { data, error } = await supabase
    .from("partners")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Partner[];
}

export async function fetchPartner(partnerId: string): Promise<Partner | null> {
  const { data, error } = await supabase.from("partners").select("*").eq("id", partnerId).maybeSingle();
  if (error) throw error;
  return (data as unknown as Partner) ?? null;
}

export async function fetchPartnerCustomers(partnerId: string): Promise<PartnerCustomer[]> {
  const { data, error } = await supabase
    .from("partner_customers")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PartnerCustomer[];
}

export async function fetchPartnerOrders(partnerId: string, limit = 200): Promise<MobilityOrder[]> {
  const { data, error } = await supabase
    .from("mobility_orders")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MobilityOrder[];
}

export async function fetchAllOrders(limit = 500): Promise<MobilityOrder[]> {
  const { data, error } = await supabase
    .from("mobility_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MobilityOrder[];
}

export async function fetchPartnerJourneys(partnerId: string): Promise<Journey[]> {
  const { data, error } = await supabase
    .from("journeys")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Journey[];
}

export async function fetchCapacityRequests(partnerId?: string): Promise<CapacityRequest[]> {
  let q = supabase.from("capacity_requests").select("*").order("created_at", { ascending: false });
  if (partnerId) q = q.eq("partner_id", partnerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CapacityRequest[];
}

export async function fetchPartnerApplications(): Promise<PartnerApplication[]> {
  const { data, error } = await supabase
    .from("partner_applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PartnerApplication[];
}

export async function fetchPartnerEvents(partnerId: string): Promise<PartnerEvent[]> {
  const { data, error } = await supabase
    .from("partner_events")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as PartnerEvent[];
}

/* ----------------------------------------------------------------- writes */

export interface PartnerApplicationInput {
  organisation_name: string;
  partner_type: PartnerType;
  commercial_model: CommercialModel;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  city?: string;
  website?: string;
  monthly_volume_estimate?: number | null;
  requirements?: string;
}

/**
 * ONE canonical input contract for the public partner application.
 *
 * These bounds mirror the database ingestion contract exactly
 * (partner_application_submit + the partner_applications insert policy), so a
 * form that passes here is accepted by the database and a form that fails here
 * never reaches it. Changing a bound means changing both together.
 */
export const PARTNER_APPLICATION_LIMITS = {
  organisation_name: { min: 2, max: 200 },
  contact_name: { min: 2, max: 150 },
  contact_email: { max: 254 },
  contact_phone: { min: 7, max: 30 },
  country: { min: 2, max: 100 },
  city: { max: 120 },
  website: { max: 500 },
  category: { max: 120 },
  requirements: { max: 5000 },
  intent_bring: { max: 2000 },
  network_category: { max: 120 },
  maturity_level: { max: 60 },
  lifecycle_stage: { max: 60 },
  ab_variant: { max: 60 },
  session_id: { max: 128 },
} as const;

/** Same structure the database enforces — no looser, no stricter. */
export const PARTNER_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

const squash = (v: string) => v.replace(/\s+/g, " ").trim();

/** Field-level validation shared by the public form and its tests. */
export function validatePartnerApplication(input: Partial<PartnerApplicationInput>): Record<string, string> {
  const L = PARTNER_APPLICATION_LIMITS;
  const errors: Record<string, string> = {};
  const org = input.organisation_name?.trim() ?? "";
  const name = input.contact_name?.trim() ?? "";
  const email = input.contact_email?.trim() ?? "";
  const phone = squash(input.contact_phone ?? "");
  const country = (input.country ?? "").trim() || "KE";

  if (!org) errors.organisation_name = "Organisation name is required.";
  else if (org.length < L.organisation_name.min) errors.organisation_name = "Use at least 2 characters.";
  else if (org.length > L.organisation_name.max) errors.organisation_name = "Use 200 characters or fewer.";

  if (!name) errors.contact_name = "Contact name is required.";
  else if (name.length < L.contact_name.min) errors.contact_name = "Use at least 2 characters.";
  else if (name.length > L.contact_name.max) errors.contact_name = "Use 150 characters or fewer.";

  if (!email) errors.contact_email = "Work email is required.";
  else if (email.length > L.contact_email.max) errors.contact_email = "This email address is too long.";
  else if (!PARTNER_EMAIL_PATTERN.test(email)) errors.contact_email = "Enter a valid work email address.";

  if (!phone) errors.contact_phone = "Phone number is required.";
  else if (phone.length < L.contact_phone.min) errors.contact_phone = "Enter at least 7 characters.";
  else if (phone.length > L.contact_phone.max) errors.contact_phone = "Use 30 characters or fewer.";

  if (country.length < L.country.min || country.length > L.country.max)
    errors.country = "Select a valid country.";

  if ((input.city?.trim().length ?? 0) > L.city.max) errors.city = "Use 120 characters or fewer.";
  if ((input.website?.trim().length ?? 0) > L.website.max) errors.website = "This address is too long.";
  if ((input.requirements?.trim().length ?? 0) > L.requirements.max)
    errors.requirements = "Use 5000 characters or fewer.";
  if (input.monthly_volume_estimate != null &&
      (!Number.isFinite(input.monthly_volume_estimate) || input.monthly_volume_estimate < 0 ||
       input.monthly_volume_estimate > 10_000_000))
    errors.monthly_volume_estimate = "Enter a realistic monthly volume.";

  return errors;
}

/**
 * Context the public partner experience carries into the application: what the
 * visitor said they bring, the ecosystem category and maturity level they chose,
 * the lifecycle stage they were reading and the messaging arm they were shown.
 * It is persisted on the application and on the partner intent profile, so the
 * partner desk sees the same context the visitor selected.
 *
 * Every value here is UNTRUSTED — several are derived from the query string —
 * so each one is trimmed and capped to its contract maximum before submission.
 */
export interface PartnerApplicationContext {
  intent_bring?: string | null;
  network_category?: string | null;
  maturity_level?: string | null;
  lifecycle_stage?: string | null;
  ab_variant?: string | null;
  session_id?: string | null;
}

/** Trim, collapse whitespace and cap a context value; empty becomes null. */
export function boundedContextValue(value: string | null | undefined, max: number): string | null {
  const cleaned = squash(value ?? "");
  return cleaned ? cleaned.slice(0, max) : null;
}

/** Field-name -> human message for the refusal codes the server returns. */
const SERVER_FIELD_MESSAGE: Record<string, string> = {
  organisation_name: "Check the organisation name.",
  contact_name: "Check the contact name.",
  contact_email: "Check the work email address.",
  contact_phone: "Check the phone number.",
  country: "Check the country.",
  partner_type: "Choose the kind of organisation you are.",
  commercial_model: "Choose how you want to work with us.",
};

export class PartnerApplicationError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "PartnerApplicationError";
    this.field = field;
  }
}

export async function submitPartnerApplication(
  input: PartnerApplicationInput,
  context: PartnerApplicationContext = {},
): Promise<{ reference: string; id: string }> {
  const L = PARTNER_APPLICATION_LIMITS;
  const { data, error } = await supabase.rpc("partner_application_submit", {
    p: {
      organisation_name: input.organisation_name.trim(),
      partner_type: input.partner_type,
      commercial_model: input.commercial_model,
      contact_name: input.contact_name.trim(),
      contact_email: input.contact_email.trim().toLowerCase(),
      contact_phone: squash(input.contact_phone),
      country: (input.country || "KE").trim(),
      city: boundedContextValue(input.city, L.city.max),
      website: boundedContextValue(input.website, L.website.max),
      monthly_volume_estimate: input.monthly_volume_estimate ?? null,
      requirements: input.requirements?.trim().slice(0, L.requirements.max) || null,
      intent_bring: boundedContextValue(context.intent_bring, L.intent_bring.max),
      network_category: boundedContextValue(context.network_category, L.network_category.max),
      maturity_level: boundedContextValue(context.maturity_level, L.maturity_level.max),
      lifecycle_stage: boundedContextValue(context.lifecycle_stage, L.lifecycle_stage.max),
      ab_variant: boundedContextValue(context.ab_variant, L.ab_variant.max),
      session_id: boundedContextValue(context.session_id, L.session_id.max),
    },
  } as never);

  if (error) {
    // Never surface Postgres/RLS text to a public visitor; log for developers.
    console.error("[partner-application] submission transport failure", error.message);
    throw new PartnerApplicationError("Your application could not be submitted. Please try again.");
  }
  const result = (data ?? {}) as { ok?: boolean; error?: boolean; code?: string; field?: string; id?: string; reference?: string };
  if (result.error || !result.ok) {
    console.error("[partner-application] refused", result.code, result.field);
    const field = result.field;
    throw new PartnerApplicationError(
      (field && SERVER_FIELD_MESSAGE[field]) ||
        "Your application could not be submitted. Please check your details and try again.",
      field,
    );
  }
  const saved = { reference: result.reference as string, id: result.id as string };

  /**
   * Email the saved lead to the logistics/partnerships inbox. The notifier reads
   * the persisted row server-side, so the visitor cannot influence recipients or
   * content, and a delivery failure never fails the submission the candidate
   * already completed — the record is safely stored either way.
   */
  void supabase.functions
    .invoke("partner-application-notify", { body: { application_id: saved.id } })
    .catch((e) => console.error("[partner-application] lead notification failed", (e as Error).message));

  return saved;
}


export async function createPartnerCustomer(
  partnerId: string,
  input: { full_name: string; phone?: string; email?: string; organisation?: string; customer_reference?: string; accessibility_needs?: string },
): Promise<PartnerCustomer> {
  const { data, error } = await supabase
    .from("partner_customers")
    .insert({
      partner_id: partnerId,
      full_name: input.full_name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      organisation: input.organisation?.trim() || null,
      customer_reference: input.customer_reference?.trim() || null,
      accessibility_needs: input.accessibility_needs?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as PartnerCustomer;
}

export interface OrderDraft {
  partner_customer_id: string | null;
  service_type: ServiceType;
  pickup_label: string;
  destination_label?: string;
  scheduled_at?: string | null;
  passengers: number;
  vehicle_class?: string;
  service_level?: string;
  supplier_cost: number;
  special_requirements?: string;
}

/**
 * Commercial arithmetic for a partner-booked order.
 *
 * Supplier cost is the money Yalla owes the executing supplier. The partner
 * margin comes from the partner's contracted percentage; VAT is applied on the
 * customer-facing amount. No figure is invented: everything derives from the
 * supplier cost and the partner's own contracted margin.
 */
export const VAT_RATE = 0.16;

export function priceOrder(supplierCost: number, partnerMarginPct: number, yallaMarginPct = 15) {
  const cost = Math.max(0, Number(supplierCost) || 0);
  const yallaMargin = (cost * yallaMarginPct) / 100;
  const net = cost + yallaMargin;
  const partnerMargin = (net * Math.max(0, partnerMarginPct)) / 100;
  const taxable = net + partnerMargin;
  const taxes = taxable * VAT_RATE;
  return {
    supplierCost: cost,
    yallaMargin,
    partnerMargin,
    taxes,
    customerPrice: taxable + taxes,
  };
}

export async function createPartnerOrder(
  partner: Pick<Partner, "id" | "partner_margin_pct">,
  draft: OrderDraft,
): Promise<MobilityOrder> {
  const priced = priceOrder(draft.supplier_cost, Number(partner.partner_margin_pct) || 0);
  const { data, error } = await supabase
    .from("mobility_orders")
    .insert({
      partner_id: partner.id,
      partner_customer_id: draft.partner_customer_id,
      service_type: draft.service_type,
      status: "QUOTE_REQUESTED",
      pickup_label: draft.pickup_label.trim(),
      destination_label: draft.destination_label?.trim() || null,
      scheduled_at: draft.scheduled_at || null,
      passengers: draft.passengers,
      vehicle_class: draft.vehicle_class?.trim() || null,
      service_level: draft.service_level?.trim() || null,
      supplier_cost: priced.supplierCost,
      yalla_margin: priced.yallaMargin,
      partner_margin: priced.partnerMargin,
      taxes: priced.taxes,
      customer_price: priced.customerPrice,
      special_requirements: draft.special_requirements?.trim() || null,
      idempotency_key: `${partner.id}:${draft.partner_customer_id ?? "adhoc"}:${draft.pickup_label}:${draft.scheduled_at ?? ""}:${draft.supplier_cost}`,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as MobilityOrder;
}

export async function createCapacityRequest(
  partnerId: string,
  input: { service_type: ServiceType; origin_label: string; destination_label?: string; needed_at?: string | null; passengers?: number | null; vehicle_class?: string; service_level?: string; budget_amount?: number | null; requirements?: string },
): Promise<CapacityRequest> {
  const { data, error } = await supabase
    .from("capacity_requests")
    .insert({
      partner_id: partnerId,
      service_type: input.service_type,
      origin_label: input.origin_label.trim(),
      destination_label: input.destination_label?.trim() || null,
      needed_at: input.needed_at || null,
      passengers: input.passengers ?? null,
      vehicle_class: input.vehicle_class?.trim() || null,
      service_level: input.service_level?.trim() || null,
      budget_amount: input.budget_amount ?? null,
      requirements: input.requirements?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as CapacityRequest;
}

/* ------------------------------------------------------ staff-side writes */

export async function reviewPartnerApplication(
  id: string,
  decision: "approved" | "rejected" | "in_review",
  notes: string,
): Promise<void> {
  const { data: session } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("partner_applications")
    .update({
      status: decision,
      review_notes: notes.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.user?.id ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function setPartnerStatus(
  id: string,
  patch: { status?: PartnerStatus; verification_status?: PartnerVerification },
): Promise<void> {
  const { error } = await supabase.from("partners").update(patch).eq("id", id);
  if (error) throw error;
}

/* ---------------------------------------------------------------- metrics */

export interface PartnerMetrics {
  orders: number;
  openOrders: number;
  completed: number;
  exceptions: number;
  grossValue: number;
  partnerEarnings: number;
  yallaMargin: number;
  onTimeRate: number | null;
}

/**
 * Aggregate a set of orders. Rates that cannot be evidenced return null rather
 * than a flattering placeholder.
 */
export function summariseOrders(orders: readonly MobilityOrder[]): PartnerMetrics {
  const open = orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status));
  const completed = orders.filter((o) => o.status === "COMPLETED" || o.status === "SETTLED");
  const exceptions = orders.filter((o) => EXCEPTION_ORDER_STATUSES.includes(o.status));
  const closed = completed.length + exceptions.length;
  return {
    orders: orders.length,
    openOrders: open.length,
    completed: completed.length,
    exceptions: exceptions.length,
    grossValue: orders.reduce((s, o) => s + Number(o.customer_price || 0), 0),
    partnerEarnings: orders.reduce((s, o) => s + Number(o.partner_margin || 0), 0),
    yallaMargin: orders.reduce((s, o) => s + Number(o.yalla_margin || 0), 0),
    onTimeRate: closed === 0 ? null : Math.round((completed.length / closed) * 100),
  };
}

/** Orders grouped by service line, largest first. */
export function ordersByService(orders: readonly MobilityOrder[]): Array<{ service: ServiceType; count: number; value: number }> {
  const map = new Map<ServiceType, { count: number; value: number }>();
  for (const o of orders) {
    const cur = map.get(o.service_type) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(o.customer_price || 0);
    map.set(o.service_type, cur);
  }
  return [...map.entries()]
    .map(([service, v]) => ({ service, ...v }))
    .sort((a, b) => b.value - a.value);
}

/**
 * PHASE 5 — freight procurement & carrier capacity client API.
 *
 * Nothing in this module decides anything. Compliance verdicts, capacity
 * matching, bid scores, awards, reservations and state transitions are all
 * computed by database operations; this file only calls them and types the
 * result. There is no client-side pricing, no client-side eligibility and no
 * optimistic capacity arithmetic.
 */
import { supabase } from "@/integrations/supabase/client";

export type CarrierOperatingStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "OFFBOARDED";
export type CarrierContractStatus = "NONE" | "DRAFT" | "SIGNED" | "EXPIRED" | "TERMINATED";
export type ComplianceItemState =
  | "MISSING" | "PENDING_REVIEW" | "VERIFIED" | "EXPIRED" | "REJECTED" | "LEGAL_REVIEW_REQUIRED";
export type CapacityAvailabilityState = "CONFIGURED" | "AVAILABLE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";
export type CapacityReservationState =
  | "ACTIVE" | "COMMITTED" | "CONSUMED" | "RELEASED" | "EXPIRED" | "CANCELLED";
export type RequirementState =
  | "DRAFT" | "SUBMITTED" | "SOURCING" | "AWARDED" | "BOOKED" | "FULFILLED" | "CANCELLED";
export type TenderState =
  | "DRAFT" | "OPEN" | "INVITED" | "RESPONSES_RECEIVED" | "EVALUATION" | "AWARDED" | "CANCELLED" | "EXPIRED";
export type QuoteState =
  | "DRAFT" | "SUBMITTED" | "SUPERSEDED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED";
export type InvitationState = "INVITED" | "VIEWED" | "RESPONDED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";
export type BookingState =
  | "CREATED" | "CARRIER_ASSIGNED" | "RESOURCED" | "DISPATCHED" | "EXECUTING" | "COMPLETED" | "CANCELLED" | "FAILED";
export type PricingBasis =
  | "PER_SHIPMENT" | "PER_PACKAGE" | "PER_KG" | "PER_KM" | "PER_TRIP" | "PER_LOAD"
  | "PER_PALLET" | "PER_CONTAINER" | "CONTRACT_RATE";

/** The eight operational states every Phase 5 capability distinguishes. */
export const OPERATIONAL_STATES = [
  "CONFIGURED", "AVAILABLE", "RESERVED", "COMMITTED", "CONSUMED", "EXPIRED", "CANCELLED", "FAILED",
] as const;
export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export const PRICING_BASES: { basis: PricingBasis; label: string; unit: string }[] = [
  { basis: "PER_SHIPMENT", label: "Per shipment", unit: "shipment" },
  { basis: "PER_PACKAGE", label: "Per package", unit: "package" },
  { basis: "PER_KG", label: "Per kilogram", unit: "kg" },
  { basis: "PER_KM", label: "Per kilometre", unit: "km" },
  { basis: "PER_TRIP", label: "Per trip", unit: "trip" },
  { basis: "PER_LOAD", label: "Per load", unit: "load" },
  { basis: "PER_PALLET", label: "Per pallet", unit: "pallet" },
  { basis: "PER_CONTAINER", label: "Per container", unit: "container" },
  { basis: "CONTRACT_RATE", label: "Contract rate", unit: "contract" },
];

export const COMPLIANCE_REQUIREMENTS: { code: string; label: string; category: string }[] = [
  { code: "TRANSPORT_LICENCE", label: "Transport / TLB licence", category: "LICENCE" },
  { code: "GOODS_IN_TRANSIT_PROTECTION", label: "Goods-in-transit protection", category: "PROTECTION" },
  { code: "MOTOR_PROTECTION", label: "Commercial motor protection", category: "PROTECTION" },
  { code: "TAX_COMPLIANCE", label: "Tax compliance certificate", category: "TAX" },
  { code: "SIGNED_CONTRACT", label: "Signed carriage contract", category: "CONTRACT" },
  { code: "VEHICLE_INSPECTION", label: "Vehicle inspection certificate", category: "VEHICLE" },
];

/* ------------------------------------------------------------------ rows */

export interface CarrierProfileRow {
  id: string;
  partner_id: string;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: CarrierOperatingStatus;
  service_categories: string[];
  corridors: string[];
  operating_countries: string[];
  regions: string[];
  ops_contact_name: string | null;
  ops_contact_email: string | null;
  ops_contact_phone: string | null;
  payment_terms_days: number;
  settlement_currency: string;
  tax_identifier: string | null;
  contract_status: CarrierContractStatus;
  contract_reference: string | null;
  effective_from: string | null;
  effective_until: string | null;
  created_at: string;
}

export interface CapabilityRow {
  id: string;
  carrier_id: string;
  vehicle_type: string;
  vehicle_class: string | null;
  max_payload_kg: number;
  max_volume_cbm: number | null;
  temperature_controlled: boolean;
  refrigerated: boolean;
  hazmat_capable: boolean;
  hazmat_authority_reference: string | null;
  fragile_capable: boolean;
  high_value_capable: boolean;
  oversized_capable: boolean;
  container_capable: boolean;
  cross_border_capable: boolean;
  warehouse_capable: boolean;
  last_mile_capable: boolean;
  line_haul_capable: boolean;
  special_handling: string[];
  equipment: string[];
  units_declared: number;
}

export interface ComplianceItemRow {
  id: string;
  carrier_id: string;
  requirement_code: string;
  requirement_label: string;
  category: string;
  is_mandatory: boolean;
  state: ComplianceItemState;
  reference_number: string | null;
  issuing_authority: string | null;
  issued_on: string | null;
  expires_on: string | null;
  legal_review_reason: string | null;
  reviewed_at: string | null;
}

export interface CapacitySlotRow {
  id: string;
  carrier_id: string;
  slot_reference: string;
  vehicle_id: string | null;
  vehicle_type: string;
  vehicle_class: string | null;
  equipment: string[];
  origin_area_code: string | null;
  destination_area_code: string | null;
  corridor: string | null;
  exclusive_vehicle: boolean;
  offered_kg: number;
  offered_cbm: number | null;
  reserved_kg: number;
  committed_kg: number;
  consumed_kg: number;
  availability_status: CapacityAvailabilityState;
  effective_from: string;
  effective_until: string;
  notes: string | null;
}

export interface ReservationRow {
  id: string;
  reservation_reference: string;
  slot_id: string;
  carrier_id: string;
  requirement_id: string | null;
  award_id: string | null;
  booking_id: string | null;
  qty_kg: number;
  state: CapacityReservationState;
  expires_at: string;
  released_reason: string | null;
  created_at: string;
}

export interface RequirementRow {
  id: string;
  requirement_number: string;
  state: RequirementState;
  service_level: string;
  origin_label: string;
  origin_area_code: string | null;
  destination_label: string;
  destination_area_code: string | null;
  pickup_window_start: string;
  pickup_window_end: string;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  weight_kg: number;
  volume_cbm: number | null;
  package_count: number;
  cargo_class: string;
  handling_requirements: string[];
  equipment_required: string[];
  vehicle_type_required: string | null;
  temperature_controlled: boolean;
  cross_border: boolean;
  target_budget: number | null;
  currency: string;
  is_test: boolean;
  order_id: string | null;
  created_at: string;
}

export interface RfqRow {
  id: string;
  rfq_number: string;
  requirement_id: string;
  sourcing_mode: "SINGLE" | "MULTI";
  state: TenderState;
  title: string;
  scope_notes: string | null;
  currency: string;
  target_budget: number | null;
  response_deadline: string;
  opened_at: string | null;
  awarded_at: string | null;
  cancel_reason: string | null;
  is_test: boolean;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  rfq_id: string;
  carrier_id: string;
  state: InvitationState;
  invited_at: string;
  responded_at: string | null;
  decline_reason: string | null;
}

export interface QuotationRow {
  id: string;
  quote_number: string;
  rfq_id: string;
  carrier_id: string;
  version: number;
  state: QuoteState;
  currency: string;
  pricing_basis: PricingBasis;
  base_freight: number;
  fuel_surcharge: number;
  waiting_charge: number;
  toll_charge: number;
  handling_charge: number;
  storage_charge: number;
  loading_charge: number;
  protection_charge: number;
  accessorial_total: number;
  discount: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  capacity_offered_kg: number;
  transit_time_hours: number | null;
  sla_committed: string | null;
  valid_until: string;
  snapshot_hash: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface AwardRow {
  id: string;
  award_number: string;
  rfq_id: string;
  requirement_id: string;
  quotation_id: string;
  carrier_id: string;
  reservation_id: string | null;
  status: "AWARDED" | "CANCELLED" | "SUPERSEDED";
  awarded_total: number;
  currency: string;
  award_justification: string;
  lowest_price_bypassed: boolean;
  awarded_at: string;
}

export interface BookingRow {
  id: string;
  booking_number: string;
  award_id: string;
  requirement_id: string;
  carrier_id: string;
  reservation_id: string | null;
  order_id: string | null;
  route_id: string | null;
  manifest_id: string | null;
  vehicle_id: string | null;
  driver_user_id: string | null;
  state: BookingState;
  carrier_accepted_at: string | null;
  carrier_decline_reason: string | null;
  agreed_total: number;
  currency: string;
  planned_pickup: string | null;
  planned_delivery: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface LineageRow {
  id: string;
  requirement_id: string;
  stage: "REQUESTED" | "QUOTED" | "ACCEPTED" | "ACTUAL" | "ADJUSTED" | "INVOICED" | "SETTLED";
  amount: number;
  currency: string;
  variance_vs_accepted: number | null;
  invoice_reference: string | null;
  settlement_reference: string | null;
  recorded_at: string;
}

export interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor_role: string;
  reason: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/* --------------------------------------------------------- engine outputs */

export interface ComplianceVerdict {
  state: "PASS" | "BLOCKED" | "LEGAL_REVIEW_REQUIRED" | "OWNER_CONFIGURATION_REQUIRED" | "UNKNOWN_CARRIER";
  blocking: { code: string; requirement?: string; reason?: string; expired_on?: string }[];
  expiring?: { requirement: string; expires_on: string }[];
  mandatory_items?: number;
  detail?: string;
}

export interface CapacityCandidate {
  slot_id: string;
  slot_reference: string;
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  vehicle_type: string;
  vehicle_id: string | null;
  available_kg: number;
  window_start: string;
  window_until: string;
  match_score: number;
  match_reasons: { code: string; [k: string]: unknown }[];
  compliance_state: string;
  reliability_score: number | null;
}

export interface CapacitySearchResult {
  ok: boolean;
  code?: string;
  requirement_id?: string;
  state?: "EVALUATED" | "OWNER_CONFIGURATION_REQUIRED";
  candidates: CapacityCandidate[];
  rejected: { slot_id: string; carrier_id: string; carrier_name: string; blocking: { code: string }[] }[];
}

export interface BidRow {
  quotation_id: string;
  quote_number: string;
  version: number;
  state: QuoteState;
  carrier_id: string;
  carrier_name: string;
  carrier_code: string;
  total: number;
  currency: string;
  is_lowest_price: boolean;
  breakdown: Record<string, number>;
  capacity_offered_kg: number;
  capacity_sufficient: boolean;
  transit_time_hours: number | null;
  sla_committed: string | null;
  valid_until: string;
  expired: boolean;
  compliance_state: string;
  compliance_blocking: { code: string }[];
  reliability_score: number | null;
  on_time_delivery_pct: number | null;
  awardable: boolean;
  weighted_score: number;
}

export interface BidComparison {
  ok: boolean;
  code?: string;
  rfq_id?: string;
  state?: TenderState;
  policy: {
    state: "CONFIGURED" | "OWNER_CONFIGURATION_REQUIRED";
    policy_code?: string;
    min_responses_to_award?: number;
    require_compliance_pass?: boolean;
    weights?: Record<string, number>;
  };
  lowest_total: number | null;
  bids: BidRow[];
}

export interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------- utilities */

export const availableKg = (s: Pick<CapacitySlotRow, "offered_kg" | "reserved_kg" | "committed_kg" | "consumed_kg">) =>
  Number(s.offered_kg) - Number(s.reserved_kg) - Number(s.committed_kg) - Number(s.consumed_kg);

/** Operational state of a slot — existence in the database is never availability. */
export function slotOperationalState(slot: CapacitySlotRow, now: Date = new Date()): OperationalState {
  if (slot.availability_status === "CANCELLED") return "CANCELLED";
  if (slot.availability_status === "EXPIRED" || new Date(slot.effective_until) <= now) return "EXPIRED";
  if (Number(slot.consumed_kg) >= Number(slot.offered_kg)) return "CONSUMED";
  if (Number(slot.committed_kg) > 0) return "COMMITTED";
  if (Number(slot.reserved_kg) > 0) return "RESERVED";
  if (slot.availability_status === "AVAILABLE" && availableKg(slot) > 0) return "AVAILABLE";
  return "CONFIGURED";
}

export function isSlotBookable(slot: CapacitySlotRow, qtyKg: number, now: Date = new Date()): boolean {
  if (slot.availability_status !== "AVAILABLE") return false;
  if (new Date(slot.effective_until) <= now) return false;
  if (slot.exclusive_vehicle && Number(slot.reserved_kg) + Number(slot.committed_kg) + Number(slot.consumed_kg) > 0) {
    return false;
  }
  return qtyKg > 0 && availableKg(slot) >= qtyKg;
}

/** Award readiness as the server will judge it — used only to explain the UI state. */
export function awardBlockers(bid: BidRow, requirementKg: number, comparison: BidComparison): string[] {
  const out: string[] = [];
  if (bid.state !== "SUBMITTED") out.push(`Quotation is ${bid.state.toLowerCase()}`);
  if (bid.expired) out.push("Quotation validity has lapsed");
  if (bid.compliance_state !== "PASS") out.push(`Carrier compliance is ${bid.compliance_state}`);
  if (bid.capacity_offered_kg < requirementKg) out.push("Quoted capacity is below the requirement");
  if (comparison.policy.state === "OWNER_CONFIGURATION_REQUIRED") out.push("No award policy is configured");
  const min = comparison.policy.min_responses_to_award ?? 1;
  if (comparison.bids.filter((b) => b.state === "SUBMITTED").length < min) {
    out.push(`Policy requires at least ${min} response(s)`);
  }
  return out;
}

export const quoteTotalPreview = (parts: {
  base_freight: number; fuel_surcharge?: number; waiting_charge?: number; toll_charge?: number;
  handling_charge?: number; storage_charge?: number; loading_charge?: number; protection_charge?: number;
  accessorial_total?: number; discount?: number; tax_amount?: number;
}) => {
  const n = (v?: number) => Number(v ?? 0);
  const subtotal =
    n(parts.base_freight) + n(parts.fuel_surcharge) + n(parts.waiting_charge) + n(parts.toll_charge) +
    n(parts.handling_charge) + n(parts.storage_charge) + n(parts.loading_charge) + n(parts.protection_charge) +
    n(parts.accessorial_total) - n(parts.discount);
  return { subtotal, total: subtotal + n(parts.tax_amount) };
};

/* ---------------------------------------------------------------- reads */

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

export async function listCarriers(): Promise<CarrierProfileRow[]> {
  const { data, error } = await supabase.from("carrier_profiles").select("*").order("legal_entity_name");
  return unwrap(data ?? [], error);
}

export async function listCapabilities(carrierId?: string): Promise<CapabilityRow[]> {
  let q = supabase.from("carrier_capabilities").select("*").order("vehicle_type");
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listComplianceItems(carrierId?: string): Promise<ComplianceItemRow[]> {
  let q = supabase.from("carrier_compliance_items").select("*").order("requirement_code");
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listCapacitySlots(carrierId?: string): Promise<CapacitySlotRow[]> {
  let q = supabase.from("carrier_capacity_slots").select("*").order("effective_from", { ascending: false }).limit(300);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listReservations(carrierId?: string): Promise<ReservationRow[]> {
  let q = supabase.from("capacity_reservations").select("*").order("created_at", { ascending: false }).limit(200);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listRequirements(): Promise<RequirementRow[]> {
  const { data, error } = await supabase
    .from("freight_requirements").select("*").order("created_at", { ascending: false }).limit(200);
  return unwrap(data ?? [], error);
}

export async function listRfqs(): Promise<RfqRow[]> {
  const { data, error } = await supabase
    .from("freight_rfqs").select("*").order("created_at", { ascending: false }).limit(200);
  return unwrap(data ?? [], error);
}

export async function listInvitations(rfqId?: string, carrierId?: string): Promise<InvitationRow[]> {
  let q = supabase.from("freight_rfq_invitations").select("*").order("invited_at", { ascending: false }).limit(300);
  if (rfqId) q = q.eq("rfq_id", rfqId);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listQuotations(rfqId?: string, carrierId?: string): Promise<QuotationRow[]> {
  let q = supabase.from("carrier_quotations").select("*").order("created_at", { ascending: false }).limit(300);
  if (rfqId) q = q.eq("rfq_id", rfqId);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listAwards(carrierId?: string): Promise<AwardRow[]> {
  let q = supabase.from("freight_awards").select("*").order("awarded_at", { ascending: false }).limit(200);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listBookings(carrierId?: string): Promise<BookingRow[]> {
  let q = supabase.from("freight_bookings").select("*").order("created_at", { ascending: false }).limit(200);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listLineage(requirementId?: string): Promise<LineageRow[]> {
  let q = supabase.from("freight_price_lineage").select("*").order("recorded_at", { ascending: false }).limit(300);
  if (requirementId) q = q.eq("requirement_id", requirementId);
  const { data, error } = await q;
  return unwrap(data ?? [], error);
}

export async function listProcurementAudit(limit = 150): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from("freight_procurement_audit").select("*").order("created_at", { ascending: false }).limit(limit);
  return unwrap(data ?? [], error);
}

export interface TenderPolicyRow {
  id: string; policy_code: string; policy_label: string; active: boolean;
  min_responses_to_award: number; require_compliance_pass: boolean; allow_lowest_price_only: boolean;
  weight_price: number; weight_transit: number; weight_capacity: number;
  weight_performance: number; weight_compliance: number;
}
export async function listTenderPolicies(): Promise<TenderPolicyRow[]> {
  const { data, error } = await supabase.from("freight_tender_policies").select("*").order("policy_code");
  return unwrap<TenderPolicyRow[]>(data ?? [], error);
}

export interface CarrierContractRow {
  id: string; contract_number: string; carrier_id: string; contract_type: string; status: string;
  currency: string; payment_terms_days: number; effective_from: string; effective_until: string | null;
}
export async function listContracts(carrierId?: string): Promise<CarrierContractRow[]> {
  let q = supabase.from("carrier_contracts").select("*").order("effective_from", { ascending: false });
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap<CarrierContractRow[]>(data ?? [], error);
}

export interface RateCardRow {
  id: string; carrier_id: string; rate_card_code: string; version: number; status: string;
  currency: string; effective_from: string; effective_until: string | null;
}
export async function listRateCards(carrierId?: string): Promise<RateCardRow[]> {
  let q = supabase.from("carrier_rate_cards").select("*").order("effective_from", { ascending: false });
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap<RateCardRow[]>(data ?? [], error);
}

export interface PartnerLite { id: string; partner_code: string; legal_name: string; status: string }
export async function listPartnersForCarrier(): Promise<PartnerLite[]> {
  const { data, error } = await supabase
    .from("partners").select("id, partner_code, legal_name, status").order("legal_name");
  return unwrap<PartnerLite[]>(data ?? [], error);
}

export interface CapacityLedgerRow {
  id: string; slot_id: string; reservation_id: string | null; entry_type: string;
  qty_kg: number; balance_after_kg: number; reason: string | null; created_at: string;
}
export async function listCapacityLedger(slotId: string): Promise<CapacityLedgerRow[]> {
  const { data, error } = await supabase
    .from("carrier_capacity_ledger").select("*").eq("slot_id", slotId)
    .order("created_at", { ascending: false }).limit(100);
  return unwrap<CapacityLedgerRow[]>(data ?? [], error);
}

/* ------------------------------------------------------------ operations */

async function rpc<T = RpcResult>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "RPC_FAILED", message: error.message } as T;
  return (data ?? { ok: false, code: "EMPTY_RESPONSE" }) as T;
}

export const carrierComplianceState = (carrierId: string) =>
  rpc<ComplianceVerdict>("carrier_compliance_state", { _carrier_id: carrierId });

export const carrierScorecard = (carrierId: string) =>
  rpc<Record<string, unknown>>("carrier_scorecard", { _carrier_id: carrierId });

export const capacitySearch = (requirementId: string) =>
  rpc<CapacitySearchResult>("carrier_capacity_search", { _requirement_id: requirementId });

export const bidComparison = (rfqId: string) =>
  rpc<BidComparison>("freight_bid_comparison", { _rfq_id: rfqId });

export const saveCarrier = (input: {
  partnerId: string; legalEntityName: string; serviceCategories?: string[]; corridors?: string[];
  operatingCountries?: string[]; regions?: string[]; paymentTermsDays?: number;
  opsContactName?: string; opsContactEmail?: string; opsContactPhone?: string; taxIdentifier?: string;
  operatingStatus?: CarrierOperatingStatus; contractStatus?: CarrierContractStatus;
  contractReference?: string; effectiveFrom?: string; effectiveUntil?: string;
}) =>
  rpc("carrier_profile_upsert", {
    _partner_id: input.partnerId,
    _legal_entity_name: input.legalEntityName,
    _service_categories: input.serviceCategories ?? [],
    _corridors: input.corridors ?? [],
    _operating_countries: input.operatingCountries ?? ["KE"],
    _regions: input.regions ?? [],
    _payment_terms_days: input.paymentTermsDays ?? 30,
    _ops_contact_name: input.opsContactName ?? null,
    _ops_contact_email: input.opsContactEmail ?? null,
    _ops_contact_phone: input.opsContactPhone ?? null,
    _tax_identifier: input.taxIdentifier ?? null,
    _operating_status: input.operatingStatus ?? "ONBOARDING",
    _contract_status: input.contractStatus ?? "NONE",
    _contract_reference: input.contractReference ?? null,
    _effective_from: input.effectiveFrom ?? null,
    _effective_until: input.effectiveUntil ?? null,
  });

export const saveCapability = (input: {
  carrierId: string; vehicleType: string; maxPayloadKg: number; vehicleClass?: string;
  maxVolumeCbm?: number; temperatureControlled?: boolean; refrigerated?: boolean;
  hazmatCapable?: boolean; hazmatAuthorityReference?: string; fragileCapable?: boolean;
  highValueCapable?: boolean; oversizedCapable?: boolean; containerCapable?: boolean;
  crossBorderCapable?: boolean; warehouseCapable?: boolean; lastMileCapable?: boolean;
  lineHaulCapable?: boolean; specialHandling?: string[]; equipment?: string[]; unitsDeclared?: number;
}) =>
  rpc("carrier_capability_upsert", {
    _carrier_id: input.carrierId,
    _vehicle_type: input.vehicleType,
    _max_payload_kg: input.maxPayloadKg,
    _vehicle_class: input.vehicleClass ?? null,
    _max_volume_cbm: input.maxVolumeCbm ?? null,
    _temperature_controlled: input.temperatureControlled ?? false,
    _refrigerated: input.refrigerated ?? false,
    _hazmat_capable: input.hazmatCapable ?? false,
    _hazmat_authority_reference: input.hazmatAuthorityReference ?? null,
    _fragile_capable: input.fragileCapable ?? false,
    _high_value_capable: input.highValueCapable ?? false,
    _oversized_capable: input.oversizedCapable ?? false,
    _container_capable: input.containerCapable ?? false,
    _cross_border_capable: input.crossBorderCapable ?? false,
    _warehouse_capable: input.warehouseCapable ?? false,
    _last_mile_capable: input.lastMileCapable ?? true,
    _line_haul_capable: input.lineHaulCapable ?? false,
    _special_handling: input.specialHandling ?? [],
    _equipment: input.equipment ?? [],
    _units_declared: input.unitsDeclared ?? 0,
  });

export const saveServiceArea = (input: {
  carrierId: string; areaKind: string; areaCode: string; areaLabel: string;
  direction?: string; active?: boolean;
}) =>
  rpc("carrier_service_area_set", {
    _carrier_id: input.carrierId, _area_kind: input.areaKind, _area_code: input.areaCode,
    _area_label: input.areaLabel, _direction: input.direction ?? "BOTH", _active: input.active ?? true,
  });

export const recordCompliance = (input: {
  carrierId: string; requirementCode: string; requirementLabel: string; category: string;
  state: ComplianceItemState; isMandatory?: boolean; evidenceStoragePath?: string;
  issuingAuthority?: string; referenceNumber?: string; issuedOn?: string; expiresOn?: string;
  vehicleId?: string; legalReviewReason?: string; reviewNotes?: string;
}) =>
  rpc("carrier_compliance_record", {
    _carrier_id: input.carrierId, _requirement_code: input.requirementCode,
    _requirement_label: input.requirementLabel, _category: input.category, _state: input.state,
    _is_mandatory: input.isMandatory ?? true,
    _evidence_storage_path: input.evidenceStoragePath ?? null,
    _evidence_hash: null,
    _issuing_authority: input.issuingAuthority ?? null,
    _reference_number: input.referenceNumber ?? null,
    _issued_on: input.issuedOn ?? null, _expires_on: input.expiresOn ?? null,
    _vehicle_id: input.vehicleId ?? null,
    _legal_review_reason: input.legalReviewReason ?? null,
    _review_notes: input.reviewNotes ?? null,
  });

export const saveCapacitySlot = (input: {
  id?: string | null; carrierId: string; vehicleType: string; offeredKg: number;
  effectiveFrom: string; effectiveUntil: string; vehicleId?: string | null; vehicleClass?: string;
  offeredCbm?: number; equipment?: string[]; originAreaCode?: string; destinationAreaCode?: string;
  corridor?: string; exclusiveVehicle?: boolean; availabilityStatus?: CapacityAvailabilityState;
  notes?: string;
}) =>
  rpc("carrier_capacity_slot_upsert", {
    _carrier_id: input.carrierId, _vehicle_type: input.vehicleType, _offered_kg: input.offeredKg,
    _effective_from: input.effectiveFrom, _effective_until: input.effectiveUntil,
    _id: input.id ?? null, _vehicle_id: input.vehicleId ?? null, _vehicle_class: input.vehicleClass ?? null,
    _offered_cbm: input.offeredCbm ?? null, _equipment: input.equipment ?? [],
    _origin_area_code: input.originAreaCode ?? null,
    _destination_area_code: input.destinationAreaCode ?? null,
    _corridor: input.corridor ?? null, _exclusive_vehicle: input.exclusiveVehicle ?? false,
    _availability_status: input.availabilityStatus ?? "AVAILABLE", _notes: input.notes ?? null,
  });

export const reserveCapacity = (input: {
  slotId: string; qtyKg: number; requirementId?: string; ttlMinutes?: number; idempotencyKey?: string;
}) =>
  rpc("capacity_reserve", {
    _slot_id: input.slotId, _qty_kg: input.qtyKg, _requirement_id: input.requirementId ?? null,
    _award_id: null, _ttl_minutes: input.ttlMinutes ?? 120,
    _idempotency_key: input.idempotencyKey ?? null, _qty_cbm: null,
  });

export const transitionCapacity = (reservationId: string, action: "RELEASE" | "COMMIT" | "CONSUME", reason?: string) =>
  rpc("capacity_transition", { _reservation_id: reservationId, _action: action, _reason: reason ?? null });

export const createRequirement = (input: {
  originLabel: string; destinationLabel: string; pickupWindowStart: string; pickupWindowEnd: string;
  weightKg: number; packageCount?: number; volumeCbm?: number; serviceLevel?: string;
  originAreaCode?: string; destinationAreaCode?: string; deliveryWindowStart?: string;
  deliveryWindowEnd?: string; cargoClass?: string; handlingRequirements?: string[];
  equipmentRequired?: string[]; vehicleTypeRequired?: string; temperatureControlled?: boolean;
  crossBorder?: boolean; declaredValue?: number; targetBudget?: number; specialInstructions?: string;
  tenantId?: string; orderId?: string; isTest?: boolean;
}) =>
  rpc("freight_requirement_create", {
    _origin_label: input.originLabel, _destination_label: input.destinationLabel,
    _pickup_window_start: input.pickupWindowStart, _pickup_window_end: input.pickupWindowEnd,
    _weight_kg: input.weightKg, _package_count: input.packageCount ?? 1,
    _volume_cbm: input.volumeCbm ?? null, _service_level: input.serviceLevel ?? "STANDARD",
    _origin_area_code: input.originAreaCode ?? null,
    _destination_area_code: input.destinationAreaCode ?? null,
    _delivery_window_start: input.deliveryWindowStart ?? null,
    _delivery_window_end: input.deliveryWindowEnd ?? null,
    _cargo_class: input.cargoClass ?? "GENERAL",
    _handling_requirements: input.handlingRequirements ?? [],
    _equipment_required: input.equipmentRequired ?? [],
    _vehicle_type_required: input.vehicleTypeRequired ?? null,
    _temperature_controlled: input.temperatureControlled ?? false,
    _cross_border: input.crossBorder ?? false,
    _declared_value: input.declaredValue ?? null, _target_budget: input.targetBudget ?? null,
    _special_instructions: input.specialInstructions ?? null,
    _tenant_id: input.tenantId ?? null, _order_id: input.orderId ?? null,
    _enquiry_id: null, _is_test: input.isTest ?? false,
  });

export const createRfq = (input: {
  requirementId: string; title: string; responseDeadline: string;
  sourcingMode?: "SINGLE" | "MULTI"; scopeNotes?: string; targetBudget?: number; policyCode?: string;
}) =>
  rpc("freight_rfq_create", {
    _requirement_id: input.requirementId, _title: input.title,
    _response_deadline: input.responseDeadline, _sourcing_mode: input.sourcingMode ?? "MULTI",
    _scope_notes: input.scopeNotes ?? null, _target_budget: input.targetBudget ?? null,
    _policy_code: input.policyCode ?? null,
  });

export const inviteCarriers = (rfqId: string, carrierIds: string[]) =>
  rpc("freight_rfq_invite", { _rfq_id: rfqId, _carrier_ids: carrierIds });

export const issueRfq = (rfqId: string) => rpc("freight_rfq_issue", { _rfq_id: rfqId });

export const transitionRfq = (rfqId: string, to: TenderState, reason?: string) =>
  rpc("freight_rfq_transition", { _rfq_id: rfqId, _to: to, _reason: reason ?? null });

export const submitQuote = (input: {
  rfqId: string; carrierId: string; baseFreight: number; capacityOfferedKg: number; validUntil: string;
  fuelSurcharge?: number; waitingCharge?: number; tollCharge?: number; handlingCharge?: number;
  storageCharge?: number; loadingCharge?: number; protectionCharge?: number;
  accessorials?: { label: string; amount: number }[]; discount?: number; taxAmount?: number;
  transitTimeHours?: number; pickupEta?: string; deliveryEta?: string; slaCommitted?: string;
  vehicleType?: string; equipment?: string[]; capacitySlotId?: string; pricingBasis?: PricingBasis;
  conditions?: string;
}) =>
  rpc("carrier_quote_submit", {
    _rfq_id: input.rfqId, _carrier_id: input.carrierId, _base_freight: input.baseFreight,
    _capacity_offered_kg: input.capacityOfferedKg, _valid_until: input.validUntil,
    _fuel_surcharge: input.fuelSurcharge ?? 0, _waiting_charge: input.waitingCharge ?? 0,
    _toll_charge: input.tollCharge ?? 0, _handling_charge: input.handlingCharge ?? 0,
    _storage_charge: input.storageCharge ?? 0, _loading_charge: input.loadingCharge ?? 0,
    _protection_charge: input.protectionCharge ?? 0,
    _accessorials: input.accessorials ?? [], _discount: input.discount ?? 0,
    _tax_amount: input.taxAmount ?? 0, _transit_time_hours: input.transitTimeHours ?? null,
    _pickup_eta: input.pickupEta ?? null, _delivery_eta: input.deliveryEta ?? null,
    _sla_committed: input.slaCommitted ?? null, _vehicle_type: input.vehicleType ?? null,
    _equipment: input.equipment ?? [], _capacity_slot_id: input.capacitySlotId ?? null,
    _pricing_basis: input.pricingBasis ?? "PER_SHIPMENT", _conditions: input.conditions ?? null,
  });

export const respondToInvitation = (rfqId: string, carrierId: string, action: "VIEW" | "DECLINE", reason?: string) =>
  rpc("carrier_invitation_respond", { _rfq_id: rfqId, _carrier_id: carrierId, _action: action, _reason: reason ?? null });

export const awardTender = (input: {
  rfqId: string; quotationId: string; justification: string; idempotencyKey?: string; reservationTtlMinutes?: number;
}) =>
  rpc("freight_award", {
    _rfq_id: input.rfqId, _quotation_id: input.quotationId, _justification: input.justification,
    _idempotency_key: input.idempotencyKey ?? null,
    _reservation_ttl_minutes: input.reservationTtlMinutes ?? 1440,
  });

export const createBooking = (awardId: string, idempotencyKey?: string) =>
  rpc("freight_booking_create", { _award_id: awardId, _idempotency_key: idempotencyKey ?? null });

export const attachExecution = (input: {
  bookingId: string; routeId?: string; vehicleId?: string; driverUserId?: string; manifestId?: string;
}) =>
  rpc("freight_booking_attach_execution", {
    _booking_id: input.bookingId, _route_id: input.routeId ?? null,
    _vehicle_id: input.vehicleId ?? null, _driver_user_id: input.driverUserId ?? null,
    _manifest_id: input.manifestId ?? null,
  });

export const transitionBooking = (bookingId: string, to: BookingState, reason?: string, actualAmount?: number) =>
  rpc("freight_booking_transition", {
    _booking_id: bookingId, _to: to, _reason: reason ?? null, _actual_amount: actualAmount ?? null,
  });

export const respondToAward = (bookingId: string, action: "ACCEPT" | "DECLINE", reason?: string) =>
  rpc("carrier_award_respond", { _booking_id: bookingId, _action: action, _reason: reason ?? null });

/** Existing execution assets a booking can attach to — never created here. */
export interface AttachableRoute {
  id: string; route_number: string; status: string; planned_start: string | null;
  vehicle_id: string | null; driver_user_id: string | null;
}
export async function listAttachableRoutes(): Promise<AttachableRoute[]> {
  const { data, error } = await supabase
    .from("logistics_routes")
    .select("id, route_number, status, planned_start, vehicle_id, driver_user_id")
    .in("status", ["DRAFT", "PLANNED", "READY", "ASSIGNED"])
    .order("planned_start", { ascending: true, nullsFirst: false })
    .limit(100);
  return unwrap<AttachableRoute[]>(data ?? [], error);
}

export interface FleetVehicleLite {
  id: string; vehicle_code: string; number_plate: string; vehicle_type: string; vehicle_status: string;
}
export async function listFleetVehicles(): Promise<FleetVehicleLite[]> {
  const { data, error } = await supabase
    .from("vehicles").select("id, vehicle_code, number_plate, vehicle_type, vehicle_status")
    .order("number_plate").limit(200);
  return unwrap<FleetVehicleLite[]>(data ?? [], error);
}

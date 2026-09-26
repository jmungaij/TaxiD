/**
 * Canonical Logistics Service Catalogue — the contract between UI, API,
 * serviceability, rating, dispatch and compliance.
 *
 * SERVICE_FAMILY → SERVICE_OFFERING → FULFILMENT_METHOD → RATE_PLAN
 *   → SLA_POLICY → COMPLIANCE_POLICY → POD_POLICY → RETURN_POLICY → CLAIM_POLICY
 *
 * No page component may branch on a service string; it reads the offering
 * configuration from here. Offerings are versioned and effective-dated, and
 * carry a machine-readable capability truth record so the public site can never
 * present a non-operational capability as a live service.
 */

export type ServiceFamilyCode =
  | "PARCEL"
  | "COURIER"
  | "FREIGHT"
  | "WAREHOUSING"
  | "FULFILMENT"
  | "CORPORATE";

export type FulfilmentMethod =
  | "BIKE"
  | "MOTORBIKE"
  | "COMPACT_VAN"
  | "VAN"
  | "TRUCK_3T"
  | "TRUCK_10T"
  | "PARTNER_NETWORK"
  | "HUB_TO_HUB";

export type PackageType = "DOCUMENT" | "SMALL_PARCEL" | "PARCEL" | "PALLET" | "BULK" | "TEMPERATURE_CONTROLLED";

export type PodMethod = "PHOTO" | "SIGNATURE" | "PIN" | "BARCODE" | "RECIPIENT_ID" | "PHOTO_SIGNATURE";

export type BookingMode = "INSTANT" | "SCHEDULED" | "RFQ";
export type QuoteMode = "AUTOMATIC" | "INDICATIVE" | "MANUAL";

/** Capability truth — these five are different things and must not be conflated. */
export interface CapabilityTruth {
  implemented: boolean;
  configured: boolean;
  integrated: boolean;
  operational: boolean;
  verified: boolean;
}

export interface SlaPolicy {
  code: string;
  /** Target only — never rendered as a guarantee (see claimsGovernance). */
  pickupTargetMinutes?: number;
  deliveryTargetHours?: number;
  measured: boolean;
  qualifier: string;
}

export interface CompliancePolicy {
  code: string;
  requiresPartnerLicence: boolean;
  requiresCourierIdentity: boolean;
  requiresVehicleInspection: boolean;
  requiresGoodsInTransitCover: boolean;
  restrictedGoods: string[];
  prohibitedGoods: string[];
  declaredValueRequired: boolean;
}

export interface PodPolicy {
  code: string;
  required: PodMethod[];
  optional: PodMethod[];
  minEvidenceItems: number;
  storage: "private_signed_url";
}

export interface ReturnPolicy {
  code: string;
  allowed: boolean;
  mode: "RETURN_TO_SENDER" | "HUB_HOLD" | "NONE";
  maxAttemptsBeforeReturn: number;
  holdHours: number;
}

export interface ClaimPolicy {
  code: string;
  allowed: boolean;
  /** Liability basis in words — no monetary cover asserted without a policy record. */
  liabilityBasis: string;
  windowHours: number;
  evidenceRequired: string[];
}

export interface RatePlanRef {
  id: string;
  name: string;
  zone: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  model: "DISTANCE_BAND" | "WEIGHT_BAND" | "ZONE_FLAT" | "QUOTED";
}

export interface ServiceOffering {
  code: string;
  version: number;
  family: ServiceFamilyCode;
  name: string;
  description: string;
  customerSegments: ("personal" | "business" | "enterprise" | "ecommerce")[];
  coverage: string[];
  fulfilmentMethods: FulfilmentMethod[];
  allowedPackageTypes: PackageType[];
  weightLimitKg: { min: number; max: number };
  dimensionLimitCm: { maxLongestSide: number; maxGirth: number } | null;
  dimensionsRequired: boolean;
  declaredValueRequired: boolean;
  specialHandling: string[];
  bookingMode: BookingMode;
  quoteMode: QuoteMode;
  ratePlans: RatePlanRef[];
  sla: SlaPolicy;
  compliance: CompliancePolicy;
  pod: PodPolicy;
  returns: ReturnPolicy;
  claims: ClaimPolicy;
  operatingHours: { open: string; close: string; days: string };
  cutoffLocalTime: string | null;
  capability: CapabilityTruth;
  status: "ACTIVE" | "PILOT" | "DRAFT" | "RETIRED";
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Presentation route(s). Multiple thin routes may share one offering. */
  presentationRoutes: string[];
}

export interface ServiceFamily {
  code: ServiceFamilyCode;
  name: string;
  description: string;
}

export const SERVICE_FAMILIES: ServiceFamily[] = [
  { code: "PARCEL", name: "Parcel", description: "Standard and same-day parcel movement within covered cities." },
  { code: "COURIER", name: "Courier", description: "Time-critical documents and small high-value items." },
  { code: "FREIGHT", name: "Freight & cargo", description: "Palletised and bulk movement, inter-city trucking." },
  { code: "WAREHOUSING", name: "Warehousing", description: "Storage, inventory and cross-dock handling." },
  { code: "FULFILMENT", name: "E-commerce fulfilment", description: "Pick, pack, ship and returns for online sellers." },
  { code: "CORPORATE", name: "Corporate logistics", description: "Contracted, account-billed logistics programmes." },
];

const NAIROBI = ["NAIROBI_METRO"];

const STANDARD_COMPLIANCE: CompliancePolicy = {
  code: "CMP-STD-1",
  requiresPartnerLicence: true,
  requiresCourierIdentity: true,
  requiresVehicleInspection: true,
  requiresGoodsInTransitCover: false,
  restrictedGoods: ["batteries_lithium", "aerosols", "alcohol", "pharmaceuticals", "high_value_electronics"],
  prohibitedGoods: ["firearms", "narcotics", "live_animals", "human_remains", "cash_currency", "explosives", "counterfeit_goods"],
  declaredValueRequired: true,
};

const BUSINESS_HOURS = { open: "07:00", close: "19:00", days: "Mon–Sat" };

export const SERVICE_OFFERINGS: ServiceOffering[] = [
  {
    code: "PARCEL_STANDARD",
    version: 1,
    family: "PARCEL",
    name: "Standard parcel (next-day)",
    description: "Next-day parcel movement within covered metro zones.",
    customerSegments: ["personal", "business"],
    coverage: NAIROBI,
    fulfilmentMethods: ["MOTORBIKE", "COMPACT_VAN", "VAN"],
    allowedPackageTypes: ["SMALL_PARCEL", "PARCEL"],
    weightLimitKg: { min: 0.1, max: 30 },
    dimensionLimitCm: { maxLongestSide: 120, maxGirth: 300 },
    dimensionsRequired: true,
    declaredValueRequired: true,
    specialHandling: ["fragile"],
    bookingMode: "SCHEDULED",
    quoteMode: "AUTOMATIC",
    ratePlans: [{ id: "RP-NBO-STD-1", name: "Nairobi standard v1", zone: "NAIROBI_METRO", effectiveFrom: "2026-01-01", effectiveUntil: null, model: "WEIGHT_BAND" }],
    sla: { code: "SLA-STD-1", deliveryTargetHours: 24, measured: false, qualifier: "Target, not a guarantee — subject to serviceability and capacity." },
    compliance: STANDARD_COMPLIANCE,
    pod: { code: "POD-STD-1", required: ["PHOTO"], optional: ["SIGNATURE", "PIN"], minEvidenceItems: 1, storage: "private_signed_url" },
    returns: { code: "RET-STD-1", allowed: true, mode: "RETURN_TO_SENDER", maxAttemptsBeforeReturn: 2, holdHours: 48 },
    claims: { code: "CLM-STD-1", allowed: true, liabilityBasis: "Custody, timestamp and proof-of-delivery evidence; no monetary cover is asserted until a goods-in-transit policy record exists.", windowHours: 72, evidenceRequired: ["photos", "packing_evidence", "declared_value_proof"] },
    operatingHours: BUSINESS_HOURS,
    cutoffLocalTime: "16:00",
    capability: { implemented: true, configured: true, integrated: true, operational: true, verified: false },
    status: "ACTIVE",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    presentationRoutes: ["/delivery/package"],
  },
  {
    code: "COURIER_DOCUMENT",
    version: 1,
    family: "COURIER",
    name: "Document courier",
    description: "Confidential documents, legal and medical items moved under chain of custody.",
    customerSegments: ["personal", "business", "enterprise"],
    coverage: NAIROBI,
    fulfilmentMethods: ["BIKE", "MOTORBIKE"],
    allowedPackageTypes: ["DOCUMENT", "SMALL_PARCEL"],
    weightLimitKg: { min: 0.05, max: 5 },
    dimensionLimitCm: { maxLongestSide: 45, maxGirth: 100 },
    dimensionsRequired: false,
    declaredValueRequired: false,
    specialHandling: ["confidential", "sealed_envelope"],
    bookingMode: "INSTANT",
    quoteMode: "AUTOMATIC",
    ratePlans: [{ id: "RP-NBO-DOC-1", name: "Nairobi document v1", zone: "NAIROBI_METRO", effectiveFrom: "2026-01-01", effectiveUntil: null, model: "DISTANCE_BAND" }],
    sla: { code: "SLA-DOC-1", pickupTargetMinutes: 60, deliveryTargetHours: 4, measured: false, qualifier: "Target, not a guarantee — subject to serviceability and capacity." },
    compliance: { ...STANDARD_COMPLIANCE, code: "CMP-DOC-1", declaredValueRequired: false },
    pod: { code: "POD-DOC-1", required: ["SIGNATURE", "RECIPIENT_ID"], optional: ["PHOTO"], minEvidenceItems: 2, storage: "private_signed_url" },
    returns: { code: "RET-DOC-1", allowed: true, mode: "RETURN_TO_SENDER", maxAttemptsBeforeReturn: 1, holdHours: 24 },
    claims: { code: "CLM-DOC-1", allowed: true, liabilityBasis: "Custody chain and signed handover evidence; no monetary cover asserted.", windowHours: 48, evidenceRequired: ["custody_chain", "handover_signature"] },
    operatingHours: BUSINESS_HOURS,
    cutoffLocalTime: null,
    capability: { implemented: true, configured: true, integrated: true, operational: true, verified: true },
    status: "ACTIVE",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    presentationRoutes: ["/delivery/courier", "/delivery/courier?offering=COURIER_DOCUMENT"],
  },
  {
    code: "EXPRESS_CITY",
    version: 1,
    family: "COURIER",
    name: "Express city delivery",
    description: "Time-critical intra-city pickups on two-wheel and compact vehicles.",
    customerSegments: ["personal", "business"],
    coverage: NAIROBI,
    fulfilmentMethods: ["BIKE", "MOTORBIKE", "COMPACT_VAN"],
    allowedPackageTypes: ["DOCUMENT", "SMALL_PARCEL", "PARCEL"],
    weightLimitKg: { min: 0.05, max: 15 },
    dimensionLimitCm: { maxLongestSide: 80, maxGirth: 180 },
    dimensionsRequired: false,
    declaredValueRequired: true,
    specialHandling: ["fragile", "time_critical"],
    bookingMode: "INSTANT",
    quoteMode: "AUTOMATIC",
    ratePlans: [{ id: "RP-NBO-EXP-1", name: "Nairobi express v1", zone: "NAIROBI_METRO", effectiveFrom: "2026-01-01", effectiveUntil: null, model: "DISTANCE_BAND" }],
    sla: { code: "SLA-EXP-1", pickupTargetMinutes: 60, deliveryTargetHours: 3, measured: false, qualifier: "Target, not a guarantee — subject to serviceability and capacity." },
    compliance: { ...STANDARD_COMPLIANCE, code: "CMP-EXP-1" },
    pod: { code: "POD-EXP-1", required: ["PHOTO"], optional: ["SIGNATURE", "PIN"], minEvidenceItems: 1, storage: "private_signed_url" },
    returns: { code: "RET-EXP-1", allowed: true, mode: "RETURN_TO_SENDER", maxAttemptsBeforeReturn: 1, holdHours: 12 },
    claims: { code: "CLM-EXP-1", allowed: true, liabilityBasis: "Custody and proof-of-delivery evidence; no monetary cover asserted.", windowHours: 48, evidenceRequired: ["photos", "custody_chain"] },
    operatingHours: BUSINESS_HOURS,
    cutoffLocalTime: null,
    capability: { implemented: true, configured: true, integrated: true, operational: true, verified: true },
    status: "ACTIVE",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    presentationRoutes: ["/delivery/courier", "/delivery/courier?offering=EXPRESS_CITY"],
  },
  {
    code: "FREIGHT_CARGO",
    version: 1,
    family: "FREIGHT",
    name: "Freight & cargo",
    description: "Palletised and bulk inter-city movement under contracted capacity.",
    customerSegments: ["business", "enterprise"],
    coverage: ["KENYA_TRUNK_ROUTES"],
    fulfilmentMethods: ["TRUCK_3T", "TRUCK_10T", "PARTNER_NETWORK"],
    allowedPackageTypes: ["PALLET", "BULK"],
    weightLimitKg: { min: 100, max: 30000 },
    dimensionLimitCm: null,
    dimensionsRequired: true,
    declaredValueRequired: true,
    specialHandling: ["oversize", "multi_drop"],
    bookingMode: "RFQ",
    quoteMode: "MANUAL",
    ratePlans: [{ id: "RP-KE-FRT-1", name: "Kenya trunk freight v1", zone: "KENYA_TRUNK_ROUTES", effectiveFrom: "2026-01-01", effectiveUntil: null, model: "QUOTED" }],
    sla: { code: "SLA-FRT-1", measured: false, qualifier: "Transit windows are agreed per contract." },
    compliance: { ...STANDARD_COMPLIANCE, code: "CMP-FRT-1", requiresGoodsInTransitCover: true },
    pod: { code: "POD-FRT-1", required: ["SIGNATURE", "PHOTO"], optional: ["BARCODE"], minEvidenceItems: 2, storage: "private_signed_url" },
    returns: { code: "RET-FRT-1", allowed: true, mode: "HUB_HOLD", maxAttemptsBeforeReturn: 1, holdHours: 72 },
    claims: { code: "CLM-FRT-1", allowed: true, liabilityBasis: "Contractual liability per signed service contract.", windowHours: 168, evidenceRequired: ["photos", "weighbridge_ticket", "contract_reference"] },
    operatingHours: { open: "06:00", close: "20:00", days: "Mon–Sat" },
    cutoffLocalTime: null,
    capability: { implemented: true, configured: true, integrated: false, operational: false, verified: false },
    status: "DRAFT",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    presentationRoutes: ["/delivery/logistics"],
  },
  {
    code: "ECOMMERCE_FULFILMENT",
    version: 1,
    family: "FULFILMENT",
    name: "E-commerce fulfilment",
    description: "Storage, pick-pack, last-mile and returns for online sellers.",
    customerSegments: ["business", "ecommerce"],
    coverage: NAIROBI,
    fulfilmentMethods: ["HUB_TO_HUB", "MOTORBIKE", "VAN"],
    allowedPackageTypes: ["SMALL_PARCEL", "PARCEL"],
    weightLimitKg: { min: 0.1, max: 30 },
    dimensionLimitCm: { maxLongestSide: 120, maxGirth: 300 },
    dimensionsRequired: true,
    declaredValueRequired: true,
    specialHandling: ["cash_on_delivery"],
    bookingMode: "RFQ",
    quoteMode: "MANUAL",
    ratePlans: [{ id: "RP-NBO-FUL-1", name: "Nairobi fulfilment v1", zone: "NAIROBI_METRO", effectiveFrom: "2026-01-01", effectiveUntil: null, model: "QUOTED" }],
    sla: { code: "SLA-FUL-1", measured: false, qualifier: "Service levels agreed per contract." },
    compliance: { ...STANDARD_COMPLIANCE, code: "CMP-FUL-1" },
    pod: { code: "POD-FUL-1", required: ["PHOTO"], optional: ["PIN", "SIGNATURE"], minEvidenceItems: 1, storage: "private_signed_url" },
    returns: { code: "RET-FUL-1", allowed: true, mode: "HUB_HOLD", maxAttemptsBeforeReturn: 2, holdHours: 120 },
    claims: { code: "CLM-FUL-1", allowed: true, liabilityBasis: "Contractual liability per fulfilment agreement.", windowHours: 168, evidenceRequired: ["inventory_record", "photos"] },
    operatingHours: BUSINESS_HOURS,
    cutoffLocalTime: "15:00",
    capability: { implemented: true, configured: false, integrated: false, operational: false, verified: false },
    status: "DRAFT",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    presentationRoutes: ["/delivery/logistics"],
  },
];

/** Offerings must be uniquely keyed by code+version. */
export function offering(code: string, at: Date = new Date()): ServiceOffering | undefined {
  const iso = at.toISOString().slice(0, 10);
  return SERVICE_OFFERINGS.filter((o) => o.code === code)
    .filter((o) => o.effectiveFrom <= iso && (o.effectiveUntil === null || o.effectiveUntil >= iso))
    .sort((a, b) => b.version - a.version)[0];
}

/** Offerings resolvable from a presentation route (thin routes share one core). */
export function offeringsForRoute(route: string): ServiceOffering[] {
  return SERVICE_OFFERINGS.filter((o) => o.presentationRoutes.includes(route));
}

/**
 * Public exposure gate: an offering may only be marketed as a live, bookable
 * service when it is integrated AND operational. Anything else is presented as
 * pilot / enquiry-only. This is what prevents non-operational capability from
 * being sold.
 */
export type PublicExposure = "BOOKABLE" | "ENQUIRY_ONLY" | "HIDDEN";

export function publicExposure(o: ServiceOffering): PublicExposure {
  if (o.status === "RETIRED") return "HIDDEN";
  if (o.capability.integrated && o.capability.operational) return "BOOKABLE";
  if (o.capability.implemented && o.capability.configured) return "ENQUIRY_ONLY";
  return "HIDDEN";
}

export function isBookable(code: string): boolean {
  const o = offering(code);
  return !!o && publicExposure(o) === "BOOKABLE";
}

/** Package eligibility check driven purely by catalogue configuration. */
export interface PackageDeclaration {
  type: PackageType;
  weightKg: number;
  longestSideCm?: number;
  girthCm?: number;
  declaredValueKes?: number;
  goods?: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  requiresManualReview: boolean;
}

export function checkPackageEligibility(code: string, pkg: PackageDeclaration): EligibilityResult {
  const o = offering(code);
  if (!o) return { eligible: false, reasons: ["unknown_service_offering"], requiresManualReview: false };
  const reasons: string[] = [];
  let manual = false;

  if (!o.allowedPackageTypes.includes(pkg.type)) reasons.push(`package_type_not_allowed:${pkg.type}`);
  if (pkg.weightKg < o.weightLimitKg.min) reasons.push("below_minimum_weight");
  if (pkg.weightKg > o.weightLimitKg.max) reasons.push("above_maximum_weight");
  if (o.dimensionsRequired && pkg.longestSideCm === undefined) reasons.push("dimensions_required");
  if (o.dimensionLimitCm && pkg.longestSideCm && pkg.longestSideCm > o.dimensionLimitCm.maxLongestSide) reasons.push("exceeds_longest_side");
  if (o.dimensionLimitCm && pkg.girthCm && pkg.girthCm > o.dimensionLimitCm.maxGirth) reasons.push("exceeds_girth");
  if (o.declaredValueRequired && (pkg.declaredValueKes === undefined || pkg.declaredValueKes <= 0)) reasons.push("declared_value_required");

  for (const g of pkg.goods ?? []) {
    if (o.compliance.prohibitedGoods.includes(g)) reasons.push(`prohibited_goods:${g}`);
    else if (o.compliance.restrictedGoods.includes(g)) manual = true;
  }

  return { eligible: reasons.length === 0, reasons, requiresManualReview: manual };
}

/** Serviceability verdict shape consumed by booking surfaces. */
export type ServiceabilityVerdict = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "MANUAL_REVIEW";

export interface ServiceabilityInput {
  offeringCode: string;
  originZone: string;
  destinationZone: string;
  partnerCapacityAvailable: boolean;
  withinOperatingHours: boolean;
  package?: PackageDeclaration;
}

export function evaluateServiceability(input: ServiceabilityInput): { verdict: ServiceabilityVerdict; reasons: string[] } {
  const o = offering(input.offeringCode);
  if (!o) return { verdict: "UNAVAILABLE", reasons: ["unknown_service_offering"] };
  const reasons: string[] = [];
  if (!o.coverage.includes(input.originZone)) reasons.push("origin_not_covered");
  if (!o.coverage.includes(input.destinationZone)) reasons.push("destination_not_covered");
  if (reasons.length) return { verdict: "UNAVAILABLE", reasons };

  if (input.package) {
    const el = checkPackageEligibility(input.offeringCode, input.package);
    if (!el.eligible) return { verdict: "UNAVAILABLE", reasons: el.reasons };
    if (el.requiresManualReview) return { verdict: "MANUAL_REVIEW", reasons: ["restricted_goods_declared"] };
  }
  if (publicExposure(o) === "ENQUIRY_ONLY") return { verdict: "MANUAL_REVIEW", reasons: ["offering_not_operational"] };
  if (!input.partnerCapacityAvailable) return { verdict: "LIMITED", reasons: ["no_partner_capacity"] };
  if (!input.withinOperatingHours) return { verdict: "LIMITED", reasons: ["outside_operating_hours"] };
  return { verdict: "AVAILABLE", reasons: [] };
}

/**
 * Dispatch eligibility contract. `verified = true` is explicitly NOT accepted as
 * a compliance substitute: licence, document and insurance validity windows must
 * be supplied and in date.
 */
export interface DispatchEligibilityInput {
  offeringCode: string;
  now?: Date;
  partner: {
    status: string;
    licenceValidUntil: string | null;
    goodsInTransitCoverValidUntil: string | null;
    permittedServiceFamilies: ServiceFamilyCode[];
    permittedZones: string[];
  };
  courier: {
    identityValid: boolean;
    requiredDocumentsValidUntil: string | null;
  };
  vehicle: {
    class: FulfilmentMethod;
    inspectionValidUntil: string | null;
    insuranceValidUntil: string | null;
  };
  zone: string;
  isSeedRecord?: boolean;
}

export interface DispatchEligibilityResult {
  eligible: boolean;
  blockers: string[];
}

const inDate = (until: string | null | undefined, now: Date) =>
  !!until && new Date(until).getTime() > now.getTime();

export function evaluateDispatchEligibility(input: DispatchEligibilityInput): DispatchEligibilityResult {
  const now = input.now ?? new Date();
  const o = offering(input.offeringCode);
  const blockers: string[] = [];
  if (!o) return { eligible: false, blockers: ["unknown_service_offering"] };

  if (input.isSeedRecord) blockers.push("seed_or_demo_record_cannot_receive_production_job");
  if (input.partner.status !== "APPROVED") blockers.push("partner_not_approved");
  if (o.compliance.requiresPartnerLicence && !inDate(input.partner.licenceValidUntil, now)) blockers.push("partner_licence_invalid_or_expired");
  if (o.compliance.requiresGoodsInTransitCover && !inDate(input.partner.goodsInTransitCoverValidUntil, now)) blockers.push("goods_in_transit_cover_invalid_or_expired");
  if (!input.partner.permittedServiceFamilies.includes(o.family)) blockers.push("service_family_not_permitted_for_partner");
  if (!input.partner.permittedZones.includes(input.zone)) blockers.push("zone_not_permitted_for_partner");
  if (o.compliance.requiresCourierIdentity && !input.courier.identityValid) blockers.push("courier_identity_invalid");
  if (!inDate(input.courier.requiredDocumentsValidUntil, now)) blockers.push("courier_documents_invalid_or_expired");
  if (!o.fulfilmentMethods.includes(input.vehicle.class)) blockers.push("vehicle_class_not_eligible_for_offering");
  if (o.compliance.requiresVehicleInspection && !inDate(input.vehicle.inspectionValidUntil, now)) blockers.push("vehicle_inspection_invalid_or_expired");
  if (!inDate(input.vehicle.insuranceValidUntil, now)) blockers.push("vehicle_insurance_invalid_or_expired");

  return { eligible: blockers.length === 0, blockers };
}

/** Capability matrix rows for the governance surface / report. */
export function capabilityMatrix(): {
  code: string;
  name: string;
  status: ServiceOffering["status"];
  capability: CapabilityTruth;
  exposure: PublicExposure;
}[] {
  return SERVICE_OFFERINGS.map((o) => ({
    code: o.code,
    name: o.name,
    status: o.status,
    capability: o.capability,
    exposure: publicExposure(o),
  }));
}

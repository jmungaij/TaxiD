/**
 * Compliance as configuration — licensing, protection (goods-in-transit),
 * restricted goods and jurisdiction modelled as an enforceable policy engine
 * rather than prose in Terms & Conditions.
 *
 * IMPORTANT LEGAL BOUNDARY
 * This module records and enforces licensing/protection FACTS supplied by
 * counsel or compliance. It does NOT and must not determine TaxiD's regulatory
 * classification. `LICENSING_DETERMINATION` below is deliberately
 * LEGAL_REVIEW / undetermined until an authoritative record is entered.
 */
import { FulfilmentMethod, ServiceFamilyCode, offering } from "./serviceCatalogue";

/* ------------------------------------------------------------------ *
 * Policy enums (DF-12 item 12 — legal policy as configuration)
 * ------------------------------------------------------------------ */

export type RestrictedGoodsDisposition = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "MANUAL_REVIEW";
export type ProtectionAvailability = "NOT_AVAILABLE" | "OPTIONAL" | "INCLUDED" | "CONDITIONAL";
export type ServiceJurisdiction = "DOMESTIC" | "REGIONAL" | "INTERNATIONAL";
export type LicensingRequirement =
  | "NOT_REQUIRED"
  | "PARTNER_REQUIRED"
  | "YALLA_REQUIRED"
  | "BOTH_REQUIRED"
  | "LEGAL_REVIEW";

/* ------------------------------------------------------------------ *
 * Partner licence record (DF-11 support, not determination)
 * ------------------------------------------------------------------ */

export type LicenceStatus = "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED" | "UNVERIFIED";

export interface PartnerLicenceRecord {
  partner_id: string;
  licence_required: boolean;
  licence_verified: boolean;
  licence_number: string | null;
  licence_category: string | null;
  licence_issuer: string | null;
  effective_from: string | null;
  expires_at: string | null;
  status: LicenceStatus;
  /** Permitted scope as stated on the licence itself — not inferred. */
  permitted_service_families: ServiceFamilyCode[];
  permitted_territories: string[];
  verification_source: string | null;
  verified_at: string | null;
  verified_by: string | null;
}

/**
 * TaxiD's own licensing position. Unresolved by design: the platform records
 * the question, counsel records the answer.
 */
export const LICENSING_DETERMINATION = {
  requirement: "LEGAL_REVIEW" as LicensingRequirement,
  candidate_categories: ["courier_hailing_service_provider", "courier_operator"],
  authority: "Communications Authority of Kenya",
  determined: false,
  determined_by: null as string | null,
  determined_at: null as string | null,
  evidence_reference: null as string | null,
  note:
    "The published market structure includes a courier-hailing category for platforms linking consumers with licensed courier operators. Whether TaxiD falls within it is a regulatory determination reserved to counsel; no surface may state a licensed status until a record exists here.",
};

const inDate = (from: string | null, until: string | null, now: Date) =>
  !!until && new Date(until).getTime() > now.getTime() && (!from || new Date(from).getTime() <= now.getTime());

export function licenceValid(l: PartnerLicenceRecord, now: Date = new Date()): { valid: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!l.licence_required) return { valid: true, blockers: [] };
  if (!l.licence_number) blockers.push("licence_number_missing");
  if (!l.licence_verified) blockers.push("licence_not_verified");
  if (l.status !== "ACTIVE") blockers.push(`licence_status_${l.status.toLowerCase()}`);
  if (!inDate(l.effective_from, l.expires_at, now)) blockers.push("licence_outside_validity_window");
  if (!l.verification_source || !l.verified_at) blockers.push("licence_verification_evidence_missing");
  return { valid: blockers.length === 0, blockers };
}

export function licenceScopeCovers(
  l: PartnerLicenceRecord,
  family: ServiceFamilyCode,
  territory: string,
): { covered: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!l.permitted_service_families.includes(family)) blockers.push("service_scope_not_permitted_by_licence");
  if (!l.permitted_territories.includes(territory)) blockers.push("territory_not_permitted_by_licence");
  return { covered: blockers.length === 0, blockers };
}

/* ------------------------------------------------------------------ *
 * Protection policy (replaces the primitive `insurance = true`)
 * ------------------------------------------------------------------ */

export type ProtectionStatus = "ACTIVE" | "LAPSED" | "PENDING" | "UNVERIFIED";

export interface ProtectionPolicyRecord {
  policy_id: string;
  provider: string;
  policy_type: "GOODS_IN_TRANSIT" | "CARRIER_LIABILITY" | "MARINE_CARGO" | "DECLARED_VALUE_COVER";
  policy_number: string;
  coverage_type: string;
  coverage_limit: number;
  currency: string;
  deductible: number;
  effective_from: string;
  expires_at: string;
  eligible_service_families: ServiceFamilyCode[];
  eligible_service_offerings: string[];
  eligible_vehicle_classes: FulfilmentMethod[];
  territory: string[];
  exclusions: string[];
  claim_procedure: string;
  status: ProtectionStatus;
  verified_at: string | null;
  verified_by: string | null;
  evidence_reference: string | null;
}

/**
 * No policy record exists yet. This empty registry is the reason FREIGHT_CARGO
 * (which requires cover) cannot be dispatched, and why the protection claim's
 * commitment level is NONE.
 */
export const PROTECTION_POLICIES: ProtectionPolicyRecord[] = [];

export interface ProtectionRequirementInput {
  offeringCode: string;
  vehicleClass: FulfilmentMethod;
  territory: string;
  declaredValue?: number;
  now?: Date;
}

export interface ProtectionVerdict {
  requirement: ProtectionAvailability;
  satisfied: boolean;
  policy_id: string | null;
  blockers: string[];
}

export function evaluateProtection(input: ProtectionRequirementInput): ProtectionVerdict {
  const now = input.now ?? new Date();
  const o = offering(input.offeringCode);
  if (!o) return { requirement: "NOT_AVAILABLE", satisfied: false, policy_id: null, blockers: ["unknown_service_offering"] };

  const required = o.compliance.requiresGoodsInTransitCover;
  const candidates = PROTECTION_POLICIES.filter(
    (p) =>
      p.status === "ACTIVE" &&
      !!p.verified_at &&
      inDate(p.effective_from, p.expires_at, now) &&
      (p.eligible_service_offerings.includes(o.code) || p.eligible_service_families.includes(o.family)) &&
      p.eligible_vehicle_classes.includes(input.vehicleClass) &&
      p.territory.includes(input.territory) &&
      (input.declaredValue === undefined || input.declaredValue <= p.coverage_limit),
  );

  if (!required) {
    return {
      requirement: candidates.length ? "OPTIONAL" : "NOT_AVAILABLE",
      satisfied: true,
      policy_id: candidates[0]?.policy_id ?? null,
      blockers: [],
    };
  }
  if (!candidates.length) {
    return {
      requirement: "CONDITIONAL",
      satisfied: false,
      policy_id: null,
      blockers: ["no_verified_protection_policy_covers_this_movement"],
    };
  }
  return { requirement: "INCLUDED", satisfied: true, policy_id: candidates[0].policy_id, blockers: [] };
}

/* ------------------------------------------------------------------ *
 * Restricted goods disposition table
 * ------------------------------------------------------------------ */

export const GOODS_DISPOSITION: Record<string, RestrictedGoodsDisposition> = {
  firearms: "PROHIBITED",
  narcotics: "PROHIBITED",
  explosives: "PROHIBITED",
  live_animals: "PROHIBITED",
  human_remains: "PROHIBITED",
  cash_currency: "PROHIBITED",
  counterfeit_goods: "PROHIBITED",
  batteries_lithium: "CONDITIONAL",
  aerosols: "CONDITIONAL",
  alcohol: "MANUAL_REVIEW",
  pharmaceuticals: "MANUAL_REVIEW",
  high_value_electronics: "CONDITIONAL",
  documents: "ALLOWED",
  general_merchandise: "ALLOWED",
};

export function dispositionFor(goods: string): RestrictedGoodsDisposition {
  return GOODS_DISPOSITION[goods] ?? "MANUAL_REVIEW";
}

export const JURISDICTION_BY_FAMILY: Record<ServiceFamilyCode, ServiceJurisdiction> = {
  PARCEL: "DOMESTIC",
  COURIER: "DOMESTIC",
  FREIGHT: "DOMESTIC",
  WAREHOUSING: "DOMESTIC",
  FULFILMENT: "DOMESTIC",
  CORPORATE: "DOMESTIC",
};

/** Combined compliance gate used before any dispatch job may be created. */
export interface ComplianceGateInput {
  offeringCode: string;
  licence: PartnerLicenceRecord;
  vehicleClass: FulfilmentMethod;
  territory: string;
  declaredGoods?: string[];
  declaredValue?: number;
  now?: Date;
}

export function evaluateComplianceGate(input: ComplianceGateInput): {
  allowed: boolean;
  requiresManualReview: boolean;
  blockers: string[];
} {
  const o = offering(input.offeringCode);
  if (!o) return { allowed: false, requiresManualReview: false, blockers: ["unknown_service_offering"] };

  const blockers: string[] = [];
  let manual = false;

  if (o.compliance.requiresPartnerLicence) {
    const v = licenceValid(input.licence, input.now);
    blockers.push(...v.blockers);
    const s = licenceScopeCovers(input.licence, o.family, input.territory);
    blockers.push(...s.blockers);
  }

  const protection = evaluateProtection({
    offeringCode: input.offeringCode,
    vehicleClass: input.vehicleClass,
    territory: input.territory,
    declaredValue: input.declaredValue,
    now: input.now,
  });
  if (!protection.satisfied) blockers.push(...protection.blockers);

  for (const g of input.declaredGoods ?? []) {
    const d = dispositionFor(g);
    if (d === "PROHIBITED") blockers.push(`prohibited_goods:${g}`);
    if (d === "CONDITIONAL" || d === "MANUAL_REVIEW") manual = true;
  }

  return { allowed: blockers.length === 0, requiresManualReview: manual, blockers };
}

/**
 * PLATFORM-LEVEL public commitment governance.
 *
 * Elevated out of logistics: every TaxiD service surface (mobility, charter,
 * rentals, delivery, corporate, partner marketplace) must resolve what it may
 * promise through this module.
 *
 * Law:
 *   effective = MIN(declared ceiling, evidence ceiling)
 *   GUARANTEED is never derived from evidence — it requires an explicit
 *   contractual declaration on top of BOOKABLE-grade evidence.
 *
 * The chain is: EVIDENCE → CAPABILITY → COMMITMENT → PUBLIC EXPOSURE →
 * BOOKING → DISPATCH. No layer may be skipped.
 */
import {
  PublicCommitmentLevel,
  COMMITMENT_ORDER,
  minCommitment,
  evidenceCeiling,
} from "@/lib/logistics/domain/commitment";
import type { CapabilityTruth } from "@/lib/logistics/domain/serviceCatalogue";

export type { PublicCommitmentLevel };
export { COMMITMENT_ORDER, minCommitment, evidenceCeiling };

const rank = (l: PublicCommitmentLevel) => COMMITMENT_ORDER.indexOf(l);

/** Surfaces governed by commitment level. */
export type GovernedSurface =
  | "website"          // may the service be advertised?
  | "ai_assistant"     // may the AI recommend it?
  | "pricing"          // may the platform return a binding price?
  | "booking"          // may a customer actually book it?
  | "dispatch"         // may an operational job be created?
  | "sla";             // may the system make a commitment?

/** Minimum effective level each surface requires. */
export const SURFACE_MINIMUM: Record<GovernedSurface, PublicCommitmentLevel> = {
  website: "INFORMATIONAL",
  ai_assistant: "ENQUIRY_ONLY",
  pricing: "ESTIMATE_ONLY",
  booking: "BOOKABLE",
  dispatch: "BOOKABLE",
  sla: "GUARANTEED",
};

export interface PlatformCommitmentInput {
  /** Stable identifier of the service/offering/claim. */
  code: string;
  /** Commercially declared ceiling — may lower, never raise. */
  declared: PublicCommitmentLevel;
  /** Evidence of what the platform can actually do. */
  capability: CapabilityTruth;
  /**
   * Contractual authority for GUARANTEED: a legal/contract record reference.
   * Without it, GUARANTEED is unreachable regardless of declaration.
   */
  contractualGuaranteeRef?: string | null;
  /** RETIRED services expose nothing. */
  retired?: boolean;
  /**
   * TEMPORAL VALIDITY. Evidence, licences, protection cover, SLA definitions,
   * contracts and rate plans all expire. Any expired or not-yet-effective item
   * degrades the effective commitment automatically — no human step required.
   */
  evidenceValidity?: EvidenceValidity[];
  /** Evaluation instant; defaults to now. */
  now?: string;
  /**
   * Strong GUARANTEED authority. A contract reference alone is NOT sufficient.
   * Every field must be present, approved and time-valid.
   */
  guaranteeAuthority?: GuaranteeAuthority | null;
}

export interface EvidenceValidity {
  kind:
    | "partner_licence"
    | "protection_policy"
    | "sla_definition"
    | "contract"
    | "rate_plan"
    | "capability_attestation"
    | "courier_document"
    | "vehicle_inspection";
  reference: string;
  valid_from: string;
  valid_to: string | null;
  revoked?: boolean;
}

export interface GuaranteeAuthority {
  contract_id: string;
  contract_version: number;
  contract_approved: boolean;
  offering_code: string;
  serviceability_confirmed: boolean;
  effective_from: string;
  effective_to: string | null;
  sla_definition_ref: string | null;
  operational_capability_confirmed: boolean;
  capacity_confirmed: boolean;
  compliance_confirmed: boolean;
  commercial_owner_approval: { approver_id: string; approved_at: string } | null;
}

export interface TemporalAssessment {
  valid: boolean;
  expired: string[];
  notYetEffective: string[];
  revoked: string[];
}

export function assessTemporalValidity(items: EvidenceValidity[] = [], now = new Date().toISOString()): TemporalAssessment {
  const t = Date.parse(now);
  const expired = items.filter((i) => i.valid_to !== null && Date.parse(i.valid_to) <= t).map((i) => `${i.kind}:${i.reference}`);
  const notYetEffective = items.filter((i) => Date.parse(i.valid_from) > t).map((i) => `${i.kind}:${i.reference}`);
  const revoked = items.filter((i) => i.revoked).map((i) => `${i.kind}:${i.reference}`);
  return { valid: expired.length === 0 && notYetEffective.length === 0 && revoked.length === 0, expired, notYetEffective, revoked };
}

/** Every clause of the strong GUARANTEED gate, evaluated explicitly. */
export function guaranteeAuthorityBlockers(a: GuaranteeAuthority | null | undefined, now = new Date().toISOString()): string[] {
  if (!a) return ["no_guarantee_authority"];
  const blockers: string[] = [];
  const t = Date.parse(now);
  if (!a.contract_id) blockers.push("contract_missing");
  if (!a.contract_version) blockers.push("contract_version_missing");
  if (!a.contract_approved) blockers.push("contract_not_approved");
  if (!a.offering_code) blockers.push("offering_missing");
  if (!a.serviceability_confirmed) blockers.push("route_serviceability_unconfirmed");
  if (Date.parse(a.effective_from) > t) blockers.push("contract_not_yet_effective");
  if (a.effective_to && Date.parse(a.effective_to) <= t) blockers.push("contract_expired");
  if (!a.sla_definition_ref) blockers.push("sla_definition_missing");
  if (!a.operational_capability_confirmed) blockers.push("operational_capability_unconfirmed");
  if (!a.capacity_confirmed) blockers.push("capacity_unconfirmed");
  if (!a.compliance_confirmed) blockers.push("compliance_unconfirmed");
  if (!a.commercial_owner_approval?.approver_id) blockers.push("commercial_approval_missing");
  return blockers;
}


export interface PlatformCommitmentResolution {
  code: string;
  declared: PublicCommitmentLevel;
  evidence: PublicCommitmentLevel;
  /** Ceiling imposed by time-validity of licences, cover, SLA, contract, rates. */
  temporal: PublicCommitmentLevel;
  effective: PublicCommitmentLevel;
  permitted: Record<GovernedSurface, boolean>;
  /** Why the effective level was capped, when it was. */
  cappedBy: "declaration" | "evidence" | "retirement" | "guarantee_authority" | "temporal_validity" | null;
  temporalAssessment: TemporalAssessment;
  guaranteeBlockers: string[];
}

/**
 * effective = MIN(declared, evidence, temporal validity)
 * and GUARANTEED additionally requires a complete, approved, time-valid
 * guarantee authority — never a bare contract reference.
 */
export function resolveCommitment(input: PlatformCommitmentInput): PlatformCommitmentResolution {
  const now = input.now ?? new Date().toISOString();
  const evidence = evidenceCeiling(input.capability);
  const temporalAssessment = assessTemporalValidity(input.evidenceValidity, now);
  // Expired/revoked evidence degrades capability claims to enquiry-only.
  const temporal: PublicCommitmentLevel = temporalAssessment.valid ? "GUARANTEED" : "ENQUIRY_ONLY";
  const guaranteeBlockers = guaranteeAuthorityBlockers(input.guaranteeAuthority, now);

  let effective: PublicCommitmentLevel;
  let cappedBy: PlatformCommitmentResolution["cappedBy"] = null;

  if (input.retired) {
    effective = "NONE";
    cappedBy = "retirement";
  } else if (input.declared === "GUARANTEED" && guaranteeBlockers.length > 0) {
    // GUARANTEED is never derived and never asserted by configuration or a bare
    // contract reference alone.
    effective = minCommitment(minCommitment("BOOKABLE", evidence), temporal);
    cappedBy = temporalAssessment.valid ? "guarantee_authority" : "temporal_validity";
  } else if (input.declared === "GUARANTEED" && evidence === "BOOKABLE" && temporalAssessment.valid) {
    effective = "GUARANTEED";
  } else {
    effective = minCommitment(minCommitment(input.declared, evidence), temporal);
    if (!temporalAssessment.valid && rank(temporal) < rank(minCommitment(input.declared, evidence))) cappedBy = "temporal_validity";
    else if (effective !== input.declared) cappedBy = "evidence";
    else if (rank(input.declared) < rank(evidence)) cappedBy = "declaration";
  }

  const permitted = Object.fromEntries(
    (Object.keys(SURFACE_MINIMUM) as GovernedSurface[]).map((s) => [
      s,
      rank(effective) >= rank(SURFACE_MINIMUM[s]),
    ]),
  ) as Record<GovernedSurface, boolean>;

  return { code: input.code, declared: input.declared, evidence, temporal, effective, permitted, cappedBy, temporalAssessment, guaranteeBlockers };
}


/** Single question every surface should ask before rendering or acting. */
export function permits(surface: GovernedSurface, input: PlatformCommitmentInput): boolean {
  return resolveCommitment(input).permitted[surface];
}

/** Guard for imperative paths (booking handlers, dispatch creation, pricing APIs). */
export function assertPermitted(surface: GovernedSurface, input: PlatformCommitmentInput): void {
  const r = resolveCommitment(input);
  if (!r.permitted[surface]) {
    throw new Error(
      `commitment_violation: ${input.code} is ${r.effective}; ${surface} requires ${SURFACE_MINIMUM[surface]}`,
    );
  }
}

/**
 * PUBLIC_COMMITMENT_LEVEL — the commercial-claims firewall.
 *
 * Capability truth (implemented/configured/integrated/operational/verified)
 * describes what the platform can DO. Commitment level describes what the
 * platform may PROMISE. They are different things and must not be conflated.
 *
 * The effective commitment is the MINIMUM of:
 *   a) the level the capability evidence can support (derived, never asserted), and
 *   b) the declared commercial ceiling for that offering or claim.
 *
 * Every public surface (website, booking engine, AI assistant, API, admin,
 * service catalogue) must read the effective level from here.
 */
import { CapabilityTruth, ServiceOffering, SERVICE_OFFERINGS, offering } from "./serviceCatalogue";

export type PublicCommitmentLevel =
  | "NONE"
  | "INFORMATIONAL"
  | "ENQUIRY_ONLY"
  | "ESTIMATE_ONLY"
  | "BOOKABLE"
  | "GUARANTEED";

export const COMMITMENT_ORDER: PublicCommitmentLevel[] = [
  "NONE",
  "INFORMATIONAL",
  "ENQUIRY_ONLY",
  "ESTIMATE_ONLY",
  "BOOKABLE",
  "GUARANTEED",
];

const rank = (l: PublicCommitmentLevel) => COMMITMENT_ORDER.indexOf(l);

export function minCommitment(a: PublicCommitmentLevel, b: PublicCommitmentLevel): PublicCommitmentLevel {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Ceiling supported by evidence alone.
 *  - nothing implemented                     → NONE
 *  - implemented only                        → INFORMATIONAL
 *  - implemented + configured                → ENQUIRY_ONLY
 *  - + integrated (not operational)          → ENQUIRY_ONLY
 *  - + operational (not verified)            → ESTIMATE_ONLY
 *  - + verified                              → BOOKABLE
 * GUARANTEED is never derived: it requires a contractual/legal record and must
 * be declared explicitly, and only where evidence already supports BOOKABLE.
 */
export function evidenceCeiling(c: CapabilityTruth): PublicCommitmentLevel {
  if (!c.implemented) return "NONE";
  if (!c.configured) return "INFORMATIONAL";
  if (!c.operational) return "ENQUIRY_ONLY";
  if (!c.verified) return "ESTIMATE_ONLY";
  return "BOOKABLE";
}

/**
 * Declared commercial ceiling per offering. Product/commercial may lower this
 * at will; they may never raise the effective level above the evidence ceiling.
 */
export const DECLARED_COMMITMENT: Record<string, PublicCommitmentLevel> = {
  PARCEL_STANDARD: "BOOKABLE",
  COURIER_DOCUMENT: "BOOKABLE",
  EXPRESS_CITY: "BOOKABLE",
  FREIGHT_CARGO: "ENQUIRY_ONLY",
  ECOMMERCE_FULFILMENT: "INFORMATIONAL",
};

export function effectiveCommitment(o: ServiceOffering): PublicCommitmentLevel {
  if (o.status === "RETIRED") return "NONE";
  const declared = DECLARED_COMMITMENT[o.code] ?? "INFORMATIONAL";
  return minCommitment(declared, evidenceCeiling(o.capability));
}

export function commitmentForOffering(code: string): PublicCommitmentLevel {
  const o = offering(code);
  return o ? effectiveCommitment(o) : "NONE";
}

/**
 * Non-offering claims (SLA promises, protection, coverage statements) carry
 * their own commitment level so a target can never be rendered as a guarantee.
 */
export interface ClaimCommitment {
  claim: string;
  surface: "website" | "booking" | "assistant" | "api" | "admin" | "catalogue";
  capability: CapabilityTruth;
  declared: PublicCommitmentLevel;
}

export const CLAIM_COMMITMENTS: ClaimCommitment[] = [
  {
    claim: "sub_60_minute_pickup",
    surface: "website",
    capability: { implemented: true, configured: true, integrated: true, operational: true, verified: false },
    declared: "ESTIMATE_ONLY",
  },
  {
    claim: "24_7_operations",
    surface: "website",
    capability: { implemented: true, configured: true, integrated: false, operational: false, verified: false },
    declared: "INFORMATIONAL",
  },
  {
    claim: "goods_in_transit_insurance",
    surface: "website",
    capability: { implemented: false, configured: false, integrated: false, operational: false, verified: false },
    declared: "NONE",
  },
  {
    claim: "licensed_courier_operations",
    surface: "website",
    capability: { implemented: false, configured: false, integrated: false, operational: false, verified: false },
    declared: "NONE",
  },
];

export function effectiveClaimCommitment(c: ClaimCommitment): PublicCommitmentLevel {
  return minCommitment(c.declared, evidenceCeiling(c.capability));
}

/** UI affordances permitted at a given commitment level. */
export interface CommitmentAffordances {
  bookNow: boolean;
  getQuote: boolean;
  requestInformation: boolean;
  talkToLogistics: boolean;
  displayPublicly: boolean;
  mayStateAsGuarantee: boolean;
}

export function affordances(level: PublicCommitmentLevel): CommitmentAffordances {
  return {
    bookNow: rank(level) >= rank("BOOKABLE"),
    getQuote: rank(level) >= rank("ESTIMATE_ONLY"),
    requestInformation: rank(level) >= rank("ENQUIRY_ONLY"),
    talkToLogistics: rank(level) >= rank("ENQUIRY_ONLY"),
    displayPublicly: rank(level) >= rank("INFORMATIONAL"),
    mayStateAsGuarantee: level === "GUARANTEED",
  };
}

/** Governance matrix row used by the report and admin surface. */
export function commitmentMatrix() {
  return SERVICE_OFFERINGS.map((o) => {
    const level = effectiveCommitment(o);
    return {
      code: o.code,
      name: o.name,
      capability: o.capability,
      evidenceCeiling: evidenceCeiling(o.capability),
      declared: DECLARED_COMMITMENT[o.code] ?? "INFORMATIONAL",
      effective: level,
      affordances: affordances(level),
    };
  });
}

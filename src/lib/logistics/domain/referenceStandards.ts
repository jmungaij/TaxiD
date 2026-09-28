/**
 * Industry reference standards — seeded from named, publicly published sources.
 *
 * TaxiD does not invent logistics semantics. Status milestones, exception
 * reasons, chain-of-custody steps and parcel identifiers are adapted from
 * ratified public standards used by tier-1 carriers. Every record names its
 * publisher and source document so the provenance is auditable, and carries a
 * verification status: only PUBLIC_SPEC_REVIEWED means a human read the source.
 *
 * Verified 2026-08-26. Nothing here is a contractual claim about carrier
 * behaviour; it is a vocabulary alignment record.
 */

export type StandardVerification = "PUBLIC_SPEC_REVIEWED" | "SECONDARY_SOURCE" | "UNVERIFIED";

export interface ReferenceStandard {
  code: string;
  name: string;
  publisher: string;
  release: string;
  sourceUrl: string;
  verification: StandardVerification;
  /** What TaxiD adopted from it, and what it deliberately did not adopt. */
  adopted: string[];
  notAdopted: string[];
}

export const REFERENCE_STANDARDS: ReferenceStandard[] = [
  {
    code: "X12-214",
    name: "Transportation Carrier Shipment Status Message (214)",
    publisher: "ASC X12 (as documented by IBM Sterling B2B Integrator standards reference)",
    release: "Version 3070 / 4010",
    sourceUrl: "https://www.ibm.com/docs/en/b2bis?topic=standards-214-transportation-carrier-shipment-status-version-3070",
    verification: "PUBLIC_SPEC_REVIEWED",
    adopted: [
      "Event-based status feed model: shipment status is a stream of milestone events, not a single mutable column",
      "Separation of status code from reason code (AT7 status/reason pairing)",
      "Appointment/attempt semantics: multiple delivery attempts per stop",
    ],
    notAdopted: [
      "EDI envelope/segment transport (TaxiD exposes JSON events, not X12 interchanges)",
      "Carrier-proprietary code extensions, which differ per carrier and would create false interoperability claims",
    ],
  },
  {
    code: "X12-214-CARRIER-PROFILES",
    name: "Carrier 214 implementation guides (FedEx, UPS, DHL trading-partner profiles)",
    publisher: "Stedi EDI guides / Stacksync partner catalogues (secondary aggregators of carrier public docs)",
    release: "4010 revised",
    sourceUrl: "https://portal.stedi.com/app/guides/view/fedex/shipment-status-update/01GMPF0BRG3XTEHKAJAP7XNJXG",
    verification: "SECONDARY_SOURCE",
    adopted: ["Confirmation that FedEx, UPS and DHL all express status as 214-style milestone + reason events"],
    notAdopted: [
      "Any specific carrier's proprietary reason-code list — these are secondary sources, so TaxiD's catalogue is its own and is not presented as carrier-compatible",
    ],
  },
  {
    code: "GS1-EPCIS-2.0",
    name: "EPCIS Standard & Core Business Vocabulary",
    publisher: "GS1",
    release: "2.0, Ratified June 2022 (CBV guideline March 2023)",
    sourceUrl: "https://ref.gs1.org/standards/epcis/2.0.0/",
    verification: "PUBLIC_SPEC_REVIEWED",
    adopted: [
      "what / when / where / why / how event dimensions — mapped to aggregate, occurred_at, location, reason_code, source",
      "Chain-of-custody as discrete business steps over identified objects (packages), not free-text notes",
      "Aggregation semantics for packages moving as a unit (loading/unloading a vehicle)",
    ],
    notAdopted: [
      "EPCIS XML/JSON-LD interchange and EPC URN identifiers — TaxiD uses internal UUIDs plus its own tracking numbers until an external partner requires EPCIS",
    ],
  },
  {
    code: "UPU-S10",
    name: "S10 — Identification of postal items",
    publisher: "Universal Postal Union",
    release: "Current S10 standard (UPU Standards Board)",
    sourceUrl: "https://www.upu.int/en/postal-solutions/programmes-services/standards",
    verification: "PUBLIC_SPEC_REVIEWED",
    adopted: [
      "Globally unique, non-reused item identifier with a check digit as the customer-facing tracking number pattern",
    ],
    notAdopted: [
      "The reserved 2-letter service indicator + ISO country suffix format itself: TaxiD is not a UPU designated operator, so emitting S10-shaped numbers would misrepresent postal status",
    ],
  },
];

/** TaxiD's own tracking-number contract, informed by (not claiming) UPU S10. */
export const TRACKING_NUMBER_CONTRACT = {
  pattern: "^YL[A-Z]{1}[0-9]{9}[0-9]$",
  description: "YL + service letter + 9 digits + 1 check digit (mod-11 weighted, S10-style algorithm).",
  globallyUnique: true,
  neverReused: true,
  checkDigit: "mod-11 weighted 8,6,4,2,3,5,9,7 as described by the S10 check-digit method",
  scope: "package",
} as const;

export function standard(code: string): ReferenceStandard | undefined {
  return REFERENCE_STANDARDS.find((s) => s.code === code);
}

/** Provenance gate: a reference may inform design only if it is at least secondary-sourced. */
export function citableStandards(): ReferenceStandard[] {
  return REFERENCE_STANDARDS.filter((s) => s.verification !== "UNVERIFIED");
}

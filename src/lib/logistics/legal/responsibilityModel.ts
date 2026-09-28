/**
 * PARTY & RESPONSIBILITY MODEL.
 *
 * TaxiD is a digital technology marketplace. It facilitates discovery,
 * matching, booking, payment and settlement. The independent Fleet Owner /
 * Transport Service Provider performs the physical transport service and owns
 * the carrier-side licensing, insurance, vehicle, driver and fulfilment
 * obligations.
 *
 * This module does NOT clear, assert or score any legal control. It states, for
 * each existing LG control, WHICH PARTY owns the obligation and WHERE the
 * authoritative evidence lives, so the legal register stops evidencing
 * carrier-side obligations at platform level and stops treating one Fleet
 * Owner's document pack as network-wide compliance.
 */

export type ResponsibleParty = "PLATFORM" | "FLEET_OWNER" | "VEHICLE" | "DRIVER" | "CLIENT";

export interface ControlResponsibility {
  control_id: string;
  title: string;
  /** The party that must hold the underlying obligation. */
  party: ResponsibleParty;
  /** Where the authoritative evidence is stored in this system. */
  system_of_record: string;
  /**
   * Whether the control is satisfied once (platform-level document) or must be
   * satisfied by EVERY member of a population (each Fleet Owner / vehicle / driver).
   */
  evidence_scope: "SINGLE_DOCUMENT" | "POPULATION";
  /** What the platform itself is still obliged to do for this control. */
  platform_obligation: string;
}

export const CONTROL_RESPONSIBILITY: ControlResponsibility[] = [
  {
    control_id: "LG-01",
    title: "Platform regulatory classification (is TaxiD an intermediary or a carrier?)",
    party: "PLATFORM",
    system_of_record: "Legal determination — external counsel opinion + company approval",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "Obtain and record a counsel determination on whether the operating model (algorithmic matching, price presentation, payment facilitation, transaction records) causes TaxiD to be regulated as a carrier, agent or marketplace intermediary. Not resolvable by architecture description alone.",
  },
  {
    control_id: "LG-02",
    title: "Transport operator / goods carriage authority",
    party: "FLEET_OWNER",
    system_of_record: "carrier_compliance_items (FO-CAK-COURIER-LICENCE, FO-TRANSPORT-LICENCE)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Require, verify and expiry-track each Fleet Owner's own operating authority before exposing it to clients. TaxiD does not hold this licence.",
  },
  {
    control_id: "LG-03",
    title: "Driver licensing / PSV / professional eligibility",
    party: "DRIVER",
    system_of_record: "carrier_compliance_items at DRIVER level (DRV-LICENCE, DRV-PSV-BADGE)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Block assignment of any driver whose licence or professional badge is missing, unverified or expired.",
  },
  {
    control_id: "LG-04",
    title: "Vehicle inspection / roadworthiness",
    party: "VEHICLE",
    system_of_record: "carrier_compliance_items at VEHICLE level (VEH-INSPECTION, VEH-REGISTRATION)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Block dispatch of any vehicle whose inspection is missing, unverified or expired.",
  },
  {
    control_id: "LG-05",
    title: "Motor / third-party insurance",
    party: "FLEET_OWNER",
    system_of_record: "carrier_compliance_items (FO-MOTOR-INSURANCE, VEH-INSURANCE)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Require insurer, policy number, cover, limits, effective and expiry dates per Fleet Owner and per vehicle. Any platform-level cover TaxiD holds must never be presented as replacing this.",
  },
  {
    control_id: "LG-06",
    title: "Goods-in-transit / cargo liability cover",
    party: "FLEET_OWNER",
    system_of_record: "carrier_compliance_items (FO-GIT-INSURANCE)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Verify cargo cover applies to the service being offered; refuse eligibility on expiry.",
  },
  {
    control_id: "LG-07",
    title: "Restricted goods control",
    party: "PLATFORM",
    system_of_record: "Configurable platform goods rule register + Fleet Owner undertaking",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "Maintain the marketplace rule and the declaration/screening/refusal mechanism. The classification list stays configurable — TaxiD does not own an immutable legal catalogue of restricted items.",
  },
  {
    control_id: "LG-08",
    title: "Prohibited goods control",
    party: "PLATFORM",
    system_of_record: "Configurable platform goods rule register + PROHIBITED_GOODS_UNDERTAKING declaration",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "Prohibit platform use for goods prohibited or sanctioned under applicable law or government directive; obtain the Fleet Owner's operational compliance undertaking covering controlled substances, firearms, hazmat, sanctioned, stolen and counterfeit goods.",
  },
  {
    control_id: "LG-09",
    title: "Claims handling",
    party: "FLEET_OWNER",
    system_of_record: "Fleet Owner Agreement + claims workflow",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Operate the dispute/claims workflow and route the claim to the responsible Fleet Owner. TaxiD is not the carrier and does not underwrite the loss.",
  },
  {
    control_id: "LG-10",
    title: "Liability allocation and limitation",
    party: "PLATFORM",
    system_of_record: "Platform terms of service (intermediary allocation)",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "Disclose the intermediary model before the client commits, allocate transport performance to the Fleet Owner, and preserve any liability that cannot lawfully be excluded. No blanket zero-liability clause.",
  },
  {
    control_id: "LG-11",
    title: "Terms of carriage / client terms",
    party: "PLATFORM",
    system_of_record: "Platform terms + Fleet Owner Agreement",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "State that the transport service agreement is between the client and the Fleet Owner, and that TaxiD facilitates the transaction and, at the client's instruction, the payment.",
  },
  {
    control_id: "LG-12",
    title: "Fleet Owner / Transport Service Provider Agreement",
    party: "FLEET_OWNER",
    system_of_record: "carrier_declarations (FLEET_OWNER_AGREEMENT) + carrier_contracts",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Load-bearing document. Must be accepted during onboarding — never discovered after a booking exists. Carries licensing warranties, insurance obligations, driver and agent responsibility, subcontracting ban, disclosure of lapse, audit rights, suspension rights and indemnity.",
  },
  {
    control_id: "LG-13",
    title: "Data protection registration",
    party: "PLATFORM",
    system_of_record: "Platform compliance register — existing active data protection certificate",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "TaxiD is the controller for client and consignment data regardless of who drives. Record the existing certificate, its status and renewal date; do not create a duplicate certification workflow.",
  },
  {
    control_id: "LG-14",
    title: "Data processing governance",
    party: "PLATFORM",
    system_of_record: "Processing register",
    evidence_scope: "SINGLE_DOCUMENT",
    platform_obligation:
      "Maintain the processing register and processor terms. The Fleet Owner separately complies for data it processes in performing its service.",
  },
  {
    control_id: "LG-15",
    title: "Cross-border / customs carriage",
    party: "FLEET_OWNER",
    system_of_record: "carrier_compliance_items (corridor-specific authority)",
    evidence_scope: "POPULATION",
    platform_obligation:
      "Require corridor-specific authority from the Fleet Owner before exposing cross-border capacity.",
  },
];

export function responsibilityFor(controlId: string): ControlResponsibility | null {
  return CONTROL_RESPONSIBILITY.find((c) => c.control_id === controlId) ?? null;
}

/** Controls that can never be cleared by a single document at platform level. */
export function populationScopedControls(): ControlResponsibility[] {
  return CONTROL_RESPONSIBILITY.filter((c) => c.evidence_scope === "POPULATION");
}

/**
 * Authoritative client-facing disclosure. Used wherever the platform's role must
 * be stated before the client commits. Deliberately preserves mandatory law.
 */
export const FACILITATOR_DISCLOSURE = `TaxiD operates a digital technology platform that facilitates connections and transactions between clients and independent Fleet Owners / Transport Service Providers. TaxiD does not own or operate the Fleet Owner's vehicles or vessels and does not itself perform the underlying transportation service.

The transportation service is provided by the Fleet Owner directly to the client. The Fleet Owner remains responsible for the lawful, safe and proper performance of that service, including its vehicles, vessels, drivers, personnel, licences, permits, insurance, cargo handling, regulatory compliance and delivery obligations.

Where TaxiD facilitates payment at the client's instruction, that facilitation does not, by itself, constitute an assumption by TaxiD of the Fleet Owner's transport obligations.

Nothing in these terms purports to exclude or limit liability that cannot lawfully be excluded or limited.`;

/** Short attribution line for bookings, invoices, PODs and tracking surfaces. */
export function serviceAttribution(fleetOwnerName: string | null | undefined): string {
  const provider = fleetOwnerName?.trim() || "the assigned Fleet Owner";
  return `Transport service provided by ${provider}. Transaction facilitated by TaxiD.`;
}

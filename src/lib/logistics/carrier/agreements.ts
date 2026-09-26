/**
 * FLEET OWNER CONTRACTUAL INSTRUMENTS — derived from the LG-01…LG-15
 * responsibility model in src/lib/logistics/legal/responsibilityModel.ts.
 *
 * These are the exact texts presented to the Fleet Owner's signatory. The
 * database hashes the text that was actually displayed (SHA-256) so the accepted
 * version is tamper-evident.
 *
 * LEGAL POSTURE
 *  - SAFARID is a digital marketplace and transaction-facilitation
 *    platform. It does not own or operate the Fleet Owner's assets or personnel.
 *  - These instruments ALLOCATE responsibility. They do not, and must not, purport
 *    to exclude mandatory law.
 *  - LG-01 (the platform's own regulatory characterisation) remains a legal
 *    determination reserved to counsel and is deliberately NOT asserted here.
 */

export type DeclarationInstrumentCode =
  | "FLEET_OWNER_AGREEMENT"
  | "PROHIBITED_GOODS_UNDERTAKING"
  | "INDEMNITY_ACCEPTANCE";

export interface DeclarationInstrument {
  code: DeclarationInstrumentCode;
  version: string;
  title: string;
  summary: string;
  /** Ordered clauses shown to the signatory; the concatenation is what is hashed. */
  clauses: string[];
  /** Legal register controls this instrument evidences. */
  legalControls: string[];
}

const AGREEMENT: DeclarationInstrument = {
  code: "FLEET_OWNER_AGREEMENT",
  version: "v1",
  title: "SAFARID Fleet Owner / Transport Service Provider Agreement",
  summary:
    "Establishes that you provide the transport service independently and that SAFARID provides only the technology that facilitates the transaction.",
  legalControls: ["LG-02", "LG-03", "LG-04", "LG-05", "LG-06", "LG-09", "LG-10", "LG-11"],
  clauses: [
    "1. Independent provider. You (the Fleet Owner / Transport Service Provider) provide the underlying physical transportation service to the Client in your own name, at your own risk and under your own operating authority. SAFARID Limited operates a digital marketplace and transaction-facilitation platform and does not provide the physical transportation service.",
    "2. Assets. You own, lease or otherwise lawfully control every vehicle, vessel or other asset you present on the platform, and you remain solely responsible for its roadworthiness, maintenance, inspection and lawful use.",
    "3. Personnel. Drivers, crew, loaders and agents you deploy are engaged by you and are not employees, workers or agents of SAFARID. You are responsible for their engagement, conduct, supervision, remuneration and statutory entitlements.",
    "4. Licences and authorisations. You hold and will maintain in force every licence, permit and operating authority required for your operation, including any courier, public service or goods-carriage authorisation applicable to the services you accept.",
    "5. Insurance. You hold and will maintain motor insurance and, where applicable, goods-in-transit or passenger liability cover appropriate to the services you accept, and you will produce the policy or certificate on request.",
    "6. Verification. You authorise SAFARID to verify the documents you submit, to record their status and expiry, and to suspend your access to the marketplace where mandatory evidence is missing, unverified, expired, suspended or revoked.",
    "7. Notification. You will notify SAFARID immediately if any licence, permit, inspection or insurance is suspended, revoked, cancelled or expires, and you will not accept bookings during any such period.",
    "8. Fulfilment. You are responsible for collection, custody, carriage, care and delivery of the Client's goods or the carriage of passengers, and for the accuracy of the delivery evidence you capture.",
    "9. Compliance with law. You will comply with all applicable law, regulatory directives and sanctions applicable to your operation, including road transport, labour, tax, safety and data obligations.",
    "10. Subcontracting. You will not subcontract a booking without disclosure, and where you do subcontract you remain responsible to the Client and to SAFARID for performance and for your subcontractor's compliance.",
    "11. Platform role and payment facilitation. SAFARID may present indicative or marketplace pricing, match capacity, collect the Client's payment at the Client's instruction, record your economic entitlement in your Fleet Owner wallet and settle it to your verified destination. None of these technology or payment-facilitation functions transfers your operational obligations to SAFARID.",
    "12. Suspension. You accept that non-compliance, expired evidence, safety concerns or unlawful conduct may result in immediate suspension of your marketplace access, and that suspension is applied by the platform's automated compliance controls.",
    "13. Records. You will keep the records required by law and by this Agreement and will make them available for verification, audit or regulatory enquiry.",
    "14. Mandatory law. Nothing in this Agreement excludes or limits any liability or obligation that cannot lawfully be excluded or limited, and nothing in it makes SAFARID responsible for obligations that are yours as the transport service provider.",
  ],
};

const PROHIBITED_GOODS: DeclarationInstrument = {
  code: "PROHIBITED_GOODS_UNDERTAKING",
  version: "v1",
  title: "Prohibited and Restricted Goods Undertaking",
  summary:
    "SAFARID prohibits unlawful and restricted consignments on the marketplace. You undertake to comply with the law that applies to what you actually carry.",
  legalControls: ["LG-07", "LG-08"],
  clauses: [
    "1. Marketplace prohibition. SAFARID prohibits the booking, listing or carriage through the platform of any goods, substance, item or activity that is prohibited or restricted under applicable law, sanctions, government directive or regulatory requirement. The platform's prohibited and restricted categories are configurable and are updated as legal requirements change; they are control rules and are not a permanent or exhaustive statement of the law.",
    "2. Your legal compliance. You undertake that you understand the restrictions applicable to your operation and that you will not knowingly accept, load, carry or deliver a prohibited consignment through the platform.",
    "3. Dangerous and hazardous goods. You will comply with the requirements applicable to dangerous, hazardous, flammable, explosive, radioactive or otherwise regulated goods, including packaging, labelling, documentation, vehicle suitability and driver competence, and you will not accept such goods unless you hold the required authorisation.",
    "4. Controlled substances. You will comply with all controlled-substance, narcotics, pharmaceutical and precursor-chemical restrictions.",
    "5. Weapons. You will comply with all firearms, ammunition, weapons and military or dual-use goods restrictions.",
    "6. Sanctions and unlawful trade. You will not use the platform in connection with sanctioned parties or destinations, smuggling, counterfeit goods, protected wildlife or trafficking of any kind.",
    "7. Personnel. You will ensure that your drivers, crew, agents and subcontractors are instructed in, and comply with, these restrictions.",
    "8. Reporting and refusal. You will refuse or stop a movement where you know or reasonably suspect that the consignment is prohibited or restricted, and you will report it to the relevant authority and to SAFARID.",
    "9. Responsibility. You accept responsibility for breaches originating on your side of the transaction, including acts and omissions of your drivers, agents and subcontractors, and you accept that a breach may result in immediate suspension of marketplace access.",
  ],
};

const INDEMNITY: DeclarationInstrument = {
  code: "INDEMNITY_ACCEPTANCE",
  version: "v1",
  title: "Fleet Owner Indemnity and Responsibility Allocation",
  summary:
    "Allocates Fleet Owner-side risk to the Fleet Owner, to the extent permitted by law. It does not exclude mandatory liability.",
  legalControls: ["LG-09", "LG-10", "LG-11", "LG-12"],
  clauses: [
    "1. Indemnity. To the fullest extent permitted by applicable law, you will indemnify and hold harmless SAFARID Limited, its officers and employees against claims, losses, fines, penalties, damages and reasonable costs arising out of: (a) your provision or non-provision of the transport service; (b) loss of, damage to or delay of goods in your custody; (c) injury to persons or property caused by your vehicles, drivers, agents or subcontractors; (d) your breach of licence, permit, inspection, insurance or other regulatory requirements; (e) your carriage of prohibited or restricted goods; and (f) your breach of this or any other instrument accepted on the platform.",
    "2. Insurance first. Your indemnity is supported by, and does not replace, the insurance you are required to maintain. You will notify your insurer of a claim where the policy requires it and will cooperate in its handling.",
    "3. Claims cooperation. You will provide the documents, delivery evidence, incident reports and contact details reasonably required to investigate and resolve a Client claim or a regulatory enquiry.",
    "4. Platform obligations retained. SAFARID remains responsible for its own obligations, including the operation and security of the platform, the accuracy of the transaction records it generates, its handling of personal data and the payment-facilitation and settlement workflow it operates.",
    "5. No exclusion of mandatory law. This indemnity does not exclude, restrict or modify any liability or right that cannot lawfully be excluded, restricted or modified, and it does not purport to transfer to you any obligation that the law imposes on SAFARID.",
    "6. Survival. This allocation of responsibility survives suspension or termination of your marketplace access in respect of matters arising before it took effect.",
  ],
};

export const FLEET_OWNER_INSTRUMENTS: DeclarationInstrument[] = [
  AGREEMENT,
  PROHIBITED_GOODS,
  INDEMNITY,
];

/** The exact text presented to, and hashed for, the signatory. */
export function instrumentText(i: DeclarationInstrument): string {
  return [`${i.title} (${i.version})`, i.summary, ...i.clauses].join("\n\n");
}

export function findInstrument(code: DeclarationInstrumentCode): DeclarationInstrument {
  const found = FLEET_OWNER_INSTRUMENTS.find((i) => i.code === code);
  if (!found) throw new Error(`Unknown instrument ${code}`);
  return found;
}

/**
 * Client-facing terms summary — the counterpart disclosure shown to Clients so the
 * marketplace does not misrepresent who performs the service.
 */
export const CLIENT_TERMS_SUMMARY = [
  "SAFARID operates a digital marketplace that connects you with independent Fleet Owners / Transport Service Providers.",
  "The Fleet Owner shown on your booking provides the vehicle, the driver and the physical transport service.",
  "SAFARID facilitates discovery, matching, booking, pricing presentation, payment collection at your instruction, notifications, transaction records and delivery evidence.",
  "The Fleet Owner holds the licences, permits, inspections and insurance required for the service it performs.",
  "SAFARID remains responsible for the platform, the transaction records it generates, its handling of your personal data and the payment workflow it operates.",
];

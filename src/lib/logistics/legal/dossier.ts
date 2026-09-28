/**
 * LG LEGAL DOSSIER — LG-01…LG-15 + LG-GOODS.
 *
 * This module is a DOCUMENT SPECIFICATION LIBRARY, not a second readiness
 * engine, evidence store, approval mechanism or document-management system.
 * It supplies, for every legal control already defined in the readiness
 * register:
 *
 *   • the Documents 360 location the evidence must live in;
 *   • the controlled draft legal determination to be filed there;
 *   • the true evidentiary state of that draft;
 *   • the operational control the approved document would authorise.
 *
 * ABSOLUTE RULE — nothing here asserts a licence, insurance policy, legal
 * opinion, regulator approval, effective date or expiry date. Every seeded
 * document is a DRAFT for authorised legal review. Only the existing evidence
 * + approval RPCs (with server-side separation of duties) can clear a control.
 */

export type LgProvenance =
  | "INTERNAL_DOCUMENT"
  | "REGULATOR_DOCUMENT"
  | "INSURER_DOCUMENT"
  | "EXTERNAL_COUNSEL_DOCUMENT"
  | "CUSTOMER_CONTRACT"
  | "PARTNER_CONTRACT"
  | "COMPANY_APPROVAL";

export type LgEvidenceType =
  | "LEGAL_DETERMINATION"
  | "POLICY"
  | "REGULATORY_LICENCE"
  | "INSURANCE_POLICY"
  | "CONTRACT"
  | "TERMS_OF_SERVICE"
  | "DATA_PROTECTION_DOCUMENT";

/** The true evidentiary state of a seeded draft, before any human action. */
export type LgDraftState =
  | "LEGAL_REVIEW_REQUIRED"
  | "EVIDENCE_REQUIRED"
  | "INSURANCE_EVIDENCE_REQUIRED"
  | "REGULATOR_ACTION_REQUIRED"
  | "OWNER_APPROVAL_REQUIRED";

export interface LgDossierEntry {
  /** Readiness control this dossier serves. LG-GOODS is a master policy with no single control. */
  control_id: string;
  document_id: string;
  title: string;
  folder: string;
  evidence_type: LgEvidenceType;
  provenance: LgProvenance;
  /** Real issuing authority, or the explicit determination marker — never invented. */
  issuing_authority: string;
  draft_state: LgDraftState;
  /** Declaration text that describes the ACTUAL evidentiary state. Never "Confirmed". */
  declaration: string;
  /** Clause / section architecture of the draft document. */
  sections: string[];
  /** Fields that only the regulator, insurer, counsel or executed contract can supply. */
  authoritative_fields: string[];
  /** What the approved, effective document authorises in the operational spine. */
  operational_linkage: string;
  /** Public regulatory sources filed as REGULATORY_REFERENCE (never as a TaxiD licence). */
  regulatory_references: string[];
}

export const LG_ROOT_FOLDER = "TaxiD Documents 360 / Legal & Regulatory / Logistics & Courier";
export const LG_CORRESPONDENCE_EMAIL = "admin@taxid.us";
export const LG_DRAFT_WATERMARK = "DRAFT — FOR LEGAL REVIEW — NOT EVIDENCE OF REGULATORY APPROVAL";
export const LG_ENTITY = "Yalla Beena Limited, trading as TaxiD";

/** Marker used wherever the issuing authority cannot be asserted yet. */
export const LEGAL_DETERMINATION_REQUIRED = "LEGAL DETERMINATION REQUIRED";

const folderFor = (control: string) => `${LG_ROOT_FOLDER} / ${control}`;

export const LG_DOSSIER: LgDossierEntry[] = [
  {
    control_id: "LG-01",
    document_id: "YB-LG01-REG-001",
    title: "TaxiD Courier / Parcel Operating Model and Applicable Licensing Determination",
    folder: folderFor("LG-01"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: "Communications Authority of Kenya (CA) — determination required",
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft legal determination prepared for authorised legal review. No regulatory licence, exemption or regulatory approval is asserted by this record. The applicable TaxiD operating model and licensing category must be confirmed against current Communications Authority requirements and authoritative TaxiD evidence.",
    sections: [
      "Purpose, scope and entity description",
      "Actual service description: parcel booking, collection, dispatch, handling, conveyance, delivery, courier matching",
      "Capability inventory: TaxiD-owned delivery capability, driver/partner network, third-party licensed courier partners",
      "Candidate regulatory categories: (A) Courier Hailing Service Provider, (B) National Courier Operator, (C) International Courier Operator, (D) platform plus principal courier operator, (E) platform operating exclusively through licensed courier partners, (F) other legally applicable model",
      "Mapping of each TaxiD service to each candidate category, with the facts relied upon",
      "Domestic versus international operations analysis",
      "Determination question reserved to counsel — NOT decided by this draft",
      "Licence application pathway and regulatory correspondence log (if a licence is required)",
      "Evidence schedule: licence application, regulatory correspondence, licence/certificate, licence number, scope, territory, issue date, expiry date, conditions, renewal date",
      "Operational consequences of each candidate determination",
    ],
    authoritative_fields: ["licence_number", "licence_scope", "territory", "issue_date", "expiry_date", "conditions"],
    operational_linkage:
      "Courier/parcel services remain not legally cleared for production until the determination is approved and, where a licence is required, the CA licence evidence is filed. Absent evidence, the affected service stays unavailable.",
    regulatory_references: [
      "Communications Authority of Kenya — courier licensing framework (REGULATORY_REFERENCE)",
      "Communications Authority of Kenya — licensing procedure (REGULATORY_REFERENCE)",
    ],
  },
  {
    control_id: "LG-02",
    document_id: "YB-LG02-REG-001",
    title: "TaxiD Transport Operator and Commercial Goods-Carriage Requirements Determination",
    folder: folderFor("LG-02"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft determination of transport operator obligations, separated by operation type and vehicle relationship. No statutory conclusion, exemption or operator authorisation is asserted. PSV requirements are not applied to goods operations without an approved legal basis.",
    sections: [
      "Separation of operations: passenger transport, parcel transport, commercial goods carriage",
      "Separation of fleet relationships: TaxiD-owned, leased, partner, subcontracted carrier",
      "Requirement matrix per combination: licensing, inspection, driver, vehicle, load, safety, operator records",
      "Analysis of whether any mobility/ride-hailing approval extends to commercial goods carriage — reserved to counsel",
      "Uncertain requirements register, each marked LEGAL_REVIEW_REQUIRED",
      "Evidence schedule per requirement",
    ],
    authoritative_fields: ["operator_authorisation_reference", "issuing_authority", "effective_date", "expiry_date"],
    operational_linkage:
      "Approved requirements become the eligibility rules for goods-carriage service offering by fleet relationship; unapproved combinations remain non-bookable.",
    regulatory_references: ["Applicable NTSA / transport legislation material (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-03",
    document_id: "YB-LG03-REG-001",
    title: "Courier Personnel Identity, Vetting, Licensing and Engagement Requirements",
    folder: folderFor("LG-03"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft personnel requirements framework distinguishing statutory requirement, TaxiD policy and customer safety standard. No internal policy is represented as a statutory requirement.",
    sections: [
      "Identity verification and document standards",
      "Driver licence and vehicle-category entitlement",
      "Right to work / engagement status",
      "Vetting and background checks — only where lawful",
      "Safety training and operational training",
      "Contractual engagement and code of conduct",
      "Incident reporting duties",
      "Three-column classification: LEGAL REQUIREMENT | TaxiD POLICY | CUSTOMER SAFETY STANDARD",
      "Eligibility consequences per requirement",
    ],
    authoritative_fields: ["legal_basis_citation", "counsel_reviewer", "approval_date"],
    operational_linkage:
      "Approved requirements bind courier/driver eligibility: a courier without a satisfied mandatory requirement is not dispatch-eligible.",
    regulatory_references: ["Applicable NTSA driver licensing material (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-04",
    document_id: "YB-LG04-REG-001",
    title: "Courier and Delivery Vehicle Compliance Determination",
    folder: folderFor("LG-04"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft vehicle compliance determination. No requirement in this draft is represented as finally applicable, and no vehicle is represented as compliant, until legal verification and per-vehicle evidence exist.",
    sections: [
      "Registration and authority to operate the vehicle",
      "Inspection and roadworthiness, including inspection expiry handling",
      "Vehicle category and commercial-use requirements",
      "Carrying capacity and load limits",
      "Motor and cargo insurance interface (see LG-05, LG-06)",
      "Cargo suitability, including temperature-controlled and secured carriage",
      "Safety equipment",
      "Per-vehicle evidence schedule and renewal calendar",
    ],
    authoritative_fields: ["inspection_certificate_number", "inspection_expiry", "registration_reference"],
    operational_linkage:
      "Approved requirements drive vehicle eligibility, dispatch eligibility and carrier eligibility. Expired vehicle compliance makes the vehicle unavailable for dispatch.",
    regulatory_references: ["NTSA commercial service vehicle and inspection material (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-05",
    document_id: "YB-LG05-INS-001",
    title: "TaxiD Goods Handling Insurance and Protection Determination",
    folder: folderFor("LG-05"),
    evidence_type: "INSURANCE_POLICY",
    provenance: "INSURER_DOCUMENT",
    issuing_authority: "Insurer — evidence required",
    draft_state: "INSURANCE_EVIDENCE_REQUIRED",
    declaration:
      "Evidence template only. No insurance cover, insurer, policy number, limit or period is asserted. Insured status cannot be derived from an internal policy document; only an insurer-issued policy or certificate filed in Documents 360 is evidence.",
    sections: [
      "Scope of goods handled by TaxiD and by partners",
      "Required cover template — completed only from insurer-issued evidence",
      "Certificate filing and renewal calendar",
      "Escalation where cover is unavailable (INSURER_ACTION_REQUIRED)",
    ],
    authoritative_fields: [
      "insurer",
      "policy_number",
      "insured_entity",
      "policy_type",
      "territory",
      "effective_date",
      "expiry_date",
      "goods_covered",
      "maximum_value",
      "deductible",
      "exclusions",
      "claims_procedure",
      "certificate_location",
    ],
    operational_linkage:
      "Without insurer evidence, services depending on TaxiD-held goods cover stay restricted. Expired insurance restricts the affected service automatically.",
    regulatory_references: [],
  },
  {
    control_id: "LG-06",
    document_id: "YB-LG06-INS-001",
    title: "Goods-in-Transit Insurance Scope, Limits and Exclusions",
    folder: folderFor("LG-06"),
    evidence_type: "INSURANCE_POLICY",
    provenance: "INSURER_DOCUMENT",
    issuing_authority: "Insurer — evidence required",
    draft_state: "INSURANCE_EVIDENCE_REQUIRED",
    declaration:
      "Evidence template only. No goods-in-transit limits, territories or exclusions are asserted. Limits used by booking validation must originate from the insurer-issued policy filed in Documents 360.",
    sections: [
      "Per-shipment limit and aggregate limit capture",
      "Territorial scope",
      "Perils: loss, damage, theft",
      "High-value goods, restricted goods, temperature-controlled goods treatment",
      "Exclusions schedule",
      "Claim notification requirements and deadlines",
      "Booking validation binding: declared value versus approved insured limit",
    ],
    authoritative_fields: ["per_shipment_limit", "aggregate_limit", "territory", "exclusions", "notification_period"],
    operational_linkage:
      "Once approved and effective, declared value above the approved insured limit raises INSURANCE_EXCEPTION and sends the booking to review rather than silently accepting uninsured exposure.",
    regulatory_references: [],
  },
  {
    control_id: "LG-07",
    document_id: "YB-LG07-GOODS-001",
    title: "Restricted Goods Policy",
    folder: folderFor("LG-07"),
    evidence_type: "POLICY",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft restricted-goods classification framework for legal review. No category, condition or legal basis in this draft is approved, and the framework is not represented as complete.",
    sections: [
      "Classification method and evidence of legal basis per category",
      "Per category: legal basis, documentation, permit, packaging, vehicle, carrier, insurance, handling, approval authority",
      "Conditional acceptance workflow and approval authority matrix",
      "Operational restriction per category",
      "Review cadence and change control",
    ],
    authoritative_fields: ["legal_basis_citation", "permit_authority", "approval_authority"],
    operational_linkage:
      "After legal approval, restricted classification sends the booking to COMPLIANCE_REVIEW and requires approval before it becomes bookable.",
    regulatory_references: ["Applicable KRA customs guidance (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-08",
    document_id: "YB-LG08-GOODS-001",
    title: "Prohibited Goods Policy",
    folder: folderFor("LG-08"),
    evidence_type: "POLICY",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft prohibited-goods schedule for legal review. The schedule is expressly NOT represented as exhaustive and confers no acceptance authority for anything omitted from it.",
    sections: [
      "Prohibited categories with the legal or safety basis relied upon",
      "Non-exhaustiveness statement and residual-risk handling",
      "Rejection workflow and customer messaging",
      "Attempt logging: attempt, user, package, classification, reason, timestamp, policy version",
      "Override policy — no override exists unless a future approved legal policy creates a controlled one",
    ],
    authoritative_fields: ["legal_basis_citation", "approval_date", "policy_version"],
    operational_linkage: "After legal approval, prohibited classification produces BOOKING_REJECTED with a logged attempt record.",
    regulatory_references: ["Applicable KRA customs prohibitions material (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-09",
    document_id: "YB-LG09-CLAIMS-001",
    title: "TaxiD Logistics Claims Handling and Evidentiary Standard",
    folder: folderFor("LG-09"),
    evidence_type: "POLICY",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft claims-handling standard for legal review. No claim outcome, liability position, notification period or settlement authority is asserted until approved.",
    sections: [
      "Claim eligibility and notification period (blank until approved)",
      "Claim initiation channels and intake record",
      "Evidence standard: POD, custody chain, exception record, driver evidence, vehicle evidence, photographs",
      "Investigation and custody reconstruction — read from the existing authoritative logistics records only",
      "Assessment and insurance interaction (LG-05, LG-06)",
      "Approval authority, settlement, appeal and closure",
      "Prohibition on creating any duplicate custody or delivery history",
    ],
    authoritative_fields: ["notification_period", "approval_authority", "settlement_authority_limit"],
    operational_linkage:
      "Approved standard governs the claims workflow, which consumes package, manifest, route, stop, custody, attempt, POD, exception, payment and settlement records already held by the logistics spine.",
    regulatory_references: [],
  },
  {
    control_id: "LG-10",
    document_id: "YB-LG10-LIAB-001",
    title: "TaxiD Logistics Liability and Limitation Framework",
    folder: folderFor("LG-10"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "EXTERNAL_COUNSEL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft liability framework for counsel determination. ALL numerical liability limits are deliberately blank and must remain blank until supported by approved legal or contractual evidence.",
    sections: [
      "Allocation of liability: platform, principal carrier, partner carrier, customer",
      "Heads of loss: loss, damage, delay, theft, consequential loss",
      "Custody-based liability boundaries",
      "Customer obligations: declaration, packaging, accuracy",
      "Insurance interaction and indemnity",
      "Limitation clauses — VALUES BLANK pending counsel determination",
      "Consumer protection considerations",
      "Force majeure",
      "Dispute resolution and governing law",
    ],
    authoritative_fields: ["liability_cap", "per_shipment_cap", "counsel_reference", "approval_date"],
    operational_linkage:
      "Approved limits become the source of the liability wording surfaced at booking and used in claims assessment. No limit is displayed until approved.",
    regulatory_references: [],
  },
  {
    control_id: "LG-11",
    document_id: "YB-LG11-CON-001",
    title: "TaxiD Customer Terms of Carriage",
    folder: folderFor("LG-11"),
    evidence_type: "TERMS_OF_SERVICE",
    provenance: "CUSTOMER_CONTRACT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Controlled draft of the customer terms of carriage. Not in force. No version of these terms may be presented to customers or bound to a booking until approved and made effective.",
    sections: [
      "Definitions and contracting entity",
      "Scope of service and service availability",
      "Booking and acceptance",
      "Restricted and prohibited goods (LG-07, LG-08)",
      "Packaging and customer declarations",
      "Pickup, custody and transport",
      "Delivery, recipient verification and proof of delivery",
      "Failed delivery, redelivery and returns",
      "Pricing, payment, cancellation and refunds",
      "Claims procedure and prescription period",
      "Insurance and declared value",
      "Liability and limitation (LG-10) — limits blank pending approval",
      "Customs and cross-border carriage (LG-15)",
      "Data protection (LG-13, LG-14)",
      "Force majeure",
      "Complaints, disputes and mediation",
      "Governing law and jurisdiction",
      "Amendments, versioning and version binding at booking",
    ],
    authoritative_fields: ["version", "effective_date", "approval_date", "approver"],
    operational_linkage:
      "Every booking retains the terms version accepted at booking. When the effective version changes or expires, acceptance of the current version is required before a booking can be accepted.",
    regulatory_references: [],
  },
  {
    control_id: "LG-12",
    document_id: "YB-LG12-CON-001",
    title: "TaxiD Courier / Carrier Partner Agreement",
    folder: folderFor("LG-12"),
    evidence_type: "CONTRACT",
    provenance: "PARTNER_CONTRACT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Controlled draft partner agreement. Unexecuted. No partner acquires production dispatch eligibility because this draft exists; eligibility requires an executed agreement plus the required compliance evidence.",
    sections: [
      "Appointment, scope and territory",
      "Services and service levels",
      "Rates, commission and settlement",
      "Licensing warranties (LG-01, LG-02)",
      "Driver requirements (LG-03) and vehicle requirements (LG-04)",
      "Insurance obligations (LG-05, LG-06)",
      "Custody, proof of delivery and evidence duties",
      "Restricted and prohibited goods obligations",
      "Data protection and confidentiality",
      "Audit and incident reporting",
      "Claims, indemnity and set-off",
      "Suspension, termination and subcontracting",
      "Regulatory compliance and change of law",
      "Execution block — signatures required",
    ],
    authoritative_fields: ["executed_copy_reference", "execution_date", "counterparty", "signatories"],
    operational_linkage:
      "Partner tender/dispatch eligibility requires an executed agreement of record plus satisfied compliance evidence; otherwise the partner cannot receive a tender.",
    regulatory_references: [],
  },
  {
    control_id: "LG-13",
    document_id: "YB-LG13-DP-001",
    title: "TaxiD Logistics Privacy and Lawful Basis Determination",
    folder: folderFor("LG-13"),
    evidence_type: "DATA_PROTECTION_DOCUMENT",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: "Office of the Data Protection Commissioner (ODPC) — determination required",
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft processing register and lawful-basis analysis for review by the data protection function. No lawful basis is established by labelling it in software; each basis must be confirmed against the Data Protection Act and applicable ODPC guidance.",
    sections: [
      "Processing register scope: customer, recipient, driver, partner data",
      "Data categories: identity, contact, location/GPS, POD, photographs, signature, OTP, communications, payment, claims, fraud signals, support and audit records",
      "Per processing purpose: data, purpose, lawful basis, controller/processor role, recipients, retention, security, cross-border transfer, data-subject rights, legal source",
      "Controller versus processor determination per relationship",
      "Data-subject rights handling and response routes",
      "Mapping to the published TaxiD privacy notice",
    ],
    authoritative_fields: ["lawful_basis_per_purpose", "dpo_reviewer", "approval_date"],
    operational_linkage:
      "A processing purpose without an approved lawful basis is not treated as lawful by the platform; affected processing stays LEGAL_REVIEW_REQUIRED.",
    regulatory_references: [
      "Kenya Data Protection Act (REGULATORY_REFERENCE)",
      "Data Protection (General) Regulations (REGULATORY_REFERENCE)",
      "ODPC transport-sector guidance (REGULATORY_REFERENCE)",
    ],
  },
  {
    control_id: "LG-14",
    document_id: "YB-LG14-DP-001",
    title: "TaxiD Logistics Data Handling, Retention and Cross-Border Transfer Determination",
    folder: folderFor("LG-14"),
    evidence_type: "DATA_PROTECTION_DOCUMENT",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: "Office of the Data Protection Commissioner (ODPC) — determination required",
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft retention and transfer matrix. No retention period is stated: retention must be set only as reasonably necessary, subject to the statutory exceptions, and cross-border transfers must be assessed against the applicable statutory safeguards.",
    sections: [
      "Lifecycle: collect → use → share → store → retain → archive → delete",
      "Matrix columns: DATA CLASS | PURPOSE | LEGAL BASIS | RETENTION PERIOD | RETENTION REASON | STORAGE LOCATION | PROCESSOR | TRANSFER DESTINATION | TRANSFER SAFEGUARD | DELETION METHOD | REVIEW DATE",
      "Retention periods left BLANK pending determination",
      "Processor register and sub-processor changes",
      "Cross-border transfer assessment per destination and safeguard",
      "Deletion and archival mechanisms, and the periodic review cadence",
    ],
    authoritative_fields: ["retention_period_per_class", "transfer_safeguard", "review_date", "approval_date"],
    operational_linkage:
      "Approved retention periods configure the platform retention jobs; an unapproved data class keeps its retention decision open rather than defaulting to a value.",
    regulatory_references: [
      "Kenya Data Protection Act — retention and transfer provisions (REGULATORY_REFERENCE)",
      "Data Protection (General) Regulations — retention schedule and periodic review (REGULATORY_REFERENCE)",
    ],
  },
  {
    control_id: "LG-15",
    document_id: "YB-LG15-REG-001",
    title: "TaxiD Regional and Cross-Border Logistics Requirements Determination",
    folder: folderFor("LG-15"),
    evidence_type: "LEGAL_DETERMINATION",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft corridor requirements matrix. No corridor is represented as cleared. Routing capability is not corridor clearance, and cross-border obligations are corridor-specific evidence rather than a single compliance flag.",
    sections: [
      "Corridors: Kenya domestic; Kenya → Uganda; Kenya → Tanzania; Kenya → Rwanda; Kenya → other EAC; other international",
      "Per corridor: courier licensing, carrier licensing, vehicle requirements, driver requirements",
      "Per corridor: customs entry, manifests, declarations, transit documentation and bonds, release procedures",
      "Per corridor: duties and taxes, restricted goods, insurance, data transfer, destination requirements, local contractual requirements",
      "Corridor evidence schedule and owner",
      "Corridor activation rule: approved matrix row required before the corridor becomes bookable",
    ],
    authoritative_fields: ["per_corridor_evidence", "customs_reference", "approval_date"],
    operational_linkage:
      "A corridor stays unavailable for booking until its matrix row is approved and effective, irrespective of routing capability.",
    regulatory_references: ["KRA customs, transit and declaration guidance (REGULATORY_REFERENCE)"],
  },
  {
    control_id: "LG-GOODS",
    document_id: "YB-LG-GOODS-001",
    title: "TaxiD Goods Classification Policy",
    folder: folderFor("LG-GOODS"),
    evidence_type: "POLICY",
    provenance: "INTERNAL_DOCUMENT",
    issuing_authority: LEGAL_DETERMINATION_REQUIRED,
    draft_state: "LEGAL_REVIEW_REQUIRED",
    declaration:
      "Draft master goods classification policy for legal review. It is the parent of LG-07 and LG-08 and confers no acceptance authority until approved and versioned.",
    sections: [
      "Classifications: STANDARD, CONDITIONAL, RESTRICTED, PROHIBITED",
      "Classification criteria and evidence per class",
      "State machine — STANDARD → BOOKABLE; CONDITIONAL → CONDITION_CHECK → APPROVAL → BOOKABLE; RESTRICTED → COMPLIANCE_REVIEW → APPROVAL → BOOKABLE; PROHIBITED → REJECTED",
      "Approval authority per class",
      "Policy versioning and the rule that every shipment/package retains the classification-policy version applied",
      "Change control and review cadence",
    ],
    authoritative_fields: ["policy_version", "approval_date", "approver"],
    operational_linkage:
      "The approved, versioned policy drives package acceptance. The policy version is persisted against every shipment/package classification.",
    regulatory_references: [],
  },
];

export const lgEntry = (controlId: string): LgDossierEntry | undefined =>
  LG_DOSSIER.find((d) => d.control_id === controlId);

/* ------------------------------ draft rendering ----------------------------- */

/**
 * Renders the controlled draft document. Every rendered draft carries the
 * watermark, blank authoritative fields and an explicit non-assertion notice.
 */
export function renderLgDraft(entry: LgDossierEntry, now = new Date()): string {
  const lines: string[] = [
    `${LG_DRAFT_WATERMARK}`,
    "",
    `# ${entry.title}`,
    "",
    `Document ID: ${entry.document_id}`,
    `Control: ${entry.control_id}`,
    `Entity: ${LG_ENTITY}`,
    `Jurisdiction: Kenya`,
    `Document type: ${entry.evidence_type}`,
    `Provenance: ${entry.provenance}`,
    `Issuing authority: ${entry.issuing_authority}`,
    `Documents 360 location: ${entry.folder}`,
    `Official correspondence: ${LG_CORRESPONDENCE_EMAIL}`,
    `Version: 0.1 (DRAFT)`,
    `Status: ${entry.draft_state}`,
    `Prepared: ${now.toISOString().slice(0, 10)}`,
    `Effective date: (blank — no authoritative evidence)`,
    `Expiry / review date: (blank — no authoritative evidence)`,
    `Approved by: (blank — approval not granted)`,
    "",
    "## Evidentiary declaration",
    entry.declaration,
    "",
    "## Sections",
    ...entry.sections.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Fields that only an authoritative source may complete",
    ...(entry.authoritative_fields.length
      ? entry.authoritative_fields.map((f) => `- ${f}: (blank)`)
      : ["- none"]),
    "",
    "## Operational linkage once approved and effective",
    entry.operational_linkage,
    "",
    "## Regulatory references (filed as REGULATORY_REFERENCE, not as TaxiD licences)",
    ...(entry.regulatory_references.length ? entry.regulatory_references.map((r) => `- ${r}`) : ["- none"]),
    "",
    `${LG_DRAFT_WATERMARK}`,
    "",
  ];
  return lines.join("\n");
}

/* ---------------------------- reconciliation report --------------------------- */

export interface LgReconciliation {
  totalControls: number;
  draftDocumentsAvailable: number;
  authoritativeDocumentsFound: number;
  legalReviewRequired: number;
  ownerApprovalRequired: number;
  externalRegulatorActionRequired: number;
  insuranceEvidenceRequired: number;
  missingData: number;
  operationalControlsLinked: number;
}

export interface LgControlEvidenceState {
  control_id: string;
  /** Approved + effective evidence of record, if any. */
  approved: boolean;
  /** Any evidence record exists (submitted or approved). */
  hasEvidence: boolean;
}

/**
 * Pure reconciliation over the dossier plus the EXISTING evidence register
 * state. Nothing here can turn a draft into an approval.
 */
export function reconcileLgDossier(states: LgControlEvidenceState[]): LgReconciliation {
  const byId = new Map(states.map((s) => [s.control_id, s]));
  let authoritative = 0;
  let legalReview = 0;
  let ownerApproval = 0;
  let regulator = 0;
  let insurance = 0;
  let missing = 0;

  for (const entry of LG_DOSSIER) {
    const st = byId.get(entry.control_id);
    if (st?.approved) {
      authoritative += 1;
      continue;
    }
    if (st?.hasEvidence) ownerApproval += 1;
    else if (entry.draft_state === "INSURANCE_EVIDENCE_REQUIRED") insurance += 1;
    else if (entry.draft_state === "REGULATOR_ACTION_REQUIRED") regulator += 1;
    else legalReview += 1;
    missing += entry.authoritative_fields.length;
  }

  return {
    totalControls: LG_DOSSIER.length,
    draftDocumentsAvailable: LG_DOSSIER.length,
    authoritativeDocumentsFound: authoritative,
    legalReviewRequired: legalReview,
    ownerApprovalRequired: ownerApproval,
    externalRegulatorActionRequired: regulator,
    insuranceEvidenceRequired: insurance,
    missingData: missing,
    operationalControlsLinked: LG_DOSSIER.filter((d) => d.operational_linkage.trim().length > 0).length,
  };
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function lgDossierCsv(states: LgControlEvidenceState[] = []): string {
  const byId = new Map(states.map((s) => [s.control_id, s]));
  const head = [
    "control_id",
    "document_id",
    "title",
    "documents_360_location",
    "evidence_type",
    "provenance",
    "issuing_authority",
    "state",
    "operational_linkage",
  ];
  const rows = LG_DOSSIER.map((d) => {
    const st = byId.get(d.control_id);
    const state = st?.approved ? "APPROVED_EVIDENCE_OF_RECORD" : st?.hasEvidence ? "PENDING_APPROVAL" : d.draft_state;
    return [
      d.control_id,
      d.document_id,
      d.title,
      d.folder,
      d.evidence_type,
      d.provenance,
      d.issuing_authority,
      state,
      d.operational_linkage,
    ].map(csvCell).join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

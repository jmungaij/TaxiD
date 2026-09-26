/**
 * CANONICAL YALLA MOBILITY LEGAL PUBLISHING REGISTRY
 * --------------------------------------------------
 * One source of truth for every public legal document rendered at /legal/*.
 *
 * Governance rules enforced by src/lib/legal/__tests__/legal-documents.test.ts:
 *   - every footer LEGAL destination resolves to exactly one document here;
 *   - every document declares a slug, SEO title, SEO description, effective
 *     date, last-updated date, owner and at least three anchored sections;
 *   - `related` links may only point at routes that exist in the application
 *     (no invented destinations, no placeholder URLs);
 *   - no placeholder / lorem text, and no unverifiable compliance claim.
 *
 * Content model: static, versioned in source control. This is deliberate —
 * legal text must be reviewable, diffable and identical for every visitor,
 * so it is NOT stored in a mutable content table.
 */
import { CONTACT } from "@/config/contact";

export interface LegalSection {
  /** Anchor id used by the in-page contents navigation. */
  id: string;
  heading: string;
  /** Leading paragraph(s). */
  body?: string[];
  /** Bulleted detail. */
  bullets?: string[];
}

export interface LegalRelated {
  to: string;
  label: string;
}

export interface LegalDocument {
  /** URL segment under /legal. */
  slug: string;
  title: string;
  /** One-line statement of what this document governs. */
  summary: string;
  seoTitle: string;
  seoDescription: string;
  effectiveDate: string;
  lastUpdated: string;
  /** Accountable internal owner. */
  owner: string;
  /** Contact channel for questions about this document. */
  contactEmail: string;
  /** How this document differs from adjacent documents (prevents duplication). */
  scopeNote: string;
  sections: LegalSection[];
  related: LegalRelated[];
}

const SUPPORT = CONTACT.supportEmail;
const SALES = CONTACT.salesEmail;

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "What personal data Yalla Mobility collects when you ride, drive, book or manage a corporate account, why we collect it, and how you exercise your rights.",
    seoTitle: "Privacy Policy | Yalla Mobility",
    seoDescription:
      "How Yalla Mobility collects, uses, shares and retains personal data across rides, deliveries, rentals, charter and corporate mobility in Kenya.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Office of the Data Protection Officer",
    contactEmail: SUPPORT,
    scopeNote:
      "This policy explains WHAT we process and WHY. Our Data Protection page explains HOW we govern that processing — lawful basis registers, transfers, retention schedules and how to lodge a request.",
    sections: [
      {
        id: "who-we-are",
        heading: "Who this policy covers",
        body: [
          "Yalla Mobility operates a mobility platform in Kenya covering ride-hailing, airport transfers, corporate mobility, parcel and courier delivery, vehicle rental and leasing, and road, air and marine charter.",
          "This policy applies to riders, drivers and courier partners, corporate administrators and employees travelling on a corporate account, fleet and charter operators, and visitors to our website.",
        ],
      },
      {
        id: "what-we-collect",
        heading: "Personal data we collect",
        bullets: [
          "Account data: name, telephone number, email address and password credentials.",
          "Identity and compliance data for drivers, operators and corporate customers: national ID, driving licence, KRA PIN, company registration and tax compliance documents.",
          "Trip and booking data: pickup and drop-off points, route, timestamps, vehicle and fare or quotation details.",
          "Payment data: M-Pesa transaction references, tokenised card instruments, wallet balances and invoices. We never store full card numbers.",
          "Location data: collected while a trip, delivery or dispatch is active, and only with device permission.",
          "Device and technical data: device model, operating system, app version, IP address and diagnostic logs.",
          "Support and safety data: enquiries, incident reports, safety escalations and the resulting case records.",
        ],
      },
      {
        id: "why-we-process",
        heading: "Why we process it",
        bullets: [
          "To provide the service you requested — matching, dispatch, navigation, delivery and charter fulfilment.",
          "To price, bill, settle and invoice, including corporate billing and driver payouts.",
          "To keep riders, drivers and partners safe, and to investigate incidents and complaints.",
          "To detect and prevent fraud, payment abuse and account takeover.",
          "To meet legal and regulatory obligations, including tax invoicing and transport regulatory reporting.",
          "To improve reliability, coverage and product quality using aggregated analysis.",
        ],
      },
      {
        id: "sharing",
        heading: "Who we share data with",
        body: [
          "We do not sell personal data. We share only what is necessary, and only with parties that are bound by contract or by law:",
        ],
        bullets: [
          "The driver or partner fulfilling your trip, delivery or charter — limited to what is needed to complete it.",
          "Your employer's authorised administrators, where you travel on a corporate account — trip, policy and cost data for that trip only.",
          "Payment providers and financial institutions processing your transaction.",
          "Professional advisers, auditors and insurers, under confidentiality obligations.",
          "Government authorities, regulators, courts and law enforcement where a lawful request or legal obligation applies.",
        ],
      },
      {
        id: "your-rights",
        heading: "Your rights",
        body: [
          `To exercise any right below, email ${SUPPORT} from the address on your account, or raise a request through the Help Centre. We respond within the statutory period and will tell you if we need to verify your identity first.`,
        ],
        bullets: [
          "Access a copy of the personal data we hold about you.",
          "Correct data that is inaccurate or incomplete.",
          "Request deletion where we no longer have a lawful reason to keep it.",
          "Request a portable copy of data you provided to us.",
          "Object to, or ask us to restrict, a particular use.",
          "Withdraw a consent you previously gave, such as location or marketing consent.",
        ],
      },
      {
        id: "security-and-changes",
        heading: "Security and changes to this policy",
        body: [
          "Access to personal data is restricted by role, protected by row-level authorisation in our platform, and recorded in audit logs. Administrative and privileged access requires multi-factor authentication.",
          "When we change this policy we update the last-updated date above and, for material changes affecting your rights, notify you in the app or by email before the change takes effect.",
        ],
      },
    ],
    related: [
      { to: "/legal/data-protection", label: "Data Protection" },
      { to: "/legal/cookies", label: "Cookie Policy" },
      { to: "/legal/terms", label: "Terms of Service" },
      { to: "/support", label: "Help Centre" },
    ],
  },

  {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "The agreement between you and Yalla Mobility when you use the platform as a rider, driver, courier, corporate customer, fleet operator or charter customer.",
    seoTitle: "Terms of Service | Yalla Mobility",
    seoDescription:
      "The terms governing use of the Yalla Mobility platform for riders, drivers, courier partners, corporate customers, fleet operators and charter customers.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Legal & Commercial",
    contactEmail: SALES,
    scopeNote:
      "These terms govern the contractual relationship. Conduct expectations on the platform are set out separately in our Community Guidelines.",
    sections: [
      {
        id: "agreement",
        heading: "The agreement",
        body: [
          "By creating an account, requesting a trip, submitting a booking or accepting work on the platform, you agree to these terms. If you use Yalla Mobility on behalf of an organisation, you confirm you are authorised to bind that organisation.",
          "You must be at least 18 years old to hold an account.",
        ],
      },
      {
        id: "role",
        heading: "Our role",
        body: [
          "Yalla Mobility operates a technology platform that connects customers with independent transport, delivery, rental and charter providers. Except where we state otherwise in a written contract, we do not ourselves provide the transport service.",
          "Drivers and partners are independent contractors. Fleet, charter and leasing operators contract with customers on their own account, under the standards we require of them to remain on the platform.",
        ],
      },
      {
        id: "who-you-are",
        heading: "Terms by participant type",
        bullets: [
          "Riders: request trips, pay the quoted fare and applicable charges, and follow the Community Guidelines.",
          "Drivers and courier partners: maintain valid licensing, insurance and vehicle standards, complete verification, and keep documents current.",
          "Corporate customers: complete business verification, fund the corporate wallet or agree billing terms, and are responsible for employee use under configured policies.",
          "Fleet, charter and leasing operators: keep operating authorisations, insurance and asset records valid, and honour confirmed bookings.",
          "Marketplace participants: list only assets and services they are entitled to supply.",
        ],
      },
      {
        id: "pricing-and-payment",
        heading: "Pricing, quotations and payment",
        body: [
          "On-demand fares are quoted or estimated before you confirm, and may change if the route, waiting time, tolls or requested vehicle changes. Charter, leasing, freight and corporate services are quotation-based; the authoritative price is the one issued in your quotation or contract.",
          "Payments are taken through the methods enabled on your account. Corporate travel may be charged to a funded corporate wallet or invoiced under agreed terms. Tax invoices are issued as required by law.",
        ],
      },
      {
        id: "cancellation",
        heading: "Cancellation, refunds and disputes",
        body: [
          "Cancellation charges may apply once a provider has been assigned or has begun travelling to you. Quotation-based services follow the cancellation terms stated in the quotation or contract.",
          "Raise a billing dispute through the Help Centre. We review the trip or booking record, the payment record and the provider's evidence before deciding, and refunds are returned to the original payment method.",
        ],
      },
      {
        id: "suspension",
        heading: "Suspension and termination",
        body: [
          "We may suspend or close an account where we identify fraud, payment abuse, safety risk, document or licensing failure, or a breach of these terms or the Community Guidelines. Where the law allows, we tell you why and how to respond.",
          "You may stop using the platform at any time and ask us to close your account, subject to settling outstanding amounts and any retention we are legally required to apply.",
        ],
      },
      {
        id: "liability-and-law",
        heading: "Liability and governing law",
        body: [
          "Nothing in these terms excludes liability that cannot lawfully be excluded. Otherwise our liability is limited to the amounts you paid for the affected service.",
          "These terms are governed by the laws of Kenya, and disputes are subject to the jurisdiction of the courts of Kenya.",
        ],
      },
    ],
    related: [
      { to: "/legal/community", label: "Community Guidelines" },
      { to: "/legal/privacy", label: "Privacy Policy" },
      { to: "/pricing", label: "Pricing Guide" },
      { to: "/support", label: "Help Centre" },
    ],
  },

  {
    slug: "cookies",
    title: "Cookie Policy",
    summary:
      "The cookies and local storage Yalla Mobility uses on this website, what each category does, and how you control the optional ones.",
    seoTitle: "Cookie Policy | Yalla Mobility",
    seoDescription:
      "Cookies and browser storage used by Yalla Mobility: strictly necessary session and authentication storage, preferences, and analytics you can control.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Office of the Data Protection Officer",
    contactEmail: SUPPORT,
    scopeNote:
      "This page covers browser storage technologies only. The wider handling of personal data is described in our Privacy Policy.",
    sections: [
      {
        id: "what-we-use",
        heading: "What we use",
        body: [
          "Our website uses a small number of cookies and browser storage entries. Some are required for the site to work at all; the rest are optional and can be declined without losing access to any service.",
        ],
      },
      {
        id: "categories",
        heading: "Categories",
        bullets: [
          "Strictly necessary: your authenticated session, security and anti-abuse tokens, and the state of a booking or application form you are part-way through. These cannot be switched off.",
          "Preferences: interface choices such as your last selected city, service and display settings, stored locally on your device.",
          "Analytics: aggregated measurement of page and journey performance, used to fix broken flows and improve reliability.",
          "Marketing: not enabled by default on this website. If we introduce advertising measurement, it will be opt-in and listed here first.",
        ],
      },
      {
        id: "your-controls",
        heading: "How you control them",
        bullets: [
          "Decline optional categories where a consent control is presented to you.",
          "Clear cookies and site data for this website from your browser settings at any time.",
          "Use your browser's blocking controls — note that blocking strictly necessary storage will sign you out and prevent bookings from completing.",
        ],
      },
      {
        id: "third-parties",
        heading: "Third-party storage",
        body: [
          "Some third-party components we rely on — authentication, payment authorisation and mapping — set their own storage when you use them. They act as processors for us under contract, and their storage is limited to delivering that function.",
          `If you need a current itemised list for a compliance review, email ${SUPPORT} and we will provide one.`,
        ],
      },
    ],
    related: [
      { to: "/legal/privacy", label: "Privacy Policy" },
      { to: "/legal/data-protection", label: "Data Protection" },
      { to: "/support", label: "Help Centre" },
    ],
  },

  {
    slug: "data-protection",
    title: "Data Protection",
    summary:
      "How Yalla Mobility governs personal data: accountability, lawful basis, transfers, retention, security controls and how to lodge a data request or complaint.",
    seoTitle: "Data Protection | Yalla Mobility",
    seoDescription:
      "Yalla Mobility's data protection governance: data controller role, lawful basis, retention, cross-border transfers, breach response and how to lodge a request.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Office of the Data Protection Officer",
    contactEmail: SUPPORT,
    scopeNote:
      "Our Privacy Policy tells you what we process. This page tells you how that processing is governed and how to hold us to it.",
    sections: [
      {
        id: "accountability",
        heading: "Accountability",
        body: [
          "Yalla Mobility acts as data controller for the personal data of riders, drivers, partners and corporate users of the platform, and as processor where a corporate customer instructs us in relation to its own employees' travel data.",
          `Data protection accountability sits with the Office of the Data Protection Officer, reachable at ${SUPPORT}.`,
        ],
      },
      {
        id: "lawful-basis",
        heading: "Lawful basis",
        bullets: [
          "Performance of a contract: delivering the trip, delivery, rental or charter you requested and billing for it.",
          "Legal obligation: tax invoicing, transport regulatory requirements and lawful requests from authorities.",
          "Legitimate interests: safety investigation, fraud prevention and platform integrity, balanced against your rights.",
          "Consent: device location while the app is in use, and any optional communications.",
        ],
      },
      {
        id: "retention",
        heading: "Retention",
        body: [
          "We retain personal data only as long as the purpose requires, or as long as the law obliges us to. Financial and tax records are retained for the statutory period. Safety and incident records are retained while the case and any appeal remain open, and for the period required to defend legal claims. Account data is deleted or irreversibly anonymised once no lawful basis remains.",
        ],
      },
      {
        id: "transfers",
        heading: "Cross-border transfers",
        body: [
          "Platform data is processed on managed cloud infrastructure. Where a transfer outside Kenya is necessary — for example to a service provider hosting or supporting the platform — it takes place only under the safeguards required by Kenyan data protection law, supported by contractual protections with the recipient.",
        ],
      },
      {
        id: "security",
        heading: "Security controls",
        bullets: [
          "Role-based access with row-level authorisation enforced in the platform database, not only in the interface.",
          "Multi-factor authentication and device registration for administrative and privileged access.",
          "Audit logging of privileged actions and access to sensitive records.",
          "Encryption of data in transit, and of credentials and secrets at rest.",
          "Segregated environments, with production access restricted and reviewed.",
        ],
      },
      {
        id: "requests-and-breaches",
        heading: "Requests, complaints and breach response",
        body: [
          `Submit a data subject request or complaint to ${SUPPORT}. We acknowledge, verify identity, and respond within the statutory period. If you are not satisfied with our response, you may escalate to the Office of the Data Protection Commissioner in Kenya.`,
          "If a personal data breach occurs that is likely to affect your rights, we assess it, contain it, notify the regulator within the required timeframe and inform affected people directly.",
        ],
      },
    ],
    related: [
      { to: "/legal/privacy", label: "Privacy Policy" },
      { to: "/legal/cookies", label: "Cookie Policy" },
      { to: "/security", label: "Security Centre" },
      { to: "/legal/compliance", label: "Regulatory Compliance" },
    ],
  },

  {
    slug: "accessibility",
    title: "Accessibility Statement",
    summary:
      "The accessibility standard Yalla Mobility works to, what we have implemented, what we know is still limited, and how to report a barrier.",
    seoTitle: "Accessibility Statement | Yalla Mobility",
    seoDescription:
      "Yalla Mobility's accessibility commitment: WCAG 2.1 AA target, implemented measures, known limitations and how to report an accessibility barrier.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Design Systems & Front-End Engineering",
    contactEmail: SUPPORT,
    scopeNote:
      "This statement describes our own testing and current state. It is not a certification, and we do not claim full conformance.",
    sections: [
      {
        id: "commitment",
        heading: "Our commitment",
        body: [
          "We are working towards WCAG 2.1 Level AA across the Yalla Mobility website and apps. Accessibility checks run as part of our engineering pipeline for public marketing and booking surfaces, and regressions are treated as defects.",
        ],
      },
      {
        id: "implemented",
        heading: "What is implemented today",
        bullets: [
          "Semantic HTML landmarks, a single main region per page and a valid heading hierarchy.",
          "Full keyboard operation of the header, mega-menus, footer navigation and forms, with visible focus indicators.",
          "Accessible names on icon-only controls, and current-page announcement in navigation.",
          "Colour contrast checked against the Executive Blue design tokens rather than ad-hoc colours.",
          "Form labels, described error states, and status messages announced to assistive technology.",
          "Touch targets sized for mobile use, and layouts verified from small mobile to large desktop without horizontal scrolling.",
          "Reduced-motion preferences respected in interface animation.",
        ],
      },
      {
        id: "limitations",
        heading: "Known limitations",
        bullets: [
          "Interactive maps convey route and vehicle position visually; text alternatives for live map state are still being extended.",
          "Some third-party embedded components — payment authorisation and mapping — are outside our direct control and may not fully match our standard.",
          "Documents attached to older records may not be fully tagged for screen readers.",
        ],
      },
      {
        id: "report",
        heading: "Report a barrier",
        body: [
          `If any part of Yalla Mobility is difficult or impossible to use, email ${SUPPORT} or call ${CONTACT.phoneDisplay}. Tell us the page, what you were trying to do and the assistive technology you use. We aim to respond within five business days and will offer an alternative way to complete your task in the meantime.`,
        ],
      },
    ],
    related: [
      { to: "/support", label: "Help Centre" },
      { to: "/contact", label: "Contact Yalla Mobility" },
      { to: "/legal/community", label: "Community Guidelines" },
    ],
  },

  {
    slug: "community",
    title: "Community Guidelines",
    summary:
      "The conduct expected of everyone on the Yalla Mobility platform — riders, drivers, courier partners, corporate travellers and operators — and how we enforce it.",
    seoTitle: "Community Guidelines | Yalla Mobility",
    seoDescription:
      "Conduct standards for riders, drivers, courier partners and operators on Yalla Mobility, prohibited behaviour, how to report an issue and how we enforce.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Trust & Safety",
    contactEmail: SUPPORT,
    scopeNote:
      "These guidelines set behavioural expectations. The contractual relationship is governed by our Terms of Service.",
    sections: [
      {
        id: "principles",
        heading: "Principles that apply to everyone",
        bullets: [
          "Treat every person with respect, regardless of identity, background or belief.",
          "Keep people safe: follow traffic law, use seatbelts and secure loads properly.",
          "Be honest: accurate accounts, accurate trips, accurate invoices and accurate claims.",
          "Respect privacy: never share another person's contact details, location or trip information.",
          "Look after property: vehicles, parcels, keys and rented assets.",
        ],
      },
      {
        id: "riders",
        heading: "Riders and corporate travellers",
        bullets: [
          "Be ready at the pickup point and cancel early if plans change.",
          "No smoking, no open alcohol and no unlawful items in the vehicle.",
          "Travel with the number of passengers the vehicle is licensed for.",
          "Use corporate accounts only for travel your employer's policy permits.",
        ],
      },
      {
        id: "drivers",
        heading: "Drivers, couriers and operators",
        bullets: [
          "Keep licensing, insurance, inspection and platform documents valid and current.",
          "Only the verified driver may operate the account; account sharing is prohibited.",
          "Complete the trip or delivery as accepted, follow the agreed route and hand over parcels correctly.",
          "Maintain vehicle cleanliness, roadworthiness and required safety equipment.",
        ],
      },
      {
        id: "prohibited",
        heading: "Prohibited conduct",
        bullets: [
          "Violence, threats, sexual misconduct, harassment or discrimination of any kind.",
          "Driving under the influence of alcohol or drugs.",
          "Fraud: manipulated trips, false claims, fabricated documents or payment abuse.",
          "Carrying prohibited or unlawful goods, weapons or hazardous items.",
          "Retaliation against anyone who makes a good-faith report.",
        ],
      },
      {
        id: "reporting",
        heading: "How to report",
        body: [
          `Report an incident through the Help Centre, in-app support on the trip or booking record, or by calling ${CONTACT.phoneDisplay}. Emergencies should always go to the emergency services first, then to us so we can support you and preserve the trip record.`,
        ],
      },
      {
        id: "enforcement",
        heading: "How we enforce",
        body: [
          "Reports are reviewed by Trust & Safety against the trip, booking, payment and document record. Depending on severity we may issue a warning, require re-training or re-verification, restrict access to certain services, suspend an account pending investigation, or remove a participant from the platform permanently.",
          "Where the law requires it, we cooperate with authorities. Where a decision affects your access, we tell you what standard was applied and how to respond.",
        ],
      },
    ],
    related: [
      { to: "/safety", label: "Safety Centre" },
      { to: "/legal/terms", label: "Terms of Service" },
      { to: "/support", label: "Help Centre" },
    ],
  },

  {
    slug: "compliance",
    title: "Regulatory Compliance",
    summary:
      "The regulatory obligations Yalla Mobility operates under in Kenya, and the controls that keep the platform compliant.",
    seoTitle: "Regulatory Compliance | Yalla Mobility",
    seoDescription:
      "Yalla Mobility's regulatory posture in Kenya: transport regulation, tax invoicing, data protection registration, payments compliance and internal controls.",
    effectiveDate: "1 June 2026",
    lastUpdated: "17 August 2026",
    owner: "Compliance & Risk",
    contactEmail: SALES,
    scopeNote:
      "This page summarises regulatory obligations and controls. Personal data governance is covered separately under Data Protection.",
    sections: [
      {
        id: "transport",
        heading: "Transport and licensing",
        body: [
          "Drivers, vehicles and operators are verified before activation and re-verified when documents expire. Verification covers driving licence, vehicle registration, insurance, inspection and the operating authorisations required for the service being offered.",
        ],
      },
      {
        id: "tax",
        heading: "Tax and invoicing",
        body: [
          "Fares, quotations and corporate invoices are issued through the platform's invoicing spine so that every billable transaction carries a traceable tax record. Driver and partner tax identifiers are captured during onboarding where required.",
        ],
      },
      {
        id: "payments",
        heading: "Payments and financial controls",
        bullets: [
          "Wallet balances are only credited from verified payment provider callbacks, never from client input.",
          "The financial ledger is append-only, with reconciliation runs that surface and escalate mismatches.",
          "Approval workflows and audit logs apply to refunds, adjustments and privileged financial actions.",
        ],
      },
      {
        id: "data",
        heading: "Data protection",
        body: [
          "Personal data processing is governed under our Data Protection framework, including lawful basis, retention schedules, transfer safeguards and breach response.",
        ],
      },
      {
        id: "questions",
        heading: "Compliance questions",
        body: [
          `Corporate, procurement and regulator enquiries — including due-diligence questionnaires — should go to ${SALES}. We provide the current documentation applicable to the market and service in question.`,
        ],
      },
    ],
    related: [
      { to: "/legal/data-protection", label: "Data Protection" },
      { to: "/security", label: "Security Centre" },
      { to: "/legal/terms", label: "Terms of Service" },
    ],
  },
];

/** Slug → document lookup used by the /legal/:slug route. */
export const LEGAL_BY_SLUG: Record<string, LegalDocument> = Object.fromEntries(
  LEGAL_DOCUMENTS.map((d) => [d.slug, d]),
);

/** Ordered index rendered on every legal page (cross-linking, no dead ends). */
export const LEGAL_INDEX: LegalRelated[] = LEGAL_DOCUMENTS.map((d) => ({
  to: `/legal/${d.slug}`,
  label: d.title,
}));

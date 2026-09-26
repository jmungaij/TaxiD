/**
 * YALLA PARTNER CAPABILITY REGISTRY — the canonical partner taxonomy.
 *
 * Discovered from the real application, not invented for a mega-menu. Every
 * entry below was verified against:
 *   • the public/authenticated route table in src/App.tsx and src/lib/routes.ts
 *   • the partner spine in src/lib/partners/api.ts + marketplace.ts
 *     (`partners`, `partner_applications`, `partner_users`, `partner_wallets`,
 *      `partner_supply_assets`, `partner_quotes`, `partner_settlements`)
 *   • the driver, charter-operator and delivery-portal surfaces
 *
 * Classification law:
 *   DISTRIBUTION — brings demand: sells or refers Yalla mobility to customers
 *   SUPPLY       — brings capacity: drivers, fleets, charter, logistics, rental
 *   INTEGRATION  — brings technical reach: API, white label, platform
 *
 * A corporate *customer* buying mobility, an employee travelling on a corporate
 * policy, and a rider are NOT partners; they live under Business/Rides and are
 * deliberately absent from this registry.
 *
 * `capability` is the honesty gate. `operational` = a dedicated end-to-end flow
 * exists today. `application_only` = Yalla accepts the partner and operates the
 * relationship through the partner desk and the shared partner workspace, but
 * there is no self-serve product surface yet — such an entry must never be
 * presented as a live self-service capability.
 */

import type { CommercialModel, PartnerType } from "@/lib/partners/api";

export type PartnerSide = "DISTRIBUTION" | "SUPPLY" | "INTEGRATION";

export type PartnerCapability = "operational" | "application_only";

export interface PartnerSegment {
  /** URL slug — /partners/<slug>. */
  slug: string;
  /** Canonical partner-type key (data model taxonomy value). */
  partnerTypeKey: string;
  /** Public label. Terminology dictionary — do not vary this wording. */
  label: string;
  /** Menu description: operational language, no marketing filler. */
  navDesc: string;
  side: PartnerSide;
  capability: PartnerCapability;
  /** Landing-page headline and lead. */
  headline: string;
  lead: string;
  /** Who this is for, in plain business terms. */
  audience: string;
  /** What the partner can actually sell or supply through Yalla. */
  services: string[];
  /** What the partner does in the platform, in order. */
  workflow: string[];
  /** Commercial relationship in force for this segment. */
  commercial: string;
  /** Backend entities of record. */
  backendEntities: string[];
  /** Where the partner applies. */
  applyRoute: string;
  /** Where an admitted partner signs in / works. */
  workspaceRoute: string;
  /** Label for the workspace destination. */
  workspaceLabel: string;
  /** Auth roles that reach the workspace (server-side RLS is authoritative). */
  authRoles: string[];
  /** Application pre-fill for the partner application form. */
  prefill?: { partner_type: PartnerType; commercial_model: CommercialModel };
  /** Related public product routes — never dead ends. */
  related: { to: string; label: string }[];
}

export const PARTNER_SEGMENTS: PartnerSegment[] = [
  /* ---------------- DISTRIBUTION — partners that bring demand ---------------- */
  {
    slug: "travel-tourism",
    partnerTypeKey: "travel_partner",
    label: "Travel & Tourism Partners",
    navDesc: "Tour operators, DMCs, travel agencies and destination businesses.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Sell ground mobility to the guests you already bring to Kenya",
    lead: "Sell airport transfers, city rides, excursions, safari charters and vehicle rental to your guests through Yalla — without building your own transport operation.",
    audience: "Tour operators, destination management companies, travel agencies, online travel platforms and destination businesses.",
    services: ["Airport transfers", "City and intercity rides", "Safari and excursion charters", "Vehicle rental for guests", "Multi-leg guest journeys"],
    workflow: ["Register the guest as your customer", "Quote from your contracted rate card", "Confirm the order", "Track execution per leg", "Reconcile and settle"],
    commercial: "Contracted margin per order — net rate, markup or commission, versioned at order level.",
    backendEntities: ["partner_applications", "partners", "partner_quotes", "partner_settlements"],
    applyRoute: "/partners/apply?type=travel-tourism",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "TOUR_OPERATOR", commercial_model: "BOOK" },
    related: [{ to: "/charter", label: "Charter services" }, { to: "/rentals", label: "Rentals & leasing" }],
  },
  {
    slug: "hospitality",
    partnerTypeKey: "hospitality_partner",
    label: "Hospitality Partners",
    navDesc: "Hotels, lodges and resorts arranging guest mobility.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Guest transfers and excursions without your own transport fleet",
    lead: "Arrange reliable guest transfers, excursions and managed mobility from your front desk, on your own commercial terms.",
    audience: "Hotels, lodges, resorts, serviced apartments and hospitality groups.",
    services: ["Airport and station transfers", "Guest excursions", "Executive vehicles for VIP guests", "Group movement for conferences", "Courier runs for guest items"],
    workflow: ["Register the guest or booking reference", "Quote and confirm from the front desk", "Track the movement", "Reconcile monthly", "Settle on contracted terms"],
    commercial: "Contracted margin per order, or a fixed fee per movement where agreed.",
    backendEntities: ["partner_applications", "partners", "partner_quotes", "partner_settlements"],
    applyRoute: "/partners/apply?type=hospitality",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "HOTEL", commercial_model: "BOOK" },
    related: [{ to: "/rider/airport", label: "Airport transfers" }, { to: "/charter", label: "Charter services" }],
  },
  {
    slug: "corporate",
    partnerTypeKey: "corporate_partner",
    label: "Corporate & Institutional Partners",
    navDesc: "Organisations distributing or arranging mobility for others.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Distribute managed mobility to the people your organisation moves",
    lead: "For companies, NGOs, schools, universities, financial institutions and government bodies that arrange or distribute mobility for delegates, students, beneficiaries or member organisations — beyond buying rides for their own staff.",
    audience: "Companies, NGOs, development programmes, schools and universities, financial institutions, government and member bodies.",
    services: ["Delegate and visitor transport", "Student and staff movement programmes", "Group and event mobility", "Managed logistics for programmes", "Courier and document movement"],
    workflow: ["Register the traveller or beneficiary", "Quote against the contracted terms", "Route the approval", "Execute and track", "Reconcile and settle"],
    commercial: "Contracted margin, revenue share or fixed fee, depending on the programme.",
    backendEntities: ["partner_applications", "partners", "partner_quotes", "partner_settlements"],
    applyRoute: "/partners/apply?type=corporate",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "CORPORATE", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/corporates", label: "Corporate mobility (buying for your own staff)" }, { to: "/enterprise", label: "Yalla Enterprise" }],
  },
  {
    slug: "commerce-retail",
    partnerTypeKey: "commerce_partner",
    label: "Commerce & Retail Partners",
    navDesc: "E-commerce and retail businesses distributing delivery.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Same-day delivery under your own brand",
    lead: "Offer your customers same-day and scheduled delivery fulfilled by Yalla's courier and logistics network, with proof of delivery on every drop.",
    audience: "E-commerce brands, retailers, distributors, pharmacies and marketplaces.",
    services: ["Same-day parcel delivery", "Scheduled and batch drops", "Returns collection", "Bulk and freight movement", "Proof of delivery on every order"],
    workflow: ["Create the delivery order", "Quote and confirm", "Courier allocated and dispatched", "Track to proof of delivery", "Reconcile and settle"],
    commercial: "Net rate or markup per delivery, with your margin recorded on the order.",
    backendEntities: ["partner_applications", "partners", "partner_quotes", "partner_settlements"],
    applyRoute: "/partners/apply?type=commerce-retail",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "ECOMMERCE", commercial_model: "BOOK" },
    related: [{ to: "/delivery/package", label: "Package delivery" }, { to: "/delivery/courier", label: "Courier services" }],
  },
  {
    slug: "events-destinations",
    partnerTypeKey: "event_partner",
    label: "Events & Destination Partners",
    navDesc: "Event organisers and destination businesses moving groups.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Move delegates, crews and groups on a single plan",
    lead: "Plan and execute conference, festival, sporting and destination mobility as one journey — shuttles, executive vehicles, coaches and charter where supported.",
    audience: "Event organisers, conference and exhibition companies, venues, sports bodies and destination businesses.",
    services: ["Delegate shuttles", "Coach and bus movement", "VIP and executive vehicles", "Crew and equipment logistics", "Air charter where supported"],
    workflow: ["Build the movement plan as a journey", "Quote all legs together", "Confirm and allocate capacity", "Run the event with live status", "Reconcile and settle"],
    commercial: "Contracted margin per order, with group and tiered rates where agreed.",
    backendEntities: ["partner_applications", "partners", "partner_quotes", "partner_settlements"],
    applyRoute: "/partners/apply?type=events-destinations",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "EVENT", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/charter", label: "Charter services" }, { to: "/rentals", label: "Rentals & leasing" }],
  },
  {
    slug: "referral-distribution",
    partnerTypeKey: "referral_partner",
    label: "Referral & Distribution Partners",
    navDesc: "Businesses that refer Yalla services to their customers.",
    side: "DISTRIBUTION",
    capability: "operational",
    headline: "Refer the movement, earn on the completed order",
    lead: "Send your customers to Yalla and earn on completed movements, with no operations for you to run and no fulfilment obligation.",
    audience: "Agencies, membership bodies, professional services firms, consultants and businesses with a customer base that needs mobility.",
    services: ["Referred rides and transfers", "Referred charter enquiries", "Referred delivery and logistics", "Referred rental and leasing"],
    workflow: ["Refer the customer or enquiry", "Yalla quotes and fulfils", "Completion is recorded", "Your earning is reconciled", "Settlement on contracted terms"],
    commercial: "Commission on completed, reconciled orders — no exposure to supplier cost.",
    backendEntities: ["partner_applications", "partners", "partner_ledger_entries", "partner_settlements"],
    applyRoute: "/partners/apply?type=referral-distribution",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "OTHER", commercial_model: "REFER" },
    related: [{ to: "/partners", label: "Partner programme" }, { to: "/pricing", label: "Pricing" }],
  },

  /* ------------------- SUPPLY — partners that bring capacity ------------------ */
  {
    slug: "drivers",
    partnerTypeKey: "driver_partner",
    label: "Driver Partners",
    navDesc: "Drive and deliver with Yalla.",
    side: "SUPPLY",
    capability: "operational",
    headline: "Drive and deliver with Yalla",
    lead: "Join the Yalla supply partner network as a driver or courier: register, verify your documents, complete training, activate and start earning.",
    audience: "Professional drivers, chauffeurs, courier riders and owner-drivers.",
    services: ["Rides and airport transfers", "Courier and parcel delivery", "Corporate and executive trips", "Charter and group work through an operator"],
    workflow: ["Register", "Verify documents", "Complete onboarding and training", "Activate", "Drive and earn", "Track performance"],
    commercial: "Trip and delivery earnings with transparent commission, paid through driver payouts.",
    backendEntities: ["drivers", "driver_documents", "driver_payouts"],
    applyRoute: "/driver/apply",
    workspaceRoute: "/dashboard/driver",
    workspaceLabel: "Driver Portal",
    authRoles: ["driver"],
    related: [{ to: "/drivers", label: "Drive with Yalla" }, { to: "/driver/earnings", label: "Driver earnings" }, { to: "/driver/training", label: "Driver academy" }],
  },
  {
    slug: "fleet-operators",
    partnerTypeKey: "fleet_partner",
    label: "Fleet Operators",
    navDesc: "Put vehicles and drivers to work on Yalla demand.",
    side: "SUPPLY",
    capability: "operational",
    headline: "Put your vehicles and drivers to work on Yalla demand",
    lead: "Register your fleet, verify your vehicles and drivers, publish capacity and receive matched demand — cars, SUVs, vans and utility vehicles.",
    audience: "Fleet owners and operators running cars, SUVs, vans, minibuses and utility vehicles with their own drivers.",
    services: ["Ride and transfer supply", "Corporate and executive supply", "Van and utility capacity", "Standing capacity commitments"],
    workflow: ["Register the fleet", "Verify vehicles and drivers", "Submit capacity and rates", "Receive matched demand", "Execute", "Reconcile and get paid"],
    commercial: "Supplier cost per job on agreed rates; settlement after order-level reconciliation.",
    backendEntities: ["partner_supply_assets", "capacity_commitments", "partner_settlements"],
    applyRoute: "/partners/apply?type=fleet-operators",
    workspaceRoute: "/dashboard/charter/operator-portal",
    workspaceLabel: "Operator Portal",
    authRoles: ["operator", "fleet_manager", "operations_admin"],
    prefill: { partner_type: "OTHER", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/charter/login", label: "Operator sign in" }, { to: "/rentals", label: "Rentals & leasing" }],
  },
  {
    slug: "charter-operators",
    partnerTypeKey: "charter_operator",
    label: "Charter Operators",
    navDesc: "Publish charter capacity and respond to qualified demand.",
    side: "SUPPLY",
    capability: "operational",
    headline: "Publish charter capacity and respond to qualified demand",
    lead: "Register as a charter operator, verify your licences and assets, publish capacity and rates, and respond to qualified bus, coach, air and marine charter demand where supported.",
    audience: "Bus and coach operators, air charter operators, helicopter and marine operators, and specialist charter businesses.",
    services: ["Bus and coach charter", "Air charter where supported", "Helicopter and marine charter where supported", "Group and event movement", "Standing charter contracts"],
    workflow: ["Register the operator", "Verify licences", "Register assets", "Publish capacity and rates", "Respond to requests", "Contract", "Execute", "Reconcile and settle"],
    commercial: "Operator rates per contract; settlement after reconciliation of the executed charter.",
    backendEntities: ["charter_inventory", "partner_supply_assets", "charter_bookings", "partner_settlements"],
    applyRoute: "/partners/apply?type=charter-operators",
    workspaceRoute: "/dashboard/charter/operator-portal",
    workspaceLabel: "Operator Portal",
    authRoles: ["charter_operator", "operator", "operations_admin"],
    prefill: { partner_type: "AIR_CHARTER", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/charter", label: "Charter services" }, { to: "/charter/login", label: "Operator sign in" }],
  },
  {
    slug: "logistics-carriers",
    partnerTypeKey: "logistics_partner",
    label: "Logistics & Carrier Partners",
    navDesc: "Courier, carrier, freight and hub capacity.",
    side: "SUPPLY",
    capability: "operational",
    headline: "Extend your delivery and freight capacity through Yalla demand",
    lead: "Register courier, carrier, freight or hub capacity, define your service area, receive shipments, dispatch, capture proof of delivery and settle on reconciled orders.",
    audience: "Courier companies, carriers, freight and trucking operators, 3PLs and hub or warehousing operators.",
    services: ["Parcel and courier capacity", "Freight and trucking capacity", "Hub and warehousing support", "Scheduled and batch distribution"],
    workflow: ["Register", "Verify", "Define service area", "Register vehicles and riders", "Declare capacity", "Receive shipments", "Dispatch and track", "Capture POD", "Reconcile and settle"],
    commercial: "Carrier rates per shipment; settlement after proof of delivery and reconciliation.",
    backendEntities: ["partner_supply_assets", "capacity_requests", "partner_settlements"],
    applyRoute: "/partners/apply?type=logistics-carriers",
    workspaceRoute: "/delivery/portal",
    workspaceLabel: "Logistics Partner Portal",
    authRoles: ["driver", "operator", "operations_admin"],
    prefill: { partner_type: "LOGISTICS", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/delivery/logistics", label: "Logistics services" }, { to: "/delivery/courier", label: "Courier services" }],
  },
  {
    slug: "rental-leasing",
    partnerTypeKey: "rental_partner",
    label: "Rental & Leasing Partners",
    navDesc: "Supply vehicles for rental and leasing demand.",
    side: "SUPPLY",
    capability: "application_only",
    headline: "Supply vehicles into rental and leasing demand",
    lead: "Rental and leasing supply is admitted through the partner desk: your assets are verified and your rates are contracted before any demand is routed to you. There is no self-serve rental supply console yet — the partner desk operates the relationship with you.",
    audience: "Car rental companies, leasing companies and fleet owners with vehicles available for rental or long-term lease.",
    services: ["Self-drive rental supply", "Chauffeured rental supply", "Corporate leasing supply", "Long-term fleet supply"],
    workflow: ["Apply through the partner desk", "Verify company and assets", "Contract rates and terms", "Receive routed demand", "Execute", "Reconcile and settle"],
    commercial: "Contracted rental and lease rates; settlement after reconciliation.",
    backendEntities: ["partner_applications", "partner_supply_assets", "partner_settlements"],
    applyRoute: "/partners/apply?type=rental-leasing",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "OTHER", commercial_model: "ORCHESTRATE" },
    related: [{ to: "/rentals", label: "Rentals & leasing" }, { to: "/contact", label: "Talk to the partner desk" }],
  },

  /* --------------- INTEGRATION — partners that bring technical reach --------- */
  {
    slug: "api",
    partnerTypeKey: "api_partner",
    label: "API Partners",
    navDesc: "Integrate Yalla mobility programmatically.",
    side: "INTEGRATION",
    capability: "application_only",
    headline: "Connect Yalla mobility into your own technology",
    lead: "API access is granted after technical discovery, scoped credentials and certification in sandbox. Credentials are issued by the integration desk — there is no self-serve key generation.",
    audience: "Platforms, online travel platforms, ERPs, and enterprises with their own product journeys.",
    services: ["Programmatic quoting and booking", "Order status and tracking", "Documents and evidence", "Settlement and reconciliation data"],
    workflow: ["Technical discovery", "Scoped credentials", "Build in sandbox", "Certify agreed scenarios", "Controlled production go-live"],
    commercial: "Contracted margin or fee per transaction, agreed before certification.",
    backendEntities: ["partner_applications", "partners", "certification_workflows"],
    applyRoute: "/partners/apply?type=api",
    workspaceRoute: "/developers",
    workspaceLabel: "Developer Portal",
    authRoles: ["partner_user"],
    prefill: { partner_type: "TRAVEL_PLATFORM", commercial_model: "API" },
    related: [{ to: "/developers", label: "Developer portal" }, { to: "/api-docs", label: "API documentation" }],
  },
  {
    slug: "white-label",
    partnerTypeKey: "white_label_partner",
    label: "White-Label Partners",
    navDesc: "Yalla-powered mobility under your own brand.",
    side: "INTEGRATION",
    capability: "application_only",
    headline: "Your brand at the front, Yalla's execution engine behind it",
    lead: "White-label programmes are approved case by case through the partner desk: commercial model, operating model, service scope and governance are contracted before build, and certification precedes go-live.",
    audience: "Established brands, platforms and enterprises that want to operate a mobility product without building the operation.",
    services: ["Branded booking experience", "Yalla-operated fulfilment", "Multi-service journeys", "Reconciled settlement reporting"],
    workflow: ["Commercial discussion", "Operating model agreed", "Technical discovery", "Build and certify", "Controlled go-live", "Joint performance review"],
    commercial: "Contracted commercial and operating model, agreed per programme.",
    backendEntities: ["partner_applications", "partners", "commercial_contract_instances"],
    applyRoute: "/partners/apply?type=white-label",
    workspaceRoute: "/partner/workspace",
    workspaceLabel: "Partner Workspace",
    authRoles: ["partner_user"],
    prefill: { partner_type: "TRAVEL_PLATFORM", commercial_model: "WHITE_LABEL" },
    related: [{ to: "/enterprise", label: "Yalla Enterprise" }, { to: "/developers", label: "Developer portal" }],
  },
  {
    slug: "technology",
    partnerTypeKey: "technology_partner",
    label: "Technology & Platform Partners",
    navDesc: "Connect technology, distribution or operational systems.",
    side: "INTEGRATION",
    capability: "application_only",
    headline: "Connect your systems to the Yalla operating stack",
    lead: "For technology and platform businesses whose systems need to exchange data with Yalla — distribution platforms, expense and travel systems, telematics, payments and operational tooling. Scope and data flows are agreed with the integration desk.",
    audience: "Software platforms, travel and expense systems, telematics providers, payment platforms and systems integrators.",
    services: ["Data exchange with Yalla systems", "Embedded surfaces in your product", "Operational and reporting integrations"],
    workflow: ["Partnership discussion", "Technical discovery", "Scope and data flows agreed", "Build and certify", "Controlled go-live"],
    commercial: "Agreed per partnership — referral, revenue share or fee.",
    backendEntities: ["partner_applications", "partners", "certification_workflows"],
    applyRoute: "/partners/apply?type=technology",
    workspaceRoute: "/developers",
    workspaceLabel: "Developer Portal",
    authRoles: ["partner_user"],
    prefill: { partner_type: "TRAVEL_PLATFORM", commercial_model: "EMBED" },
    related: [{ to: "/developers", label: "Developer portal" }, { to: "/contact", label: "Talk to the partner desk" }],
  },
];

export const SIDE_LABEL: Record<PartnerSide, string> = {
  DISTRIBUTION: "Partner network",
  SUPPLY: "Supply network",
  INTEGRATION: "Integration partners",
};

export const SIDE_BLURB: Record<PartnerSide, string> = {
  DISTRIBUTION: "Organisations that sell, refer or arrange Yalla mobility for their own customers.",
  SUPPLY: "Operators and drivers that provide the capacity Yalla fulfils demand with.",
  INTEGRATION: "Businesses that connect Yalla mobility into their own technology or brand.",
};

export function segmentsBySide(side: PartnerSide): PartnerSegment[] {
  return PARTNER_SEGMENTS.filter((s) => s.side === side);
}

export function findSegment(slug: string | null | undefined): PartnerSegment | undefined {
  if (!slug) return undefined;
  return PARTNER_SEGMENTS.find((s) => s.slug === slug);
}

/** Actors that are explicitly NOT partners — kept so the IA cannot drift. */
export const NON_PARTNER_ACTORS = [
  { actor: "Rider", route: "/riders", why: "Buys rides for themselves." },
  { actor: "Corporate customer", route: "/corporates", why: "Buys mobility for its own staff; becomes a partner only when it distributes Yalla services." },
  { actor: "Corporate employee", route: "/dashboard/corporate", why: "Travels under an employer policy." },
  { actor: "Yalla staff", route: "/staff/access", why: "Internal operator of the platform." },
] as const;

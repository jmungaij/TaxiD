/**
 * SAFARID business architecture — the economic foundation of Staff 360.
 *
 * SAFARID is a digital mobility marketplace. It connects demand (customers) with
 * independent resource owners and operators, and provides the technology,
 * commercial orchestration, payment and governance layer around the
 * transaction. Nothing in this module implies SAFARID owns the vehicles, fleets,
 * aircraft, vessels or equipment offered through the platform.
 *
 * Kept as pure data so the Staff portal, tests and governance gates share one
 * definition. No rates, commissions or margins are encoded here — commercial
 * rules stay configurable and are read from the application's own pricing and
 * settlement data.
 */

/* ------------------------------------------------------------------ *
 * Demand side — customers
 * ------------------------------------------------------------------ */

export type CustomerSegmentId =
  | "individual"
  | "corporate"
  | "business_logistics"
  | "rental_leasing"
  | "charter_travel";

export interface CustomerSegment {
  id: CustomerSegmentId;
  label: string;
  description: string;
  /** Representative services purchased by this segment. */
  services: string[];
  /** Customer 360 archetype used to render the specialised profile. */
  archetype: string;
}

export const CUSTOMER_SEGMENTS: CustomerSegment[] = [
  {
    id: "individual",
    label: "Individual customers",
    description: "People purchasing personal mobility on demand or on a schedule.",
    services: [
      "On-demand ride hailing",
      "Airport transfers",
      "Intercity travel",
      "Scheduled rides",
      "Taxi services",
      "Executive rides",
    ],
    archetype: "Profile → trips → payments → preferences → support → loyalty",
  },
  {
    id: "corporate",
    label: "Corporate customers",
    description: "Organisations purchasing mobility for employees, executives, visitors and events.",
    services: [
      "Employee mobility",
      "Executive travel",
      "Event & group travel",
      "Airport meet & greet",
      "Staff transport",
      "Project mobility",
    ],
    archetype:
      "Company → departments → employees → cost centres → policies → contracts → bookings → wallet → billing → usage → SLA → renewal",
  },
  {
    id: "business_logistics",
    label: "Business & enterprise logistics",
    description: "Businesses requiring parcel, courier, freight, cargo and B2B fulfilment.",
    services: [
      "Parcel delivery",
      "Courier services",
      "Freight & cargo",
      "Truck dispatch",
      "Warehouse & distribution",
      "Recurring logistics routes",
    ],
    archetype: "Company → shipments → routes → deliveries → warehouses → SLA → billing → usage",
  },
  {
    id: "rental_leasing",
    label: "Rental & leasing customers",
    description: "Customers requiring vehicles, equipment or long-term fleet solutions.",
    services: [
      "Cars, SUVs & luxury vehicles",
      "Buses & coaches",
      "Trucks & haulers",
      "Heavy equipment",
      "Event resources",
      "Long-term fleet & aircraft leasing",
    ],
    archetype: "Customer → assets requested → reservations → contracts → payments → utilisation → renewal",
  },
  {
    id: "charter_travel",
    label: "Charter & travel customers",
    description: "Customers requiring chartered road, air or marine capacity.",
    services: [
      "Bus, van & coach charter",
      "Aircraft & helicopter charter",
      "Marine transport",
      "School & tourism transport",
      "VIP & corporate charter",
    ],
    archetype: "Customer → missions → quotes → manifests → operators → bookings → payments → history",
  },
];

/* ------------------------------------------------------------------ *
 * Supply side — marketplace participants (never "SAFARID's fleet")
 * ------------------------------------------------------------------ */

export interface SupplyParticipant {
  label: string;
  /** What the participant makes available through the platform. */
  provides: string;
}

/**
 * Supply participants are independent resource providers and operators. They
 * are not SAFARID employees and their resources are not SAFARID assets.
 */
export const SUPPLY_PARTICIPANTS: SupplyParticipant[] = [
  { label: "Drivers", provides: "Personal driving capacity on the platform" },
  { label: "Vehicle owners", provides: "Individual vehicles listed for mobility demand" },
  { label: "Fleet owners", provides: "Managed multi-vehicle capacity" },
  { label: "Courier operators", provides: "Parcel and courier fulfilment capacity" },
  { label: "Transport operators", provides: "Scheduled and contracted road capacity" },
  { label: "Charter operators", provides: "Bus, coach, van and specialised charter capacity" },
  { label: "Rental operators", provides: "Short-term vehicle and equipment inventory" },
  { label: "Leasing providers", provides: "Long-term contracted fleet supply" },
  { label: "Aircraft operators", provides: "Air charter and leasing capacity" },
  { label: "Marine operators", provides: "Vessel capacity for marine transport" },
  { label: "Equipment providers", provides: "Project, event and heavy equipment" },
  { label: "Hub & warehouse partners", provides: "Storage, sorting and distribution capacity" },
  { label: "Other marketplace partners", provides: "Ancillary services supporting fulfilment" },
];

/** Preferred vocabulary for third-party supply across all Staff 360 surfaces. */
export const SUPPLY_VOCABULARY = [
  "Marketplace supply",
  "Partner supply",
  "Operator network",
  "Available marketplace resources",
] as const;

/* ------------------------------------------------------------------ *
 * Revenue architecture
 * ------------------------------------------------------------------ */

export type RevenueCategoryId =
  | "mobility_transaction"
  | "marketplace_fees"
  | "corporate_mobility"
  | "delivery_logistics"
  | "rental"
  | "leasing"
  | "charter"
  | "service_management"
  | "corporate_account"
  | "partner_economics";

export interface RevenueCategory {
  id: RevenueCategoryId;
  label: string;
  description: string;
  segments: CustomerSegmentId[];
  /** Where the commercial rule lives; never hard-coded rates. */
  ruleSource: "platform_pricing" | "commercial_agreement" | "settlement_rules" | "configurable";
}

export const REVENUE_CATEGORIES: RevenueCategory[] = [
  {
    id: "mobility_transaction",
    label: "Mobility transaction revenue",
    description: "Revenue associated with completed ride and mobility transactions.",
    segments: ["individual", "corporate"],
    ruleSource: "platform_pricing",
  },
  {
    id: "marketplace_fees",
    label: "Marketplace & platform fees",
    description: "Fees for facilitating transactions between customers and resource providers.",
    segments: ["individual", "corporate", "business_logistics", "rental_leasing", "charter_travel"],
    ruleSource: "configurable",
  },
  {
    id: "corporate_mobility",
    label: "Corporate mobility revenue",
    description: "Managed employee and executive mobility programmes.",
    segments: ["corporate"],
    ruleSource: "commercial_agreement",
  },
  {
    id: "delivery_logistics",
    label: "Delivery & logistics revenue",
    description: "Parcel, courier, freight, cargo and logistics transactions.",
    segments: ["business_logistics"],
    ruleSource: "platform_pricing",
  },
  {
    id: "rental",
    label: "Rental revenue",
    description: "Vehicle and equipment rental transactions.",
    segments: ["rental_leasing"],
    ruleSource: "platform_pricing",
  },
  {
    id: "leasing",
    label: "Leasing revenue",
    description: "Long-term leasing arrangements under contract.",
    segments: ["rental_leasing", "corporate"],
    ruleSource: "commercial_agreement",
  },
  {
    id: "charter",
    label: "Charter revenue",
    description: "Bus, coach, aircraft, helicopter, marine and specialised charter.",
    segments: ["charter_travel", "corporate"],
    ruleSource: "platform_pricing",
  },
  {
    id: "service_management",
    label: "Service & management fees",
    description: "Applied where the relevant commercial agreement provides for them.",
    segments: ["corporate", "business_logistics"],
    ruleSource: "commercial_agreement",
  },
  {
    id: "corporate_account",
    label: "Corporate account revenue",
    description: "Contracted services, usage and bookings on corporate accounts.",
    segments: ["corporate"],
    ruleSource: "commercial_agreement",
  },
  {
    id: "partner_economics",
    label: "Marketplace partner economics",
    description: "Platform fees, commissions, partner settlements and related economics.",
    segments: ["individual", "corporate", "business_logistics", "rental_leasing", "charter_travel"],
    ruleSource: "settlement_rules",
  },
];

/* ------------------------------------------------------------------ *
 * Flows — revenue graph, commercial flow, people flow
 * ------------------------------------------------------------------ */

/** Customer → … → Customer lifetime value. One of the central models. */
export const REVENUE_GRAPH: string[] = [
  "Customer",
  "Customer segment",
  "Service category",
  "Product / service",
  "Booking / order",
  "Marketplace transaction",
  "Resource provider / operator",
  "Gross transaction value",
  "SAFARID revenue",
  "Partner / operator settlement",
  "Net revenue",
  "Customer lifetime value",
];

/** The cross-department commercial operating system. */
export const COMMERCIAL_FLOW: string[] = [
  "Marketing",
  "Demand",
  "Sales",
  "Customer",
  "Solution",
  "Quote",
  "Contract",
  "Onboarding",
  "Booking / order",
  "Marketplace matching",
  "Resource owner / operator",
  "Service delivery",
  "Payment",
  "SAFARID revenue",
  "Customer success",
  "Retention",
  "Expansion",
  "Lifetime value",
];

/** The human capital operating system. */
export const PEOPLE_FLOW: string[] = [
  "Strategy",
  "Organisation",
  "Departments",
  "Positions",
  "People",
  "Capabilities",
  "Work",
  "Outcomes",
  "Customer / marketplace impact",
  "Revenue / value",
  "Learning",
  "Capability development",
  "Organisational growth",
];

/** Revenue funnel stages used by the Revenue Intelligence Centre. */
export const REVENUE_FUNNEL: string[] = [
  "Demand",
  "Lead",
  "Opportunity",
  "Quote",
  "Won",
  "Booked",
  "Fulfilled",
  "Invoiced",
  "Collected",
];

/** Revenue quality measures — definitions come from configured finance rules. */
export const REVENUE_QUALITY_MEASURES: string[] = [
  "Gross transaction value",
  "SAFARID revenue",
  "Partner / operator settlement",
  "Net revenue",
  "Margin",
  "Collections",
  "Revenue leakage",
];

/** Enterprise sales lifecycle spanning every SAFARID service category. */
export const SALES_LIFECYCLE: string[] = [
  "Market intelligence",
  "Lead",
  "Qualification",
  "Account",
  "Opportunity",
  "Needs discovery",
  "Mobility solution",
  "CPQ",
  "Pricing",
  "Proposal",
  "Quote",
  "Approval",
  "Negotiation",
  "Contract",
  "Onboarding",
  "Booking / order",
  "Fulfilment",
  "Invoice",
  "Collection",
  "Customer success",
  "Expansion",
  "Renewal",
];

/** Marketplace dimensions tracked by Marketplace 360. */
export const MARKETPLACE_DIMENSIONS: string[] = [
  "Demand",
  "Supply",
  "Availability",
  "Matching",
  "Service quality",
  "Pricing",
  "Transaction volume",
  "Marketplace liquidity",
  "Partner performance",
  "Customer experience",
  "Settlement",
  "Geographic coverage",
  "Capacity",
];

/** Axes along which marketplace liquidity is assessed. */
export const LIQUIDITY_AXES: string[] = [
  "Geography",
  "Service",
  "Resource category",
  "Time",
  "Price",
  "Operator",
  "Customer segment",
];

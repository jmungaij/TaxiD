/**
 * Marketplace Asset Framework — Asset Type Resolver + domain lexicons.
 *
 *   Marketplace → Booking Engine → Asset Type Resolver → Domain Renderer
 *
 * The booking engine, payments, notifications, audit and security stay shared.
 * Everything a customer *reads* (terminology, document titles, fee lines,
 * receipt fields, workflow steps) is resolved from the asset domain instead of
 * being inherited from the aviation template. A bus charter must never render
 * "Aircraft", "Cabin arrangement", "Airport fees" or "Flight itinerary".
 */

export type AssetDomainId =
  | "aviation"
  | "road_passenger"
  | "car_rental"
  | "truck"
  | "marine"
  | "equipment";

export interface DomainFeatureFlags {
  /** Aviation cabin arrangement picker (club four, executive, etc.). */
  cabinLayout: boolean;
  /** Physical seat map (coach/van saloon or aircraft cabin). */
  seatMap: boolean;
  /** Named occupant list required before payment. */
  occupantList: boolean;
  /** Airport intelligence panel (runway, lounge, ICAO/IATA). */
  airportIntel: boolean;
  /** Asset media gallery. */
  gallery: boolean;
  /** Luggage / cargo capacity capture. */
  luggage: boolean;
  /** Mileage + fuel policy (rentals). */
  mileage: boolean;
  /** Cargo manifest (haulage). */
  cargoManifest: boolean;
  /** Marine safety briefing + life jackets. */
  marineSafety: boolean;
}

export interface DomainLexicon {
  id: AssetDomainId;
  /** Product brand shown in the header, e.g. "🚌 Yalla Coach". */
  brandName: string;
  brandEmoji: string;
  brandTagline: string;
  /** Confirmation heading, e.g. "Trip confirmation". */
  confirmationTitle: string;
  /** Long document title used on PDFs. */
  documentTitle: string;
  /** Product-specific document template family (never `receipt_template_v1`). */
  documentTemplate: string;
  assetLabel: string;
  assetPluralLabel: string;
  operatorLabel: string;
  crewLabel: string;
  occupantLabel: string;
  occupantPluralLabel: string;
  manifestLabel: string;
  seatingLabel: string;
  routeLabel: string;
  originLabel: string;
  destinationLabel: string;
  departureLabel: string;
  arrivalLabel: string;
  /** Third-party charges line on the quote (never "Airport fees" off-aviation). */
  feesLabel: string;
  galleryLabel: string;
  durationLabel: string;
  features: DomainFeatureFlags;
  /** Customer-visible booking workflow for this domain. */
  wizardSteps: string[];
  /** Product-aware pricing components. */
  pricingLines: string[];
  /** Fields that must appear on this domain's receipt. */
  receiptFields: string[];
}

const noFeatures: DomainFeatureFlags = {
  cabinLayout: false,
  seatMap: false,
  occupantList: false,
  airportIntel: false,
  gallery: true,
  luggage: false,
  mileage: false,
  cargoManifest: false,
  marineSafety: false,
};

export const DOMAIN_LEXICONS: Record<AssetDomainId, DomainLexicon> = {
  aviation: {
    id: "aviation",
    brandName: "Yalla Air",
    brandEmoji: "✈️",
    brandTagline: "Private aviation charter & leasing",
    confirmationTitle: "Flight itinerary",
    documentTitle: "Flight itinerary & confirmation",
    documentTemplate: "aviation_receipt",
    assetLabel: "Aircraft",
    assetPluralLabel: "Aircraft",
    operatorLabel: "Air operator",
    crewLabel: "Flight crew",
    occupantLabel: "Passenger",
    occupantPluralLabel: "Passengers",
    manifestLabel: "Passenger manifest",
    seatingLabel: "Cabin arrangement",
    routeLabel: "Flight route",
    originLabel: "Departure airport",
    destinationLabel: "Arrival airport",
    departureLabel: "Departure",
    arrivalLabel: "Arrival",
    feesLabel: "Airport & landing fees",
    galleryLabel: "Aircraft & cabin",
    durationLabel: "Flight hours",
    features: { ...noFeatures, cabinLayout: true, seatMap: true, occupantList: true, airportIntel: true },
    wizardSteps: ["Search", "Aircraft", "Cabin & seats", "Passenger manifest", "Payment", "Flight itinerary"],
    pricingLines: ["Flight hours", "Landing fees", "Navigation", "Crew", "Ground handling"],
    receiptFields: ["Aircraft", "Cabin", "Crew", "Airport", "Flight time", "Navigation fees", "Landing fees"],
  },
  road_passenger: {
    id: "road_passenger",
    brandName: "Yalla Coach",
    brandEmoji: "🚌",
    brandTagline: "Bus, van & coach charter",
    confirmationTitle: "Trip confirmation",
    documentTitle: "Trip confirmation & travel document",
    documentTemplate: "bus_receipt",
    assetLabel: "Vehicle",
    assetPluralLabel: "Vehicles",
    operatorLabel: "Fleet operator",
    crewLabel: "Driver & co-driver",
    occupantLabel: "Passenger",
    occupantPluralLabel: "Passengers",
    manifestLabel: "Passenger list",
    seatingLabel: "Seat layout",
    routeLabel: "Road route",
    originLabel: "Boarding point",
    destinationLabel: "Drop-off point",
    departureLabel: "Departure time",
    arrivalLabel: "Arrival time",
    feesLabel: "Tolls, parking & permits",
    galleryLabel: "Vehicle & saloon",
    durationLabel: "Trip days",
    features: { ...noFeatures, seatMap: true, occupantList: true, luggage: true },
    wizardSteps: ["Pickup & destination", "Bus category", "Seat layout", "Luggage & requests", "Payment", "Trip confirmation"],
    pricingLines: ["Road distance", "Driving hours", "Driver", "Fuel", "Parking", "Tolls", "Operator fee"],
    receiptFields: ["Vehicle", "Registration", "Driver", "Route", "Pickup point", "Drop-off point", "Road distance", "Trip hours", "Passenger count", "Fleet operator"],
  },
  car_rental: {
    id: "car_rental",
    brandName: "Yalla Drive",
    brandEmoji: "🚘",
    brandTagline: "Car rentals & self-drive",
    confirmationTitle: "Rental confirmation",
    documentTitle: "Rental agreement & confirmation",
    documentTemplate: "car_receipt",
    assetLabel: "Vehicle",
    assetPluralLabel: "Vehicles",
    operatorLabel: "Rental branch",
    crewLabel: "Named driver",
    occupantLabel: "Driver",
    occupantPluralLabel: "Drivers",
    manifestLabel: "Named drivers",
    seatingLabel: "Vehicle class",
    routeLabel: "Pickup & return",
    originLabel: "Pickup branch",
    destinationLabel: "Return branch",
    departureLabel: "Rental start",
    arrivalLabel: "Rental return",
    feesLabel: "Insurance & damage waiver",
    galleryLabel: "Vehicle photos",
    durationLabel: "Rental days",
    features: { ...noFeatures, mileage: true },
    wizardSteps: ["Pickup branch", "Return branch", "Rental period", "Driver & insurance", "Mileage", "Payment", "Rental confirmation"],
    pricingLines: ["Daily rate", "Mileage", "Fuel policy", "Insurance", "Accessories"],
    receiptFields: ["Vehicle", "Registration", "Rental period", "Mileage", "Fuel policy", "Insurance", "Damage deposit", "Keys issued", "Vehicle inspection"],
  },
  truck: {
    id: "truck",
    brandName: "Yalla Haul",
    brandEmoji: "🚚",
    brandTagline: "Truck, lorry & hauler transport",
    confirmationTitle: "Cargo transport confirmation",
    documentTitle: "Cargo transport confirmation",
    documentTemplate: "truck_receipt",
    assetLabel: "Truck",
    assetPluralLabel: "Trucks",
    operatorLabel: "Haulage operator",
    crewLabel: "Driver & turnboy",
    occupantLabel: "Consignment",
    occupantPluralLabel: "Consignments",
    manifestLabel: "Cargo manifest",
    seatingLabel: "Payload configuration",
    routeLabel: "Haulage route",
    originLabel: "Loading point",
    destinationLabel: "Delivery point",
    departureLabel: "Loading schedule",
    arrivalLabel: "Delivery schedule",
    feesLabel: "Weighbridge, tolls & permits",
    galleryLabel: "Truck & body",
    durationLabel: "Haulage days",
    features: { ...noFeatures, cargoManifest: true, luggage: true },
    wizardSteps: ["Loading point", "Delivery point", "Truck type & payload", "Cargo manifest", "Loading instructions", "Payment", "Cargo transport confirmation"],
    pricingLines: ["Road distance", "Payload band", "Driver & turnboy", "Fuel", "Tolls", "Loading & offloading"],
    receiptFields: ["Truck type", "Registration", "Payload", "Cargo capacity", "Loading point", "Delivery point", "Delivery schedule", "Driver", "Turnboy", "Route"],
  },
  marine: {
    id: "marine",
    brandName: "Yalla Marine",
    brandEmoji: "🛥",
    brandTagline: "Yacht, boat & ship charter",
    confirmationTitle: "Voyage confirmation",
    documentTitle: "Voyage confirmation & sailing plan",
    documentTemplate: "boat_receipt",
    assetLabel: "Vessel",
    assetPluralLabel: "Vessels",
    operatorLabel: "Marine operator",
    crewLabel: "Captain & crew",
    occupantLabel: "Guest",
    occupantPluralLabel: "Guests",
    manifestLabel: "Guest list",
    seatingLabel: "Deck & cabin plan",
    routeLabel: "Water route",
    originLabel: "Departure marina",
    destinationLabel: "Arrival marina",
    departureLabel: "Cast off",
    arrivalLabel: "Berthing",
    feesLabel: "Harbour & dock fees",
    galleryLabel: "Vessel & decks",
    durationLabel: "Cruising hours",
    features: { ...noFeatures, occupantList: true, marineSafety: true },
    wizardSteps: ["Departure marina", "Destination marina", "Guests & hours", "Captain & crew", "Catering & safety", "Payment", "Voyage confirmation"],
    pricingLines: ["Cruising hours", "Captain", "Crew", "Fuel", "Dock fees"],
    receiptFields: ["Vessel", "Captain", "Crew", "Marina", "Cruising hours", "Fuel", "Dock fees", "Life jackets"],
  },
  equipment: {
    id: "equipment",
    brandName: "Yalla Assets",
    brandEmoji: "🏗",
    brandTagline: "Machinery, equipment & event assets",
    confirmationTitle: "Hire confirmation",
    documentTitle: "Hire agreement & confirmation",
    documentTemplate: "equipment_receipt",
    assetLabel: "Equipment",
    assetPluralLabel: "Equipment",
    operatorLabel: "Hire yard",
    crewLabel: "Operator & rigger",
    occupantLabel: "Site contact",
    occupantPluralLabel: "Site contacts",
    manifestLabel: "Site contacts",
    seatingLabel: "Configuration",
    routeLabel: "Delivery & collection",
    originLabel: "Delivery site",
    destinationLabel: "Collection site",
    departureLabel: "On-hire",
    arrivalLabel: "Off-hire",
    feesLabel: "Transport, rigging & site fees",
    galleryLabel: "Equipment photos",
    durationLabel: "Hire days",
    features: { ...noFeatures },
    wizardSteps: ["Delivery site", "Hire period", "Equipment class", "Site requirements", "Payment", "Hire confirmation"],
    pricingLines: ["Daily rate", "Transport", "Operator", "Fuel", "Site fees"],
    receiptFields: ["Equipment", "Serial", "Hire period", "Delivery site", "Operator", "Transport", "Damage deposit"],
  },
};

/** Slug → domain. Anything unmapped resolves by keyword, then to equipment. */
const SLUG_DOMAIN: Record<string, AssetDomainId> = {
  "aircraft-charter": "aviation",
  "helicopter-charter": "aviation",
  "aircraft-leasing": "aviation",
  "bus-charter": "road_passenger",
  "marine-charter": "marine",
  "truck-hauler-leasing": "truck",
  "car-rentals": "car_rental",
  "heavy-machinery-leasing": "equipment",
  "equipment-rentals": "equipment",
  "event-rentals": "equipment",
};

/** Asset Type Resolver — the single mapping from a marketplace slug to a domain. */
export function resolveAssetDomain(slug: string | null | undefined): AssetDomainId {
  if (!slug) return "equipment";
  const direct = SLUG_DOMAIN[slug];
  if (direct) return direct;
  const s = slug.toLowerCase();
  if (/aircraft|jet|helicopter|air/.test(s)) return "aviation";
  if (/bus|coach|van|shuttle/.test(s)) return "road_passenger";
  if (/truck|lorry|hauler|haulage|cargo/.test(s)) return "truck";
  if (/car|self-drive/.test(s)) return "car_rental";
  if (/marine|boat|yacht|ship|vessel/.test(s)) return "marine";
  return "equipment";
}

/** Domain Renderer entry point — the lexicon every charter surface reads from. */
export function domainLexicon(slug: string | null | undefined): DomainLexicon {
  return DOMAIN_LEXICONS[resolveAssetDomain(slug)];
}

/** True when the slug's domain is aviation (guards aviation-only UI blocks). */
export const isAviationDomain = (slug: string | null | undefined) =>
  resolveAssetDomain(slug) === "aviation";

/** Product-specific document template id, e.g. `bus_receipt`. */
export const documentTemplateFor = (slug: string | null | undefined, kind = "receipt") => {
  const lex = domainLexicon(slug);
  return kind === "receipt" ? lex.documentTemplate : `${lex.documentTemplate.replace(/_receipt$/, "")}_${kind}`;
};

/** Terminology that may only ever appear inside the aviation domain. */
export const AVIATION_ONLY_TERMS = [
  "aircraft", "cabin", "flight", "airport", "icao", "iata", "runway",
  "pilot", "boarding pass", "landing", "navigation fee", "empty leg",
] as const;

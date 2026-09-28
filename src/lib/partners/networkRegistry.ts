/**
 * PARTNER NETWORK REGISTRY — the single machine-readable source for the public
 * "The network" experience on /partners.
 *
 * Governance rules encoded here:
 *  • Every category resolves its capability list and its destination from the
 *    Partner Capability Registry (`taxonomy.ts`) where a segment exists, so the
 *    marketing surface can never drift from the operational taxonomy.
 *  • No route is invented: destinations are either an existing /partners/<slug>
 *    segment page or the validated /partners/apply application route.
 *  • No volumes, no counts, no guarantees — capability language only.
 *  • Imagery is imported through vite-imagetools, producing AVIF/WebP/JPEG
 *    variants at retina widths, with intrinsic dimensions for zero layout shift.
 */
import { findSegment } from "@/lib/partners/taxonomy";
import type { PictureSet } from "@/components/marketing/ResponsiveImage";

/* ---------------- imagery (build-time responsive variants) ---------------- */
import travelTourism from "@/assets/partners/network/travel-tourism.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import hospitality from "@/assets/partners/network/hospitality.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import corporate from "@/assets/partners/network/corporate-institutions.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import commerceRetail from "@/assets/partners/network/commerce-retail.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import logisticsCourier from "@/assets/partners/network/logistics-courier.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import eventsAviation from "@/assets/partners/network/events-aviation.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import driversChauffeurs from "@/assets/partners/network/drivers-chauffeurs.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import fleetOperators from "@/assets/partners/network/fleet-operators.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import busCoach from "@/assets/partners/network/bus-coach.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import logisticsProviders from "@/assets/partners/network/logistics-providers.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import aircraftOperators from "@/assets/partners/network/aircraft-operators.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import marineEquipment from "@/assets/partners/network/marine-equipment.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";

export type EcosystemKey = "distribution" | "supply";

export interface NetworkCategory {
  /** Stable id — used for tab panels, analytics and deep state. */
  id: string;
  label: string;
  /** One-line description shown on the selector card. */
  description: string;
  /** Overlay chips on the stage image — the business, in four words. */
  overlay: string[];
  /** What the partner can actually do in the platform. */
  capabilities: string[];
  /** Why it is commercially worth doing. */
  partnerValue: string;
  /** Where the record of this relationship lives — credibility, not a claim. */
  provenance: string;
  cta: string;
  to: string;
  /** Optional deep read on the existing segment page. */
  segmentTo?: string;
  analyticsEvent: string;
  image: PictureSet;
  alt: string;
}

export interface Ecosystem {
  key: EcosystemKey;
  /** Preserved terminology — do not reword. */
  label: string;
  role: string;
  lead: string;
  cta: string;
  to: string;
  analyticsEvent: string;
  categories: NetworkCategory[];
}

/** Capability list from the operational taxonomy, so the two never diverge. */
const services = (slug: string, fallback: string[]) =>
  findSegment(slug)?.services ?? fallback;

/** Application route from the operational taxonomy where one is defined. */
const applyRoute = (slug: string, fallback: string) =>
  findSegment(slug)?.applyRoute ?? fallback;

const segmentRoute = (slug: string) =>
  findSegment(slug) ? `/partners/${slug}` : undefined;

export const NETWORK_STAGE_SIZES =
  "(min-width: 1280px) 62vw, (min-width: 768px) 92vw, 100vw";
export const NETWORK_THUMB_SIZES =
  "(min-width: 1280px) 12vw, (min-width: 640px) 22vw, 40vw";

export const ECOSYSTEMS: Ecosystem[] = [
  {
    key: "distribution",
    label: "Distribution partners — demand",
    role: "Organisations with customers to move.",
    lead: "You already hold the customer relationship. TaxiD supplies the movement, the commercial record and the settlement behind it.",
    cta: "Apply as a distribution partner",
    to: "/partners/apply?track=distribution",
    analyticsEvent: "distribution_application_started",
    categories: [
      {
        id: "travel-tourism",
        label: "Travel & tourism",
        description: "Tour operators, DMCs, travel agencies and OTAs arranging ground movement for arriving guests.",
        overlay: ["Airport transfers", "Ground transport", "Tour operations", "Guest mobility"],
        capabilities: services("travel-tourism", []),
        partnerValue: "Sell guest mobility without building or funding your own transport operation.",
        provenance: "Recorded against partner quotes and settlements in the partner ledger.",
        cta: "Explore travel & tourism partnership",
        to: applyRoute("travel-tourism", "/partners/apply?track=distribution"),
        segmentTo: segmentRoute("travel-tourism"),
        analyticsEvent: "distribution_category_selected",
        image: travelTourism,
        alt: "A travel operator greeting arriving international guests at a Nairobi airport terminal with an executive vehicle waiting outside",
      },
      {
        id: "hospitality",
        label: "Hospitality",
        description: "Hotels, lodges and resorts offering airport transfers, excursions and guest mobility.",
        overlay: ["Guest transfers", "Excursions", "Hotel mobility", "VIP transport"],
        capabilities: services("hospitality", []),
        partnerValue: "Offer a dependable arrival and departure experience as part of the stay.",
        provenance: "Every guest movement carries an order record and a reconciled commercial line.",
        cta: "Explore hospitality partnership",
        to: applyRoute("hospitality", "/partners/apply?track=distribution"),
        segmentTo: segmentRoute("hospitality"),
        analyticsEvent: "distribution_category_selected",
        image: hospitality,
        alt: "A uniformed chauffeur opening an executive sedan door for a guest under the portico of a luxury Nairobi hotel",
      },
      {
        id: "corporate-institutions",
        label: "Corporate & institutions",
        description: "Employers, NGOs, schools and government arranging staff, delegate and institutional travel.",
        overlay: ["Staff transport", "Executive travel", "Delegate movement", "Managed mobility"],
        capabilities: services("corporate", []),
        partnerValue: "Move staff and delegates under policy, with approvals and cost centres recorded.",
        provenance: "Approvals, cost centres and trip intent are written to the corporate mobility record.",
        cta: "Explore corporate partnership",
        to: applyRoute("corporate", "/partners/apply?track=distribution"),
        segmentTo: segmentRoute("corporate"),
        analyticsEvent: "distribution_category_selected",
        image: corporate,
        alt: "Corporate colleagues leaving a glass office tower in Nairobi towards a waiting executive vehicle",
      },
      {
        id: "commerce-retail",
        label: "Commerce & retail",
        description: "E-commerce and retail brands that need delivery and mobility for their own customers.",
        overlay: ["Same-day delivery", "Dispatch", "Proof of delivery", "Returns movement"],
        capabilities: services("commerce-retail", []),
        partnerValue: "Deliver under your own brand without operating riders, vans or a dispatch desk.",
        provenance: "Each delivery carries a dispatch record and proof of delivery in the logistics spine.",
        cta: "Explore commerce & retail partnership",
        to: applyRoute("commerce-retail", "/partners/apply?track=distribution"),
        segmentTo: segmentRoute("commerce-retail"),
        analyticsEvent: "distribution_category_selected",
        image: commerceRetail,
        alt: "A courier loading parcels into a delivery van at a retail dispatch bay while an operations manager checks a tablet",
      },
      {
        id: "logistics-courier",
        label: "Logistics & courier",
        description: "Couriers, freight forwarders and 3PLs extending capacity without buying vehicles.",
        overlay: ["Parcel movement", "Cargo movement", "Capacity requests", "Order lifecycle"],
        capabilities: [
          "Parcel and cargo orders",
          "Capacity requests for routes you cannot cover",
          "Allocation to verified logistics supply",
          "Tracking and proof of delivery",
          "Reconciliation before settlement",
        ],
        partnerValue: "Take work you cannot currently fulfil and pass it to verified capacity.",
        provenance: "Allocation reasons and exceptions are recorded as tracked operational events.",
        cta: "Discuss a logistics distribution agreement",
        to: "/partners/apply?track=distribution",
        analyticsEvent: "distribution_category_selected",
        image: logisticsCourier,
        alt: "A logistics supervisor with a tablet coordinating cargo loading into a truck at a Nairobi freight depot",
      },
      {
        id: "events-aviation",
        label: "Events & aviation",
        description: "Event organisers, airlines and air charter organisations moving groups, crews and delegates.",
        overlay: ["Group movement", "Crew transport", "Delegate journeys", "Multi-leg planning"],
        capabilities: services("events-destinations", []),
        partnerValue: "Plan and execute group movement as one journey with a single commercial view.",
        provenance: "Legs are grouped into a journey record with one reconciled commercial view.",
        cta: "Explore events & destinations partnership",
        to: applyRoute("events-destinations", "/partners/apply?track=distribution"),
        segmentTo: segmentRoute("events-destinations"),
        analyticsEvent: "distribution_category_selected",
        image: eventsAviation,
        alt: "Conference delegates boarding an executive coach outside a Nairobi convention centre with a coordinator directing them",
      },
    ],
  },
  {
    key: "supply",
    label: "Supply partners — capacity",
    role: "Operators with assets and crews to utilise.",
    lead: "You hold the vehicles, crews and licences. TaxiD brings recorded demand, allocation reasons and reconciled settlement.",
    cta: "Apply as a supply partner",
    to: "/partners/apply?track=supply",
    analyticsEvent: "supply_application_started",
    categories: [
      {
        id: "drivers-chauffeurs",
        label: "Drivers & chauffeurs",
        description: "Verified professional drivers operating under a fleet or on their own licence.",
        overlay: ["Verified driver", "Vehicle", "Availability", "Trip execution"],
        capabilities: services("drivers", []),
        partnerValue: "Work from recorded demand instead of waiting at the rank.",
        provenance: "Licence, compliance documents and expiries are held as verified driver records.",
        cta: "Start a driver application",
        to: "/driver/apply",
        segmentTo: segmentRoute("drivers"),
        analyticsEvent: "supply_category_selected",
        image: driversChauffeurs,
        alt: "A professional chauffeur standing beside a polished executive sedan on a tree-lined Nairobi avenue",
      },
      {
        id: "fleet-operators",
        label: "Fleet operators",
        description: "Operators of executive, van and utility fleets seeking sustained utilisation.",
        overlay: ["Vehicles", "Availability", "Utilisation", "Demand matching"],
        capabilities: services("fleet-operators", []),
        partnerValue: "Turn available fleet capacity into bookable demand.",
        provenance: "Vehicles, availability and utilisation are held as supply asset records.",
        cta: "Apply as a fleet partner",
        to: applyRoute("fleet-operators", "/partners/apply?track=supply"),
        segmentTo: segmentRoute("fleet-operators"),
        analyticsEvent: "supply_category_selected",
        image: fleetOperators,
        alt: "A fleet manager with a tablet walking a depot yard past a row of executive SUVs, sedans and utility vans",
      },
      {
        id: "bus-coach",
        label: "Bus & coach operators",
        description: "Group movement capacity for staff transport, events and upcountry charters.",
        overlay: ["Group capacity", "Staff transport", "Event movement", "Upcountry charter"],
        capabilities: services("charter-operators", []),
        partnerValue: "Fill seats and vehicle days from contracted group demand.",
        provenance: "Charter quotations are computed server-side from the contracted rate card.",
        cta: "Apply as a coach charter operator",
        to: applyRoute("charter-operators", "/partners/apply?track=supply"),
        segmentTo: segmentRoute("charter-operators"),
        analyticsEvent: "supply_category_selected",
        image: busCoach,
        alt: "Executive coaches parked in a row at a Nairobi depot while an operations manager briefs a uniformed driver",
      },
      {
        id: "logistics-providers",
        label: "Logistics providers",
        description: "Courier, freight and 3PL capacity for parcel and cargo movement.",
        overlay: ["Parcel capacity", "Cargo capacity", "Allocation", "Proof of delivery"],
        capabilities: services("logistics-carriers", []),
        partnerValue: "Receive allocated parcel and cargo work against your declared capacity.",
        provenance: "Allocation, exceptions and proof of delivery are recorded per order.",
        cta: "Apply as a logistics carrier",
        to: applyRoute("logistics-carriers", "/partners/apply?track=supply"),
        segmentTo: segmentRoute("logistics-carriers"),
        analyticsEvent: "supply_category_selected",
        image: logisticsProviders,
        alt: "A third-party logistics operator scanning palletised cargo beside a fleet of panel vans in a Nairobi distribution yard",
      },
      {
        id: "aircraft-operators",
        label: "Aircraft operators",
        description: "Licensed air charter operators providing lift for corporate and safari itineraries.",
        overlay: ["Charter", "Transfers", "Corporate aviation", "Destination movement"],
        capabilities: services("charter-operators", []),
        partnerValue: "Receive charter enquiries with route, timing and class already specified.",
        provenance: "Operator certification and compliance documents are verified before admission.",
        cta: "Apply as an air charter operator",
        to: applyRoute("charter-operators", "/partners/apply?track=supply"),
        segmentTo: segmentRoute("charter-operators"),
        analyticsEvent: "supply_category_selected",
        image: aircraftOperators,
        alt: "A private business jet on an African apron with a pilot completing a walk-around as executives approach",
      },
      {
        id: "marine-equipment",
        label: "Marine & equipment",
        description: "Marine operators and equipment providers supporting specialist movement.",
        overlay: ["Vessel capacity", "Specialist equipment", "Coastal transfers", "Project movement"],
        capabilities: [
          "Declare vessels, equipment and crewed capacity",
          "Receive specialist movement enquiries",
          "Quote against the contracted commercial model",
          "Record execution and exceptions per order",
          "Reconcile before settlement",
        ],
        partnerValue: "Put specialist marine and equipment capacity in front of contracted demand.",
        provenance: "Admission is compliance-verified; capacity is held as declared supply assets.",
        cta: "Discuss a marine or equipment agreement",
        to: "/partners/apply?track=supply",
        analyticsEvent: "supply_category_selected",
        image: marineEquipment,
        alt: "A crewed motor launch alongside a Kenyan coastal jetty with specialist equipment cases staged on the dock",
      },
    ],
  },
];

/** Execution engine — the layer between the two ecosystems. */
export const ENGINE_STAGES = [
  "Match",
  "Quote",
  "Book",
  "Allocate",
  "Execute",
  "Reconcile",
] as const;

export const NETWORK_OUTCOMES = [
  { t: "One execution engine", d: "Ride, charter, delivery, logistics, rental and leasing." },
  { t: "Smart matching", d: "Demand matched to appropriate supply, with the reason recorded." },
  { t: "Transparent commercials", d: "Supplier cost, TaxiD margin and partner economics per the applicable commercial model." },
  { t: "Reliable settlement", d: "Orders reconcile before settlement." },
] as const;

export const getEcosystem = (key: EcosystemKey) =>
  ECOSYSTEMS.find((e) => e.key === key) ?? ECOSYSTEMS[0];

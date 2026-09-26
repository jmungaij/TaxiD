/**
 * PARTNER WORKSPACE LIFECYCLE — machine-readable source for the public
 * "Partner workspace" control surface on /partners.
 *
 * The workspace is not six features; it is one continuous record moving from a
 * partner's customer relationship into SAFARID's execution network and back into
 * settlement. Each stage below states:
 *   • who owns it (the partner, SAFARID, or both),
 *   • what actually happens in the platform today,
 *   • where the record lives — a real deep link into an existing surface.
 *
 * Governance:
 *  • destinations are existing routes only (`/partner/workspace?tab=…`,
 *    `/partners/apply`, `/support`); nothing invented,
 *  • no volumes, counts, rates, SLAs or guarantees are stated,
 *  • where a capability is desk-operated rather than self-service, the stage
 *    says so instead of implying a screen that does not exist.
 */
import type { PictureSet } from "@/components/marketing/ResponsiveImage";

import imgCustomer from "@/assets/partners/network/corporate-institutions.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgDemand from "@/assets/partners/network/travel-tourism.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgBooking from "@/assets/partners/network/maturity-manage.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgCommercials from "@/assets/partners/econ-margin.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgCapacity from "@/assets/partners/network/fleet-operators.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgExecution from "@/assets/partners/network/drivers-chauffeurs.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgJourney from "@/assets/partners/network/bus-coach.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgReconciliation from "@/assets/partners/network/maturity-embed.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";
import imgExperience from "@/assets/partners/network/hospitality.jpg?w=560;960;1600&format=avif;webp;jpg&as=picture";

export type StageOwner = "partner" | "yalla" | "shared";

export const OWNER_LABEL: Record<StageOwner, string> = {
  partner: "You own this",
  yalla: "SAFARID operates this",
  shared: "You and SAFARID, on one record",
};

export interface LifecycleStage {
  id: string;
  /** Rail number — the sequence is the story. */
  n: string;
  /** Rail label, single word where possible so it never wraps. */
  label: string;
  owner: StageOwner;
  /** The partner's sentence for this stage. */
  claim: string;
  /** What the stage is, in one line. */
  lead: string;
  /** What actually happens in the platform. */
  does: string[];
  /** Where the record of this stage lives — credibility without numbers. */
  provenance: string;
  cta: string;
  to: string;
  /** Secondary, honest entry point when the stage is desk-operated. */
  secondary?: { label: string; to: string };
  analyticsEvent: string;
  image: PictureSet;
  alt: string;
}

export const LIFECYCLE: LifecycleStage[] = [
  {
    id: "customer",
    n: "01",
    label: "Customer",
    owner: "partner",
    claim: "My customer.",
    lead: "Your customer register stays yours — SAFARID never becomes the relationship owner.",
    does: [
      "Create and maintain customer records with references and preferences",
      "Attach cost centres and internal references used by your own billing",
      "Every later order, journey and document is filed against that customer",
    ],
    provenance: "Held in your partner workspace under row-level authorisation, so only your team reaches it.",
    cta: "Open the customer register",
    to: "/partner/workspace?tab=customers",
    analyticsEvent: "partner_lifecycle_customer",
    image: imgCustomer,
    alt: "A corporate travel manager reviewing customer accounts with a colleague in a Nairobi office",
  },
  {
    id: "demand",
    n: "02",
    label: "Demand",
    owner: "partner",
    claim: "My demand.",
    lead: "A customer request becomes structured demand — service line, route, timing and class.",
    does: [
      "Capture the requirement against an existing customer, not a blank form",
      "Choose the service line: ride, charter, delivery, logistics, rental or leasing",
      "Record what the customer actually asked for before anything is priced",
    ],
    provenance: "Recorded as the order intake stage of a partner order, versioned from the moment it is created.",
    cta: "Start a customer order",
    to: "/partner/workspace?tab=book",
    analyticsEvent: "partner_lifecycle_demand",
    image: imgDemand,
    alt: "A travel operations desk taking a customer transport request by phone in daylight",
  },
  {
    id: "booking",
    n: "03",
    label: "Booking",
    owner: "shared",
    claim: "My order.",
    lead: "One order surface for every SAFARID service line, placed on your customer's behalf.",
    does: [
      "Place the order across service lines from a single form",
      "Route it through your own approval path where your account requires one",
      "Track status from draft to confirmation without leaving the workspace",
    ],
    provenance: "One partner order record, with each state change written to an append-only trail.",
    cta: "Book for a customer",
    to: "/partner/workspace?tab=book",
    analyticsEvent: "partner_lifecycle_booking",
    image: imgBooking,
    alt: "A partner operator confirming a mobility order on a laptop workspace",
  },
  {
    id: "commercials",
    n: "04",
    label: "Commercials",
    owner: "shared",
    claim: "My commercial.",
    lead: "Supplier cost, SAFARID margin, your margin and applicable taxes — visible before you confirm.",
    does: [
      "Pricing is computed server-side from your contracted rate card",
      "The commercial breakdown is shown on the order, not sent later",
      "The rate version used is pinned to the order for audit",
    ],
    provenance: "Derived from the contracted rate card; no rate is entered by hand on the order.",
    cta: "See how commercials appear",
    to: "/partner/workspace?tab=book",
    secondary: { label: "Discuss commercial terms", to: "/partners/apply?track=distribution" },
    analyticsEvent: "partner_lifecycle_commercials",
    image: imgCommercials,
    alt: "Two executives concluding a commercial agreement beside a navy sedan outside a glass office",
  },
  {
    id: "capacity",
    n: "05",
    label: "Capacity",
    owner: "yalla",
    claim: "SAFARID's supply.",
    lead: "You do not have to own the vehicles. SAFARID matches the order to verified capacity.",
    does: [
      "Matching scores admitted supply against the order and records the reason",
      "Raise a capacity request when the supply you need is not yet visible",
      "Compliance-verified operators only — admission precedes allocation",
    ],
    provenance: "Matching decisions are stored with their scoring reasons; supply admission is document-verified.",
    cta: "Raise a capacity request",
    to: "/partner/workspace?tab=capacity",
    analyticsEvent: "partner_lifecycle_capacity",
    image: imgCapacity,
    alt: "A verified commercial fleet of vans and executive vehicles staged at first light",
  },
  {
    id: "execution",
    n: "06",
    label: "Execution",
    owner: "yalla",
    claim: "One execution engine.",
    lead: "Allocation, dispatch and delivery run on SAFARID's operating layer — one engine for every service line.",
    does: [
      "Allocation to the assigned operator, driver, vehicle or carrier",
      "Operational exceptions are raised as tracked cases with owners",
      "Order state moves forward on the same record your customer was booked on",
    ],
    provenance: "Execution events are produced onto the operational spine and worked by SAFARID operations.",
    cta: "Follow the order lifecycle",
    to: "/partner/workspace?tab=orders",
    analyticsEvent: "partner_lifecycle_execution",
    image: imgExecution,
    alt: "A professional chauffeur receiving a dispatch assignment beside a dark navy sedan in Nairobi",
  },
  {
    id: "journey",
    n: "07",
    label: "Journey",
    owner: "shared",
    claim: "One customer journey.",
    lead: "Several legs, one customer journey, one commercial view — not a pile of unrelated bookings.",
    does: [
      "Group arrival, transfers, charter legs and departure into one journey",
      "See the journey the way your customer experiences it",
      "Keep one commercial view across every leg in the journey",
    ],
    provenance: "Journeys reference the same partner orders — grouping never creates a second source of truth.",
    cta: "Open journeys",
    to: "/partner/workspace?tab=journeys",
    analyticsEvent: "partner_lifecycle_journey",
    image: imgJourney,
    alt: "A coach and executive vehicles coordinated for a multi-leg group journey",
  },
  {
    id: "reconciliation",
    n: "08",
    label: "Reconciliation",
    owner: "shared",
    claim: "My margin, reconciled.",
    lead: "Delivered orders are reconciled against the commercials agreed at confirmation, then settled.",
    does: [
      "Delivered quantities and cost are reconciled to the confirmed order",
      "Your margin is recognised on the reconciled order, not estimated",
      "Financial entries are append-only — no ledger line is edited in place",
    ],
    provenance: "Settlement reads an append-only ledger; wallet credits are recognised only from verified payment callbacks.",
    cta: "Review orders and settlement",
    to: "/partner/workspace?tab=orders",
    analyticsEvent: "partner_lifecycle_reconciliation",
    image: imgReconciliation,
    alt: "A finance analyst reconciling delivered mobility orders on screen",
  },
  {
    id: "experience",
    n: "09",
    label: "Experience",
    owner: "shared",
    claim: "One customer experience.",
    lead: "Your customer sees your brand and one standard of service — with documents they can verify.",
    does: [
      "Issued commercial documents are sealed with a content fingerprint and can be verified independently",
      "Service exceptions and compliance findings are tracked with owners and resolution trails",
      "A named partner desk carries commercial and operational escalation",
    ],
    provenance: "Document seals are independently verifiable; escalation runs through the partner desk, not a shared inbox.",
    cta: "Open documents",
    to: "/partner/workspace?tab=documents",
    secondary: { label: "Partner desk and support", to: "/support" },
    analyticsEvent: "partner_lifecycle_experience",
    image: imgExperience,
    alt: "A hotel guest welcomed into a waiting executive vehicle by a chauffeur at a Nairobi property",
  },
];

export const LIFECYCLE_IDS = LIFECYCLE.map((s) => s.id);

export const LIFECYCLE_STAGE_SIZES = "(min-width: 1024px) 58vw, 100vw";

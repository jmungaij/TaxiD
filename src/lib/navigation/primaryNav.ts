/**
 * Canonical public navigation registry — the single source of truth for the
 * marketing header, mega menu, mobile navigation and footer.
 *
 * Information architecture (IA v3.0 — forensic re-engineering):
 * navigation models the CUSTOMER'S mental model, not the feature inventory.
 * Five layers are kept strictly separate:
 *
 *   A. Products / services   → Rides, Business & Charter, Rentals & Leasing, Delivery, Logistics
 *   B. Discovery → included inside its relevant service category
 *   C. Management / operations → surfaced inside product categories as
 *      `requiresAuth` items, never as top-level categories
 *   D. Partner / supply      → Partners (drivers, fleet, charter, logistics)
 *   E. Company / resources   → Resources (help, developers, company, trust)
 *
 * Rules enforced by src/lib/navigation/__tests__/primary-nav.test.ts:
 *   - primary categories follow customer services, in commercial-priority order
 *   - every destination resolves to a route registered in src/lib/routes.ts
 *   - no destination repeats inside a single category
 *   - no hash deep links whose anchor target does not exist
 *   - the footer is derived from this registry (never hand-maintained)
 */
import { ROUTES } from "@/lib/routes";
import { logUiEvent } from "@/lib/navLog";
import { segmentsBySide } from "@/lib/partners/taxonomy";

/** Who a destination is intended for. Frontend hint only — RLS is authoritative. */
export type NavAudience =
  | "public"
  | "rider"
  | "corporate"
  | "partner"
  | "operator"
  | "staff";

export type NavChild = {
  to: string;
  label: string;
  desc?: string;
  external?: boolean;
  /** Intended audience (used for role-aware presentation, not security). */
  audience?: NavAudience;
  /** True when the destination is behind authentication. */
  requiresAuth?: boolean;
  /**
   * Guarantees the destination survives the footer projection's per-column cap.
   * Used for company-critical entry points (e.g. Careers) that would otherwise
   * be truncated by group ordering.
   */
  footerPin?: boolean;
};

export type NavGroup = { heading?: string; items: NavChild[] };

export type NavItem = {
  to?: string;
  label: string;
  /** One-line explanation rendered at the top of the mega panel. */
  desc?: string;
  groups?: NavGroup[];
  /** Single featured conversion CTA for the category. */
  featured?: { to: string; label: string; desc?: string; requiresAuth?: boolean; audience?: NavAudience };
  /** Mega-panel column count (defaults to the number of groups, capped at 4). */
  cols?: 2 | 3 | 4;
};

/* ------------------------------------------------------------------ *
 * Route resolution
 * ------------------------------------------------------------------ */

const registered = new Set(ROUTES.map((r) => r.path));

/** Strips query string and hash — deep links share their parent's route. */
export function navPathname(to: string): string {
  return to.split("#")[0].split("?")[0] || "/";
}

/** Query-string `tab` value of a deep-linked nav item, when present. */
export function navTab(to: string): string | null {
  const q = to.split("#")[0].split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get("tab");
}

/**
 * True when the target maps onto a registered route. Dynamic segments and
 * nested children are tolerated by walking up the path, mirroring the
 * route-integrity report.
 */
export function isNavPathResolvable(to: string): boolean {
  if (/^https?:/i.test(to)) return true;
  const path = navPathname(to);
  if (registered.has(path)) return true;
  const parts = path.split("/").filter(Boolean);
  while (parts.length > 0) {
    parts.pop();
    const candidate = "/" + parts.join("/");
    if (registered.has(candidate) || registered.has(candidate + "/*")) return true;
  }
  return false;
}

/**
 * Active-state rule shared by desktop and mobile navigation. A `?tab=` item is
 * active only when the current location carries the same tab, so sibling tabs
 * on one route never highlight together.
 */
export function isNavItemActive(to: string, pathname: string, search = ""): boolean {
  if (/^https?:/i.test(to)) return false;
  if (navPathname(to) !== pathname) return false;
  const tab = navTab(to);
  if (!tab) return true;
  return new URLSearchParams(search).get("tab") === tab;
}

/** Fire-and-forget analytics for navigation engagement. */
export function trackNavClick(section: string, child: NavChild, surface: "desktop" | "mobile") {
  void logUiEvent({
    elementId: `nav.${section.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    elementLabel: child.label,
    action: "nav_click",
    payload: { section, label: child.label, to: child.to, surface },
  });
}

/* ------------------------------------------------------------------ *
 * Primary categories
 * ------------------------------------------------------------------ */

export const PRIMARY_CATEGORIES = [
  "Rides",
  "Drivers",
   "Business & Charter",
  "Rentals & Leasing",
   "Delivery",
  "Logistics",
  "TaxiD Partners",
  "Resources",
] as const;


export type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number];

export function buildPrimaryNav(appLinks: {
  riderAndroid: string;
  riderIos: string;
  driverAndroid: string;
  driverIos: string;
}): NavItem[] {
  return [
    /* 01 — RIDES: individual passenger mobility. */
    {
      label: "Rides",
      desc: "Everyday rides, airport transfers and scheduled journeys for individuals.",
      cols: 3,
      featured: { to: "/rider", label: "Book a Ride", desc: "Set your pickup, see the fare, meet your driver", requiresAuth: true, audience: "rider" },
      groups: [
        {
          heading: "Book & travel",
          items: [
            { to: "/rider", label: "Book a Ride", desc: "Request a ride with the fare confirmed upfront", requiresAuth: true, audience: "rider" },
            { to: "/rider/airport", label: "Airport Transfers", desc: "Pre-arranged pickups and drop-offs, timed to your flight", requiresAuth: true, audience: "rider" },
            { to: "/rider/schedule", label: "Intercity & Scheduled Travel", desc: "Book journeys in advance, in town or between cities", requiresAuth: true, audience: "rider" },
            { to: "/pricing", label: "Fares & Vehicle Categories", desc: "Compare taxi, comfort and executive options" },
            { to: "/riders/individual", label: "Why Ride with TaxiD", desc: "Verified driver partners, clear fares, wide coverage" },
          ],
        },

        {
          heading: "Rider portal",
          items: [
            { to: "/dashboard/rider", label: "Rider Portal", desc: "Manage your account in one place", requiresAuth: true, audience: "rider" },
            { to: "/rider/trips", label: "Ride History", desc: "Past journeys and downloadable receipts", requiresAuth: true, audience: "rider" },
            { to: "/rider/favorites", label: "Saved Places", desc: "Save home, work and the places you travel to often", requiresAuth: true, audience: "rider" },
            { to: "/rider/wallet", label: "Wallet", desc: "Top up by M-Pesa or card and keep every receipt", requiresAuth: true, audience: "rider" },
            { to: "/rider/rewards", label: "Rewards", desc: "Earn points and unlock benefits as you travel", requiresAuth: true, audience: "rider" },
          ],
        },
        {
          heading: "Get started",
          items: [
            { to: "/auth?mode=register&role=rider", label: "Create a Rider Account", desc: "Register in under a minute" },
            { to: appLinks.riderAndroid, label: "Download for Android", desc: "Available on Google Play", external: true },
            { to: appLinks.riderIos, label: "Download for iOS", desc: "Available on the App Store", external: true },
            { to: "/support", label: "Rider Support", desc: "Help centre, safety and trip assistance" },
          ],
        },
      ],
    },

    /* 02 — DRIVERS: join → operate → grow. Restored as a first-class category. */
    {
      label: "Drivers",
      desc: "Drive, deliver and grow with TaxiD — access more demand, manage your work and get paid.",
      cols: 3,
      featured: { to: "/driver/apply", label: "Become a Driver", desc: "Register as a TaxiD driver partner" },
      groups: [
        {
          heading: "Join TaxiD",
          items: [
            { to: "/driver/apply", label: "Become a Driver", desc: "Register as a TaxiD driver partner" },
            { to: "/driver/start", label: "Create Driver Account", desc: "Sign up, confirm your payout number and tour the portal" },
            { to: "/driver/apply?track=courier", label: "Courier & Logistics Driver", desc: "Deliver parcels and freight on your own schedule" },
            { to: "/driver/onboarding", label: "Vehicle Requirements", desc: "Eligibility, documents and vehicle standards" },
            { to: "/drivers", label: "Why Drive with TaxiD", desc: "Earnings, benefits and driver partner support" },
          ],
        },
        {
          heading: "Driver portal",
          items: [
            { to: "/auth?redirect=/dashboard/driver", label: "Driver Login", desc: "Sign in to your driver partner profile" },
            { to: "/dashboard/driver", label: "Driver Dashboard", desc: "Track trips, earnings and performance", requiresAuth: true, audience: "partner" },
            { to: "/dashboard/driver/documents", label: "Document Management", desc: "Upload and renew licences and compliance documents", requiresAuth: true, audience: "partner" },
          ],
        },
        {
          heading: "Grow & support",
          items: [
            { to: "/driver/training", label: "Driver Academy", desc: "Training and certification for driver partners" },
            { to: "/driver/support", label: "Driver Support", desc: "Round-the-clock help centre" },
            { to: "/driver/earnings", label: "Earnings & Incentives", desc: "Understand fares, bonuses and payout timing" },
            { to: appLinks.driverAndroid, label: "Get the Driver App — Android", desc: "Available on Google Play", external: true },
            { to: appLinks.driverIos, label: "Get the Driver App — iOS", desc: "Available on the App Store", external: true },
          ],
        },
      ],
    },

    /* 03 — BUSINESS: move people → control spend → manage → integrate. */

    {
       label: "Business & Charter",
       desc: "Managed business travel and ground, air and marine charter in one place.",
       cols: 4,
      featured: { to: "/corporate/register", label: "Open a Business Account", desc: "Complete business verification in one session" },
      groups: [
        {
          heading: "Corporate mobility",
          items: [
            { to: "/riders/corporate", label: "Employee Mobility", desc: "Company-paid staff travel with central booking and spend visibility" },
             { to: "/marketplace?family=ride", label: "Compare ride capacity", desc: "Search participating operators by city and date" },
            { to: "/rentals/chauffeur", label: "Executive Travel", desc: "Chauffeured travel and protocol support for senior teams and guests" },
            { to: "/corporates", label: "Corporate Programmes", desc: "How managed corporate mobility works with TaxiD" },
            { to: "/riders/corporate#book", label: "Request a Movement", desc: "Arrange a business trip in a few steps" },
          ],
        },
        /*
         * Business controls (Travel Approvals, Cost Centres, Corporate Wallet,
         * Policies & Budget Rules, Billing & Reports) are NOT public marketing
         * navigation. They are governed administration surfaces and now live
         * exclusively under Charter & Business → Corporate Controls in the
         * admin / Super Admin rail (src/lib/workspaces/config.ts +
         * src/lib/navigation/domains.ts). Do not reintroduce them here.
         */

        {
          heading: "Business account",
          items: [
            { to: "/business/portal", label: "Power Business Portal", desc: "Your requests, trips and business activity", requiresAuth: true, audience: "corporate" },
            { to: "/corporate/register", label: "Open a Business Account", desc: "Register your organisation and verify it online" },
            { to: "/dashboard/corporate", label: "Corporate Dashboard", desc: "Employees, trips, approvals and spend", requiresAuth: true, audience: "corporate" },
            { to: "/dashboard/charter/portal", label: "Charter Management", desc: "Charter requests, procurement and approvals", requiresAuth: true, audience: "corporate" },
          ],
        },
        {
          heading: "Enterprise & charter",
          items: [
            { to: "/enterprise", label: "Enterprise Solutions", desc: "Tailored mobility programmes with service-level commitments" },
            { to: "/enterprise/demo", label: "Enterprise Walkthrough", desc: "See booking, policy checks, approval and spend control step by step" },
            { to: "/corporate", label: "Company Profile", desc: "Read and download the TaxiD company profile" },
            { to: "/corporate-travel-management", label: "Corporate Travel Programmes", desc: "How corporate travel and staff mobility works with TaxiD in Kenya" },
            { to: "/blog/corporate-travel-management-guide", label: "Corporate Travel Guide", desc: "A practical playbook for travel and finance teams" },
          ],
        },
        {
           heading: "Charter & bookings",
          items: [
             { to: "/charter", label: "All Charter Categories", desc: "Browse ground, air and marine charter services" },
             { to: "/charter/search", label: "Search & Compare Fleet", desc: "Compare participating charter operators" },
             { to: "/marketplace?family=charter", label: "Compare Available Charter", desc: "Search published capacity by city, date and vehicle" },
            { to: "/charter/bus-charter", label: "Bus, Van & Coach Charter", desc: "Staff, school, tour and VIP group movements" },
            { to: "/charter/smartfare", label: "Charter Fares", desc: "Transparent, per-segment charter pricing" },
            { to: "/charter/aircraft-charter", label: "Aircraft Charter", desc: "Private aircraft for executive travel, missions and group journeys" },
            { to: "/charter/helicopter-charter", label: "Helicopter Charter", desc: "Transfers, aerial tours and offshore movements" },
            { to: "/charter/marine-charter", label: "Marine Charter", desc: "Boats, yachts, ferries and cargo vessels" },
            { to: "/charter/booking-status", label: "My Charters", desc: "Charter status, manifests and receipts", requiresAuth: true },
            { to: "/contact", label: "Request a Charter", desc: "Speak to a TaxiD charter consultant" },
          ],
        },
      ],
    },

    /* 04 — RENTALS & LEASING: short-term access vs long-term access. */
    {
      label: "Rentals & Leasing",
      desc: "Flexible vehicle rental and long-term leasing for individuals, businesses and fleet operators.",
      cols: 3,
       featured: { to: "/marketplace?family=rental", label: "Find a Vehicle", desc: "Compare published rental capacity and rates" },
      groups: [
        {
          heading: "Vehicle rental",
          items: [
            { to: "/rentals/self-drive", label: "Cars & SUVs", desc: "Self-drive vehicles by the day, week or month" },
             { to: "/marketplace?family=rental", label: "Compare Rental Capacity", desc: "Search available vehicles from participating operators" },
            { to: "/charter/car-rentals", label: "Luxury Cars", desc: "Premium vehicles, self-drive or with a professional driver" },
          ],
        },
        {
          heading: "Commercial & fleet",
          items: [
            { to: "/rentals/bus-coach", label: "Bus & Coach Rental", desc: "Coaches for single trips or ongoing contracts" },
            { to: "/rentals/corporate-leasing", label: "Fleet Leasing", desc: "Vehicles and fleet capacity on flexible long-term leases" },
            { to: "/charter/truck-hauler-leasing", label: "Truck & Hauler Rental", desc: "Commercial transport capacity for cargo and projects" },
            { to: "/charter/heavy-machinery-leasing", label: "Heavy Equipment", desc: "Excavators, dozers, graders and site machinery" },
          ],
        },
        {
          heading: "Equipment, aviation & events",
          items: [
            { to: "/charter/equipment-rentals", label: "Equipment Rentals", desc: "Tools, plant and project equipment on hire" },
            { to: "/charter/aircraft-leasing", label: "Aircraft Leasing", desc: "Dry, wet and ACMI leasing structures for operators" },
            { to: "/charter/event-rentals", label: "Event Rentals", desc: "Tents, seating, sound and staging for events" },
            { to: "/rentals", label: "All Rentals & Leasing", desc: "The full rental and leasing catalogue with pricing" },
          ],
        },
      ],
    },

    /* 05 — DELIVERY: parcels, documents and city courier. */
    {
      label: "Delivery",
      desc: "Send parcels and documents, book a courier and track your delivery.",
      cols: 2,
      featured: { to: "/delivery/package", label: "Send a Parcel", desc: "Book a same-day collection" },
      groups: [
        {
           heading: "Send & track",
          items: [
             { to: "/delivery", label: "Delivery Overview", desc: "Explore parcel, package and courier options" },
            { to: "/delivery/package", label: "Parcel & Express Delivery", desc: "Same-day parcel collection and delivery across the city" },
            { to: "/delivery/courier", label: "Courier", desc: "Documents, legal files and medical consignments handled with care" },
             { to: "/track", label: "Track a Shipment", desc: "Check the progress of a delivery" },
             { to: "/marketplace?family=logistics", label: "Compare Delivery Capacity", desc: "See participating delivery operators" },
           ],
         },
         {
           heading: "Delivery support",
           items: [
             { to: "/delivery/enquiry", label: "Ask the Delivery Desk", desc: "Request help with an unusual consignment" },
             { to: "/delivery/portal", label: "Carrier Portal", desc: "Manage assigned deliveries", requiresAuth: true, audience: "partner" },
           ],
         },
       ],
     },

     /* 06 — LOGISTICS: freight, fleet and business supply chains. */
     {
       label: "Logistics",
       desc: "Plan freight, dedicated fleet and business distribution with the logistics desk.",
       cols: 3,
       featured: { to: "/logistics/quote", label: "Request a Logistics Quote", desc: "Tell us the route, load and schedule" },
       groups: [
         {
           heading: "Freight & fleet",
           items: [
            { to: "/delivery/logistics", label: "Freight & Cargo", desc: "Regional freight movements through cross-dock hubs" },
            { to: "/delivery/fleet", label: "Truck Dispatch", desc: "Dedicated trucks for repeat and contracted routes" },
             { to: "/marketplace?family=logistics", label: "Compare Freight Capacity", desc: "Discover approved carrier capacity" },
          ],
        },
        {
          heading: "Track & manage",
          items: [
                        { to: "/delivery/ops", label: "Logistics Operations", desc: "Dispatch, routing and exception handling", requiresAuth: true },
            { to: "/delivery/ops/packages", label: "Shipment Operations", desc: "Manage packages and delivery jobs", requiresAuth: true },
            { to: "/delivery/ops/routes", label: "Route Optimisation", desc: "Plan efficient multi-stop routes", requiresAuth: true },
          ],
        },
        {
          heading: "Business logistics",
          items: [
            { to: "/logistics/solutions", label: "Business Logistics", desc: "Warehousing, line-haul, distribution and third-party logistics" },
            { to: "/logistics", label: "Logistics Network", desc: "Coverage, hubs and operating capabilities" },
             { to: "/logistics/quote", label: "Get a Business Quote", desc: "Request a tailored logistics proposal" },
          ],
        },
      ],
    },

    /*
     * 07 — TaxiD PARTNERS: the supply/distribution side, projected from the
     * Partner Capability Registry (src/lib/partners/taxonomy.ts) so a menu
     * entry cannot exist without a real segment page, application route and
     * workspace. Demand-side actors (riders, corporate customers) are never
     * listed here.
     */
    {
      label: "TaxiD Partners",
      desc: "Partner with TaxiD to distribute mobility services, provide transportation capacity or integrate TaxiD into your technology ecosystem.",
      cols: 4,
      featured: { to: "/partners", label: "TaxiD Partners", desc: "Bring demand, provide capacity or integrate technology" },
      groups: [
        {
          heading: "Demand partners — bring customers",
          items: segmentsBySide("DISTRIBUTION").map((s) => ({
            to: `/partners/${s.slug}`,
            label: s.label,
            desc: s.navDesc,
            audience: "partner" as NavAudience,
          })),
        },
        {
          heading: "Supply partners — provide capacity",
          items: segmentsBySide("SUPPLY").map((s) => ({
            to: `/partners/${s.slug}`,
            label: s.label,
            desc: s.navDesc,
            audience: "partner" as NavAudience,
          })),
        },
        {
          heading: "Technology partners",
          items: segmentsBySide("INTEGRATION").map((s) => ({
            to: `/partners/${s.slug}`,
            label: s.label,
            desc: s.navDesc,
            audience: "partner" as NavAudience,
          })),
        },
        {
          heading: "Apply & operate",
          items: [
            { to: "/partners", label: "Partner Programme Overview", desc: "How partnering with TaxiD works" },
            { to: "/partners/apply", label: "Become a Partner", desc: "Tell us about your company and get verified" },
            { to: "/partner/workspace", label: "Partner Workspace", desc: "Quote, book, track and settle in one workspace", requiresAuth: true, audience: "partner" },
            { to: "/dashboard/driver", label: "Driver Portal", desc: "Trips, earnings and payouts for driver partners", requiresAuth: true, audience: "partner" },
            { to: "/dashboard/charter/operator-portal", label: "Operator Portal", desc: "Manage fleet, capacity, rates and availability", requiresAuth: true, audience: "operator" },
            { to: "/delivery/portal", label: "Logistics Partner Portal", desc: "Shipments, dispatch and proof of delivery", requiresAuth: true, audience: "partner" },
          ],
        },
        {
          heading: "List your capacity",
          items: [
            { to: "/provider/capacity", label: "Offer Your Capacity", desc: "List vehicles and services for marketplace approval", requiresAuth: true, audience: "partner" },
            { to: "/operator", label: "Operator Portal", desc: "Your rides, statements, wallet and withdrawals", requiresAuth: true, audience: "partner" },
            { to: "/marketplace", label: "See the Marketplace", desc: "How customers search the capacity you publish" },
          ],
        },
      ],
    },

    /* 08 — RESOURCES: information, developers, company and trust. */
    {
      label: "Resources",
      desc: "Help, pricing guidance, developer tools and company information.",
      cols: 3,
      featured: { to: "/support", label: "Visit the Help Centre", desc: "Answers, guides and contact options" },
      groups: [
        {
          heading: "Help & guides",
          items: [
            { to: "/support", label: "Help Centre", desc: "Guides and troubleshooting for every service" },
            { to: "/faq", label: "FAQs", desc: "Answers to the questions customers ask most" },
            { to: "/pricing", label: "Pricing Guide", desc: "Fares, fees and business plans explained" },
            { to: "/safety", label: "Safety Centre", desc: "The measures that protect every journey" },
          ],
        },
        {
          heading: "Developers",
          items: [
            { to: "/developers", label: "Developer Portal", desc: "Documentation, SDKs and a sandbox environment" },
            { to: "/api-docs", label: "API Documentation", desc: "Rides, wallets, bookings and webhooks" },
          ],
        },
        {
          heading: "Company & trust",
          items: [
            { to: "/about", label: "About TaxiD", desc: "Who we are and what we are building" },
            { to: "/news", label: "Newsroom", desc: "Announcements and platform updates" },
            { to: "/careers", label: "Careers", desc: "Open roles — apply and track your application", footerPin: true },
            { to: "/compliance", label: "Compliance", desc: "Our regulatory and governance posture" },
            { to: "/security", label: "Security Centre", desc: "How we protect customer and business data" },
          ],
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Account gateway
 * ------------------------------------------------------------------ */

/**
 * Sign-in destinations surfaced from the header's Sign In control.
 *
 * Identity principle: the public gateway lets a visitor declare HOW they use
 * TaxiD — never WHAT authority they hold. Privileged operating contexts
 * (Super Admin Control Center) are resolved server-side from the
 * authenticated identity's roles, so they are deliberately absent here.
 */
export type SignInGroupKey = "personal" | "business" | "supply";

export interface SignInGroup {
  key: SignInGroupKey;
  heading: string;
  items: NavChild[];
}

export const SIGN_IN_GROUPS: SignInGroup[] = [
  {
    key: "personal",
    heading: "Personal",
    items: [
      { to: "/auth", label: "Customer Login", desc: "Rides and personal mobility" },
      { to: "/clients/login", label: "Client Account Login", desc: "Your bookings, account and service requests" },
    ],
  },
  {
    key: "business",
    heading: "Business",
    items: [
      { to: "/corporate/login", label: "Corporate Login", desc: "Employee mobility, approvals and travel" },
    ],
  },
  {
    key: "supply",
    heading: "Supply",
    items: [
      { to: "/auth?redirect=/dashboard/driver", label: "Driver Login", desc: "Trips, availability and earnings" },
      { to: "/charter/login", label: "Operator Login", desc: "Fleet, charter and transport operations" },
      { to: "/delivery/portal", label: "Partner Login", desc: "Courier, carrier and hub operations" },
    ],
  },
];

/** Flattened gateway destinations (navigation-integrity test surface). */
export const SIGN_IN_ITEMS: NavChild[] = SIGN_IN_GROUPS.flatMap((g) => g.items);

/** Public "Get Started" destination for new customers. */
export const GET_STARTED: NavChild = {
  to: "/auth?mode=register",
  label: "Get Started",
  desc: "Create your TaxiD account",
};

/**
 * Resolves the href a navigation surface should render. Authenticated
 * destinations are routed through the correct login gateway with an explicit
 * `redirect`, so a signed-out visitor is never dropped on a bare login screen
 * and never hits a dead end. Server-side authorization remains authoritative.
 */
export function navHref(child: NavChild): string {
  if (!child.requiresAuth || child.external) return child.to;
  const gateway = child.audience === "corporate" ? "/corporate/login" : "/auth";
  return `${gateway}?redirect=${encodeURIComponent(child.to)}`;
}


/* ------------------------------------------------------------------ *
 * Footer projection (derived — never hand-maintained)
 * ------------------------------------------------------------------ */

export interface FooterColumn {
  title: string;
  links: NavChild[];
}

/**
 * Footer columns derived from the same registry as the header. Authenticated
 * destinations are excluded: the footer is a public discovery surface, so it
 * only lists routes a signed-out visitor can meaningfully open.
 */
export function buildFooterColumns(nav: NavItem[]): FooterColumn[] {
  const columns: FooterColumn[] = nav
    .filter((item) => item.groups)
    .map((item) => {
      const publicLinks = item
        .groups!.flatMap((g) => g.items)
        .filter((c) => !c.requiresAuth && !c.external && !c.to.includes("#"));
      // Pinned destinations are projected first so the per-column cap can never
      // silently drop a company-critical entry point such as Careers.
      const pinned = publicLinks.filter((c) => c.footerPin);
      const rest = publicLinks.filter((c) => !c.footerPin);
      return { title: item.label, links: [...pinned, ...rest].slice(0, 7) };
    })
    .filter((col) => col.links.length > 0);

  columns.push({
    title: "Legal",
    links: [
      { to: "/legal/privacy", label: "Privacy Policy" },
      { to: "/legal/terms", label: "Terms of Service" },
      { to: "/legal/cookies", label: "Cookie Policy" },
      { to: "/legal/data-protection", label: "Data Protection" },
      { to: "/legal/accessibility", label: "Accessibility" },
      { to: "/legal/community", label: "Community Guidelines" },
    ],
  });

  return columns;
}

/**
 * Canonical Staff Access gateway.
 *
 * ONE implementation, ONE route: the public entry point into the authenticated
 * staff environment. Authority is never derived from this link — `/staff`
 * resolves roles server-side and offers only the operating contexts the
 * identity is authorised for (RLS remains authoritative).
 */
export const STAFF_ACCESS: NavChild = {
  to: "/staff",
  label: "Staff Access",
  desc: "TaxiD staff sign-in — operations and administration",
  audience: "staff",
};

/* ------------------------------------------------------------------ *
 * Staff portal (not part of public commercial navigation)
 * ------------------------------------------------------------------ */

/**
 * Staff destinations, migrated out of the public header mega panel and into the
 * Staff Portal dashboard. Kept here so the navigation-integrity test can assert
 * every destination resolves to a registered route.
 */
export const STAFF_PORTAL_SECTIONS: NavGroup[] = [
  {
    heading: "TaxiD Staff 360",
    items: [
      { to: "/staff/360", label: "Staff 360", desc: "Who am I, my work, my impact" },
      { to: "/staff/organisation", label: "Organisation", desc: "Divisions, departments, positions" },
      { to: "/staff/people", label: "People & Capability", desc: "Skills, academy, workforce planning" },
      { to: "/staff/workforce/blueprints", label: "Role Blueprints", desc: "Role purpose, outcomes, KPIs, standard work" },
      { to: "/staff/workforce/launchpad", label: "Workforce Launchpad", desc: "Day-1 activation, 30/60/90 ramp, capacity" },
    ],
  },
  {
    heading: "Business & intelligence",
    items: [
      { to: "/staff/revenue", label: "Revenue Intelligence", desc: "Revenue graph, funnel, quality" },
      { to: "/staff/marketplace", label: "Marketplace 360", desc: "Demand, supply, liquidity" },
      { to: "/staff/customers", label: "Customer 360", desc: "Every customer archetype" },
      { to: "/staff/intelligence", label: "Enterprise Intelligence", desc: "Explained AI signals" },
    ],
  },
];

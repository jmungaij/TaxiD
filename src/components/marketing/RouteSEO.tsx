import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useRouteHeadClaimed } from "@/components/seo/headClaim";

const BASE_URL = "https://yalla-africa.lovable.app";
const OG_IMAGE = `${BASE_URL}/og-safarid-1200x630.v1.png`;

/**
 * Fallback for routes with no entry below. Deliberately distinct from the home
 * route's own metadata so no two URLs ever share a title, description or social
 * preview.
 */
const DEFAULT_META = {
  title: "TaxiD — Transport & Logistics in Kenya",
  description:
    "Browse TaxiD services across Kenya: rides, corporate mobility, charter, vehicle rental and leasing, delivery, freight and logistics.",
};

// Per-route head metadata. Titles <60 chars, descriptions 50–160 chars.
const META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "TaxiD — Move People. Power Business.",
    description:
      "One platform for rides, corporate mobility, charter, vehicle rental and leasing, delivery and freight — with verified providers and M-Pesa payment.",
  },
  "/about": {
    title: "About TaxiD — Mobility & Transportation Marketplace",
    description:
      "Learn how TaxiD connects customers and organisations with transportation, fleet, charter, rental, leasing and logistics providers.",
  },
  "/riders": {
    title: "Rides — Everyday, Airport and Scheduled Journeys",
    description:
      "Book everyday rides, airport transfers and scheduled journeys with verified driver partners. Pay by M-Pesa, card or wallet.",
  },
  "/drivers": {
    title: "Drive with TaxiD — Become a Driver Partner",
    description:
      "Join TaxiD as a driver partner: access more demand, manage your work, get paid, and use training and support.",
  },
  "/corporates": {
    title: "Corporate Mobility — Manage Business Travel with TaxiD",
    description:
      "Manage employee transportation with centralised booking, controlled spending, approvals, invoicing and reporting.",
  },
  "/delivery": {
    title: "Delivery & Logistics — Parcels, Courier and Freight",
    description:
      "Move parcels, freight and cargo with delivery, courier and managed logistics, tracked end to end with proof of delivery.",
  },
  "/rentals": {
    title: "Vehicle Rental & Leasing — Cars, Fleets and Equipment",
    description:
      "Flexible vehicle rental and long-term leasing for individuals, businesses and fleet operators, including buses and equipment.",
  },
  "/enterprise": {
    title: "Enterprise Solutions — Mobility Technology for Operators",
    description:
      "Dispatch, fleet management and payment technology for transport operators, logistics businesses and large organisations.",
  },
  "/pricing": {
    title: "Pricing — Transparent TaxiD & Delivery Fares",
    description:
      "See fares, per-kilometre rates, surge limits and business plans for rides, delivery and corporate mobility.",
  },
  "/support": {
    title: "Help Centre — TaxiD Rider & Driver Support",
    description:
      "Get help with bookings, payments, accounts and safety — support for customers, driver partners and business customers.",
  },
  "/faq": {
    title: "FAQ — Common Questions About TaxiD",
    description:
      "Answers on booking, driver partner onboarding, payments, business accounts, safety and service coverage.",
  },
  "/news": {
    title: "Newsroom — TaxiD Updates & Press Releases",
    description:
      "Latest news from TaxiD: launches, partnerships, policy updates and product milestones across African markets.",
  },
  "/careers": {
    title: "Careers at TaxiD — Open Roles and Apply",
    description:
      "Open roles in engineering, operations, design, commercial and compliance. Apply and track your application online.",
  },
  "/contact": {
    title: "Contact TaxiD — Sales, Support & Partnerships",
    description:
      "Contact TaxiD for customer support, commercial enquiries, driver partner applications, partnerships and media.",
  },
  "/developers": {
    title: "Developers — TaxiD APIs & Integrations",
    description:
      "Integrate TaxiD booking, dispatch and payment APIs. Documentation, SDKs and sandbox access for developers.",
  },
  "/security": {
    title: "Security at TaxiD — Platform Security Overview",
    description:
      "How TaxiD secures rider, driver and corporate data: encryption in transit and at rest, MFA, RBAC and SOC-style controls.",
  },
  "/security-center": {
    title: "Security Centre — Compliance, Disclosure & Reports",
    description:
      "TaxiD's Security Centre: compliance certifications, audit reports, vulnerability disclosure program and incident response.",
  },
  "/rentals/self-drive": {
    title: "Self-Drive Car Rental in Nairobi — TaxiD",
    description:
      "Hire a self-drive car in Nairobi with published daily rates, included kilometres and transparent excess-kilometre pricing. Book or request a quote.",
  },
  "/rentals/chauffeur": {
    title: "Chauffeured Car Hire in Nairobi — TaxiD",
    description:
      "Chauffeured vehicles with vetted drivers for business travel, events and airport transfers. Published day rates, clear extras, corporate discount.",
  },
  "/logistics/solutions": {
    title: "Business Logistics Solutions in Kenya — TaxiD",
    description:
      "Document courier, express city delivery, standard parcel, freight and e-commerce fulfilment with coverage areas, collection hours and proof of delivery.",
  },
  "/blog/corporate-travel-management-guide": {
    title: "Corporate Travel Management Guide — TaxiD for Business",
    description:
      "A practical guide for finance and HR teams: setting travel policies, controlling costs and reporting on corporate mobility.",
  },
  "/reliability": {
    title: "Reliability at TaxiD — How Bookings Hold Up",
    description:
      "How TaxiD protects bookings and payments: verified M-Pesa confirmation, no double charges, recorded handovers and daily reconciliation.",
  },
  "/transparency": {
    title: "Transparency at TaxiD — Prices and Records",
    description:
      "See how TaxiD shows prices before payment, issues references and receipts, and reports corporate spending without hidden fees.",
  },
  "/innovation": {
    title: "Engineering & Innovation at TaxiD",
    description:
      "How TaxiD is built: event-driven operations, configurable business rules, evidence-gated releases and AI used as a reasoning layer.",
  },
  "/compliance": {
    title: "Compliance at TaxiD — Kenya Requirements",
    description:
      "How TaxiD handles Kenyan compliance: partner document checks, KRA tax details, data-protection rights and recorded approvals.",
  },
  "/privacy": {
    title: "Privacy at TaxiD — Your Data and Rights",
    description:
      "What personal data TaxiD collects, why it is needed, who can see it, and how to access, correct, export or delete your information.",
  },
  "/leadership": {
    title: "Leadership at TaxiD — How It Is Run",
    description:
      "How responsibility is divided at TaxiD, an early-stage founder-led Kenyan mobility company, and how to reach the right team.",
  },
  "/governance": {
    title: "Governance at TaxiD — Controls and Approvals",
    description:
      "How TaxiD governs decisions: role-based access, second-approver rules, recorded audit trails and evidence-based release gates.",
  },
  "/sustainability": {
    title: "Sustainability at TaxiD — An Honest Position",
    description:
      "TaxiD's honest sustainability position: measurable vehicle utilisation and paperless operations today, no unverified emissions claims.",
  },
};

/** Routes that are articles rather than site pages, for og:type. */
const ARTICLE_ROUTES = new Set(["/blog/corporate-travel-management-guide"]);

// Per-route JSON-LD structured data. Stacks with sitewide Organization/WebSite in index.html.
const ORG = { "@type": "Organization", name: "TaxiD", url: BASE_URL } as const;

function buildRouteJsonLd(pathname: string, title: string, description: string, url: string) {
  const blocks: Record<string, unknown>[] = [];

  // BreadcrumbList for every non-home route
  if (pathname !== "/") {
    const segments = pathname.split("/").filter(Boolean);
    blocks.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
        ...segments.map((seg, i) => ({
          "@type": "ListItem",
          position: i + 2,
          name: seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          item: `${BASE_URL}/${segments.slice(0, i + 1).join("/")}`,
        })),
      ],
    });
  }

  // Service schema for service routes that do NOT self-manage their head via
  // <SeoHead>. Routes whose page renders SeoHead (RouteSEO is silent there)
  // carry their Service block in the page's jsonLd prop: /riders, /drivers,
  // /rentals, /enterprise, /delivery, /rentals/self-drive, /rentals/chauffeur,
  // /logistics/solutions.
  const serviceMap: Record<string, string> = {
    "/corporates": "Corporate mobility management",
  };
  if (serviceMap[pathname]) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "Service",
      name: title,
      description,
      serviceType: serviceMap[pathname],
      provider: ORG,
      areaServed: "Africa",
      url,
    });
  }

  if (pathname === "/contact") {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "ContactPage",
      name: title,
      description,
      url,
      mainEntity: ORG,
    });
  }

  return blocks;
}

export const RouteSEO = () => {
  const { pathname } = useLocation();
  // A page rendering <SeoHead> owns its head — emit nothing on claimed routes
  // so og:title / og:description / canonical never appear twice.
  const claimed = useRouteHeadClaimed(pathname);
  const meta = META[pathname] ?? DEFAULT_META;
  const url = `${BASE_URL}${pathname === "/" ? "/" : pathname}`;
  const jsonLdBlocks = buildRouteJsonLd(pathname, meta.title, meta.description, url);

  if (claimed) return null;

  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={ARTICLE_ROUTES.has(pathname) ? "article" : "website"} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
      <meta name="twitter:image" content={OG_IMAGE} />
      {jsonLdBlocks.map((block, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(block)}</script>
      ))}
    </Helmet>
  );
};

export default RouteSEO;

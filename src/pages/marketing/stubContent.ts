export interface StubItem { title: string; desc: string; icon?: string }
export interface StubSection {
  eyebrow?: string;
  heading: string;
  body?: string;
  items?: StubItem[];
  bullets?: string[];
}
export interface StubContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  highlights?: { value: string; label: string }[];
  sections: StubSection[];
  ctaTitle?: string;
  ctaSubtitle?: string;
}

const valuePage = (
  title: string,
  subtitle: string,
  pillars: StubItem[],
  metrics: { value: string; label: string }[],
): StubContent => ({
  eyebrow: "Our Values",
  title,
  subtitle,
  highlights: metrics,
  sections: [
    { eyebrow: "How we deliver", heading: "What this looks like in practice", items: pillars },
  ],
});

export const STUB_CONTENT: Record<string, StubContent> = {
  "/driver": {
    eyebrow: "Driver Hub",
    title: "Welcome, driver",
    subtitle: "Everything you need to join, train, earn and grow with SAFARID.",
    sections: [{
      heading: "Where to go next",
      items: [
        { title: "Start your application", desc: "7-stage onboarding with save & resume.", icon: "Rocket" },
        { title: "Calculate your earnings", desc: "Live averages for your city.", icon: "Calculator" },
        { title: "Explore benefits", desc: "Financial, safety, professional, business.", icon: "Award" },
        { title: "Driver Academy", desc: "Free training and certifications.", icon: "GraduationCap" },
        { title: "Safety Command Center", desc: "SOS, monitoring and insurance.", icon: "Shield" },
        { title: "Driver support", desc: "24/7 chat, phone and email.", icon: "Headphones" },
      ],
    }],
  },
  // ---------- Core Values ----------
  "/reliability": valuePage(
    "Reliability you can build a business on",
    "99.95% platform uptime, instant driver settlement, and SLA-backed enterprise APIs.",
    [
      { title: "99.95% uptime", desc: "Multi-AZ infrastructure with active monitoring and automated failover.", icon: "Activity" },
      { title: "Instant settlement", desc: "Drivers receive earnings to M-Pesa in under 2 minutes after a trip.", icon: "Zap" },
      { title: "SLA-backed APIs", desc: "Enterprise contracts include written response and resolution times.", icon: "FileCheck2" },
      { title: "Idempotent payments", desc: "Hash-chained ledger guarantees no double-charges, no lost trips.", icon: "Lock" },
      { title: "Status page", desc: "Public transparency on incidents and post-mortems.", icon: "Eye" },
      { title: "Backups & DR", desc: "Hourly snapshots, multi-region restore tested monthly.", icon: "Database" },
    ],
    [
      { value: "99.95%", label: "Uptime SLA" },
      { value: "<2 min", label: "Driver payout" },
      { value: "4.2M+", label: "Trips processed" },
      { value: "0", label: "Lost transactions" },
    ],
  ),
  "/transparency": valuePage(
    "Open by default",
    "Open pricing, immutable audit logs, and real-time dashboards for riders, drivers, and corporate customers.",
    [
      { title: "Upfront pricing", desc: "Full fare breakdown shown before booking, no surge surprises.", icon: "Tag" },
      { title: "Immutable ledger", desc: "Hash-chained financial events, third-party auditable.", icon: "Lock" },
      { title: "Corporate dashboards", desc: "Live view of every trip, every wallet, every approval.", icon: "BarChart3" },
      { title: "Driver earnings", desc: "Per-trip breakdown showing fare, commission, tax and net.", icon: "Receipt" },
      { title: "Open status page", desc: "Public incident history and uptime data.", icon: "Activity" },
      { title: "Policy clarity", desc: "Plain-language terms, no dark patterns.", icon: "FileText" },
    ],
    [
      { value: "100%", label: "Upfront fares" },
      { value: "0", label: "Hidden fees" },
      { value: "Real-time", label: "Audit log" },
      { value: "Public", label: "Status page" },
    ],
  ),
  "/innovation": valuePage(
    "Engineering Africa's mobility OS",
    "Event-driven architecture, AI-assisted operations, predictive routing, and an open developer platform.",
    [
      { title: "Event-driven core", desc: "Every trip, payment, and incident is a versioned event you can replay.", icon: "Workflow" },
      { title: "AI assist", desc: "LLM-powered dispatch, fraud detection, and customer support.", icon: "Sparkles" },
      { title: "Predictive ETA", desc: "Traffic-aware models trained on local conditions.", icon: "TrendingUp" },
      { title: "Open APIs", desc: "REST and webhook APIs for delivery, corporate and rental partners.", icon: "Code" },
      { title: "Edge functions", desc: "Sub-100ms latency on critical paths via global edge.", icon: "Zap" },
      { title: "Local data centers", desc: "Kenyan-resident data infrastructure for compliance.", icon: "Server" },
    ],
    [
      { value: "12+", label: "Production AI models" },
      { value: "<100ms", label: "API p95" },
      { value: "Open", label: "Developer APIs" },
      { value: "Kenya", label: "Data residency" },
    ],
  ),
  "/compliance": valuePage(
    "Compliance, by design",
    "GDPR, Kenya Data Protection Act, PCI DSS scope, and ISO 27001 readiness — built into the platform, not bolted on.",
    [
      { title: "Kenya DPA 2019", desc: "Registered Data Controller; full subject-access workflows.", icon: "ShieldCheck" },
      { title: "GDPR-aligned", desc: "Lawful basis tracking, data minimisation, EU representative.", icon: "Globe" },
      { title: "PCI DSS scope", desc: "Tokenized card data, no PAN on our servers.", icon: "CreditCard" },
      { title: "ISO 27001 readiness", desc: "ISMS in place, external audit underway.", icon: "Award" },
      { title: "KRA eTIMS", desc: "Real-time tax invoice submission for every fare.", icon: "Receipt" },
      { title: "NTSA / CAK", desc: "Licensed and reporting per Kenyan transport rules.", icon: "FileCheck2" },
    ],
    [
      { value: "Kenya DPA", label: "Registered controller" },
      { value: "PCI", label: "DSS scope" },
      { value: "ISO 27001", label: "In progress" },
      { value: "100%", label: "eTIMS coverage" },
    ],
  ),

  // ---------- Trust ----------
  "/security": {
    eyebrow: "Trust",
    title: "Security at SAFARID",
    subtitle: "Defense in depth, from device to ledger.",
    highlights: [
      { value: "AES-256", label: "At rest" },
      { value: "TLS 1.3", label: "In transit" },
      { value: "RBAC", label: "Every endpoint" },
      { value: "24/7", label: "SOC monitoring" },
    ],
    sections: [
      {
        eyebrow: "Controls",
        heading: "How we protect rider, driver and corporate data",
        items: [
          { title: "Encryption", desc: "AES-256 at rest, TLS 1.3 in transit, KMS-managed keys.", icon: "Lock" },
          { title: "RBAC + RLS", desc: "Row-level security on every database table, role-based access on every API.", icon: "Shield" },
          { title: "Audit logging", desc: "Hash-chained audit trail, tamper-evident.", icon: "FileSearch" },
          { title: "OWASP-aligned", desc: "Tested against OWASP Top 10 + ASVS Level 2.", icon: "ShieldCheck" },
          { title: "Pen testing", desc: "Annual third-party penetration test, quarterly internal.", icon: "Bug" },
          { title: "Bug bounty", desc: "Responsible disclosure programme open to researchers.", icon: "Award" },
        ],
      },
    ],
  },
  "/privacy": {
    eyebrow: "Trust",
    title: "Your data, your control",
    subtitle: "We collect only what is needed to deliver safe, reliable mobility — and we tell you exactly what.",
    sections: [
      {
        heading: "Your rights",
        bullets: [
          "Access — download everything we hold about you",
          "Correction — fix anything that is wrong",
          "Erasure — delete your account and personal data",
          "Portability — export your data in a machine-readable format",
          "Objection — opt out of marketing and profiling",
          "Withdraw consent — at any time, no penalty",
        ],
      },
      {
        eyebrow: "Read the policy",
        heading: "Detailed privacy policy",
        body: "Our full Privacy Policy explains every category of data, every processor, and every retention period.",
      },
    ],
  },
  "/compliance-center": {
    eyebrow: "Trust",
    title: "Compliance Center",
    subtitle: "All certifications, frameworks and regulatory filings in one place.",
    highlights: [
      { value: "Kenya DPA", label: "Registered" },
      { value: "PCI", label: "DSS scope" },
      { value: "ISO 27001", label: "In progress" },
      { value: "NTSA", label: "Licensed" },
    ],
    sections: [
      {
        eyebrow: "Frameworks",
        heading: "Standards we align to",
        items: [
          { title: "GDPR", desc: "EU General Data Protection Regulation.", icon: "Globe" },
          { title: "Kenya DPA 2019", desc: "Office of the Data Protection Commissioner.", icon: "ShieldCheck" },
          { title: "PCI DSS", desc: "Payment Card Industry Data Security Standard.", icon: "CreditCard" },
          { title: "ISO 27001", desc: "Information Security Management System.", icon: "Award" },
          { title: "OWASP ASVS", desc: "Application Security Verification Standard.", icon: "Shield" },
          { title: "KRA eTIMS", desc: "Real-time tax invoicing.", icon: "Receipt" },
        ],
      },
    ],
  },

  // ---------- Leadership / Governance / Investors / Sustainability ----------
  "/leadership": {
    eyebrow: "Company",
    title: "Leadership & Governance",
    subtitle: "Operators who have scaled African technology, finance and mobility businesses.",
    sections: [
      {
        heading: "Executive team",
        items: [
          { title: "Office of the CEO", desc: "Strategy, partnerships, regulation.", icon: "Briefcase" },
          { title: "Chief Technology Officer", desc: "Platform, data, AI.", icon: "Cpu" },
          { title: "Chief Operating Officer", desc: "Markets, supply, operations.", icon: "Workflow" },
          { title: "Chief Financial Officer", desc: "Treasury, tax, investor relations.", icon: "Wallet" },
          { title: "Chief People Officer", desc: "Talent, culture, driver experience.", icon: "Users" },
          { title: "General Counsel", desc: "Legal, compliance, risk.", icon: "Scale" },
        ],
      },
    ],
  },
  "/governance": {
    eyebrow: "Company",
    title: "Board & Governance",
    subtitle: "Independent board oversight with audit, risk, and remuneration committees.",
    sections: [
      {
        heading: "Board committees",
        items: [
          { title: "Audit Committee", desc: "Financial integrity, controls, external auditor.", icon: "FileCheck2" },
          { title: "Risk Committee", desc: "Operational, regulatory and cyber risk oversight.", icon: "ShieldAlert" },
          { title: "Remuneration", desc: "Executive pay and equity policy.", icon: "Wallet" },
          { title: "Safety Board", desc: "Independent rider and driver safety review.", icon: "Shield" },
          { title: "Tech & Data", desc: "AI ethics and data governance.", icon: "Cpu" },
          { title: "ESG Committee", desc: "Sustainability and social impact.", icon: "Leaf" },
        ],
      },
    ],
  },
  "/investors": {
    eyebrow: "Company",
    title: "Investor Relations",
    subtitle: "SAFARID is building Africa's mobility operating system. Here is the opportunity.",
    highlights: [
      { value: "$120B", label: "African mobility TAM" },
      { value: "12,400+", label: "Active drivers" },
      { value: "850+", label: "Corporate clients" },
      { value: "4.2M+", label: "Trips" },
    ],
    sections: [
      {
        eyebrow: "Why now",
        heading: "Market opportunity",
        items: [
          { title: "Urban density", desc: "Africa's urban population doubles by 2050 — mobility demand follows.", icon: "Globe" },
          { title: "Mobile money", desc: "Universal M-Pesa rails make cashless mobility default in East Africa.", icon: "Wallet" },
          { title: "Corporate spend", desc: "Untapped enterprise travel and logistics budgets digitising fast.", icon: "Briefcase" },
          { title: "Platform unit economics", desc: "Multi-product platform compounds LTV per user.", icon: "TrendingUp" },
          { title: "Regulatory tailwind", desc: "Formalisation of transport creates moats for compliant operators.", icon: "ShieldCheck" },
          { title: "AI leverage", desc: "Dispatch, pricing and fraud benefit disproportionately from AI.", icon: "Sparkles" },
        ],
      },
      {
        eyebrow: "Talk to us",
        heading: "Contact Investor Relations",
        body: "For data rooms, briefings and partnership enquiries, contact sales@yalla.africa.",
      },
    ],
    ctaTitle: "Partner with the team building Africa's mobility OS",
    ctaSubtitle: "Investor briefings available on request.",
  },
  "/sustainability": {
    eyebrow: "Company",
    title: "Sustainability & Impact",
    subtitle: "Economic empowerment, lower-carbon mobility, and inclusive access.",
    highlights: [
      { value: "12,400+", label: "Driver livelihoods" },
      { value: "+38%", label: "Avg driver income" },
      { value: "EV-ready", label: "Fleet pilot" },
      { value: "100%", label: "Cashless" },
    ],
    sections: [
      {
        heading: "Our pillars",
        items: [
          { title: "Economic empowerment", desc: "Instant settlement and fair commissions improve driver take-home.", icon: "Wallet" },
          { title: "Lower-carbon trips", desc: "Pooling, optimised routing and EV pilots reduce emissions per ride.", icon: "Leaf" },
          { title: "Digital inclusion", desc: "Cashless rides accessible via USSD and feature phones.", icon: "Smartphone" },
          { title: "Gender access", desc: "Women-driver programme and women-only ride options.", icon: "Users" },
          { title: "Local jobs", desc: "Engineering, ops and support teams hired across the region.", icon: "Briefcase" },
          { title: "Data residency", desc: "Kenya-resident infrastructure keeps value local.", icon: "Server" },
        ],
      },
    ],
  },

  // ---------- Newsroom + Developers ----------
  "/developers": {
    eyebrow: "Build with SAFARID",
    title: "Developer Platform",
    subtitle: "REST APIs, webhooks and SDKs for delivery, corporate and rental partners.",
    sections: [
      {
        heading: "What you can build",
        items: [
          { title: "Trips API", desc: "Request, track and settle rides programmatically.", icon: "Car" },
          { title: "Delivery API", desc: "Send, track and prove delivery of packages.", icon: "Package" },
          { title: "Wallets API", desc: "Top up, debit and reconcile corporate wallets.", icon: "Wallet" },
          { title: "Webhooks", desc: "Real-time event stream for trips, payments and incidents.", icon: "Webhook" },
          { title: "OAuth", desc: "Per-user delegated access with scoped permissions.", icon: "Key" },
          { title: "Sandboxes", desc: "Test environments mirror production with fake money.", icon: "Beaker" },
        ],
      },
      {
        eyebrow: "Get access",
        heading: "Request API keys",
        body: "Email sales@yalla.africa with your use case. We onboard partners weekly.",
      },
    ],
    ctaTitle: "Build on SAFARID",
    ctaSubtitle: "API access is free for early partners.",
  },

  // ---------- Riders split ----------
  "/riders/individual": {
    eyebrow: "Riders",
    title: "Built for everyday journeys",
    subtitle: "Daily commutes, airport runs, scheduled rides — booked in seconds, priced upfront, monitored end to end.",
    highlights: [
      { value: "<5 min", label: "Average pickup" },
      { value: "Upfront", label: "Pricing" },
      { value: "24/7", label: "Safety ops" },
      { value: "M-Pesa", label: "+ card + wallet" },
    ],
    sections: [
      {
        eyebrow: "Why riders choose us",
        heading: "Move with confidence",
        items: [
          { title: "Live SOS", desc: "One-tap emergency button connected to our safety center.", icon: "Siren" },
          { title: "Trip sharing", desc: "Share live location with friends and family on any device.", icon: "Share2" },
          { title: "Verified drivers", desc: "Every driver passes background, NTSA and document checks.", icon: "ShieldCheck" },
          { title: "Scheduled rides", desc: "Book hours or days ahead for airports and meetings.", icon: "Calendar" },
          { title: "Favorites", desc: "Save home, work and frequent destinations.", icon: "Star" },
          { title: "Rewards", desc: "Earn points on every trip and redeem on rides or partners.", icon: "Award" },
        ],
      },
    ],
  },
  "/riders/corporate": {
    eyebrow: "Riders",
    title: "Corporate riders, simplified",
    subtitle: "Employees ride on the company wallet with policy-aware approvals, automatic receipts and cost-center reporting.",
    highlights: [
      { value: "Dual", label: "Wallet (corp + personal)" },
      { value: "Policy", label: "Aware approvals" },
      { value: "eTIMS", label: "Tax invoices" },
      { value: "API", label: "+ SSO ready" },
    ],
    sections: [
      {
        eyebrow: "Made for employees",
        heading: "Travel that respects company policy",
        items: [
          { title: "Trip intent", desc: "Tag every ride: client visit, airport, commute or personal.", icon: "Tags" },
          { title: "Auto approvals", desc: "Below threshold? Auto-approved. Above? Routed instantly to managers.", icon: "CheckCircle2" },
          { title: "Cost centers", desc: "Per-department, per-project budget allocation in real time.", icon: "Layers" },
          { title: "Receipts", desc: "VAT-compliant eTIMS invoices delivered automatically.", icon: "Receipt" },
        ],
      },
    ],
    ctaTitle: "Bring your team on SAFARID",
    ctaSubtitle: "Talk to corporate sales about onboarding your employees.",
  },

  // ---------- Logistics & Delivery ----------
  "/logistics": {
    eyebrow: "Logistics & Delivery",
    title: "National distribution network",
    subtitle: "Packages, couriers and full B2B logistics — one operating layer, one API, one ops center.",
    sections: [
      {
        heading: "Choose your lane",
        items: [
          { title: "Package Delivery", desc: "Same-day parcel pickup, route-optimized.", icon: "Package" },
          { title: "Courier Delivery", desc: "Documents and small items, on-demand.", icon: "MailPlus" },
          { title: "Logistics Solutions", desc: "B2B fulfilment, distribution and 3PL.", icon: "Truck" },
        ],
      },
    ],
  },
  "/logistics/package": {
    eyebrow: "Logistics",
    title: "Package Delivery",
    subtitle: "Same-day pickup and delivery with proof of pickup, proof of delivery and chain-of-custody on every package.",
    sections: [
      {
        heading: "Why senders trust us",
        bullets: [
          "Live tracking with ETA prediction",
          "Photo + signature proof of delivery",
          "Tamper-evident chain-of-custody",
          "M-Pesa, card and corporate wallet payment",
          "API for marketplaces and e-commerce",
        ],
      },
    ],
  },
  "/logistics/courier": {
    eyebrow: "Logistics",
    title: "Courier Delivery",
    subtitle: "Documents, small parcels and urgent items — on the move within minutes.",
    sections: [
      {
        heading: "Built for urgency",
        bullets: [
          "On-demand pickup within 15 minutes",
          "City-wide coverage with verified couriers",
          "Live SOS and tamper alerts",
          "Bulk request via API or dashboard",
        ],
      },
    ],
  },
  "/logistics/solutions": {
    eyebrow: "Logistics",
    title: "Logistics Solutions",
    subtitle: "End-to-end distribution: warehousing, line-haul, last-mile and reverse logistics on a single platform.",
    sections: [
      {
        heading: "Enterprise capabilities",
        items: [
          { title: "Distribution command", desc: "Live national operations view with anomaly detection.", icon: "Radar" },
          { title: "Route optimization", desc: "AI-assisted multi-stop routing across regions.", icon: "Workflow" },
          { title: "Returns & reverse", desc: "Full reverse-logistics workflow with audit trail.", icon: "Undo2" },
          { title: "SLA-backed", desc: "Contractual response and resolution times.", icon: "FileCheck2" },
        ],
      },
    ],
  },

  // ---------- Car Rentals ----------
  "/rentals/self-drive": {
    eyebrow: "Rentals",
    title: "Self Drive Rentals",
    subtitle: "Rent by the hour, day or week. Verified vehicles, transparent pricing, insurance built in.",
    sections: [
      { heading: "What you get", bullets: [
        "Verified vehicles inspected before each rental",
        "Insurance and roadside assistance included",
        "M-Pesa, card or corporate wallet checkout",
        "Digital keys and contactless handover",
      ]},
    ],
  },
  "/rentals/chauffeur": {
    eyebrow: "Rentals",
    title: "Chauffeur Services",
    subtitle: "Professional drivers for executive travel, events and visiting delegations.",
    sections: [
      { heading: "Premium, with proof", bullets: [
        "Vetted, uniformed chauffeurs",
        "Live trip monitoring for your guests",
        "Flexible by-the-hour or full-day",
        "Corporate billing with cost centers",
      ]},
    ],
  },
  "/rentals/bus-coach": {
    eyebrow: "Rentals",
    title: "Bus & Coach Rental & Leasing",
    subtitle: "Charter buses and coaches for events, school runs, staff transport and group travel.",
    sections: [
      { heading: "Group transport, simplified", bullets: [
        "Fleet from 14-seat vans to 60-seat coaches",
        "Per-trip insurance for every passenger",
        "Live tracking and trip share for organizers",
        "Custom quotes with upfront pricing",
      ]},
    ],
  },
  "/rentals/corporate-leasing": {
    eyebrow: "Rentals",
    title: "Corporate Fleet Leasing",
    subtitle: "Long-term fleet leases with full maintenance, telematics and compliance reporting.",
    sections: [
      { heading: "What we handle", bullets: [
        "Vehicle sourcing and registration",
        "Maintenance, inspections and insurance",
        "Driver compliance and training",
        "Telematics, fuel and utilization dashboards",
      ]},
    ],
  },
  "/rentals/marketplace": {
    eyebrow: "Rentals",
    title: "Fleet Marketplace",
    subtitle: "Fleet owners list vehicles; renters and operators book at scale. One ledger, one trust layer.",
    sections: [
      { heading: "For fleet owners", bullets: [
        "List vehicles for self-drive, chauffeur or platform use",
        "SAFARID handles KYC, insurance verification and payouts",
        "Live utilization and earnings dashboard",
        "Compliance alerts before documents expire",
      ]},
    ],
  },

  // ---------- Enterprise / Developers / Support ----------
  "/enterprise": {
    eyebrow: "Enterprise",
    title: "National Logistics & Mobility Operating System",
    subtitle: "Powering corporate travel, delivery, fleet and distribution on one infrastructure platform with enterprise-grade trust, fraud and identity controls.",
    highlights: [
      { value: "ISO 27001", label: "Readiness" },
      { value: "Kenya DPA", label: "Registered controller" },
      { value: "SLA", label: "Backed APIs" },
      { value: "24/7", label: "NOC + SOC" },
    ],
    sections: [
      {
        eyebrow: "Built on",
        heading: "An enterprise platform, not an app",
        items: [
          { title: "Trust & Safety", desc: "Case management, chain-of-custody, watchlists.", icon: "ShieldCheck" },
          { title: "Fraud & Financial Crime", desc: "Real-time scoring, velocity, wallet abuse detection.", icon: "AlertTriangle" },
          { title: "Identity Assurance", desc: "Device, login, ATO defense and GPS integrity.", icon: "Fingerprint" },
          { title: "NOC", desc: "National operations center with live incident view.", icon: "Radar" },
          { title: "SOC & BCP", desc: "Threat intel, backups, disaster recovery, governance.", icon: "Lock" },
          { title: "AI Orchestration", desc: "Dispatch, fraud, ETA and risk models in production.", icon: "Sparkles" },
        ],
      },
    ],
  },
  "/support": {
    eyebrow: "Support",
    title: "Help, when you need it",
    subtitle: "Self-serve help, live chat, phone and dedicated enterprise support.",
    sections: [
      { heading: "Get help", bullets: [
        "24/7 in-app chat for riders and drivers",
        "Phone support for active trips and emergencies",
        "Dedicated CSMs for enterprise and corporate accounts",
        "Developer support via the developer portal",
      ]},
      { heading: "Trust resources", items: [
        { title: "Security Center", desc: "Report phishing, verify domains, review controls.", icon: "Shield" },
        { title: "Status page", desc: "Live platform health and incident history.", icon: "Activity" },
        { title: "Privacy", desc: "Your data, your rights, our policies.", icon: "Lock" },
      ]},
    ],
  },
};


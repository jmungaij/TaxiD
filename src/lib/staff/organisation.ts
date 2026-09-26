/**
 * Yalla Organisation Management System — the authoritative organisational model
 * for Staff 360.
 *
 * Company → Division → Department → Team → Position → Employee
 * Position → Authority → Workflow → KPI → Capability
 */

export const ORG_HIERARCHY = [
  "Company",
  "Division",
  "Department",
  "Team",
  "Position",
  "Employee",
] as const;

export const POSITION_MODEL = ["Position", "Authority", "Workflow", "KPI", "Capability"] as const;

export type DivisionId = "executive" | "commercial" | "marketplace" | "operations" | "corporate_services";

export interface Division {
  id: DivisionId;
  label: string;
}

export const DIVISIONS: Division[] = [
  { id: "executive", label: "Executive" },
  { id: "commercial", label: "Commercial" },
  { id: "marketplace", label: "Marketplace & Customer" },
  { id: "operations", label: "Service Operations" },
  { id: "corporate_services", label: "Corporate Services" },
];

export interface Department {
  /** URL slug under /staff/departments. */
  slug: string;
  label: string;
  division: DivisionId;
  /** The departmental operating system surfaced inside Staff 360. */
  operatingSystem: string;
  mandate: string;
  /** How the department contributes to Yalla's economic engine. */
  valueContribution: string;
  /** Capability domains this department depends on. */
  capabilities: string[];
  /** Existing platform surfaces this department already operates. */
  linkedSurfaces?: { to: string; label: string }[];
}

export const DEPARTMENTS: Department[] = [
  {
    slug: "executive-office",
    label: "Executive Office",
    division: "executive",
    operatingSystem: "Enterprise Intelligence",
    mandate: "Strategy, governance and enterprise direction.",
    valueContribution: "Sets strategy and allocates capital and capability across the platform.",
    capabilities: ["Leadership", "Digital Platform", "Marketplace Management"],
    linkedSurfaces: [{ to: "/staff/intelligence", label: "Enterprise Intelligence" }],
  },
  {
    slug: "sales-revenue-operations",
    label: "Sales & Revenue Operations",
    division: "commercial",
    operatingSystem: "Yalla Sales Operating System",
    mandate: "Revenue acquisition, commercial lifecycle and revenue growth.",
    valueContribution: "Creates customers and revenue across every Yalla service category.",
    capabilities: ["Enterprise Sales", "Revenue Operations", "Customer Experience"],
    linkedSurfaces: [{ to: "/staff/revenue", label: "Revenue Intelligence Centre" }],
  },
  {
    slug: "marketing-growth",
    label: "Marketing & Growth",
    division: "commercial",
    operatingSystem: "Growth Operating System",
    mandate: "Demand generation, brand, acquisition and market development.",
    valueContribution: "Creates demand and qualified commercial opportunity.",
    capabilities: ["Customer Experience", "Data", "Marketplace Management"],
  },
  {
    slug: "customer-experience",
    label: "Customer Experience & Success",
    division: "marketplace",
    operatingSystem: "Customer Success 360",
    mandate: "Customer experience, retention, service recovery and lifetime value.",
    valueContribution: "Protects retention and expands customer lifetime value.",
    capabilities: ["Customer Experience", "Data", "Mobility"],
    linkedSurfaces: [{ to: "/staff/customers", label: "Customer 360" }],
  },
  {
    slug: "marketplace-partner-success",
    label: "Marketplace & Partner Success",
    division: "marketplace",
    operatingSystem: "Marketplace Operating System",
    mandate: "Resource providers, operators, marketplace quality and supply development.",
    valueContribution: "Creates and protects supply quality and marketplace liquidity.",
    capabilities: ["Marketplace Management", "Mobility", "Risk"],
    linkedSurfaces: [{ to: "/staff/marketplace", label: "Marketplace 360" }],
  },
  {
    slug: "corporate-mobility",
    label: "Corporate Mobility",
    division: "commercial",
    operatingSystem: "Corporate Mobility Operations",
    mandate: "Enterprise mobility solutions and corporate customer management.",
    valueContribution: "Grows contracted corporate mobility programmes and account value.",
    capabilities: ["Enterprise Sales", "Customer Experience", "Finance"],
    linkedSurfaces: [{ to: "/dashboard/corporate", label: "Corporate workspace" }],
  },
  {
    slug: "mobility-operations",
    label: "Mobility Operations & Orchestration",
    division: "operations",
    operatingSystem: "Mobility Control Tower",
    mandate: "Digital transaction orchestration, matching, dispatch and service fulfilment.",
    valueContribution: "Protects fulfilment quality and transaction completion.",
    capabilities: ["Mobility", "Marketplace Management", "Digital Platform"],
  },
  {
    slug: "delivery-logistics",
    label: "Delivery & Logistics",
    division: "operations",
    operatingSystem: "Logistics Control Tower",
    mandate: "Digital logistics and delivery orchestration.",
    valueContribution: "Converts logistics demand into completed, on-SLA deliveries.",
    capabilities: ["Logistics", "Marketplace Management", "Data"],
    linkedSurfaces: [{ to: "/delivery/ops", label: "Delivery operations" }],
  },
  {
    slug: "rentals-leasing",
    label: "Rentals & Leasing",
    division: "operations",
    operatingSystem: "Rental & Leasing Operations",
    mandate: "Digital rental and leasing marketplace operations.",
    valueContribution: "Turns operator inventory into utilised, contracted revenue.",
    capabilities: ["Rental & Leasing", "Marketplace Management", "Finance"],
    linkedSurfaces: [{ to: "/rentals", label: "Rentals & Leasing" }],
  },
  {
    slug: "charter-travel",
    label: "Charter & Travel",
    division: "operations",
    operatingSystem: "Charter Operations",
    mandate: "Digital charter marketplace and travel services.",
    valueContribution: "Matches charter demand with verified operator capacity.",
    capabilities: ["Charter", "Marketplace Management", "Risk"],
    linkedSurfaces: [{ to: "/charter", label: "Charter business" }],
  },
  {
    slug: "finance-revenue-assurance",
    label: "Finance & Revenue Assurance",
    division: "corporate_services",
    operatingSystem: "Revenue Control Centre",
    mandate: "Billing, collections, reconciliation, settlements and revenue integrity.",
    valueContribution: "Protects revenue collection and financial integrity.",
    capabilities: ["Finance", "Risk", "Data"],
  },
  {
    slug: "risk-trust-safety",
    label: "Risk, Trust & Safety",
    division: "corporate_services",
    operatingSystem: "Trust & Safety Centre",
    mandate: "Platform safety, fraud, trust and transaction protection.",
    valueContribution: "Protects transaction integrity and customer confidence.",
    capabilities: ["Risk", "Data", "AI"],
  },
  {
    slug: "legal-compliance",
    label: "Legal & Compliance",
    division: "corporate_services",
    operatingSystem: "Compliance Centre",
    mandate: "Contracts, regulatory compliance and legal governance.",
    valueContribution: "Keeps commercial activity enforceable and compliant.",
    capabilities: ["Legal", "Risk", "Finance"],
  },
  {
    slug: "procurement-partnerships",
    label: "Procurement & Strategic Partnerships",
    division: "corporate_services",
    operatingSystem: "Partnership Operations",
    mandate: "External commercial relationships and procurement.",
    valueContribution: "Secures the external capability and supply Yalla does not build itself.",
    capabilities: ["Marketplace Management", "Legal", "Finance"],
  },
  {
    slug: "technology-product",
    label: "Technology & Product",
    division: "corporate_services",
    operatingSystem: "Product & Engineering",
    mandate: "Platform engineering and product development.",
    valueContribution: "Protects platform availability and transaction capability.",
    capabilities: ["Technology", "Digital Platform", "Data"],
  },
  {
    slug: "data-ai",
    label: "Data & AI",
    division: "corporate_services",
    operatingSystem: "Intelligence Centre",
    mandate: "Data, analytics, AI and intelligence.",
    valueContribution: "Improves decisions, conversion, matching, pricing and efficiency.",
    capabilities: ["Data", "AI", "Digital Platform"],
    linkedSurfaces: [{ to: "/staff/intelligence", label: "Intelligence Centre" }],
  },
  {
    slug: "people-culture-organisation",
    label: "People, Culture & Organisation",
    division: "corporate_services",
    operatingSystem: "Human Capital Operating System",
    mandate: "Human capital, organisation and workforce development.",
    valueContribution: "Creates the human capability required to operate everything above.",
    capabilities: ["People", "Leadership", "Data"],
    linkedSurfaces: [{ to: "/staff/people", label: "Human Capital OS" }],
  },
  {
    slug: "corporate-administration",
    label: "Corporate Administration",
    division: "corporate_services",
    operatingSystem: "Administration Centre",
    mandate: "Corporate administrative services.",
    valueContribution: "Keeps the internal operating environment functioning.",
    capabilities: ["People", "Finance", "Legal"],
  },
];

export function departmentBySlug(slug: string | undefined): Department | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}

export function departmentsByDivision(division: DivisionId): Department[] {
  return DEPARTMENTS.filter((d) => d.division === division);
}

/* ------------------------------------------------------------------ *
 * Capability Cloud & Skill Graph
 * ------------------------------------------------------------------ */

export const CAPABILITY_DOMAINS = [
  "Digital Platform",
  "Marketplace Management",
  "Customer Experience",
  "Enterprise Sales",
  "Revenue Operations",
  "Mobility",
  "Logistics",
  "Charter",
  "Rental & Leasing",
  "Finance",
  "Risk",
  "Legal",
  "Technology",
  "Data",
  "AI",
  "Leadership",
  "People",
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

export const CAPABILITY_LEVELS = [
  "Aware",
  "Practitioner",
  "Proficient",
  "Expert",
  "Authority",
] as const;

/** Evidence types that can raise a skill from claimed to verified. */
export const SKILL_EVIDENCE = [
  "Verified skills",
  "Experience",
  "Projects",
  "Certifications",
  "Manager validation",
  "Learning",
  "Performance evidence",
  "Capability level",
] as const;

/** Human capital modules in the People, Culture & Organisation OS. */
export const PEOPLE_MODULES = [
  "People 360",
  "Organisation Management",
  "Position Management",
  "Talent Acquisition",
  "Onboarding",
  "Performance",
  "Capability",
  "Skills",
  "Learning",
  "Career",
  "Leadership",
  "Succession",
  "Workforce Planning",
  "Culture",
  "Employee Voice",
  "Innovation",
  "People Analytics",
] as const;

/** Yalla Academy curriculum tracks, aligned to the capability domains. */
export const ACADEMY_TRACKS = [
  "Yalla Platform",
  "Mobility Marketplace",
  "Customer Experience",
  "Sales",
  "Revenue Operations",
  "Corporate Mobility",
  "Delivery",
  "Logistics",
  "Charter",
  "Rental & Leasing",
  "Marketplace Management",
  "Technology",
  "Data",
  "AI",
  "Leadership",
  "Compliance",
  "Cybersecurity",
] as const;

/** Knowledge Operating System content classes. */
export const KNOWLEDGE_CLASSES = [
  "Policies",
  "SOPs",
  "Playbooks",
  "Product documentation",
  "Commercial knowledge",
  "Marketplace knowledge",
  "Training",
  "Lessons learned",
  "Case studies",
  "Decisions",
  "FAQs",
  "Department knowledge",
] as const;

/** Decision register fields — how Yalla learns from its own decisions. */
export const DECISION_REGISTER_FIELDS = [
  "Decision",
  "Owner",
  "Evidence",
  "Alternatives",
  "Reason",
  "Expected result",
  "Review date",
  "Actual result",
] as const;

/** Innovation Lab pipeline and evaluation criteria. */
export const INNOVATION_PIPELINE = [
  "Idea",
  "AI screening",
  "Business case",
  "Experiment",
  "Pilot",
  "Measurement",
  "Scale / stop",
] as const;

export const INNOVATION_CRITERIA = [
  "Customer value",
  "Revenue potential",
  "Marketplace impact",
  "Strategic fit",
  "Technical feasibility",
  "Risk",
  "Cost",
] as const;

/** Strategic workforce planning scenarios the twin must be able to model. */
export const WORKFORCE_SCENARIOS = [
  "New country launch",
  "Corporate mobility grows 200%",
  "Delivery transactions grow 500%",
  "Build vs buy vs partner vs automate",
] as const;

/** Continuous performance chain — outcomes over activity volume. */
export const PERFORMANCE_CHAIN = [
  "Strategy",
  "Department goal",
  "Team goal",
  "Individual goal",
  "Activity",
  "Outcome",
  "Impact",
] as const;

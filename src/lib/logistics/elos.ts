/**
 * Stage 1 — Enterprise Logistics Operating System (ELOS).
 *
 * Module 3 is promoted from a "Delivery Module" to a platform: a registry of
 * twenty first-class logistics capability domains grouped into six pillars,
 * each with an owner, maturity stage, primary KPI and the platform services it
 * inherits. Pure configuration + deterministic certification — no schema
 * changes, no new design primitives.
 */

export const ELOS_NAME = "Enterprise Logistics Operating System";
export const ELOS_SHORT_NAME = "Logistics OS";
export const ELOS_VERSION = "1.0.0";

export type ElosPillar =
  | "network"      // physical footprint
  | "movement"     // execution of movement
  | "visibility"   // tracking, ETA, exceptions
  | "specialised"  // cold chain, reverse, corporate/marketplace
  | "resources"    // drivers, vehicles, capacity
  | "intelligence"; // AI + executive

export type ElosStage = "operating" | "piloting" | "designing";

export interface ElosCapability {
  id: string;
  label: string;
  pillar: ElosPillar;
  description: string;
  stage: ElosStage;
  owner: string;
  /** Primary operating KPI for the capability. */
  kpi: string;
  /** Platform services the capability inherits (never re-implements). */
  inherits: string[];
  /** Route in the admin console where the capability surfaces. */
  surface: string;
}

export const ELOS_PILLARS: Record<ElosPillar, { label: string; description: string }> = {
  network: { label: "Network", description: "Hubs, warehouses, distribution centers, inventory and cross docking." },
  movement: { label: "Movement", description: "Courier network, fleet dispatch and dynamic routing." },
  visibility: { label: "Visibility", description: "Parcel tracking, ETA prediction and exception transparency." },
  specialised: { label: "Specialised Flows", description: "Cold chain, reverse, corporate and marketplace logistics." },
  resources: { label: "Resources", description: "Driver logistics, vehicle capacity and route optimization." },
  intelligence: { label: "Intelligence", description: "Warehouse intelligence, AI copilot and executive insight." },
};

export const ELOS_CAPABILITIES: ElosCapability[] = [
  {
    id: "national_hub_network", label: "National Hub Network", pillar: "network",
    description: "Country-wide hub topology with catchment zones, linehaul lanes and hub-level SLA envelopes.",
    stage: "operating", owner: "Network Planning", kpi: "Hub throughput vs capacity",
    inherits: ["control_plane", "event_registry"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "warehouses", label: "Warehouses", pillar: "network",
    description: "Warehouse registry, storage zones, dock scheduling and putaway/pick workflows.",
    stage: "operating", owner: "Warehouse Operations", kpi: "Dock-to-stock time",
    inherits: ["process_catalog", "control_plane"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "distribution_centers", label: "Distribution Centers", pillar: "network",
    description: "Regional DCs with wave planning, staging lanes and outbound cut-off management.",
    stage: "operating", owner: "Distribution", kpi: "Wave completion rate",
    inherits: ["process_catalog"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "inventory", label: "Inventory", pillar: "network",
    description: "Positional inventory, reservations, shrinkage controls and cycle-count evidence.",
    stage: "operating", owner: "Inventory Control", kpi: "Inventory accuracy",
    inherits: ["data_quality", "compliance_evidence"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "cross_docking", label: "Cross Docking", pillar: "network",
    description: "Inbound-to-outbound flow-through with dwell caps and no-storage routing.",
    stage: "operating", owner: "Distribution", kpi: "Cross-dock dwell time",
    inherits: ["process_intelligence"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "courier_network", label: "Courier Network", pillar: "movement",
    description: "Courier supply, onboarding, compliance state and zone coverage.",
    stage: "operating", owner: "Courier Operations", kpi: "Active courier coverage",
    inherits: ["partner_network", "trust_intelligence"], surface: "/delivery/ops/dispatch",
  },
  {
    id: "fleet_dispatch", label: "Fleet Dispatch", pillar: "movement",
    description: "Assignment engine, ranked candidates, manual override and dispatch approvals.",
    stage: "operating", owner: "Dispatch", kpi: "Time to assign",
    inherits: ["rules_engine", "autonomous_operations"], surface: "/delivery/ops/dispatch",
  },
  {
    id: "dynamic_routing", label: "Dynamic Routing", pillar: "movement",
    description: "Live re-sequencing on traffic, exception and capacity signals.",
    stage: "operating", owner: "Routing", kpi: "Reroute acceptance rate",
    inherits: ["rules_engine", "resilience"], surface: "/delivery/ops/routes",
  },
  {
    id: "parcel_tracking", label: "Parcel Tracking", pillar: "visibility",
    description: "Immutable chain of custody, scan completeness and customer-facing tracking.",
    stage: "operating", owner: "Delivery Operations", kpi: "Scan completeness",
    inherits: ["event_registry", "compliance_evidence"], surface: "/delivery/ops/packages",
  },
  {
    id: "eta_prediction", label: "ETA Prediction", pillar: "visibility",
    description: "Predicted arrival windows with confidence bands and promise-vs-actual scoring.",
    stage: "operating", owner: "Logistics Data", kpi: "ETA accuracy (p90)",
    inherits: ["enterprise_simulation", "ai_governance"], surface: "/delivery/ops/routes",
  },
  {
    id: "cold_chain", label: "Cold Chain", pillar: "specialised",
    description: "Temperature-controlled lanes with excursion detection and disposal evidence.",
    stage: "operating", owner: "Compliance & Quality", kpi: "Excursion rate",
    inherits: ["regulatory_readiness", "compliance_evidence"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "reverse_logistics", label: "Reverse Logistics", pillar: "specialised",
    description: "Returns intake, RTO handling, restock disposition and refund linkage.",
    stage: "operating", owner: "Customer Operations", kpi: "Return cycle time",
    inherits: ["finance_refunds", "customer_operations"], surface: "/dashboard/admin/customer-operations",
  },
  {
    id: "corporate_logistics", label: "Corporate Logistics", pillar: "specialised",
    description: "Contracted corporate shipping with cost centers, budgets and invoice-grade evidence.",
    stage: "operating", owner: "Corporate", kpi: "Contract SLA adherence",
    inherits: ["financial_intelligence", "customer_value"], surface: "/dashboard/admin/corporates",
  },
  {
    id: "marketplace_logistics", label: "Marketplace Logistics", pillar: "specialised",
    description: "Merchant pickups, multi-seller consolidation and marketplace SLA tiers.",
    stage: "operating", owner: "Marketplace", kpi: "Merchant pickup on-time rate",
    inherits: ["marketplace_optimization", "partner_network"], surface: "/dashboard/admin/marketplace",
  },
  {
    id: "driver_logistics", label: "Driver Logistics", pillar: "resources",
    description: "Driver shift supply, task load, earnings impact and fatigue guardrails.",
    stage: "operating", owner: "Driver Operations", kpi: "Tasks per active hour",
    inherits: ["workforce_intelligence"], surface: "/dashboard/admin/drivers",
  },
  {
    id: "vehicle_capacity", label: "Vehicle Capacity", pillar: "resources",
    description: "Volumetric and weight capacity modelling per vehicle class and compliance state.",
    stage: "operating", owner: "Fleet", kpi: "Capacity utilisation",
    inherits: ["fleet", "scalability_planning"], surface: "/dashboard/admin/fleet-center",
  },
  {
    id: "route_optimization", label: "Route Optimization", pillar: "resources",
    description: "Batch route construction under capacity, time-window and cost constraints.",
    stage: "operating", owner: "Routing", kpi: "Cost per delivered parcel",
    inherits: ["enterprise_simulation", "financial_intelligence"], surface: "/delivery/ops/routes",
  },
  {
    id: "warehouse_intelligence", label: "Warehouse Intelligence", pillar: "intelligence",
    description: "Backlog forecasting, labour planning and bottleneck detection per dispatch window.",
    stage: "operating", owner: "Warehouse Operations", kpi: "Backlog forecast error",
    inherits: ["process_intelligence", "enterprise_reasoning"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "ai_logistics_copilot", label: "AI Logistics Copilot", pillar: "intelligence",
    description: "Grounded operator assistant for exceptions, dispatch bottlenecks and playbook recall.",
    stage: "operating", owner: "Logistics Data", kpi: "Grounded answer rate",
    inherits: ["ai_governance", "enterprise_memory"], surface: "/dashboard/admin/logistics-center",
  },
  {
    id: "executive_logistics_intelligence", label: "Executive Logistics Intelligence", pillar: "intelligence",
    description: "Network-level KPI briefing, margin exposure and corrective-action tracking.",
    stage: "operating", owner: "Executive Office", kpi: "On-time delivery rate",
    inherits: ["mission_control", "business_outcome"], surface: "/dashboard/admin/executive-intelligence",
  },
];

export function elosCapability(id: string): ElosCapability | undefined {
  return ELOS_CAPABILITIES.find((c) => c.id === id);
}

export function elosByPillar(pillar: ElosPillar): ElosCapability[] {
  return ELOS_CAPABILITIES.filter((c) => c.pillar === pillar);
}

export interface ElosCertification {
  name: string;
  version: string;
  capabilities: number;
  pillars: number;
  operating: number;
  piloting: number;
  designing: number;
  /** Percentage of capabilities that are operating or piloting. */
  activationRate: number;
  /** 0-100 platform readiness score. */
  score: number;
  passed: boolean;
  findings: string[];
}

const STAGE_WEIGHT: Record<ElosStage, number> = { operating: 1, piloting: 0.6, designing: 0.2 };

/** Deterministic ELOS platform certification. */
export function certifyElos(capabilities: ElosCapability[] = ELOS_CAPABILITIES): ElosCertification {
  const findings: string[] = [];
  const ids = new Set<string>();
  for (const c of capabilities) {
    if (ids.has(c.id)) findings.push(`Duplicate capability id: ${c.id}`);
    ids.add(c.id);
    if (!c.owner) findings.push(`${c.id}: missing owner`);
    if (!c.kpi) findings.push(`${c.id}: missing primary KPI`);
    if (c.inherits.length === 0) findings.push(`${c.id}: inherits no platform service (re-implementation risk)`);
    if (!c.surface.startsWith("/")) findings.push(`${c.id}: capability has no console surface`);
  }
  const pillars = new Set(capabilities.map((c) => c.pillar));
  for (const p of Object.keys(ELOS_PILLARS) as ElosPillar[]) {
    if (!pillars.has(p)) findings.push(`Pillar ${p} has no capabilities`);
  }

  const count = capabilities.length || 1;
  const operating = capabilities.filter((c) => c.stage === "operating").length;
  const piloting = capabilities.filter((c) => c.stage === "piloting").length;
  const designing = capabilities.filter((c) => c.stage === "designing").length;
  const weighted = capabilities.reduce((sum, c) => sum + STAGE_WEIGHT[c.stage], 0) / count;
  const penalty = Math.min(30, findings.length * 5);
  const score = Math.max(0, Math.round(weighted * 100 - penalty));

  return {
    name: ELOS_NAME,
    version: ELOS_VERSION,
    capabilities: capabilities.length,
    pillars: pillars.size,
    operating,
    piloting,
    designing,
    activationRate: Math.round(((operating + piloting) / count) * 1000) / 10,
    score,
    passed: findings.length === 0 && score >= 70,
    findings,
  };
}

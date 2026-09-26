/**
 * Phase D11.0 — Enterprise Business Capability Registry.
 *
 * Configuration-only mapping between technical assets (Workspace360 domains,
 * canonical services, certifiers, ops signals) and executive-facing
 * business capabilities / business goals / executive objectives.
 *
 * No new tables. No new services. Pure, deterministic lookup surface
 * consumed by the Decision Engine and Executive Intelligence.
 */
import type { Workspace360Domain } from "./domains";

export type ExecutiveObjective =
  | "marketplace_liquidity"
  | "revenue_growth"
  | "customer_experience"
  | "driver_ecosystem"
  | "corporate_growth"
  | "trust_and_safety"
  | "compliance_and_regulation"
  | "platform_reliability";

export type BusinessGoal =
  | "marketplace_supply"
  | "marketplace_demand"
  | "driver_retention"
  | "driver_quality"
  | "rider_retention"
  | "corporate_revenue"
  | "invoice_settlement"
  | "trip_completion"
  | "customer_satisfaction"
  | "platform_trust"
  | "regulatory_compliance"
  | "operational_continuity";

export type BusinessCapability =
  | "driver_wallet"
  | "driver_payments"
  | "driver_academy"
  | "driver_onboarding"
  | "rider_booking"
  | "rider_payments"
  | "rider_safety"
  | "corporate_billing"
  | "corporate_kyb"
  | "corporate_policies"
  | "dispatch_engine"
  | "pricing_engine"
  | "fraud_engine"
  | "settlement_engine"
  | "notification_engine"
  | "package_delivery"
  | "fleet_operations"
  | "logistics_orchestration"
  | "rental_operations"
  | "audit_and_governance";

export interface BusinessCapabilitySpec {
  capability: BusinessCapability;
  label: string;
  primaryDomain: Workspace360Domain | "platform" | "finance" | "security";
  supportsGoals: BusinessGoal[];
  objectives: ExecutiveObjective[];
  /** Canonical services / certifiers / signals this capability derives from. */
  canonicalSources: string[];
  /** Executive weight (0-1) — used when ranking capabilities in reports. */
  executiveWeight: number;
}

export const BUSINESS_CAPABILITY_REGISTRY: ReadonlyArray<BusinessCapabilitySpec> = [
  {
    capability: "driver_wallet",
    label: "Driver Wallet & Withdrawals",
    primaryDomain: "driver",
    supportsGoals: ["driver_retention", "marketplace_supply"],
    objectives: ["driver_ecosystem", "marketplace_liquidity"],
    canonicalSources: [
      "certifyBusinessConsistency", "certifyOperationalQualification",
      "wallets", "driver_payouts", "driver-withdraw",
    ],
    executiveWeight: 0.9,
  },
  {
    capability: "driver_payments",
    label: "Driver Earnings & Settlement",
    primaryDomain: "finance",
    supportsGoals: ["driver_retention", "trip_completion"],
    objectives: ["driver_ecosystem", "revenue_growth"],
    canonicalSources: [
      "certifyBusinessConsistency", "settlement_batches", "journals",
    ],
    executiveWeight: 0.95,
  },
  {
    capability: "driver_academy",
    label: "Driver Academy & Quality",
    primaryDomain: "driver",
    supportsGoals: ["driver_quality", "customer_satisfaction"],
    objectives: ["customer_experience", "driver_ecosystem"],
    canonicalSources: ["training_courses", "driver_certifications"],
    executiveWeight: 0.55,
  },
  {
    capability: "driver_onboarding",
    label: "Driver Onboarding & Compliance",
    primaryDomain: "driver",
    supportsGoals: ["driver_quality", "regulatory_compliance"],
    objectives: ["driver_ecosystem", "compliance_and_regulation"],
    canonicalSources: ["driver_documents", "driver_verifications"],
    executiveWeight: 0.65,
  },
  {
    capability: "rider_booking",
    label: "Rider Booking Experience",
    primaryDomain: "rider",
    supportsGoals: ["rider_retention", "trip_completion"],
    objectives: ["customer_experience", "revenue_growth"],
    canonicalSources: ["trip_bookings", "trip_requests", "certifyCrossDomainWorkflows"],
    executiveWeight: 0.9,
  },
  {
    capability: "rider_payments",
    label: "Rider Payments & Wallet",
    primaryDomain: "rider",
    supportsGoals: ["rider_retention", "trip_completion"],
    objectives: ["customer_experience", "revenue_growth"],
    canonicalSources: ["mpesa_transactions", "payment_attempts", "rider_wallets"],
    executiveWeight: 0.9,
  },
  {
    capability: "rider_safety",
    label: "Rider Safety & Trust",
    primaryDomain: "rider",
    supportsGoals: ["rider_retention", "platform_trust"],
    objectives: ["trust_and_safety", "customer_experience"],
    canonicalSources: ["rider_safety_incidents", "rider_sos_alerts"],
    executiveWeight: 0.85,
  },
  {
    capability: "corporate_billing",
    label: "Corporate Billing & Invoices",
    primaryDomain: "corporate",
    supportsGoals: ["corporate_revenue", "invoice_settlement"],
    objectives: ["corporate_growth", "revenue_growth"],
    canonicalSources: ["corporate_invoices", "corporate_financial_reconciliation"],
    executiveWeight: 0.95,
  },
  {
    capability: "corporate_kyb",
    label: "Corporate KYB & Documents",
    primaryDomain: "corporate",
    supportsGoals: ["regulatory_compliance", "corporate_revenue"],
    objectives: ["compliance_and_regulation", "corporate_growth"],
    canonicalSources: ["corporate_documents", "corporate_kyb_audit_log"],
    executiveWeight: 0.75,
  },
  {
    capability: "corporate_policies",
    label: "Corporate Ride Policies",
    primaryDomain: "corporate",
    supportsGoals: ["corporate_revenue", "operational_continuity"],
    objectives: ["corporate_growth"],
    canonicalSources: ["corporate_ride_policies", "corporate_policy_violations"],
    executiveWeight: 0.6,
  },
  {
    capability: "dispatch_engine",
    label: "Dispatch & Assignment",
    primaryDomain: "platform",
    supportsGoals: ["marketplace_supply", "trip_completion"],
    objectives: ["marketplace_liquidity", "customer_experience"],
    canonicalSources: [
      "certifyCrossDomainWorkflows", "dispatch_requests", "dispatch_assignments",
    ],
    executiveWeight: 0.95,
  },
  {
    capability: "pricing_engine",
    label: "Pricing & Surge",
    primaryDomain: "platform",
    supportsGoals: ["marketplace_demand", "corporate_revenue"],
    objectives: ["revenue_growth", "marketplace_liquidity"],
    canonicalSources: ["pricing_models", "marketplace_surge_multipliers"],
    executiveWeight: 0.85,
  },
  {
    capability: "fraud_engine",
    label: "Fraud & Risk Engine",
    primaryDomain: "security",
    supportsGoals: ["platform_trust", "operational_continuity"],
    objectives: ["trust_and_safety", "platform_reliability"],
    canonicalSources: ["fraud_cases", "fraud_rules", "fraud_engine_traces"],
    executiveWeight: 0.85,
  },
  {
    capability: "settlement_engine",
    label: "Settlement & Reconciliation",
    primaryDomain: "finance",
    supportsGoals: ["invoice_settlement", "corporate_revenue"],
    objectives: ["revenue_growth", "corporate_growth"],
    canonicalSources: [
      "certifyBusinessConsistency", "reconciliation_cases", "payment_financial_reconciliation_full",
    ],
    executiveWeight: 0.95,
  },
  {
    capability: "notification_engine",
    label: "Notifications & Alerts",
    primaryDomain: "platform",
    supportsGoals: ["operational_continuity"],
    objectives: ["platform_reliability"],
    canonicalSources: ["event_outbox", "event_outbox_dlq", "OperationsCenter.signals"],
    executiveWeight: 0.5,
  },
  {
    capability: "package_delivery",
    label: "Package Delivery",
    primaryDomain: "package",
    supportsGoals: ["trip_completion", "customer_satisfaction"],
    objectives: ["customer_experience", "revenue_growth"],
    canonicalSources: ["packages", "delivery_orders"],
    executiveWeight: 0.55,
  },
  {
    capability: "fleet_operations",
    label: "Fleet Operations",
    primaryDomain: "fleet",
    supportsGoals: ["marketplace_supply", "operational_continuity"],
    objectives: ["marketplace_liquidity"],
    canonicalSources: ["fleets", "fleet_vehicles", "vehicles"],
    executiveWeight: 0.55,
  },
  {
    capability: "logistics_orchestration",
    label: "Logistics Orchestration",
    primaryDomain: "logistics",
    supportsGoals: ["trip_completion", "operational_continuity"],
    objectives: ["marketplace_liquidity"],
    canonicalSources: ["delivery_dispatch_jobs", "delivery_route_segments"],
    executiveWeight: 0.5,
  },
  {
    capability: "rental_operations",
    label: "Rental Operations",
    primaryDomain: "rental",
    supportsGoals: ["marketplace_supply"],
    objectives: ["marketplace_liquidity", "revenue_growth"],
    canonicalSources: ["fleets", "vehicles"],
    executiveWeight: 0.4,
  },
  {
    capability: "audit_and_governance",
    label: "Audit & Governance",
    primaryDomain: "platform",
    supportsGoals: ["regulatory_compliance", "operational_continuity"],
    objectives: ["compliance_and_regulation", "platform_reliability"],
    canonicalSources: [
      "certifyWorkspace360Governance", "audit_logs", "certifyOperationalQualification",
    ],
    executiveWeight: 0.7,
  },
];

const REGISTRY_INDEX = new Map<BusinessCapability, BusinessCapabilitySpec>(
  BUSINESS_CAPABILITY_REGISTRY.map((c) => [c.capability, c]),
);

export function getBusinessCapability(c: BusinessCapability): BusinessCapabilitySpec {
  const spec = REGISTRY_INDEX.get(c);
  if (!spec) throw new Error(`unknown business capability: ${c}`);
  return spec;
}

/** Reverse index: canonical source → capabilities that reference it. */
const SOURCE_INDEX: Map<string, BusinessCapability[]> = (() => {
  const idx = new Map<string, BusinessCapability[]>();
  for (const spec of BUSINESS_CAPABILITY_REGISTRY) {
    for (const src of spec.canonicalSources) {
      const arr = idx.get(src) ?? [];
      arr.push(spec.capability);
      idx.set(src, arr);
    }
  }
  return idx;
})();

/** Domain → capabilities primarily owned by that domain. */
const DOMAIN_INDEX: Map<string, BusinessCapability[]> = (() => {
  const idx = new Map<string, BusinessCapability[]>();
  for (const spec of BUSINESS_CAPABILITY_REGISTRY) {
    const arr = idx.get(spec.primaryDomain) ?? [];
    arr.push(spec.capability);
    idx.set(spec.primaryDomain, arr);
  }
  return idx;
})();

/**
 * Deterministically infer the business capabilities a recommendation touches
 * from its canonical sources and primary domain. Never returns an empty list
 * — always falls back to `audit_and_governance`.
 */
export function inferCapabilities(
  domain: string,
  canonicalSources: ReadonlyArray<string>,
): BusinessCapability[] {
  const hits = new Set<BusinessCapability>();
  for (const src of canonicalSources) {
    for (const cap of SOURCE_INDEX.get(src) ?? []) hits.add(cap);
  }
  if (hits.size === 0) {
    for (const cap of DOMAIN_INDEX.get(domain) ?? []) hits.add(cap);
  }
  if (hits.size === 0) hits.add("audit_and_governance");
  return Array.from(hits).sort();
}

export function capabilitiesForDomain(domain: string): BusinessCapability[] {
  return (DOMAIN_INDEX.get(domain) ?? []).slice().sort();
}

// ============================================================================
// D11.9 — Business Capability Registry Certifier (config integrity).
// Used by CI + governance to guarantee the config never drifts.
// ============================================================================

export interface BusinessCapabilityRegistryCertification {
  passed: boolean;
  score: number;
  totalCapabilities: number;
  failures: string[];
  coveredDomains: string[];
  uncoveredDomains: string[];
}

const REQUIRED_DOMAINS: ReadonlyArray<string> = [
  "driver", "rider", "corporate", "fleet", "courier",
  "package", "logistics", "rental", "platform", "finance", "security",
];

export function certifyBusinessCapabilityRegistry(): BusinessCapabilityRegistryCertification {
  const failures: string[] = [];
  const seen = new Set<BusinessCapability>();
  for (const c of BUSINESS_CAPABILITY_REGISTRY) {
    if (seen.has(c.capability)) failures.push(`duplicate capability ${c.capability}`);
    seen.add(c.capability);
    if (c.canonicalSources.length === 0) failures.push(`${c.capability} missing canonical sources`);
    if (c.supportsGoals.length === 0) failures.push(`${c.capability} missing business goals`);
    if (c.objectives.length === 0) failures.push(`${c.capability} missing executive objectives`);
    if (!(c.executiveWeight > 0 && c.executiveWeight <= 1))
      failures.push(`${c.capability} executiveWeight out of range`);
  }
  const coveredDomains = Array.from(new Set(
    BUSINESS_CAPABILITY_REGISTRY.map((c) => c.primaryDomain as string),
  )).sort();
  const uncoveredDomains = REQUIRED_DOMAINS.filter((d) => !coveredDomains.includes(d));
  for (const d of uncoveredDomains) failures.push(`no capability owns domain '${d}'`);
  const total = BUSINESS_CAPABILITY_REGISTRY.length;
  const bad = failures.length;
  const score = total === 0 ? 0 : Math.max(0, Math.round(((total - bad) / total) * 100));
  return {
    passed: failures.length === 0,
    score,
    totalCapabilities: total,
    failures,
    coveredDomains,
    uncoveredDomains,
  };
}

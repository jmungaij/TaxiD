/**
 * Enterprise Administration Control Plane — configuration governance for
 * Platform Settings.
 *
 * Platform Settings is not a bag of application preferences: every enterprise
 * business capability that is already implemented must have a *governed*
 * configuration surface (policy-driven, auditable, versioned, approval-aware
 * where money/risk is involved, and traceable to the Capability Registry).
 *
 * This module is headless. It derives the gap matrix from existing registries
 * (Capability Registry, Process Catalog, Policy Registry) and does not own any
 * business logic of its own.
 */

import { BUSINESS_CAPABILITY_REGISTRY, type BusinessCapability } from "@/lib/workspace360/capabilities";
import { POLICY_REGISTRY } from "@/lib/platform/policyRegistry";
import type { ProcessId } from "@/lib/platform/processCatalog";

export const CONTROL_PLANE_VERSION = "1.0.0";

/** Where the configuration values physically live today. */
export type ConfigBacking =
  | "platform_settings"      // platform_settings / notification_settings rows
  | "code_registry"          // frozen, versioned in-repo registry (deploy-gated)
  | "domain_table"           // dedicated governed table with RLS + audit
  | "none";                  // no configuration surface exists yet

export type MutationMode = "direct" | "approval_required" | "read_only";

export type SurfaceStatus = "governed" | "partial" | "gap";

export interface ControlPlaneSurface {
  id: string;
  /** Enterprise capability area as named in the platform charter. */
  area: string;
  /** Platform Settings section that renders this surface (deep-link id). */
  section: string;
  purpose: string;
  backing: ConfigBacking;
  mutation: MutationMode;
  /** Capability Registry entries this configuration governs. */
  capabilities: BusinessCapability[];
  /** Business processes affected when this configuration changes. */
  processes: ProcessId[];
  /** Policy Registry ids that constrain the allowed values. */
  policies: string[];
  /** Audit sink proving who changed what, when. */
  auditSink: string | null;
  /** Whether changes are versioned (history retained + revertible). */
  versioned: boolean;
  /** RBAC roles allowed to mutate. */
  roles: string[];
}

/**
 * Registry of configuration surfaces. Ordering is stable so the gap matrix and
 * its digest are deterministic across runs.
 */
export const CONTROL_PLANE_SURFACES: ReadonlyArray<ControlPlaneSurface> = [
  {
    id: "cfg_brand",
    area: "Corporate",
    section: "brand",
    purpose: "Brand identity, currency, timezone and locale defaults.",
    backing: "platform_settings",
    mutation: "direct",
    capabilities: ["corporate_billing"],
    processes: ["corporate_lead_to_invoice"],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: false,
    roles: ["admin"],
  },
  {
    id: "cfg_email",
    area: "Integrations",
    section: "email",
    purpose: "Sender identity, routing inboxes and confirmation behaviour.",
    backing: "platform_settings",
    mutation: "direct",
    capabilities: ["notification_engine"],
    processes: ["support_to_closure"],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: false,
    roles: ["admin"],
  },
  {
    id: "cfg_antispam",
    area: "Security",
    section: "antispam",
    purpose: "Public form spam thresholds and rate limits.",
    backing: "platform_settings",
    mutation: "direct",
    capabilities: ["fraud_engine"],
    processes: ["support_to_closure"],
    policies: ["pol_data_retention"],
    auditSink: "contact_audit_log",
    versioned: false,
    roles: ["admin"],
  },
  {
    id: "cfg_flags",
    area: "Release Authority",
    section: "flags",
    purpose: "Capability exposure flags gated by the release authority.",
    backing: "platform_settings",
    mutation: "approval_required",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: false,
    roles: ["admin"],
  },
  {
    id: "cfg_maintenance",
    area: "Monitoring",
    section: "maintenance",
    purpose: "Maintenance mode and incident banner gating.",
    backing: "platform_settings",
    mutation: "direct",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: false,
    roles: ["admin"],
  },
  // --- Registry-backed surfaces: values are frozen in code and deploy-gated. ---
  {
    id: "cfg_capability_registry",
    area: "Capability Registry",
    section: "controlplane",
    purpose: "Capability catalogue, owners, executive weights.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_process_registry",
    area: "Process Registry",
    section: "controlplane",
    purpose: "Process catalogue, stage budgets and KPI targets.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: ["ride_to_cash", "delivery_to_cash", "refund_to_resolution"],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_policy_registry",
    area: "Policy Registry",
    section: "controlplane",
    purpose: "Ratified policies, versions and enforcement rules.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: POLICY_REGISTRY.map((p) => p.id),
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_event_registry",
    area: "Event Registry",
    section: "controlplane",
    purpose: "Canonical events, retention, ordering and classification.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["notification_engine", "audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_bcra",
    area: "BCRA",
    section: "controlplane",
    purpose: "Release authority thresholds and certificate baselines.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_lcif",
    area: "LCIF",
    section: "controlplane",
    purpose: "Logistics capability intelligence weights and thresholds.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["logistics_orchestration", "package_delivery"],
    processes: ["delivery_to_cash"],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_intelligence_api",
    area: "Intelligence API",
    section: "controlplane",
    purpose: "Intelligence façade RBAC scopes and cache TTLs.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_ai_governance",
    area: "AI Governance",
    section: "controlplane",
    purpose: "Model inventory, confidence floors and human-override rules.",
    backing: "code_registry",
    mutation: "read_only",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: ["pol_ai_use"],
    auditSink: "git",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_compliance",
    area: "Compliance",
    section: "controlplane",
    purpose: "Regulatory rule packs, KYB requirements and retention windows.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["corporate_kyb"],
    processes: ["corporate_lead_to_invoice"],
    policies: ["pol_corporate_travel"],
    auditSink: "corporate_kyb_audit_log",
    versioned: true,
    roles: ["admin", "compliance"],
  },
  {
    id: "cfg_pricing",
    area: "Marketplace",
    section: "controlplane",
    purpose: "City pricing rules, floors and surge governance.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["pricing_engine"],
    processes: ["ride_to_cash"],
    policies: ["pol_pricing"],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_dispatch",
    area: "Fleet",
    section: "controlplane",
    purpose: "Dispatch rules, surge zones and offer timeouts.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["dispatch_engine", "fleet_operations"],
    processes: ["ride_to_cash"],
    policies: [],
    auditSink: "dispatch_approval_audit",
    versioned: true,
    roles: ["admin", "ops"],
  },
  {
    id: "cfg_finance",
    area: "Finance",
    section: "controlplane",
    purpose: "Settlement cadence, budgets and refund limits.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["settlement_engine", "driver_payments", "corporate_billing"],
    processes: ["booking_to_settlement", "refund_to_resolution", "procure_to_pay"],
    policies: ["pol_refund", "pol_pricing"],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin", "finance"],
  },
  {
    id: "cfg_trust_safety",
    area: "Trust & Safety",
    section: "controlplane",
    purpose: "Incident severity routing and safety escalation thresholds.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["rider_safety", "fraud_engine"],
    processes: ["support_to_closure"],
    policies: ["pol_customer_resolution"],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin", "trust_safety"],
  },
  {
    id: "cfg_driver",
    area: "Driver",
    section: "controlplane",
    purpose: "Onboarding requirements, document expiry and payout methods.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["driver_onboarding", "driver_wallet", "driver_academy"],
    processes: ["driver_onboard_to_active"],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin", "ops"],
  },
  {
    id: "cfg_rider",
    area: "Rider",
    section: "controlplane",
    purpose: "Booking constraints, share-link TTL and payment methods.",
    backing: "domain_table",
    mutation: "direct",
    capabilities: ["rider_booking", "rider_payments"],
    processes: ["ride_to_cash"],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin"],
  },
  {
    id: "cfg_delivery",
    area: "Delivery",
    section: "controlplane",
    purpose: "Delivery SLAs, cold-chain limits and courier assignment rules.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["package_delivery", "logistics_orchestration"],
    processes: ["delivery_to_cash"],
    policies: ["pol_delivery_sla"],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin", "ops"],
  },
  {
    id: "cfg_monitoring",
    area: "Monitoring",
    section: "controlplane",
    purpose: "Alert routes, mute windows and error-budget thresholds.",
    backing: "domain_table",
    mutation: "direct",
    capabilities: ["audit_and_governance"],
    processes: [],
    policies: [],
    auditSink: "alerts_events",
    versioned: true,
    roles: ["admin", "ops"],
  },
  {
    id: "cfg_security",
    area: "Security",
    section: "controlplane",
    purpose: "MFA enforcement, IP blocks and session policy.",
    backing: "domain_table",
    mutation: "approval_required",
    capabilities: ["audit_and_governance", "fraud_engine"],
    processes: [],
    policies: [],
    auditSink: "admin_audit_log",
    versioned: true,
    roles: ["admin", "security"],
  },
  {
    id: "cfg_rental",
    area: "Marketplace",
    section: "controlplane",
    purpose: "Rental listing rules, deposits and damage waivers.",
    backing: "none",
    mutation: "read_only",
    capabilities: ["rental_operations"],
    processes: [],
    policies: [],
    auditSink: null,
    versioned: false,
    roles: ["admin"],
  },
];

export interface SurfaceAssessment extends ControlPlaneSurface {
  status: SurfaceStatus;
  /** Governance defects for this surface, ordered deterministically. */
  gaps: string[];
}

const KNOWN_POLICY_IDS = new Set(POLICY_REGISTRY.map((p) => p.id));

const REQUIRES_APPROVAL_AREAS = new Set([
  "Finance",
  "Compliance",
  "Security",
  "Trust & Safety",
]);

function assess(s: ControlPlaneSurface): SurfaceAssessment {
  const gaps: string[] = [];
  if (s.backing === "none") gaps.push("no configuration surface");
  if (!s.auditSink) gaps.push("no audit sink");
  if (!s.versioned) gaps.push("changes are not versioned");
  if (REQUIRES_APPROVAL_AREAS.has(s.area) && s.mutation === "direct") {
    gaps.push("high-risk area allows direct mutation");
  }
  if (s.capabilities.length === 0) gaps.push("not traceable to the Capability Registry");
  for (const id of s.policies) {
    if (!KNOWN_POLICY_IDS.has(id)) gaps.push(`policy "${id}" is not in the Policy Registry`);
  }

  const status: SurfaceStatus =
    s.backing === "none" ? "gap" : gaps.length === 0 ? "governed" : "partial";
  return { ...s, status, gaps };
}

export interface ControlPlaneReport {
  version: string;
  surfaces: SurfaceAssessment[];
  /** Capability Registry entries with no configuration surface at all. */
  uncoveredCapabilities: BusinessCapability[];
  counts: Record<SurfaceStatus, number>;
  /** 0-100 governance coverage of the administration control plane. */
  score: number;
  status: "certified" | "conditional" | "not_certified";
}

export function certifyControlPlane(
  surfaces: ReadonlyArray<ControlPlaneSurface> = CONTROL_PLANE_SURFACES,
): ControlPlaneReport {
  const assessed = surfaces.map(assess);
  const covered = new Set(assessed.filter((s) => s.backing !== "none").flatMap((s) => s.capabilities));
  const uncoveredCapabilities = BUSINESS_CAPABILITY_REGISTRY
    .map((c) => c.capability)
    .filter((c) => !covered.has(c));

  const counts: Record<SurfaceStatus, number> = { governed: 0, partial: 0, gap: 0 };
  for (const s of assessed) counts[s.status] += 1;

  const surfaceScore = (counts.governed + counts.partial * 0.5) / Math.max(1, assessed.length);
  const capabilityScore =
    (BUSINESS_CAPABILITY_REGISTRY.length - uncoveredCapabilities.length) /
    Math.max(1, BUSINESS_CAPABILITY_REGISTRY.length);
  const score = Math.round((surfaceScore * 0.6 + capabilityScore * 0.4) * 100);

  return {
    version: CONTROL_PLANE_VERSION,
    surfaces: assessed,
    uncoveredCapabilities,
    counts,
    score,
    status: score >= 90 ? "certified" : score >= 70 ? "conditional" : "not_certified",
  };
}

/** Surfaces grouped by enterprise capability area for the gap matrix UI. */
export function controlPlaneGapMatrix(
  report: ControlPlaneReport = certifyControlPlane(),
): { area: string; surfaces: SurfaceAssessment[]; status: SurfaceStatus }[] {
  const byArea = new Map<string, SurfaceAssessment[]>();
  for (const s of report.surfaces) {
    const list = byArea.get(s.area) ?? [];
    list.push(s);
    byArea.set(s.area, list);
  }
  return [...byArea.entries()]
    .map(([area, list]) => ({
      area,
      surfaces: list,
      status: list.some((s) => s.status === "gap")
        ? ("gap" as const)
        : list.every((s) => s.status === "governed")
          ? ("governed" as const)
          : ("partial" as const),
    }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

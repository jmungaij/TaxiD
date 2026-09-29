/**
 * YEOS v4 — 14 Enterprise Workspaces (12 core + Flight Hub + Charter/Leasing).
 *
 * Every `path` here MUST exist in src/lib/routes.ts. This file only reorganizes
 * how those routes are surfaced in the sidebar / command centre / AI copilot.
 * No new routes, no new pages.
 *
 * v4 — Web/Admin navigation synchronization pass. The public header exposes
 * seven commercial domains (Ride, Drivers, Corporate, Delivery & Logistics,
 * Charter Business, Leasing & Rentals, Resources). Each now has a matching
 * admin workspace so nothing shipped on the website is unreachable from the
 * admin rail:
 *   1. NEW `charter_rentals` workspace — Charter Business + Leasing & Rentals
 *      (aviation charter centre, booking audit, pricing alerts/retries, asset
 *      pricing profiles, SmartFare governance, operator portal & analytics).
 *      These pages previously existed but had no navigation entry point.
 *   2. `flight_hub` is now pure scheduled/air mobility operations; charter
 *      commerce moved to `charter_rentals`.
 *   3. Riders Center + Rider Directory attached to People & Partners
 *      (mirrors the header "Ride" tab).
 *   4. Courier / Package / Logistics directories attached to Delivery &
 *      Logistics (mirrors the header "Delivery & Logistics" tab).
 *   5. Command Home attached to Executive; Alert Preferences to Platform;
 *      Security Findings to Trust & Safety.
 *   6. Workflow sections added to every workspace so long lists read as
 *      Overview → Operations → Finance → Assurance → Administration.
 *   7. Workspace order now follows enterprise value flow: strategy → run the
 *      business → customers → commercial lines → assets → money → assurance →
 *      intelligence → administration → platform.
 */
import { corporateControlWorkspaceItems } from "@/lib/navigation/corporateControls";

import { ROUTE_BY_PATH } from "@/lib/routes";
import type { WorkspaceDefinition } from "./types";

export const WORKSPACES: WorkspaceDefinition[] = [
  {
    // Strategic intelligence command centre. No operational CRUD lives here.
    key: "executive",
    title: "Executive",
    icon: "Crown",
    description: "Strategic intelligence, platform health, financial visibility, AI recommendations.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin/executive",
    kpis: ["revenue_today", "trips_today", "health_score", "alerts_open"],
    items: [
      { path: "/dashboard/admin/home", label: "Command Home", section: "Overview" },
      { path: "/dashboard/admin/executive", label: "Executive Overview", section: "Overview" },
      { path: "/dashboard/admin/executive-intelligence", label: "Enterprise Cockpit", section: "Intelligence" },
      { path: "/dashboard/admin/alerts", label: "Executive Alerts", section: "Signals" },
      { path: "/dashboard/admin/command-center", label: "AI Executive Assistant", section: "Signals" },
    ],
  },
  {
    // Real-time mobility execution centre.
    key: "operations",
    title: "Operations",
    icon: "Radar",
    description: "Real-time mobility execution — dispatch, trips, monitoring, incidents, SLA.",
    roles: ["admin", "super_admin", "finance_admin"],
    overviewPath: "/dashboard/admin/ops-center",
    kpis: ["active_trips", "dispatch_queue", "open_incidents", "eta_avg"],
    items: [
      { path: "/dashboard/admin/ops-center", label: "Live Command Center", section: "Overview" },
      { path: "/dashboard/admin/operations", label: "Operations Hub", section: "Overview" },
      { path: "/dashboard/admin/dispatch", label: "Dispatch Operations", section: "Dispatch" },
      { path: "/dashboard/admin/dispatch/sim", label: "Dispatch Simulator", section: "Dispatch" },
      { path: "/dashboard/admin/fos", label: "FOS Control", section: "Dispatch" },
      { path: "/dashboard/admin/noc", label: "NOC Console", section: "Monitoring" },
      { path: "/dashboard/admin/noc-incidents", label: "Incident Management", section: "Monitoring" },
      { path: "/dashboard/admin/sla-grace", label: "SLA Monitoring", section: "Monitoring" },
    ],
  },
  {
    // Ecosystem management: Riders • Corporate • Drivers • Support.
    key: "people_partners",
    title: "People & Partners",
    icon: "Users",
    description: "Riders, Corporate Accounts, Drivers, and the Support Center.",
    roles: ["admin", "super_admin", "compliance_admin"],
    overviewPath: "/dashboard/admin/people-partners",
    kpis: ["active_riders", "drivers_online", "corporate_accounts", "pending_approvals"],
    items: [
      { path: "/dashboard/admin/people-partners", label: "People & Partners Hub", section: "Overview" },
      { path: "/dashboard/admin/people-console", label: "People Management Console", section: "Overview" },
      { path: "/dashboard/admin/partner-invite", label: "Partner Onboarding & Invite", section: "Overview" },
      // TaxiD Partners — the distribution network (agencies, hotels, operators).
      { path: "/staff/partners", label: "TaxiD Partners Operations", section: "TaxiD Partners" },
      // Riders (mirrors the public "Ride" tab)
      { path: "/dashboard/admin/riders-center", label: "Riders Center", section: "Riders" },
      { path: "/dashboard/admin/rider-management", label: "Rider Dashboard", section: "Riders" },
      { path: "/dashboard/admin/riders", label: "Rider Directory", section: "Riders" },
      { path: "/dashboard/admin/rider-management?tab=wallet", label: "Rider Wallet", section: "Riders" },
      { path: "/dashboard/admin/rider-management?tab=trips", label: "Rider Trips", section: "Riders" },
      { path: "/dashboard/admin/rider-management?tab=support", label: "Rider Support", section: "Riders" },
      // Corporate (mirrors the public "Corporate" tab)
      { path: "/dashboard/admin/corporate-center", label: "Corporate Overview", section: "Corporate" },
      { path: "/dashboard/admin/corporates", label: "Corporate Directory", section: "Corporate" },
      // Business controls — relocated out of the public Business/Charter header.
      // Sourced from the single gate in src/lib/navigation/corporateControls.ts,
      // claimed by the Charter & Business domain so they render exactly once.
      ...corporateControlWorkspaceItems(),


      // Drivers (mirrors the public "Drivers" tab)
      { path: "/dashboard/admin/drivers", label: "Drivers Overview", section: "Drivers" },
      { path: "/dashboard/admin/lifecycle", label: "Driver Lifecycle", section: "Drivers" },
      { path: "/dashboard/admin/document-queue", label: "Compliance Queue", section: "Drivers" },
      { path: "/dashboard/admin/academy", label: "Driver Academy", section: "Drivers" },
      // Support Center
      { path: "/dashboard/admin/customer-operations", label: "Customer Operations & Resolution Center", section: "Support" },
      { path: "/dashboard/admin/contact-submissions", label: "Support Center", section: "Support" },
    ],
  },
  {
    /**
     * Commercial & Pricing — the authoritative owner of every pricing capability
     * in the platform (Admin → Commercial & Pricing → Pricing 360). Pricing 360
     * is the canonical landing workspace; the domain-specific consoles below are
     * editors that feed the same governed control plane. No pricing destination
     * may be primary-owned by Finance, Platform, Operations or Settings.
     */
    key: "commercial_pricing",
    title: "Commercial & Pricing",
    icon: "Coins",
    description:
      "Commercial control plane — rate cards, fares, fees, taxes, discounts, promotions, dynamic pricing, simulation, approvals and pricing audit across every business line.",
    roles: ["admin", "super_admin", "finance_admin", "pricing_manager"],
    overviewPath: "/dashboard/admin/pricing-360",
    kpis: ["active_rate_cards", "active_pricing_rules", "pricing_integrity", "pricing_alerts"],
    items: [
      { path: "/dashboard/admin/pricing-360", label: "Pricing 360 Command Centre", section: "Command" },
      { path: "/dashboard/admin/pricing-audit-log", label: "Pricing Audit Log", section: "Command" },
      { path: "/dashboard/admin/pricing-360?tab=intelligence", label: "Pricing Intelligence", section: "Command" },
      { path: "/dashboard/admin/pricing-360?tab=products", label: "Products & Business Lines", section: "Configuration" },
      { path: "/dashboard/admin/pricing-360?tab=markets", label: "Market Pricing", section: "Configuration" },
      { path: "/dashboard/admin/pricing-360?tab=rates", label: "Rate Cards", section: "Configuration" },
      { path: "/dashboard/admin/pricing-360?tab=rules", label: "Pricing Rules, Fees & Taxes", section: "Configuration" },
      { path: "/dashboard/admin/pricing-360?tab=asset-bands", label: "Asset Pricing Bands", section: "Configuration" },
      { path: "/dashboard/admin/pricing-360?tab=dynamic", label: "Dynamic Pricing", section: "Decisioning" },
      { path: "/dashboard/admin/pricing-360?tab=simulator", label: "Pricing Simulator", section: "Decisioning" },
      { path: "/dashboard/admin/pricing-360?tab=snapshots", label: "Quote Snapshots", section: "Assurance" },
      { path: "/dashboard/admin/pricing-360?tab=audit", label: "Pricing Audit", section: "Assurance" },
      // Product-line editors — contextual, still owned by this domain.
      { path: "/dashboard/admin/smartfare-pricing", label: "Ride Pricing · SmartFare", section: "Product Pricing" },
      { path: "/dashboard/admin/smartfare-versions", label: "SmartFare Version Diff & Audit", section: "Product Pricing" },
      { path: "/dashboard/admin/smartfare-what-if", label: "SmartFare What-If", section: "Product Pricing" },
      { path: "/dashboard/admin/pricing-360?tab=asset-bands", label: "Charter, Rental & Logistics Bands", section: "Product Pricing" },
      { path: "/dashboard/charter/portal?tab=pricing", label: "Charter Price Settings", section: "Product Pricing" },
      { path: "/dashboard/admin/flight-hub/pricing", label: "Air Dynamic Pricing Control", section: "Product Pricing" },
      { path: "/staff/commercial/charter", label: "Corporate Charter Commercial Engine", section: "Product Pricing" },
      { path: "/staff/commercial/documents", label: "Commercial Document Control", section: "Assurance" },
      { path: "/dashboard/admin/charter-pricing-alerts", label: "Pricing Alerts", section: "Assurance" },
    ],
  },
  {
    key: "marketplace",
    title: "Marketplace",
    icon: "LayoutGrid",
    description: "Demand, supply, pricing, promotions, heatmaps.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin/marketplace",
    kpis: ["demand_index", "supply_index", "surge_zones", "conversion_rate"],
    items: [
      { path: "/dashboard/admin/marketplace", label: "Marketplace Hub", section: "Overview" },
      { path: "/dashboard/admin/cta-analytics", label: "Demand & CTA Analytics", section: "Demand" },
    ],
  },
  {
    key: "delivery_logistics",
    title: "Enterprise Logistics Operating System",
    icon: "Package",
    description:
      "Hub network, warehouses, distribution, inventory, cross docking, courier, dispatch, routing, tracking, cold chain, reverse and executive logistics intelligence.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin/logistics-center",
    kpis: ["packages_active", "pod_pending", "logistics_sla", "delivery_success"],
    items: [
      { path: "/dashboard/admin/logistics-center", label: "Logistics OS Hub", section: "Overview" },
      { path: "/dashboard/admin/logistics-df10", label: "DF-10 Validation", section: "Overview" },
      { path: "/dashboard/admin/production-command-center", label: "Production Command Center", section: "Overview" },
      { path: "/dashboard/admin/legal", label: "Legal & Compliance Centre", section: "Overview" },
      { path: "/dashboard/admin/runtime-diagnostics", label: "Runtime Diagnostics", section: "Overview" },
      { path: "/dashboard/admin/delivery-operations", label: "Delivery Operations Control Tower", section: "Overview" },
      { path: "/dashboard/admin/logistics-orders", label: "Dispatch Orders Console", section: "Operations" },
      { path: "/dashboard/admin/logistics-exceptions", label: "Exception Control Centre", section: "Operations" },
      { path: "/dashboard/admin/logistics-manifests", label: "Manifests & Hub Custody", section: "Operations" },
      { path: "/dashboard/admin/logistics-warehouse", label: "Warehouse & Fulfilment", section: "Operations" },
      { path: "/dashboard/admin/freight-audit", label: "Freight Audit & Reconciliation", section: "Operations" },
      { path: "/delivery/ops", label: "Delivery Operations", section: "Operations" },
      { path: "/delivery/ops/dispatch", label: "Dispatch Command Center", section: "Operations" },
      { path: "/dashboard/admin/logistics", label: "Logistics Job Directory", section: "Operations" },
      { path: "/delivery/ops/packages", label: "Package Management", section: "Parcel Operations" },
      { path: "/dashboard/admin/packages", label: "Package Directory", section: "Parcel Operations" },
      { path: "/delivery/ops/routes", label: "Routing & ETA", section: "Parcel Operations" },
      { path: "/delivery/ops/pod", label: "Proof of Delivery", section: "Documents" },
      { path: "/delivery/portal", label: "Partner Portal", section: "Partner Management" },
      { path: "/dashboard/admin/couriers", label: "Courier Directory", section: "Partner Management" },
      { path: "/dashboard/admin/logistics-onboarding", label: "Onboarding Approvals", section: "Partner Management" },
      { path: "/dashboard/admin/logistics-capabilities", label: "Capability Registry", section: "Administration" },
    ],
  },
  {
    key: "flight_hub",
    title: "TaxiD Air · Flight Hub",
    icon: "PlaneTakeoff",
    description:
      "Air mobility command centre — live flights, operator onboarding, demand lifecycle, settlement, aviation compliance, customer relations and support.",
    roles: ["admin", "super_admin", "finance_admin", "compliance_admin"],
    overviewPath: "/dashboard/admin/flight-hub",
    kpis: ["flights_active", "fleet_availability", "gross_booked_value", "compliance_score"],
    items: [
      { path: "/dashboard/admin/flight-hub", label: "Flight Hub", section: "Overview" },
      { path: "/dashboard/admin/flight-hub/console", label: "Flights Console", section: "Operations" },
      { path: "/dashboard/admin/flight-hub/lifecycle", label: "Flight Lifecycle", section: "Operations" },
      { path: "/dashboard/admin/flight-hub/operations", label: "Operations Center", section: "Operations" },

      { path: "/dashboard/admin/flight-hub/partners", label: "Flight Partner Onboarding", section: "Partner Management" },
      { path: "/dashboard/admin/flight-hub/payments", label: "Payment System", section: "Finance" },
      { path: "/dashboard/admin/flight-hub/payouts", label: "Operator Payouts", section: "Finance" },
      { path: "/dashboard/admin/flight-hub/compliance", label: "Compliance", section: "Assurance" },
      { path: "/dashboard/admin/flight-hub/relations", label: "Customer Operations & Relations", section: "Customer" },
      { path: "/dashboard/admin/flight-hub/support", label: "Customer Support Desk", section: "Customer" },
    ],
  },
  {
    // Mirrors the public "Charter Business" + "Leasing & Rentals" header tabs.
    key: "charter_rentals",
    title: "Charter, Leasing & Rentals",
    icon: "Plane",
    description:
      "Charter marketplace, leasing and rental commerce — aviation, road, marine and equipment assets with SmartFare pricing governance and operator management.",
    roles: ["admin", "super_admin", "finance_admin", "compliance_admin"],
    overviewPath: "/dashboard/corporate-charter",
    kpis: ["charter_quotes", "fleet_utilization", "rate_card_completeness", "pricing_alerts"],
    items: [
      // Commercial spine: booking, procurement, approvals, budget and price
      // settings all moved off the public marketing pages into this portal.
      { path: "/dashboard/corporate-charter", label: "Corporate Charter Business", section: "Overview" },
      { path: "/dashboard/admin/ccb-operations", label: "CCB Operations Centre", section: "Overview" },
      { path: "/dashboard/premium", label: "Elite Premium Cockpit", section: "Overview" },
      { path: "/dashboard/corporate-charter?tab=booking", label: "Enterprise Booking Centre", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=employee", label: "Employee Mobility", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=executive", label: "Executive Travel", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=wallets", label: "Wallets", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=billing", label: "Billing & Settlement", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=policies", label: "Policies & Controls", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=reports", label: "Reports & Analytics", section: "Commercial Desk" },
      { path: "/dashboard/corporate-charter?tab=integrations", label: "Integrations", section: "Administration" },
      { path: "/dashboard/admin/ccb-operations?tab=rfq", label: "RFQ Engine", section: "Operations Centre" },
      { path: "/dashboard/admin/ccb-operations?tab=today", label: "Bookings Today", section: "Operations Centre" },
      { path: "/dashboard/admin/ccb-operations?tab=approvals", label: "Quotation Approvals", section: "Operations Centre" },
      { path: "/dashboard/admin/ccb-operations?tab=settlement", label: "Settlement", section: "Operations Centre" },
      { path: "/dashboard/admin/ccb-operations?tab=audit", label: "Audit Logs", section: "Operations Centre" },
      { path: "/dashboard/admin/road-approval-queue", label: "Road Charter Approval Queue", section: "Operations Centre" },
      { path: "/dashboard/charter/portal", label: "Charter Business Portal (legacy)", section: "Overview" },
      { path: "/dashboard/admin/aviation-center", label: "Charter Command Center", section: "Overview" },
      { path: "/dashboard/charter/analytics", label: "Charter Analytics", section: "Overview" },

      { path: "/dashboard/charter/portal?tab=missions", label: "Missions & Booking", section: "Commercial Desk" },
      { path: "/dashboard/charter/portal?tab=procurement", label: "Procurement & Approvals", section: "Commercial Desk" },
      { path: "/dashboard/charter/portal?tab=budget", label: "Budget & Corporate Wallet", section: "Commercial Desk" },
      { path: "/dashboard/charter/operator-portal", label: "Operator Portal", section: "Partner Management" },
      { path: "/dashboard/admin/charter-booking-audit", label: "Booking Change Audit", section: "Assurance" },
      { path: "/dashboard/admin/charter-retry-timeline", label: "Payment Retry Timeline", section: "Assurance" },
    ],
  },
  {
    key: "fleet",
    title: "Fleet",
    icon: "Truck",
    description: "Vehicles, maintenance, inspection, assignments, fleet analytics.",
    roles: ["admin", "super_admin", "compliance_admin"],
    overviewPath: "/dashboard/admin/fleet-center",
    kpis: ["vehicles_active", "maintenance_due", "inspections_pending", "utilization"],
    items: [
      { path: "/dashboard/admin/fleet-center", label: "Fleet Hub", section: "Overview" },
      { path: "/dashboard/admin/fleet", label: "Fleet Directory", section: "Assets" },
    ],
  },
  {
    key: "finance",
    title: "Finance",
    icon: "Wallet",
    description: "Single source of financial truth — wallets, payments, tax, ledgers.",
    roles: ["admin", "super_admin", "finance_admin"],
    overviewPath: "/dashboard/admin/finance-center",
    kpis: ["revenue_today", "settlement_queue", "payment_success_rate", "failed_payments"],
    items: [
      { path: "/dashboard/admin/finance-center", label: "Finance Overview", section: "Overview" },
      { path: "/dashboard/admin/payments", label: "Payments", section: "Payments" },
      { path: "/dashboard/admin/mpesa", label: "M-Pesa", section: "Payments" },
      { path: "/dashboard/admin/wallets", label: "Wallets", section: "Payments" },
      { path: "/dashboard/admin/refunds", label: "Refunds & Disputes", section: "Payments" },
      { path: "/dashboard/admin/payment-ops", label: "Payment Operations", section: "Payment Reliability" },
      { path: "/dashboard/admin/payment-journey", label: "Payment Journey", section: "Payment Reliability" },
      { path: "/dashboard/admin/payment-certification", label: "Payment Certification", section: "Payment Reliability" },
      { path: "/dashboard/admin/payment-dlq", label: "Payment DLQ", section: "Payment Reliability" },
      { path: "/dashboard/admin/reconciliation", label: "Reconciliation", section: "Reconciliation & Tax" },
      { path: "/dashboard/admin/reconciliation-mismatches", label: "Recon Mismatches", section: "Reconciliation & Tax" },
      { path: "/dashboard/admin/paybill-proofs", label: "Paybill Proofs", section: "Reconciliation & Tax" },
      { path: "/dashboard/admin/tax", label: "Tax Center", section: "Reconciliation & Tax" },
    ],
  },
  {
    key: "trust_safety",
    title: "Trust & Safety",
    icon: "ShieldCheck",
    description: "Fraud, identity, KYC/KYB, investigations, governance, audit.",
    roles: ["admin", "super_admin", "compliance_admin"],
    overviewPath: "/dashboard/admin/trust-center",
    kpis: ["fraud_open", "kyc_pending", "policy_exceptions", "audit_streak"],
    items: [
      { path: "/dashboard/admin/trust-center", label: "Trust Center", section: "Overview" },
      { path: "/dashboard/admin/trust-console", label: "Trust Console", section: "Overview" },
      { path: "/dashboard/admin/fraud-center", label: "Fraud Intelligence", section: "Fraud" },
      { path: "/dashboard/admin/fraud-cases", label: "Fraud Cases", section: "Fraud" },
      { path: "/dashboard/admin/delivery-fraud", label: "Delivery Fraud", section: "Fraud" },
      { path: "/dashboard/admin/identity-assurance", label: "Identity Assurance", section: "Identity & KYC" },
      { path: "/dashboard/admin/kyc-types", label: "KYC Requirements", section: "Identity & KYC" },
      { path: "/dashboard/admin/corporate-kyb", label: "Corporate KYB", section: "Identity & KYC" },
      { path: "/dashboard/admin/corporate-kyb/audit", label: "KYB Audit Log", section: "Identity & KYC" },
      { path: "/dashboard/admin/compliance", label: "Compliance Center", section: "Compliance" },
      { path: "/dashboard/admin/compliance-alerts", label: "Compliance Alerts", section: "Compliance" },
      { path: "/dashboard/admin/governance", label: "Governance", section: "Policy & Governance" },
      { path: "/dashboard/admin/policy-assurance", label: "Policy Assurance", section: "Policy & Governance" },
      { path: "/dashboard/admin/policy-exceptions", label: "Policy Exceptions", section: "Policy & Governance" },
      { path: "/dashboard/admin/policy-alerts", label: "Policy Alerts", section: "Policy & Governance" },
      { path: "/dashboard/admin/assurance", label: "Assurance", section: "Policy & Governance" },
      { path: "/dashboard/admin/security-findings", label: "Security Findings", section: "Security" },
      { path: "/dashboard/admin/security-audit", label: "Security Audit", section: "Security" },
      { path: "/dashboard/admin/access-denials", label: "Access Denials", section: "Security" },
      { path: "/dashboard/admin/privileged-updates", label: "Privileged Updates", section: "Security" },
      { path: "/dashboard/admin/privileged-metrics", label: "Privileged Metrics", section: "Security" },
      { path: "/dashboard/admin/integrity-report", label: "Integrity Report", section: "Integrity & Audit" },
      { path: "/dashboard/admin/integrity-gates", label: "Integrity Gates", section: "Integrity & Audit" },
      { path: "/dashboard/admin/production-readiness", label: "Production Readiness", section: "Integrity & Audit" },
      { path: "/dashboard/admin/integrity-audit", label: "Threshold Audit", section: "Integrity & Audit" },
      { path: "/dashboard/admin/audit-log", label: "Admin Audit Log", section: "Integrity & Audit" },
      { path: "/dashboard/admin/audit-schedules", label: "Audit Schedules", section: "Integrity & Audit" },
      { path: "/dashboard/admin/export-audit-trail", label: "Export Audit Trail", section: "Integrity & Audit" },
    ],
  },
  {
    key: "analytics_ai",
    title: "Analytics & AI",
    icon: "Brain",
    description: "Business intelligence, predictive analytics, and ML.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin/intelligence",
    kpis: ["reports_ready", "models_deployed", "ai_confidence_avg"],
    items: [
      { path: "/dashboard/admin/intelligence", label: "Intelligence Hub", section: "Overview" },
      { path: "/dashboard/admin/analytics-export", label: "Analytics Export", section: "Reporting" },
      { path: "/dashboard/admin/ml-platform", label: "ML Platform", section: "Models" },
      { path: "/dashboard/admin/digital-twin", label: "Digital Twin", section: "Models" },
    ],
  },
  {
    key: "administration",
    title: "Administration",
    icon: "UserCog",
    description: "Users, roles, permissions, org structure, approval workflows.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin",
    kpis: ["total_users", "active_roles", "pending_approvals"],
    items: [
      { path: "/dashboard/admin", label: "Admin Overview", section: "Overview" },
      { path: "/dashboard/admin/users", label: "Users", section: "Access" },
      { path: "/dashboard/admin/roles", label: "Roles", section: "Access" },
      { path: "/dashboard/admin/staff", label: "Staff & Permissions", section: "Access" },
      { path: "/dashboard/admin/business-operations", label: "Business Operations", section: "Operations" },
    ],
  },
  {
    key: "platform",
    title: "Platform",
    icon: "Settings",
    description: "System health, integrations, jobs, configuration, developer tooling.",
    roles: ["admin", "super_admin"],
    overviewPath: "/dashboard/admin/system",
    kpis: ["system_health", "jobs_running", "queue_depth"],
    items: [
      { path: "/dashboard/admin/system", label: "System Hub", section: "Overview" },
      { path: "/dashboard/admin/backend", label: "Backend Operations", section: "Overview" },
      { path: "/dashboard/admin/users", label: "Users", section: "Access" },
      { path: "/dashboard/admin/email-delivery", label: "Emails", section: "Operations" },
      { path: "/dashboard/admin/scheduled-job-health", label: "Jobs", section: "Reliability" },
      { path: "/dashboard/admin/audit-log", label: "Logs", section: "Reliability" },
      { path: "/dashboard/admin/settings", label: "Platform Settings", section: "Configuration" },
      { path: "/dashboard/admin/alert-rules", label: "Alert Rules", section: "Configuration" },
      { path: "/dashboard/admin/alert-preferences", label: "Alert Preferences", section: "Configuration" },
      { path: "/dashboard/admin/observability", label: "Observability", section: "Reliability" },
      { path: "/dashboard/admin/outbox", label: "Outbox Monitor", section: "Reliability" },
      { path: "/dashboard/admin/outbox-dlq", label: "Outbox DLQ", section: "Reliability" },
      { path: "/dashboard/admin/event-outbox", label: "Event Outbox", section: "Reliability" },
      { path: "/dashboard/admin/navigation-health", label: "Navigation Health", section: "Developer Tooling" },
      { path: "/dashboard/admin/navigation-governance", label: "Navigation Governance", section: "Developer Tooling" },
      { path: "/dashboard/admin/rename-backfill-monitor", label: "Rename Monitor", section: "Developer Tooling" },
      { path: "/dashboard/admin/access-debug", label: "Access Debug", section: "Developer Tooling" },
    ],
  },
  {
    key: "super_admin",
    title: "Super Admin",
    icon: "Shield",
    description: "Tenant, environment, and emergency controls.",
    roles: ["super_admin"],
    overviewPath: "/dashboard/admin/super",
    kpis: ["tenants", "environments", "critical_flags"],
    items: [
      { path: "/dashboard/admin/super", label: "Backend Operations Centre", section: "Overview" },
      { path: "/dashboard/admin/backend", label: "Database, Functions & Usage", section: "Platform" },
      { path: "/dashboard/admin/users", label: "Users", section: "Access" },
      { path: "/dashboard/admin/email-delivery", label: "Emails", section: "Operations" },
      { path: "/dashboard/admin/scheduled-job-health", label: "Jobs", section: "Operations" },
      { path: "/dashboard/admin/audit-log", label: "Logs", section: "Assurance" },
    ],
  },
];

export const WORKSPACES_BY_KEY = new Map(WORKSPACES.map(w => [w.key, w]));

/** Fail-fast dev-time guard: every workspace item must point at a real route. */
if (import.meta.env?.DEV) {
  for (const w of WORKSPACES) {
    for (const it of w.items) {
      // Deep-link items may carry query/hash suffixes — governance resolves
      // reachability on the canonical path.
      if (!ROUTE_BY_PATH.has(it.path.split("?")[0].split("#")[0])) {

        console.warn(`[YEOS] Workspace "${w.key}" references unknown route: ${it.path}`);
      }
    }
    if (!ROUTE_BY_PATH.has(w.overviewPath)) {
      console.warn(`[YEOS] Workspace "${w.key}" overview points at unknown route: ${w.overviewPath}`);
    }
  }
}

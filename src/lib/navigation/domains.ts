/**
 * TaxiD — Business Domain Navigation Layer (IA v5).
 *
 * The sidebar is a navigation instrument, not a database table. This file adds
 * ONE layer above the existing 14 YEOS workspaces so the rail exposes exactly
 * eight business domains:
 *
 *   Admin · Riders · Drivers · Charter & Business · Delivery & Logistics ·
 *   Leasing & Rentals · Payments & Finance · Settings
 *
 * Rules:
 *   1. No routes are created, renamed or deleted here — every destination is
 *      still owned by src/lib/routes.ts and grouped by
 *      src/lib/workspaces/config.ts. This layer only decides which domain owns
 *      which workspace, so nothing becomes an orphan.
 *   2. `workspaces` = whole workspaces absorbed by the domain.
 *   3. `claims` = individual destinations pulled out of another workspace into
 *      this domain (e.g. rider pages living inside People & Partners). A
 *      claimed path is rendered ONLY in the claiming domain — one feature, one
 *      canonical location.
 *   4. `landing` = the domain's canonical command dashboard (an existing route).
 */
import { CORPORATE_CONTROL_PATHS } from "@/lib/navigation/corporateControls";
import type { WorkspaceKey } from "@/lib/workspaces/types";
import type { AppRole } from "@/lib/routes";

export type DomainKey =
  | "admin"
  | "riders"
  | "drivers"
  | "charter_business"
  | "delivery_logistics"
  | "leasing_rentals"
  | "payments_finance"
  | "settings";

export interface DomainClaim {
  /** Section header rendered above the claimed items. */
  section: string;
  /** Exact route paths (may carry a query string) claimed from other workspaces. */
  paths: string[];
}

export interface DomainDefinition {
  key: DomainKey;
  label: string;
  /** One-line business description shown under the domain label. */
  sublabel: string;
  /** lucide-react icon name (resolved by the sidebar icon map). */
  icon: string;
  /** Canonical command dashboard for the domain. Must exist in ROUTES. */
  landing: string;
  /** Roles allowed to see the domain at all. Empty = any authenticated user. */
  roles: AppRole[];
  workspaces: WorkspaceKey[];
  claims?: DomainClaim[];
}

export const DOMAINS: DomainDefinition[] = [
  {
    key: "admin",
    label: "Admin",
    sublabel: "Platform control & intelligence",
    icon: "Shield",
    landing: "/dashboard/admin/home",
    roles: ["admin", "super_admin", "finance_admin", "compliance_admin"],
    workspaces: [
      "executive",
      "operations",
      "people_partners",
      // Commercial & Pricing sits between People & Partners and Trust & Safety.
      "commercial_pricing",
      "trust_safety",
      "analytics_ai",
      "administration",
      "platform",
      "super_admin",
    ],
  },
  {
    key: "riders",
    label: "Riders",
    sublabel: "Customers & journeys",
    icon: "Users",
    landing: "/dashboard/admin/riders-center",
    roles: ["admin", "super_admin"],
    workspaces: [],
    claims: [
      {
        section: "Rider Command",
        paths: [
          "/dashboard/admin/riders-center",
          "/dashboard/admin/rider-management",
          "/dashboard/admin/riders",
          "/dashboard/admin/rider-management?tab=trips",
          "/dashboard/admin/rider-management?tab=wallet",
          "/dashboard/admin/rider-management?tab=support",
        ],
      },
      {
        section: "Customer Care",
        paths: [
          "/dashboard/admin/customer-operations",
          "/dashboard/admin/contact-submissions",
        ],
      },
    ],
  },
  {
    key: "drivers",
    label: "Drivers",
    sublabel: "Driver network & compliance",
    icon: "UserCog",
    landing: "/dashboard/admin/drivers",
    roles: ["admin", "super_admin", "compliance_admin"],
    workspaces: [],
    claims: [
      {
        section: "Driver Command",
        paths: [
          "/dashboard/admin/drivers",
          "/dashboard/admin/lifecycle",
          "/dashboard/admin/document-queue",
          "/dashboard/admin/academy",
        ],
      },
    ],
  },
  {
    key: "charter_business",
    label: "Charter & Business",
    sublabel: "Corporate mobility & charter",
    icon: "Briefcase",
    landing: "/dashboard/corporate-charter",
    roles: ["admin", "super_admin", "finance_admin", "compliance_admin"],
    workspaces: ["charter_rentals", "flight_hub"],
    claims: [
      {
        section: "Corporate Accounts",
        paths: [
          // NOTE: /dashboard/corporate is the CUSTOMER portal (corporate_admin /
          // corporate_employee only). Admin staff reach corporate accounts through
          // the admin surfaces below — never through the customer portal route.
          "/dashboard/admin/corporate-center",
          "/dashboard/admin/corporates",
        ],
      },
      {
        // Business controls moved here from the public Business/Charter header.
        section: "Corporate Controls",
        paths: [...CORPORATE_CONTROL_PATHS],
      },
    ],
  },
  {
    key: "delivery_logistics",
    label: "Delivery & Logistics",
    sublabel: "Delivery operations",
    icon: "Package",
    landing: "/dashboard/admin/logistics-center",
    roles: ["admin", "super_admin"],
    workspaces: ["delivery_logistics"],
  },
  {
    key: "leasing_rentals",
    label: "Leasing & Rentals",
    sublabel: "Fleet utilization & contracts",
    icon: "Car",
    landing: "/dashboard/admin/fleet-center",
    roles: ["admin", "super_admin", "compliance_admin"],
    workspaces: ["fleet", "marketplace"],
  },
  {
    key: "payments_finance",
    label: "Payments & Finance",
    sublabel: "Revenue, wallets & settlements",
    icon: "Wallet",
    landing: "/dashboard/admin/finance-center",
    roles: ["admin", "super_admin", "finance_admin"],
    workspaces: ["finance"],
  },
  {
    key: "settings",
    label: "Settings",
    sublabel: "Platform configuration",
    icon: "Settings",
    landing: "/dashboard/admin/settings",
    roles: ["admin", "super_admin"],
    workspaces: [],
    claims: [
      {
        section: "Configuration",
        paths: [
          "/dashboard/admin/settings",
          "/dashboard/admin/alert-rules",
          "/dashboard/admin/alert-preferences",
        ],
      },
      {
        section: "Access",
        paths: [
          "/dashboard/admin/users",
          "/dashboard/admin/roles",
          "/dashboard/admin/staff",
        ],
      },
    ],
  },
];

export const DOMAIN_BY_KEY = new Map(DOMAINS.map((d) => [d.key, d]));

/**
 * Every path claimed by any domain. The renderer removes these from their
 * originating workspace so a destination appears exactly once in the rail.
 */
export const CLAIMED_PATHS = new Set<string>(
  DOMAINS.flatMap((d) => d.claims?.flatMap((c) => c.paths) ?? []),
);

/** The domain that owns a given workspace key (first match wins). */
export function domainForWorkspace(key: WorkspaceKey): DomainKey | undefined {
  return DOMAINS.find((d) => d.workspaces.includes(key))?.key;
}

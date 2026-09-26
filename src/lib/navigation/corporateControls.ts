/**
 * Corporate Controls — the SINGLE source of truth for the business control
 * surfaces (Travel Approvals, Cost Centres & Budgets, Corporate Wallet,
 * Policies & Budget Rules, Billing & Reports).
 *
 * These controls used to be promised from the public Charter/Business header.
 * They are governed administration surfaces, so:
 *   - they may ONLY render inside the authenticated admin / Super Admin rail,
 *   - visibility is decided here (`canViewCorporateControls`) and nowhere else,
 *   - the workspace registry and the domain rail both read this module, so a
 *     path can never drift between the two,
 *   - the legacy public destinations are listed so tests can assert they never
 *     return to the marketing header at any breakpoint.
 *
 * The server remains the authority: every destination is additionally gated by
 * the route registry (`rolesAllowed`) and RLS. This module only decides what the
 * chrome is allowed to OFFER.
 */
import { trackCta } from "@/lib/cta";

export type CorporateControlKey =
  | "travel_approvals"
  | "cost_centres"
  | "corporate_wallet"
  | "policies_budget_rules"
  | "billing_reports";

export interface CorporateControl {
  key: CorporateControlKey;
  /** Admin destination (may carry a `?tab=` deep link). */
  path: string;
  label: string;
  /** Section header used by the admin rail. */
  section: "Corporate Controls";
  /** Analytics id written to cta_events for click + open measurement. */
  analyticsId: string;
}

/** Roles authorised to see and use the corporate controls. */
export const CORPORATE_CONTROL_ROLES = ["admin", "super_admin", "finance_admin"] as const;

export const CORPORATE_CONTROLS: readonly CorporateControl[] = [
  {
    key: "travel_approvals",
    path: "/dashboard/admin/corporates/approvals",
    label: "Travel Approvals",
    section: "Corporate Controls",
    analyticsId: "corporate_controls_travel_approvals",
  },
  {
    key: "cost_centres",
    path: "/dashboard/admin/corporate-os?tab=accounts",
    label: "Cost Centres & Budgets",
    section: "Corporate Controls",
    analyticsId: "corporate_controls_cost_centres",
  },
  {
    key: "corporate_wallet",
    path: "/dashboard/admin/corporate-wallet-finance",
    label: "Corporate Wallet",
    section: "Corporate Controls",
    analyticsId: "corporate_controls_wallet",
  },
  {
    key: "policies_budget_rules",
    path: "/dashboard/corporate-charter?tab=policies",
    label: "Policies & Budget Rules",
    section: "Corporate Controls",
    analyticsId: "corporate_controls_policies",
  },
  {
    key: "billing_reports",
    path: "/dashboard/corporate-charter?tab=billing",
    label: "Billing & Reports",
    section: "Corporate Controls",
    analyticsId: "corporate_controls_billing",
  },
] as const;

/** Full hrefs (with deep-link query) of every corporate control. */
export const CORPORATE_CONTROL_PATHS = CORPORATE_CONTROLS.map((c) => c.path);

/**
 * Public destinations these controls were promised from before the migration.
 * They must never reappear in the marketing header, at any breakpoint.
 */
export const RETIRED_PUBLIC_CONTROL_PATHS = [
  "/dashboard/corporate/approvals",
  "/dashboard/corporate/expense-codes",
  "/dashboard/corporate/wallet",
  "/dashboard/corporate/policies",
  "/dashboard/corporate/invoicing",
] as const;

/** Labels as they appeared in the public "Business controls" group. */
export const RETIRED_PUBLIC_CONTROL_LABELS = CORPORATE_CONTROLS.map((c) => c.label);

/** THE gate: only admin-authority roles may be offered corporate controls. */
export function canViewCorporateControls(roles: readonly string[]): boolean {
  return CORPORATE_CONTROL_ROLES.some((r) => roles.includes(r));
}

/** Workspace-registry shape for the admin rail. */
export function corporateControlWorkspaceItems() {
  return CORPORATE_CONTROLS.map((c) => ({ path: c.path, label: c.label, section: c.section }));
}

export function isCorporateControlPath(href: string): boolean {
  return CORPORATE_CONTROL_PATHS.includes(href);
}

/** Resolves an href (or pathname + `?tab=`) onto a control, if any. */
export function corporateControlFor(href: string): CorporateControl | undefined {
  const direct = CORPORATE_CONTROLS.find((c) => c.path === href);
  if (direct) return direct;
  const [pathname, query = ""] = href.split("?");
  const tab = new URLSearchParams(query).get("tab");
  return CORPORATE_CONTROLS.find((c) => {
    const [cPath, cQuery = ""] = c.path.split("?");
    if (cPath !== pathname) return false;
    const cTab = new URLSearchParams(cQuery).get("tab");
    return cTab === tab;
  });
}

/** Rail click — measured separately from generic sidebar navigation. */
export function trackCorporateControlClick(control: CorporateControl): void {
  void trackCta({
    buttonName: `${control.analyticsId}_click`,
    actionType: "navigate",
    target: control.path,
    pageSource: "admin_rail_corporate_controls",
    metadata: { control: control.key, label: control.label, surface: "admin_rail" },
  });
}

/** Page open — fired once per landing on a corporate control destination. */
export function trackCorporateControlOpen(control: CorporateControl, pathnameWithQuery: string): void {
  void trackCta({
    buttonName: `${control.analyticsId}_open`,
    actionType: "navigate",
    target: pathnameWithQuery,
    pageSource: "corporate_controls",
    metadata: { control: control.key, label: control.label, surface: "page_open" },
  });
}

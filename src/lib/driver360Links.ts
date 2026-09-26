// Shared deep-link helper for the Driver 360 workspace.
// Keeps quick-action URL construction, tab validation, and analytics
// tracking consistent across DriverAdministration and Driver360.
import { logUiEvent } from "@/lib/navLog";

export const DRIVER360_TABS = [
  "overview",
  "wallet",
  "earnings",
  "withdrawals",
  "trips",
  "vehicles",
  "documents",
  "compliance",
  "performance",
  "academy",
  "support",
  "timeline",
  "twin",
] as const;

export type Driver360Tab = (typeof DRIVER360_TABS)[number];

export const DRIVER360_DEFAULT_TAB: Driver360Tab = "overview";

const TAB_SET: ReadonlySet<string> = new Set(DRIVER360_TABS);

export function isDriver360Tab(value: unknown): value is Driver360Tab {
  return typeof value === "string" && TAB_SET.has(value);
}

/** Coerce any ?tab= value to a valid Driver 360 tab, falling back to overview. */
export function normalizeDriver360Tab(value: unknown): Driver360Tab {
  return isDriver360Tab(value) ? value : DRIVER360_DEFAULT_TAB;
}

/**
 * Build a Driver 360 deep-link. `tab` is optional; when omitted or set to
 * the default overview tab, no ?tab= query is appended (cleaner URLs).
 */
export function driver360Path(driverId: string, tab?: Driver360Tab | null): string {
  const base = `/dashboard/admin/drivers/${driverId}`;
  if (!tab || tab === DRIVER360_DEFAULT_TAB) return base;
  return `${base}?tab=${tab}`;
}

/** Fire-and-forget analytics for a Driver 360 quick action click. */
export function trackDriver360QuickAction(
  driverId: string,
  tab: Driver360Tab,
  source: string,
): void {
  void logUiEvent({
    elementId: `driver360:quick-action:${tab}`,
    elementLabel: tab,
    action: "navigate",
    payload: { driverId, tab, source },
  });
}

/** Fire-and-forget analytics for landing on a Driver 360 tab. */
export function trackDriver360TabLanding(
  driverId: string,
  tab: Driver360Tab,
  requestedTab: string | null,
): void {
  void logUiEvent({
    elementId: `driver360:tab-landing:${tab}`,
    elementLabel: tab,
    action: "view",
    success: requestedTab === null || requestedTab === tab,
    errorMessage: requestedTab && requestedTab !== tab ? "INVALID_TAB_FALLBACK" : null,
    payload: { driverId, tab, requestedTab },
  });
}

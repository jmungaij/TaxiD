/**
 * Charter portal login-redirect analytics.
 *
 * Records which charter UI element initiated a corporate-login redirect and
 * which destination page was requested, so the funnel from marketing surface →
 * corporate login → portal page is attributable end to end.
 */
import { logUiEvent } from "@/lib/navLog";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { resolveLoginSource, resolvePostLoginTarget, splitPortalTarget } from "./portalRoutes";

/** Fired at the moment a signed-out visitor clicks a charter portal entry point. */
export function trackPortalLoginRedirect(source: string, target: string): void {
  const { pathname, search, hash } = splitPortalTarget(target);
  void logUiEvent({
    elementId: AnalyticsEvents.CHARTER_PORTAL_LOGIN_REDIRECT,
    elementLabel: source,
    action: "redirect",
    payload: { source, requested_path: pathname, requested_search: search, requested_hash: hash },
  });
}

/** Fired on the corporate login page so the requested destination is recorded. */
export function trackPortalLoginLanding(loginSearch: string): void {
  const target = resolvePostLoginTarget(loginSearch);
  void logUiEvent({
    elementId: AnalyticsEvents.CHARTER_PORTAL_LOGIN_REQUESTED_DESTINATION,
    elementLabel: resolveLoginSource(loginSearch) ?? "unknown",
    action: "view",
    payload: { source: resolveLoginSource(loginSearch), requested_destination: target },
  });
}

/** Fired when a signed-in user is blocked for lacking corporate entitlements. */
export function trackPortalPermissionBlocked(attempted: string, roles: string[]): void {
  void logUiEvent({
    elementId: AnalyticsEvents.CHARTER_PORTAL_PERMISSION_BLOCKED,
    elementLabel: attempted,
    action: "blocked",
    payload: { attempted, roles },
  });
}

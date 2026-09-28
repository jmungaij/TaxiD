/**
 * Staff Access post-authentication routing.
 *
 * Authentication answers "who are you?"; this module answers "where may you
 * land?". It never grants access: every destination is still re-checked by
 * RequireStaffPortal (identity) and by RLS / SECURITY DEFINER RPCs server-side.
 */

import { STAFF_ROLES } from "@/lib/staff/access";
import { homeForRoles } from "@/lib/staff/rbacMatrix";


/** Corporate identity domain for TaxiD staff logins (advisory hint only — the
 *  authoritative check is account existence + status + role, server-side). */
export const STAFF_EMAIL_DOMAIN = "taxid.us";

export function looksLikeStaffEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

/** Only same-origin, non-auth paths may be used as a redirect target. */
export function sanitizeStaffRedirect(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/auth") || raw.startsWith("/staff/access")) return null;
  return raw;
}

/**
 * Authorized landing surface implied by the granted roles.
 * Delegates to the RBAC matrix so the gateway, the routing and the offered
 * dashboards can never disagree. Identity-only staff (no platform role) land
 * in their personal cockpit; the guard confirms the staff register link first.
 */
export function staffLandingForRoles(roles: readonly string[]): string {
  return homeForRoles(roles);
}


/** True when any held role is a recognised staff platform role. */
export function hasStaffPlatformRole(roles: readonly string[]): boolean {
  return roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
}

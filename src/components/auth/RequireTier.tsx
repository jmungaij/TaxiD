/**
 * Elite Premium tier gate.
 *
 * Wraps a route and requires both authentication and a minimum platform tier.
 * Ineligible users are redirected gracefully to the upgrade surface (never a
 * hard 403 wall), carrying the attempted path so the page can explain exactly
 * what was blocked and how to obtain access.
 */
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { logAccessDenial, logNavigation } from "@/lib/navLog";
import {
  meetsTier, requiredTierFor, tierFromRoles, type PlatformTier,
} from "@/lib/platform/entitlements";
import {
  corporateLoginHref,
  isCharterPortalPath,
  CORPORATE_ACCESS_REQUIRED_PATH,
} from "@/lib/charter/portalRoutes";
import { trackPortalLoginRedirect } from "@/lib/charter/portalAnalytics";

interface Props {
  children: ReactNode;
  /** Explicit minimum tier; otherwise derived from the current path. */
  tier?: PlatformTier;
}

export function RequireTier({ children, tier }: Props) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const attempted = location.pathname + location.search + location.hash;
  const isCharter =
    isCharterPortalPath(location.pathname) || location.pathname.startsWith("/dashboard/corporate-charter");

  if (!user) {
    void logNavigation({ route: location.pathname, success: false, errorMessage: "NOT_AUTHENTICATED" });
    // Charter/corporate surfaces must never fall through to the admin portal.
    if (isCharter) {
      trackPortalLoginRedirect("tier_guard", attempted);
      return <Navigate to={corporateLoginHref(attempted, "tier_guard")} replace />;
    }
    return <Navigate to={`/auth?redirect=${encodeURIComponent(attempted)}`} replace />;
  }

  const required = tier ?? requiredTierFor(location.pathname);
  const userTier = tierFromRoles(roles);

  if (!meetsTier(userTier, required)) {
    void logNavigation({ route: location.pathname, success: false, errorMessage: "TIER_NOT_ENTITLED" });
    void logAccessDenial({
      surface: "route",
      requestedPath: location.pathname,
      reason: "tier_not_entitled",
      requiredRoles: [required],
      userRoles: roles,
      riskScore: 15,
    });
    if (isCharter) {
      return (
        <Navigate
          to={`${CORPORATE_ACCESS_REQUIRED_PATH}?reason=tier&attempted=${encodeURIComponent(attempted)}`}
          replace
          state={{ attempted }}
        />
      );
    }
    return (
      <Navigate
        to={`/dashboard/premium/upgrade?from=${encodeURIComponent(location.pathname + location.search)}&tier=${required}`}
        replace
      />
    );
  }

  return <>{children}</>;
}

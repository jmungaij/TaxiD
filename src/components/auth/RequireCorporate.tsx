import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  corporateLoginHref,
  CORPORATE_ACCESS_REQUIRED_PATH,
  isCharterPortalPath,
} from "@/lib/charter/portalRoutes";
import { trackPortalLoginRedirect } from "@/lib/charter/portalAnalytics";

const CORPORATE_ROLES = ["corporate_admin", "corporate_employee", "admin", "super_admin"];


/**
 * Guard for corporate dashboard routes.
 * - Unauthenticated users are redirected to /corporate/login (with redirect param
 *   preserving the full path *and* query string, so quote-lead deep links survive).
 * - Authenticated users lacking a corporate role are sent to /unauthorized,
 *   unless `anyAuthenticated` is set (self-service surfaces such as the charter
 *   business portal, where any signed-in customer may plan a private booking).
 */
export function RequireCorporate({
  children,
  anyAuthenticated = false,
}: {
  children: ReactNode;
  anyAuthenticated?: boolean;
}) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  // Full location context (path + query + hash) survives the login round-trip.
  const attempted = location.pathname + location.search + location.hash;

  if (!user) {
    trackPortalLoginRedirect("route_guard", attempted);
    return <Navigate to={corporateLoginHref(attempted, "route_guard")} replace />;
  }

  const allowed = anyAuthenticated || roles.some((r) => CORPORATE_ROLES.includes(r));
  if (!allowed) {
    // Signed-in users always get the corporate upgrade/blocked screen for
    // charter surfaces — never the generic admin /unauthorized page.
    const to = isCharterPortalPath(location.pathname)
      ? CORPORATE_ACCESS_REQUIRED_PATH
      : "/unauthorized";
    return <Navigate to={to} replace state={{ attempted }} />;
  }



  return <>{children}</>;
}

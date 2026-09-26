import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, routeFor } from "@/lib/routes";
import { Skeleton } from "@/components/ui/skeleton";
import { logNavigation, logAccessDenial } from "@/lib/navLog";
import { authzLog } from "@/lib/authzLog";
import { recordAuthRedirect, signInUrl } from "@/lib/auth/authDiagnostics";

interface Props {
  children: ReactNode;
  /** Optional explicit override; otherwise derived from current path. */
  roles?: string[];
}

export function RequireRole({ children, roles: explicit }: Props) {
  const { user, loading, roles, rolesError } = useAuth();
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

  if (!user) {
    authzLog("route_denied", {
      path: location.pathname,
      reason: "not_authenticated",
      required_roles: explicit ?? routeFor(location.pathname)?.rolesAllowed ?? [],
    });
    void logNavigation({ route: location.pathname, success: false, errorMessage: "NOT_AUTHENTICATED" });
    void logAccessDenial({
      surface: "route",
      requestedPath: location.pathname,
      reason: "not_authenticated",
      requiredRoles: explicit ?? routeFor(location.pathname)?.rolesAllowed ?? [],
      userRoles: [],
      riskScore: 10,
    });
    // Canonical auth diagnostic + preserved return path. Authentication failures
    // come here; authorization failures never do (see /unauthorized below).
    recordAuthRedirect({
      route: location.pathname,
      requestedRoute: `${location.pathname}${location.search}`,
      reason: "NO_SESSION",
      redirectDestination: "/auth",
      sessionExists: false,
      requiredRole: explicit ?? routeFor(location.pathname)?.rolesAllowed ?? [],
      actualRole: [],
    });
    return <Navigate to={signInUrl(`${location.pathname}${location.search}`, "NO_SESSION")} replace />;
  }

  const route = routeFor(location.pathname);
  const requiredRoles = explicit ?? route?.rolesAllowed ?? [];
  const allowed = roles.includes("super_admin")
    ? true
    : explicit
      ? explicit.some(r => roles.includes(r))
      : canAccess(route, roles);


  if (!allowed) {
    authzLog("route_denied", {
      path: location.pathname,
      reason: "forbidden_for_role",
      user_id: user.id,
      email: user.email,
      user_roles: roles,
      required_roles: requiredRoles,
      roles_query_error: rolesError,
    });
    void logNavigation({ route: location.pathname, success: false, errorMessage: "FORBIDDEN_FOR_ROLE" });
    void logAccessDenial({
      surface: "route",
      requestedPath: location.pathname,
      reason: "forbidden_for_role",
      requiredRoles,
      userRoles: roles,
      riskScore: 35,
    });
    recordAuthRedirect({
      route: location.pathname,
      requestedRoute: `${location.pathname}${location.search}`,
      reason: "ROLE_REQUIRED",
      redirectDestination: "/unauthorized",
      sessionExists: true,
      userId: user.id,
      requiredRole: requiredRoles,
      actualRole: roles,
    });
    return <Navigate to="/unauthorized" replace state={{ attempted: location.pathname }} />;
  }

  authzLog("route_allowed", {
    path: location.pathname,
    user_id: user.id,
    email: user.email,
    user_roles: roles,
    required_roles: requiredRoles,
  });
  return <>{children}</>;
}

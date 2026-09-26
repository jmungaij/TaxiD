import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { logNavigation } from "@/lib/navLog";
import { routeFor, canAccess } from "@/lib/routes";
import { useAuth } from "@/hooks/useAuth";

/**
 * Mounted once inside <BrowserRouter>. Logs every route change to
 * navigation_logs with success=false when the path has no matching route or
 * the user lacks the required role.
 */
export function NavigationTracker() {
  const location = useLocation();
  const { roles, loading } = useAuth();
  const prevPath = useRef<string | null>(null);
  const startedAt = useRef<number>(performance.now());

  useEffect(() => {
    if (loading) return;
    const path = location.pathname;
    const route = routeFor(path);
    const success = !!route && canAccess(route, roles);
    const error = !route
      ? "ROUTE_NOT_REGISTERED"
      : !canAccess(route, roles)
        ? "FORBIDDEN_FOR_ROLE"
        : null;

    void logNavigation({
      route: path,
      fromRoute: prevPath.current,
      success,
      errorMessage: error,
      durationMs: Math.round(performance.now() - startedAt.current),
    });

    prevPath.current = path;
    startedAt.current = performance.now();
  }, [location.pathname, roles, loading]);

  return null;
}

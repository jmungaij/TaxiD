import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Phase D5.1 — Internal engineering banner.
 *
 * Visibility rules (Workstream 1 — Internal UI Isolation):
 *   SHOW iff  authenticated
 *          AND role ∈ {super_admin, admin, ops, finance, compliance, finance_admin, ops_admin}
 *          AND STABILIZATION_MODE = true
 *
 * Never rendered on public/marketing routes, auth pages, rider/driver flows,
 * public trip-share pages, or for anonymous users — regardless of flag state.
 */
const ADMIN_ROLES = new Set([
  "super_admin",
  "admin",
  "ops",
  "ops_admin",
  "finance",
  "finance_admin",
  "compliance",
]);

// Explicit deny-list for customer-facing surfaces. Any path matching one of
// these prefixes never renders engineering banners, even if the viewer
// happens to also hold an admin role.
const PUBLIC_PATH_PREFIXES = [
  "/auth",
  "/login",
  "/signup",
  "/reset-password",
  "/unsubscribe",
  "/t/", // public trip share
  "/trip-share",
  "/track",
  "/rider",
  "/driver",
  "/corporate/login",
  "/corporate/register",
];

function isPublicSurface(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname === p.replace(/\/$/, ""));
}

export function StabilizationBanner() {
  const { user, roles, loading } = useAuth();
  const location = useLocation();
  const [active, setActive] = useState(false);

  const isAdminRole = roles.some((r) => ADMIN_ROLES.has(r));
  const eligible = !loading && !!user && isAdminRole && !isPublicSurface(location.pathname);

  useEffect(() => {
    if (!eligible) {
      setActive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("is_stabilization_mode");
      if (!cancelled) setActive(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  if (!eligible || !active) return null;

  return (
    <div
      role="status"
      data-testid="stabilization-banner"
      className="sticky top-0 z-[60] w-full border-b border-status-warning/60 bg-status-warning/10 text-status-warning dark:border-status-warning/40 dark:bg-status-warning/60 dark:text-status-warning"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Stabilization Mode active</span>
        <span className="opacity-80">
          — Internal engineering notice. New payment features, dashboards, and orchestrator promotion are frozen until
          exit criteria are met.
        </span>
      </div>
    </div>
  );
}

export default StabilizationBanner;

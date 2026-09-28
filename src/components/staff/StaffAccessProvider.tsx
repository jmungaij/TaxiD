/**
 * STAFF PORTAL ACCESS — entry is granted by IDENTITY, not only by platform role.
 *
 * Two legitimate ways into the staff portal:
 *   1. a platform staff role (admin, finance_admin, operations_manager, …), or
 *   2. a canonical staff record linked to the signed-in login.
 *
 * (2) is what lets an ordinary employee reach My Workspace. It grants the
 * "self" scope only: every wider surface still needs a platform role, and every
 * read remains RLS-scoped server-side. This component decides what the chrome
 * OFFERS — it is never the enforcement boundary.
 */
import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { authzLog } from "@/lib/authzLog";
import { canEnterStaffPortal, scopesForRoles, type StaffScope } from "@/lib/staff/access";
import { fetchMyStaffIdentity, type MyStaffIdentity } from "@/lib/workspace/api";

export interface StaffAccess {
  /** Resolved staff identity, or null while unresolved. */
  identity: MyStaffIdentity | null;
  /** Scopes the chrome may offer. Identity-only staff get {"self"}. */
  scopes: Set<StaffScope>;
  /** True when entry came from a platform staff role. */
  privileged: boolean;
  reload: () => void;
}

const StaffAccessContext = React.createContext<StaffAccess | null>(null);

export function useStaffAccess(): StaffAccess {
  const ctx = React.useContext(StaffAccessContext);
  if (!ctx) throw new Error("useStaffAccess must be used inside RequireStaffPortal");
  return ctx;
}

export function RequireStaffPortal({ children }: { children: React.ReactNode }) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();
  const [identity, setIdentity] = React.useState<MyStaffIdentity | null>(null);
  const [resolving, setResolving] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  const privileged = canEnterStaffPortal(roles);

  React.useEffect(() => {
    if (loading || !user) return;
    let live = true;
    setResolving(true);
    void fetchMyStaffIdentity(user.id)
      .then((res) => live && setIdentity(res))
      .finally(() => live && setResolving(false));
    return () => {
      live = false;
    };
  }, [loading, user, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  const value = React.useMemo<StaffAccess>(() => {
    const scopes = scopesForRoles(roles);
    if (scopes.size === 0 && identity?.status === "linked") scopes.add("self");
    return { identity, scopes, privileged, reload };
  }, [identity, privileged, roles, reload]);

  if (loading || (user && resolving && !privileged)) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const allowed = privileged || identity?.status === "linked";

  if (!allowed) {
    authzLog("route_denied", {
      path: location.pathname,
      reason: "no_staff_identity",
      user_id: user.id,
      email: user.email,
      user_roles: roles,
      required_roles: ["staff_identity"],
    });
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card className="border-warning/40">
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Staff portal unavailable
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              This login is not on the TaxiD staff register.
            </h1>
            <p className="text-sm text-muted-foreground">
              The staff portal opens automatically once your employee record carries your verified
              work email address. Nothing has been substituted in its place.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={reload}>
                Try again
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="mailto:support@taxid.us?subject=Staff%20portal%20access">
                  Contact administrator
                </a>
              </Button>
            </div>
            {identity?.diagnosticRef && (
              <p className="text-xs text-muted-foreground">
                Reference for your administrator:{" "}
                <span className="font-mono">{identity.diagnosticRef}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <StaffAccessContext.Provider value={value}>{children}</StaffAccessContext.Provider>;
}

export default RequireStaffPortal;

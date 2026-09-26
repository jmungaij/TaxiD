/**
 * Consistent corporate entitlement upgrade / blocked screen.
 *
 * Every charter UI permission denial for a SIGNED-IN user routes here (instead
 * of the generic /unauthorized admin screen) so the message is always: what is
 * blocked, why, and the next step (request access or upgrade the plan).
 */
import { useEffect, useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Building2, ArrowLeft } from "lucide-react";
import { AccessNotice } from "@/components/auth/AccessNotice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { trackPortalPermissionBlocked } from "@/lib/charter/portalAnalytics";
import { CHARTER_PORTAL_PATH } from "@/lib/charter/portalRoutes";

export default function CorporateAccessRequired() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { roles } = useAuth();
  const attempted =
    (location.state as { attempted?: string } | null)?.attempted ??
    params.get("attempted") ??
    CHARTER_PORTAL_PATH;
  const reason = params.get("reason") ?? "role";
  const ref = useMemo(
    () => `CORP-403-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    [],
  );

  useEffect(() => {
    trackPortalPermissionBlocked(attempted, roles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempted]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Corporate access required</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in, but this charter workspace needs corporate entitlements.
            </p>
          </div>
        </div>

        {reason === "tier" ? (
          <AccessNotice
            kind="tier"
            title="Elite Premium plan required"
            description="Charter mission planning, procurement and settlement are part of the Elite Premium corporate plan. Upgrade to unlock this workspace."
            actionTo="/dashboard/premium/upgrade"
            actionLabel="See plans and upgrade"
          />
        ) : (
          <AccessNotice
            kind="role"
            title="Corporate role not assigned"
            description="Ask your corporate administrator to add you to your organization as a corporate admin or employee. Access is granted instantly once the role is assigned."
            actionTo="/dashboard/premium/upgrade"
            actionLabel="Review corporate plans"
          />
        )}

        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono">
          Reference: <span className="font-semibold">{ref}</span>
          <div className="mt-1 truncate text-muted-foreground">Requested: {attempted}</div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link to="/charter">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back to charter
            </Link>
          </Button>
          <Button asChild>
            <a href="mailto:sales@safarid.org?subject=Corporate%20charter%20access%20request">
              Request access
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

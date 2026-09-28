import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShieldAlert, Home, LifeBuoy, Building2 } from "lucide-react";

function makeRef() {
  const a = Math.random().toString(16).slice(2, 10).toUpperCase();
  return `AUTH-403-${a}`;
}

export default function Unauthorized() {
  const loc = useLocation();
  const ref = useMemo(makeRef, []);
  const attempted = (loc.state as { attempted?: string } | null)?.attempted ?? loc.pathname;
  const isCorporate = attempted.startsWith("/dashboard/corporate") || attempted.startsWith("/corporate");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border bg-card shadow-sm p-8 text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">
            {isCorporate ? "Corporate Access Required" : "Access Restricted"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isCorporate
              ? "This area is limited to authorized corporate accounts. Your user is signed in but does not have a corporate role (corporate_admin or corporate_employee) assigned. Please contact your corporate administrator to be added to your organization."
              : "You do not have sufficient privileges to access this area."}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono">
          Reference: <span className="font-semibold">{ref}</span>
          <div className="text-muted-foreground mt-1 truncate">Route: {attempted}</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Contact your administrator if you believe this is an error.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {isCorporate ? (
            <Link
              to="/corporate/login"
              className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              <Building2 className="h-4 w-4" /> Corporate sign in
            </Link>
          ) : (
            <Link to="/" className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-muted">
              <Home className="h-4 w-4" /> Return Home
            </Link>
          )}
          <a href={`mailto:support@taxid.us?subject=Access%20issue%20%E2%80%93%20${ref}`}
             className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm hover:opacity-90">
            <LifeBuoy className="h-4 w-4" /> Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}


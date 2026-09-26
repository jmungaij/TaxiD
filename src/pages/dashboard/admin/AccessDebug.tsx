import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getAuthzTrace, authzTraceCorrelationId, type AuthzEntry } from "@/lib/authzLog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, ShieldCheck, ShieldX, Copy, Download } from "lucide-react";

const KYB_REQUIRED = ["admin", "super_admin", "compliance_admin"];

export default function AccessDebug() {
  const { user, loading, roles, rolesError, refreshRoles } = useAuth();
  const [trace, setTrace] = useState<AuthzEntry[]>(getAuthzTrace());
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const onLog = () => setTrace(getAuthzTrace());
    window.addEventListener("authz-log", onLog);
    return () => window.removeEventListener("authz-log", onLog);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return setClaims(null);
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        // Only surface non-sensitive claims.
        setClaims({
          sub: payload.sub,
          email: payload.email,
          role: payload.role,
          aal: payload.aal,
          session_id: payload.session_id,
          exp: new Date(payload.exp * 1000).toISOString(),
          app_metadata: payload.app_metadata,
        });
      } catch {
        setClaims(null);
      }
    });
  }, [user]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading auth state…</div>;

  const kybAllowed = KYB_REQUIRED.some((r) => roles.includes(r));

  const buildExport = () => ({
    exported_at: new Date().toISOString(),
    correlation_id: authzTraceCorrelationId,
    user: user ? { id: user.id, email: user.email, email_confirmed: !!user.email_confirmed_at } : null,
    jwt_claims: claims,
    detected_roles: roles,
    roles_error: rolesError ?? null,
    kyb_access: kybAllowed ? "allowed" : "denied",
    authz_trace: getAuthzTrace(),
  });

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildExport(), null, 2));
      toast({ title: "Copied", description: "Authz trace + claims copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard unavailable — use Download instead.", variant: "destructive" });
    }
  };

  const downloadTrace = () => {
    const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `authz-trace-${authzTraceCorrelationId.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4" data-testid="access-debug-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Access Debug</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyTrace} data-testid="copy-authz-trace">
            <Copy className="h-4 w-4 mr-2" /> Copy trace
          </Button>
          <Button data-analytics="accessdebug.download" variant="outline" size="sm" onClick={downloadTrace} data-testid="download-authz-trace">
            <Download className="h-4 w-4 mr-2" /> Download JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refreshRoles()} data-testid="refresh-roles">
            <RefreshCw className="h-4 w-4 mr-2" /> Re-fetch roles
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground font-mono" data-testid="authz-correlation-id">
        Trace correlation_id: {authzTraceCorrelationId}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Session</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          {user ? (
            <>
              <div><span className="text-muted-foreground">Email:</span> <span data-testid="debug-email">{user.email}</span></div>
              <div><span className="text-muted-foreground">User ID:</span> {user.id}</div>
              <div><span className="text-muted-foreground">Email confirmed:</span> {user.email_confirmed_at ? "yes" : "NO — this blocks role grants"}</div>
            </>
          ) : (
            <div className="text-destructive">Not signed in — every admin route will redirect to /auth.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detected roles (public.user_roles)</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex flex-wrap gap-1" data-testid="debug-roles">
            {roles.length === 0 && <span className="text-destructive">No roles returned — check user_roles rows & RLS.</span>}
            {roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
          </div>
          {rolesError && <div className="text-destructive">Role query error: {rolesError}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">JWT claims</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48">{JSON.stringify(claims, null, 2) ?? "no session"}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Corporate KYB access verdict</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex items-center gap-2" data-testid="kyb-verdict">
            {kybAllowed
              ? <><ShieldCheck className="h-5 w-5 text-status-success" /> <span className="font-medium text-status-success">ALLOWED</span> — you can open /dashboard/admin/corporate-kyb</>
              : <><ShieldX className="h-5 w-5 text-destructive" /> <span className="font-medium text-destructive">DENIED</span></>}
          </div>
          <div className="text-muted-foreground">Required (any of): {KYB_REQUIRED.join(", ")}</div>
          {!kybAllowed && (
            <ul className="list-disc pl-5 text-destructive space-y-1">
              {!user && <li>You are not signed in.</li>}
              {user && roles.length === 0 && <li>The role query returned zero rows for your user_id — the grant may target a different account, or RLS blocks the read.</li>}
              {user && roles.length > 0 && <li>Your roles ({roles.join(", ")}) don't include any required role.</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Authorization trace (this session)</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs font-mono space-y-1 max-h-64 overflow-auto" data-testid="authz-trace">
            {trace.length === 0 && <div className="text-muted-foreground">No checks recorded yet.</div>}
            {[...trace].reverse().map((e, i) => (
              <div key={i} className="border-b border-border/50 pb-1">
                <span className="text-muted-foreground">{e.ts}</span>{" "}
                <span className={e.step.includes("denied") ? "text-destructive font-semibold" : "font-semibold"}>{e.step}</span>{" "}
                {JSON.stringify(e.detail)}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * /health — lightweight distributed-build health surface.
 *
 * Confirms the app shell mounted, /build-info is served, the release manifest
 * matches it, source maps resolve, and the shipped bundle still contains the
 * role-guard runtime. Safe to hit from uptime monitors and after every deploy.
 */
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { runHealthReport, type HealthReport, type CheckState } from "@/lib/platform/deployHealth";

const StateIcon = ({ state }: { state: CheckState }) =>
  state === "pass" ? (
    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
  ) : state === "fail" ? (
    <XCircle className="h-4 w-4 text-destructive" aria-hidden />
  ) : state === "warn" ? (
    <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden />
  ) : (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
  );

export default function HealthCheck() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(true);

  const run = useCallback(async () => {
    setBusy(true);
    setReport(await runHealthReport());
    setBusy(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const overall = report?.overall ?? "pending";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <Helmet>
        <title>Deployment Health · Yalla Mobility</title>
        <meta name="description" content="Runtime health of this Yalla Mobility deployment: app shell, build info, source maps and role-guard bundle." />
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
            Deployment Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Verifies this host is serving a complete, role-guarded release.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={overall === "pass" ? "default" : overall === "fail" ? "destructive" : "outline"}
            data-testid="health-overall"
          >
            {overall === "pass" ? "HEALTHY" : overall === "fail" ? "UNHEALTHY" : overall === "warn" ? "DEGRADED" : "CHECKING"}
          </Badge>
          <Button variant="outline" size="sm" onClick={run} disabled={busy} data-analytics="health-recheck">
            <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
            Re-check
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runtime checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {(report?.checks ?? []).map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-4 border-b border-border/50 py-3 last:border-0">
              <div className="flex items-start gap-2">
                <StateIcon state={c.state} />
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </div>
            </div>
          ))}
          {busy && !report && <p className="py-3 text-sm text-muted-foreground">Running checks…</p>}
        </CardContent>
      </Card>

      {report?.buildInfo && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Build</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Release: </span><span className="font-mono text-xs break-all">{report.buildInfo.release ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Build ID: </span><span className="font-mono text-xs">{report.buildInfo.build_id ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Commit: </span><span className="font-mono text-xs">{report.buildInfo.git_commit ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Built at: </span><span className="font-mono text-xs">{report.buildInfo.built_at ?? "—"}</span></div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Release hash: </span><span className="font-mono text-xs break-all">{report.buildInfo.release_sha256 ?? "—"}</span></div>
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Signature: </span>
              <span className="font-mono text-xs break-all">
                {report.buildInfo.signature
                  ? `${report.buildInfo.signature.algorithm} key=${report.buildInfo.signature.key_id} (${report.buildInfo.signature.key_source})`
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Need a full asset sweep of this host?{" "}
        <Link to="/deploy-smoke" className="text-primary underline" data-analytics="health-to-smoke">
          Run the post-deploy smoke test
        </Link>
        .
      </p>
    </main>
  );
}

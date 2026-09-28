/**
 * /deploy-smoke — post-deploy asset sweep.
 *
 * Requests every hashed asset and source map declared in release-manifest.json
 * from the *serving host* (cPanel, CDN, Lovable) and reports any missing file,
 * wrong byte size, or blocked path (e.g. .htaccess rules denying .map files).
 */
import { useCallback, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Download, PlayCircle, Loader2 } from "lucide-react";
import { runDeploySmoke, type SmokeReport } from "@/lib/platform/deployHealth";

export default function DeploySmoke() {
  const [report, setReport] = useState<SmokeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [onlyFailures, setOnlyFailures] = useState(true);

  const run = useCallback(async () => {
    setBusy(true);
    setReport(null);
    setProgress({ done: 0, total: 0 });
    const next = await runDeploySmoke((done, total) => setProgress({ done, total }));
    setReport(next);
    setBusy(false);
  }, []);

  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deploy-smoke-${report.buildInfo?.build_id ?? "unknown"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const failures = report?.assets.filter((a) => !a.ok) ?? [];
  const rows = report ? (onlyFailures ? failures : report.assets) : [];
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <Helmet>
        <title>Post-Deploy Smoke Test · TaxiD</title>
        <meta name="description" content="Verify every hashed asset and source map of this TaxiD release resolves correctly from the serving host." />
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Post-Deploy Smoke Test</h1>
          <p className="text-sm text-muted-foreground">
            Fetches every asset in the signed manifest from this host and flags mismatches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={run} disabled={busy} data-analytics="deploy-smoke-run">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="mr-2 h-4 w-4" aria-hidden />}
            {busy ? "Running…" : "Run smoke test"}
          </Button>
          {report && (
            <Button variant="outline" onClick={download} data-analytics="deploy-smoke-export">
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Export JSON
            </Button>
          )}
        </div>
      </div>

      {busy && (
        <Card className="mb-6">
          <CardContent className="space-y-2 py-4">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">
              {progress.done} / {progress.total} assets checked
            </p>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Result</CardTitle>
              <Badge variant={failures.length === 0 ? "default" : "destructive"} data-testid="smoke-verdict">
                {failures.length === 0 ? "ALL ASSETS OK" : `${failures.length} PROBLEM(S)`}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Host: </span><span className="font-mono text-xs break-all">{report.origin || "—"}</span></div>
              <div><span className="text-muted-foreground">Build: </span><span className="font-mono text-xs">{report.buildInfo?.build_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Assets checked: </span>{report.assets.length}</div>
              <div><span className="text-muted-foreground">Source maps: </span>{report.assets.filter((a) => a.kind === "map").length}</div>
              <div><span className="text-muted-foreground">Missing / blocked: </span>{report.missing}</div>
              <div><span className="text-muted-foreground">Size mismatches: </span>{report.mismatched}</div>
            </CardContent>
          </Card>

          {report.assets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No manifest assets found — this host is not serving a packaged release (expected on the dev server).
            </p>
          )}

          {report.assets.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Assets</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setOnlyFailures((v) => !v)} data-analytics="deploy-smoke-toggle-rows">
                  {onlyFailures ? "Show all" : "Show failures only"}
                </Button>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">No failures — every declared asset resolved with the expected size.</p>
                ) : (
                  <div className="space-y-0">
                    {rows.map((a) => (
                      <div key={a.path} className="flex items-start justify-between gap-4 border-b border-border/50 py-2 text-sm last:border-0">
                        <div className="flex min-w-0 items-start gap-2">
                          {a.ok ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                          ) : (
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                          )}
                          <span className="truncate font-mono text-xs">{a.path}</span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {a.ok ? `${a.actualBytes} B` : (a.reason ?? "failed")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Shell-level checks live on the{" "}
        <Link to="/health" className="text-primary underline" data-analytics="smoke-to-health">
          deployment health page
        </Link>
        .
      </p>
    </main>
  );
}

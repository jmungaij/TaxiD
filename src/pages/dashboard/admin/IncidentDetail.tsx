/**
 * Incident detail (admin).
 *
 * Full investigation context for one row of the executive alert history:
 * the whole incident chain, the raw alert events, the affected integration's
 * circuit-breaker state and every correlation id we can attach — with links
 * back to the timeline and to the alert centre.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SeoHead } from "@/components/seo/SeoHead";
import { ArrowLeft, Copy, ExternalLink, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import {
  incidentKindLabel, loadIncidentContext, type IncidentContext,
} from "@/lib/corporate/incidentDetail";

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  info: "bg-muted text-muted-foreground",
};

const BREAKER_TONE: Record<string, string> = {
  open: "bg-destructive/15 text-destructive border-destructive/30",
  half_open: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  closed: "bg-primary/15 text-primary border-primary/30",
};

const ts = (v: string | null) => (v ? new Date(v).toLocaleString("en-KE") : "—");

export default function IncidentDetail() {
  const { alertId } = useParams<{ alertId: string }>();
  const [ctx, setCtx] = React.useState<IncidentContext | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadIncidentContext(alertId);
      if (!data) setError("This incident no longer exists in the alert history.");
      setCtx(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  React.useEffect(() => { void load(); }, [load]);

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="Incident Detail | SAFARID"
        description="Full alert context: incident chain, affected integration, circuit-breaker state and correlation IDs."
        path={`/dashboard/admin/incidents/${alertId ?? ""}`}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild size="sm" variant="ghost" className="-ml-2 mb-1">
            <Link to="/dashboard/admin/executive-command-centre">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back to alert timeline
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldAlert className="h-5 w-5" aria-hidden /> Incident detail
          </h1>
          <p className="text-sm text-muted-foreground">
            {ctx ? ctx.anchor.title : "Loading incident context…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ctx?.anchor.integration_key && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/dashboard/admin/alerts?integration=${ctx.anchor.integration_key}`}>
                Alert centre <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </header>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && !ctx ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : ctx ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Severity", ctx.severity],
              ["Status", ctx.status.replace(/_/g, " ")],
              ["Occurrences", String(ctx.occurrences)],
              ["Integration", ctx.anchor.integration_key ?? "—"],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-lg font-semibold capitalize">{value}</CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Kind</span><div>{incidentKindLabel(ctx.anchor.kind)}</div></div>
              <div><span className="text-muted-foreground">Alert key</span><div className="font-mono text-xs">{ctx.anchor.alert_key}</div></div>
              <div><span className="text-muted-foreground">First seen</span><div>{ts(ctx.firstSeenAt)}</div></div>
              <div><span className="text-muted-foreground">Last seen</span><div>{ts(ctx.lastSeenAt)}</div></div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Message</span>
                <p className="whitespace-pre-line">{ctx.anchor.message}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Circuit-breaker state</CardTitle>
            </CardHeader>
            <CardContent>
              {ctx.breakers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No circuit-breaker records for this integration.</p>
              ) : (
                <ul className="space-y-2">
                  {ctx.breakers.map((b) => (
                    <li key={b.service} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3 text-sm">
                      <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{b.service}</span>
                      <Badge variant="outline" className={BREAKER_TONE[b.state] ?? "bg-muted text-muted-foreground"}>
                        {b.state.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">failures {b.failure_count} · successes {b.success_count}</span>
                      {b.opened_at && <span className="text-xs text-muted-foreground">opened {ts(b.opened_at)}</span>}
                      {b.reopens_at && <span className="text-xs text-muted-foreground">reopens {ts(b.reopens_at)}</span>}
                      {b.last_error && <span className="text-xs text-destructive">{b.last_error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Correlation IDs</CardTitle>
            </CardHeader>
            <CardContent>
              {ctx.correlationIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">No correlation IDs attached to this incident.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {ctx.correlationIds.map((cid) => (
                    <li key={cid}>
                      <button
                        type="button"
                        onClick={() => copy(cid)}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 font-mono text-xs hover:bg-muted"
                        aria-label={`Copy correlation id ${cid}`}
                      >
                        {cid} <Copy className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Incident chain ({ctx.chain.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l border-border/60 pl-4">
                {ctx.chain.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                    <div className="rounded-md border border-border/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={SEVERITY_TONE[e.severity] ?? SEVERITY_TONE.info}>{e.severity}</Badge>
                        <span className="text-sm font-medium">{e.title}</span>
                        <time className="text-xs text-muted-foreground" dateTime={e.created_at}>{ts(e.created_at)}</time>
                        {e.channels.length > 0 && (
                          <span className="text-xs text-muted-foreground">via {e.channels.join(", ")}</span>
                        )}
                        {e.id === ctx.anchor.id && <Badge variant="secondary">this alert</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{e.message}</p>
                      {e.metric_key && (
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {e.metric_key}: {e.value ?? "—"}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Integration events ({ctx.alertEvents.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {ctx.alertEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No raw alert events recorded for this kind.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3">Time</th>
                        <th className="py-2 pr-3">Rule</th>
                        <th className="py-2 pr-3">Severity</th>
                        <th className="py-2 pr-3">Metric</th>
                        <th className="py-2 pr-3">Observed</th>
                        <th className="py-2 pr-3">Threshold</th>
                        <th className="py-2 pr-3">Acknowledged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ctx.alertEvents.map((e) => (
                        <tr key={e.id} className="border-b border-border/40">
                          <td className="py-2 pr-3 whitespace-nowrap">{ts(e.created_at)}</td>
                          <td className="py-2 pr-3">{e.rule_name ?? "—"}</td>
                          <td className="py-2 pr-3">{e.severity ?? "—"}</td>
                          <td className="py-2 pr-3">{e.metric_key ?? "—"}</td>
                          <td className="py-2 pr-3 tabular-nums">{e.observed_value ?? "—"}</td>
                          <td className="py-2 pr-3 tabular-nums">{e.threshold ?? "—"}</td>
                          <td className="py-2 pr-3">{ts(e.acknowledged_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

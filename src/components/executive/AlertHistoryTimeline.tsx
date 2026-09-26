/**
 * Alert history timeline for the Executive Command Centre.
 *
 * Reads `executive_alert_history` (written by `executiveAlertDispatch`) and
 * renders a filterable timeline: severity, affected integration and time range,
 * with a link through to the incident detail surfaces.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ExternalLink, History, RefreshCw } from "lucide-react";
import { ALERT_KIND_LABEL } from "@/lib/corporate/userAlertPrefs";
import type { ExecAlertKind } from "@/lib/corporate/executiveAlerts";

interface HistoryRow {
  id: string;
  alert_key: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  metric_key: string | null;
  value: number | null;
  integration_key: string | null;
  channels: string[];
  incident_ref: string | null;
  created_at: string;
}

const RANGES: Array<{ key: string; label: string; hours: number }> = [
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
  { key: "90d", label: "Last 90 days", hours: 24 * 90 },
];

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  info: "bg-muted text-muted-foreground",
};

/** Where an operator goes to investigate this alert. */
function incidentLink(row: HistoryRow): { to: string; label: string } {
  if (row.kind === "sla_degraded") {
    return { to: "/dashboard/admin/corporates/approvals", label: "Approvals SLA" };
  }
  return { to: `/dashboard/admin/incidents/${row.id}`, label: "Incident detail" };
}

export function AlertHistoryTimeline() {
  const [rows, setRows] = React.useState<HistoryRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [severity, setSeverity] = React.useState("all");
  const [integration, setIntegration] = React.useState("all");
  const [range, setRange] = React.useState("7d");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hours = RANGES.find((r) => r.key === range)?.hours ?? 168;
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const { data, error: err } = await untypedDb
        .from("executive_alert_history")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300);
      if (err) throw new Error(err.message);
      setRows(
        ((data ?? []) as HistoryRow[]).map((r) => ({
          ...r,
          channels: Array.isArray(r.channels) ? r.channels.map(String) : [],
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alert history");
    } finally {
      setLoading(false);
    }
  }, [range]);

  React.useEffect(() => { void load(); }, [load]);

  const integrations = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.integration_key).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (severity === "all" || r.severity === severity) &&
      (integration === "all" || r.integration_key === integration),
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" aria-hidden /> Alert history
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 w-[140px]" aria-label="Filter by severity">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
            <Select value={integration} onValueChange={setIntegration}>
              <SelectTrigger className="h-8 w-[160px]" aria-label="Filter by integration">
                <SelectValue placeholder="Integration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All integrations</SelectItem>
                {integrations.map((i) => (
                  <SelectItem key={i} value={i} className="capitalize">{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by time range">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="sr-only">Refresh alert history</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
        {loading && rows.length === 0 && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            No alerts recorded for this filter. Alerts appear here as soon as service levels,
            integrations or circuit-breakers degrade.
          </p>
        )}
        <ol className="relative space-y-3 border-l border-border/60 pl-4">
          {filtered.map((r) => {
            const link = incidentLink(r);
            return (
              <li key={r.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full ${
                    r.severity === "critical" ? "bg-destructive" : "bg-status-warning"
                  }`}
                  aria-hidden
                />
                <div className="rounded-md border border-border/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={SEVERITY_TONE[r.severity] ?? SEVERITY_TONE.info}>
                      {r.severity}
                    </Badge>
                    <span className="text-sm font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {ALERT_KIND_LABEL[r.kind as ExecAlertKind] ?? r.kind}
                    </span>
                    {r.integration_key && (
                      <Badge variant="secondary" className="capitalize">{r.integration_key}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString("en-KE")}</time>
                    <span>
                      Delivered: {r.channels.length ? r.channels.join(", ") : "suppressed by preferences"}
                    </span>
                    {r.metric_key && <span className="font-mono">{r.metric_key}</span>}
                    <Button asChild size="sm" variant="ghost" className="h-6 px-2">
                      <Link to={link.to}>
                        {link.label} <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export default AlertHistoryTimeline;

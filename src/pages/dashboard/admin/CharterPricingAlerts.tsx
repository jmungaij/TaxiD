/**
 * Charter pricing staleness alerts — admin console.
 *
 * Browses `charter.pricing_version_stale` alert events by slug and time range,
 * links to the latest published pricing version, and surfaces the recent
 * `quote_create` rejections each alert represents so responders can tell an
 * aviation version lag apart from a non-aviation regression (which should
 * never happen and is always raised as critical).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { untypedDb } from "@/integrations/supabase/untyped";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, RefreshCw, Gauge, ExternalLink, Download } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { AVIATION_PRICED_SLUGS, requiresPublishedPricing } from "@/lib/charter/pricingGovernance";
import { useTableView } from "@/lib/charter/useTableView";

const SLUGS = [
  "all",
  ...AVIATION_PRICED_SLUGS,
  "bus-charter",
  "marine-charter",
  "heavy-machinery-leasing",
];

interface AlertRow {
  id: string;
  severity: string;
  message: string;
  observed_value: number | null;
  threshold: number | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

interface PublishedRow {
  version: number;
  effective_at: string | null;
  created_at: string;
  actor_email: string | null;
  note: string | null;
}

const sevVariant = (s: string) =>
  s === "critical" ? "destructive" : s === "warning" ? "secondary" : "outline";

const ctxStr = (r: AlertRow, k: string) => {
  const v = (r.context ?? {})[k];
  return v === null || v === undefined || v === "" ? "—" : String(v);
};

export default function CharterPricingAlerts() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [published, setPublished] = useState<PublishedRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(params.get("slug") ?? "all");
  const [severity, setSeverity] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    const db = untypedDb;
    let q = db
      .from("alerts_events")
      .select("id,severity,message,observed_value,threshold,context,created_at")
      .eq("metric_key", "charter.pricing_version_stale")
      .order("created_at", { ascending: false })
      .limit(500);
    if (slug !== "all") q = q.contains("context", { slug });
    if (severity !== "all") q = q.eq("severity", severity);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) q = q.lte("created_at", new Date(`${to}T23:59:59`).toISOString());

    const [{ data, error: err }, pricing] = await Promise.all([
      q,
      db.from("charter_pricing_config")
        .select("version,effective_at,created_at,actor_email,note")
        .order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (err) setError(err.message);
    setRows((data ?? []) as AlertRow[]);
    setPublished((pricing?.data ?? null) as PublishedRow | null);
    setLoading(false);
  };

  /** Download the currently filtered alerts for incident review. */
  const exportCsv = () => {
    const range = `${from || "start"}_${to || "now"}`;
    downloadCsv(
      `charter-pricing-stale-${slug}-${range}.csv`,
      toCsv(
        rows.map((r) => ({
          created_at: r.created_at,
          severity: r.severity,
          slug: ctxStr(r, "slug"),
          category: ctxStr(r, "category"),
          quoted_version: ctxStr(r, "quoted_version"),
          active_version: ctxStr(r, "active_version"),
          last_publish_at: ctxStr(r, "last_publish_at"),
          observed_value: r.observed_value ?? "",
          threshold: r.threshold ?? "",
          message: r.message,
        })),
      ),
    );
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, severity, from, to]);

  const stats = useMemo(() => {
    const bySlug = new Map<string, number>();
    let critical = 0;
    let nonAviation = 0;
    for (const r of rows) {
      const s = String((r.context ?? {}).slug ?? "unknown");
      bySlug.set(s, (bySlug.get(s) ?? 0) + 1);
      if (r.severity === "critical") critical += 1;
      if (!requiresPublishedPricing(s)) nonAviation += 1;
    }
    return {
      total: rows.length,
      critical,
      nonAviation,
      top: [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [rows]);

  const view = useTableView<AlertRow>(rows, {
    created_at: (r) => r.created_at,
    severity: (r) => r.severity,
    slug: (r) => String((r.context ?? {}).slug ?? ""),
    observed_value: (r) => r.observed_value ?? 0,
  }, 25);

  const onSlug = (v: string) => {
    setSlug(v);
    const next = new URLSearchParams(params);
    if (v === "all") next.delete("slug"); else next.set("slug", v);
    setParams(next, { replace: true });
  };

  return (
    <AdminOnly>
      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              Charter pricing staleness alerts
            </h1>
            <p className="text-sm text-muted-foreground">
              Every <code>charter.pricing_version_stale</code> rejection, by category and time range.
              Any non-aviation occurrence is a category-offline regression.
            </p>
          </div>
          <div className="flex gap-2">
            <Button data-analytics="charterpricingalerts.export_csv" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Alerts in range</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{stats.total}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Critical</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold text-destructive">{stats.critical}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Non-aviation (regression)</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold text-destructive">{stats.nonAviation}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Gauge className="h-4 w-4" /> Latest published pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {published ? (
                <>
                  <div className="text-2xl font-semibold">v{published.version}</div>
                  <div className="text-muted-foreground">
                    {new Date(published.effective_at ?? published.created_at).toLocaleString()}
                    {published.actor_email ? ` · ${published.actor_email}` : ""}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">No pricing published yet.</div>
              )}
              <Link
                to="/dashboard/admin/flight-hub/pricing"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Pricing control <ExternalLink className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Category slug</Label>
              <Select value={slug} onValueChange={onSlug}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SLUGS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All categories" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["all", "info", "warning", "critical"].map((s) => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All severities" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {stats.top.length > 0 && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Rejections by slug</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {stats.top.map(([s, n]) => (
                <Badge
                  key={s}
                  variant={requiresPublishedPricing(s) ? "secondary" : "destructive"}
                  className="cursor-pointer"
                  onClick={() => onSlug(s)}
                >
                  {s}: {n}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent quote_create rejections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : view.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No staleness alerts in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      {[
                        ["created_at", "When"], ["slug", "Slug"], ["severity", "Severity"],
                        ["observed_value", "In window"],
                      ].map(([key, label]) => (
                        <th key={key} className="py-2 pr-4">
                          <button className="hover:underline" onClick={() => view.toggleSort(key)}>{label}</button>
                        </th>
                      ))}
                      <th className="py-2 pr-4">Quoted → active</th>
                      <th className="py-2 pr-4">Last publish</th>
                      <th className="py-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((r) => (
                      <tr key={r.id} className="border-t border-border/60 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="py-2 pr-4">{ctxStr(r, "slug")}</td>
                        <td className="py-2 pr-4"><Badge variant={sevVariant(r.severity)}>{r.severity}</Badge></td>
                        <td className="py-2 pr-4">{r.observed_value ?? "—"}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">
                          v{ctxStr(r, "quoted_version")} → v{ctxStr(r, "active_version")}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {(r.context ?? {}).last_published_at
                            ? new Date(String((r.context ?? {}).last_published_at)).toLocaleString()
                            : "—"}
                        </td>
                        <td className="py-2 text-muted-foreground">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
                  <span>Page {view.info.page} of {view.info.pageCount}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={view.page <= 1}
                      onClick={() => view.setPage(view.page - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={view.page >= view.info.pageCount}
                      onClick={() => view.setPage(view.page + 1)}>Next</Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}

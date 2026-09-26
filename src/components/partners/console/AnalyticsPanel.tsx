/**
 * Usage analytics — filters (environment, capability domain, credential, date
 * range), charts, and CSV/PDF export of exactly the figures on screen.
 *
 * Every value comes from `partner_api_usage_daily`. When a filter matches no
 * rows the panel says so explicitly rather than rendering an empty chart that
 * could be mistaken for a flat line at zero traffic.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileText, Filter } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { CAPABILITY_DOMAINS } from "@/lib/partners/apiPlatform";
import { fetchCredentials, fetchUsage, type ApiEnvironment } from "@/lib/partners/devPortal";
import {
  RANGE_PRESETS, aggregateUsage, defaultFilter, downloadCsv, exportFilename,
  exportUsagePdf, filterUsage, rangeFor, usageCsv, type RangePresetKey, type UsageFilter,
} from "@/lib/partners/usageAnalytics";

const nf = new Intl.NumberFormat("en-KE");
const ENVIRONMENTS: ApiEnvironment[] = ["sandbox", "production"];

export function AnalyticsPanel({ partnerId, partnerName }: { partnerId: string; partnerName: string }) {
  const enabled = Boolean(partnerId);
  const [filter, setFilter] = useState<UsageFilter>(defaultFilter);
  const [preset, setPreset] = useState<RangePresetKey | "custom">("30d");
  const [exporting, setExporting] = useState(false);

  const usage = useQuery({
    queryKey: ["partner-api-usage-analytics", partnerId],
    queryFn: () => fetchUsage(partnerId, 90),
    enabled,
  });
  const credentials = useQuery({
    queryKey: ["partner-api-credentials", partnerId],
    queryFn: () => fetchCredentials(partnerId),
    enabled,
  });

  const rows = usage.data ?? [];
  const creds = credentials.data ?? [];
  const filtered = useMemo(() => filterUsage(rows, filter), [rows, filter]);
  const agg = useMemo(() => aggregateUsage(filtered), [filtered]);

  const ctx = { partnerName: partnerName || "Partner", filter, credentials: creds };
  const domainKeys = useMemo(
    () => [...new Set(["all", ...CAPABILITY_DOMAINS.map((d) => d.key), ...rows.map((r) => r.domain_key)])],
    [rows],
  );

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const applyPreset = (key: RangePresetKey) => {
    setPreset(key);
    setFilter((f) => ({ ...f, ...rangeFor(key) }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" aria-hidden /> Filters
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={!filtered.length}
              onClick={() => {
                downloadCsv(usageCsv(agg, ctx), exportFilename(ctx, "csv"));
                toast.success("CSV exported", { description: "Aggregated exactly as filtered on screen." });
              }}
            >
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={!filtered.length || exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportUsagePdf(agg, { ...ctx, generatedAt: new Date() });
                  toast.success("PDF exported");
                } catch (e) {
                  toast.error("Export failed", { description: (e as Error).message });
                } finally {
                  setExporting(false);
                }
              }}
            >
              <FileText className="h-4 w-4" aria-hidden /> {exporting ? "Building…" : "PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Environment
            </legend>
            <div className="flex flex-wrap gap-2">
              {ENVIRONMENTS.map((env) => (
                <Toggle
                  key={env}
                  size="sm"
                  variant="outline"
                  pressed={filter.environments.includes(env)}
                  onPressedChange={() => setFilter((f) => ({ ...f, environments: toggleIn(f.environments, env) }))}
                  aria-label={`Include ${env} traffic`}
                >
                  {env}
                </Toggle>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Capability domain
            </legend>
            <div className="flex flex-wrap gap-2">
              {domainKeys.map((key) => (
                <Toggle
                  key={key}
                  size="sm"
                  variant="outline"
                  pressed={filter.domains.includes(key)}
                  onPressedChange={() => setFilter((f) => ({ ...f, domains: toggleIn(f.domains, key) }))}
                  aria-label={`Filter to ${key}`}
                >
                  {CAPABILITY_DOMAINS.find((d) => d.key === key)?.name ?? key}
                </Toggle>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">No selection means every domain is included.</p>
          </fieldset>

          {creds.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Credential
              </legend>
              <div className="flex flex-wrap gap-2">
                {creds.map((c) => (
                  <Toggle
                    key={c.id}
                    size="sm"
                    variant="outline"
                    pressed={filter.credentialIds.includes(c.id)}
                    onPressedChange={() =>
                      setFilter((f) => ({ ...f, credentialIds: toggleIn(f.credentialIds, c.id) }))
                    }
                    aria-label={`Filter to credential ${c.label}`}
                  >
                    {c.label}
                    <Badge variant="secondary" className="ml-2">{c.environment}</Badge>
                  </Toggle>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Date range
            </legend>
            <div className="flex flex-wrap items-end gap-3">
              {RANGE_PRESETS.map((r) => (
                <Toggle
                  key={r.key}
                  size="sm"
                  variant="outline"
                  pressed={preset === r.key}
                  onPressedChange={() => applyPreset(r.key)}
                  aria-label={r.label}
                >
                  {r.label}
                </Toggle>
              ))}
              <div className="space-y-1">
                <Label htmlFor="usage-from" className="text-xs">From</Label>
                <Input
                  id="usage-from"
                  type="date"
                  value={filter.from}
                  className="h-9 w-[9.5rem]"
                  onChange={(e) => {
                    setPreset("custom");
                    setFilter((f) => ({ ...f, from: e.target.value }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="usage-to" className="text-xs">To</Label>
                <Input
                  id="usage-to"
                  type="date"
                  value={filter.to}
                  className="h-9 w-[9.5rem]"
                  onChange={(e) => {
                    setPreset("custom");
                    setFilter((f) => ({ ...f, to: e.target.value }));
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Telemetry is retained for 90 days in this console; older periods are available from the
              integration desk on request.
            </p>
          </fieldset>
        </CardContent>
      </Card>

      {!enabled ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Analytics appear once your login is attached to a partner account.
        </CardContent></Card>
      ) : usage.isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading telemetry…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No requests are recorded for this filter. This is a genuine zero, not a loading state —
          widen the date range or clear the domain filter.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Requests", value: nf.format(agg.totals.requests), hint: `${agg.activeDays} active day(s)` },
              { label: "Error rate", value: `${(agg.totals.errorRate * 100).toFixed(2)}%`, hint: `${nf.format(agg.totals.errors)} errors` },
              { label: "Throttle rate", value: `${(agg.totals.throttleRate * 100).toFixed(2)}%`, hint: `${nf.format(agg.totals.throttled)} throttled` },
              { label: "Busiest day", value: agg.busiestDay ? nf.format(agg.busiestDay.requests) : "—", hint: agg.busiestDay?.date ?? "no traffic" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{m.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Requests, errors and throttling over time</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={agg.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="requests" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.18)" strokeWidth={2} />
                    <Area type="monotone" dataKey="errors" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.14)" strokeWidth={2} />
                    <Area type="monotone" dataKey="throttled" stroke="hsl(var(--muted-foreground))" fill="hsl(var(--muted-foreground) / 0.10)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Volume by capability domain</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agg.byDomain} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-18} height={56} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="requests" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Split by environment</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Environment</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Errors</TableHead>
                      <TableHead className="text-right">Throttled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.byEnvironment.map((e) => (
                      <TableRow key={e.environment}>
                        <TableCell className="font-medium">{e.environment}</TableCell>
                        <TableCell className="text-right tabular-nums">{nf.format(e.requests)}</TableCell>
                        <TableCell className="text-right tabular-nums">{nf.format(e.errors)}</TableCell>
                        <TableCell className="text-right tabular-nums">{nf.format(e.throttled)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

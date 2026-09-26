/**
 * SAFARID PARTNERS 360 — captured funnel comparison, journeys and experiment.
 *
 * Three readings of the same counted telemetry the /partners experience writes
 * (view → interact → CTA):
 *   • Comparison — by messaging frame, intent, ecosystem, category, maturity and
 *     lifecycle stage;
 *   • Journeys   — the individual sessions behind those numbers, drillable by
 *     any dimension and drill-through to one journey's timeline;
 *   • Experiment — the messaging A/B arms, overall and by intent and maturity.
 *
 * Aggregation is pure (`funnelAnalytics`, `journeyDrill`, `abAnalytics`); this
 * page fetches, filters, ranges and renders. No estimates — everything shown is
 * counted, and an experiment reading is only called a result when both arms
 * clear the stated minimum exposure.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, FlaskConical, MousePointerClick, RefreshCw, Route, Users, X } from "lucide-react";

import StatCard from "@/components/common/StatCard";
import { ReportExportMenu } from "@/components/executive/ReportExportMenu";
import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  funnelComparisonTable, summarisePartnerFunnel, type RawCtaEvent,
} from "@/lib/partners/funnelAnalytics";
import {
  DRILL_FILTERS, activeFilterCount, buildJourneys, filterPartnerEvents, journeyTable,
  labelOf, type DrillFilters, type DrillKey,
} from "@/lib/partners/journeyDrill";
import { MIN_VIEWS_PER_ARM, abReportTable, buildAbReport } from "@/lib/partners/abAnalytics";
import { VARIANT_DESCRIPTION } from "@/lib/partners/abTest";
import { usePartnerFunnelRealtime } from "@/lib/partners/history";


const WINDOWS = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

const ANY = "__any__";

async function fetchEvents(days: number): Promise<RawCtaEvent[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("cta_events")
    .select("button_name, action_type, target, page_source, session_id, clicked_at, metadata")
    .gte("clicked_at", since)
    .order("clicked_at", { ascending: false })
    .limit(20_000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RawCtaEvent[];
}

export default function PartnerFunnelDashboard() {
  const [win, setWin] = useState<WindowKey>("30");
  const [filters, setFilters] = useState<DrillFilters>({});
  const windowLabel = WINDOWS.find((w) => w.key === win)!.label;

  const events = useQuery({
    queryKey: ["yp-funnel", win],
    queryFn: () => fetchEvents(Number(win)),
  });

  // Live funnel: a visitor moving lifecycle stage, or a partner profile
  // changing, refetches the counted telemetry behind this dashboard.
  const { connected } = usePartnerFunnelRealtime(() => { void events.refetch(); }, "dashboard");


  const filtered = useMemo(
    () => filterPartnerEvents(events.data ?? [], filters),
    [events.data, filters],
  );
  const summary = useMemo(() => summarisePartnerFunnel(filtered), [filtered]);
  const journeys = useMemo(() => buildJourneys(filtered), [filtered]);
  const abReport = useMemo(() => buildAbReport(filtered), [filtered]);

  const [dim, setDim] = useState("frame");
  const activeDim = summary.dimensions.find((d) => d.key === dim) ?? summary.dimensions[0];
  const filterCount = activeFilterCount(filters);

  const setFilter = (key: DrillKey, value: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (value === ANY) delete next[key];
      else next[key] = value;
      return next;
    });

  if (events.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Partner funnel comparison"
        eyebrow="SAFARID Partners 360"
        lede="Counted view → interact → CTA behaviour on the SAFARID Partners experience — compared by dimension, drillable to individual journeys, and split by messaging experiment arm."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={connected ? "secondary" : "outline"}>
              {connected ? "Live" : "Polling"}
            </Badge>

            {WINDOWS.map((w) => (
              <Button
                key={w.key}
                size="sm"
                variant={w.key === win ? "default" : "outline"}
                onClick={() => setWin(w.key)}
              >
                {w.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => void events.refetch()} disabled={events.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${events.isFetching ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </Button>
            <ReportExportMenu
              label="Funnel comparison"
              build={() => funnelComparisonTable(summary, windowLabel)}
              disabled={summary.totals.view + summary.totals.interact + summary.totals.cta === 0}
            />
          </div>
        }
      />

      {/* ---------------- drill-down filters ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Drill down</CardTitle>
          <CardDescription>
            Filters apply to whole journeys, not single events: a session is kept only when it declared every
            value selected here. {filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? "" : "s"} applied.` : "No filters applied."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DRILL_FILTERS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor={`filter-${f.key}`}>
                  {f.label}
                </label>
                <Select value={filters[f.key] ?? ANY} onValueChange={(v) => setFilter(f.key, v)}>
                  <SelectTrigger id={`filter-${f.key}`}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ANY}>Any — {f.hint}</SelectItem>
                    {f.values.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {filterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
              <X className="mr-2 h-4 w-4" aria-hidden /> Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Section views" value={summary.totals.view} tone="primary" icon={<Activity className="h-5 w-5" />} description={windowLabel} />
        <StatCard title="Interactions" value={summary.totals.interact} tone="ai" icon={<MousePointerClick className="h-5 w-5" />} description="Tab, stage and level selections" />
        <StatCard title="CTA clicks" value={summary.totals.cta} tone="success" icon={<MousePointerClick className="h-5 w-5" />} description="Apply, checklist and workspace links" />
        <StatCard title="Journeys" value={journeys.length} tone="default" icon={<Users className="h-5 w-5" />} description={summary.lastEventAt ? `Last event ${new Date(summary.lastEventAt).toLocaleString()}` : "No events captured yet"} />
      </div>

      <Tabs defaultValue="comparison">
        <TabsList>
          <TabsTrigger value="comparison"><Activity className="mr-2 h-4 w-4" aria-hidden />Comparison</TabsTrigger>
          <TabsTrigger value="journeys"><Route className="mr-2 h-4 w-4" aria-hidden />Journeys</TabsTrigger>
          <TabsTrigger value="experiment"><FlaskConical className="mr-2 h-4 w-4" aria-hidden />Messaging experiment</TabsTrigger>
        </TabsList>

        {/* ---------------- comparison ---------------- */}
        <TabsContent value="comparison" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Comparison by dimension</CardTitle>
              <CardDescription>{activeDim ? activeDim.question : "No captured events in this window."}</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeDim?.key ?? dim} onValueChange={setDim}>
                <TabsList className="flex h-auto flex-wrap justify-start">
                  {summary.dimensions.map((d) => (
                    <TabsTrigger key={d.key} value={d.key}>{d.label}</TabsTrigger>
                  ))}
                </TabsList>

                {summary.dimensions.map((d) => (
                  <TabsContent key={d.key} value={d.key} className="mt-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <caption className="sr-only">{`${d.label} — ${d.question} (${windowLabel})`}</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-4 font-semibold">{d.label}</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Views</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Interactions</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">CTA clicks</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Sessions</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Interact %</th>
                            <th scope="col" className="py-2 text-right font-semibold">CTA %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.rows.map((r) => (
                            <tr key={r.id} className="border-b border-border/60 last:border-0">
                              <th scope="row" className="py-2 pr-4 text-left font-medium">{r.label}</th>
                              <td className="py-2 pr-4 text-right tabular-nums">{r.view}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{r.interact}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{r.cta}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{r.sessions}</td>
                              <td className="py-2 pr-4 text-right tabular-nums">{r.interactRatePct.toFixed(1)}%</td>
                              <td className="py-2 text-right tabular-nums">{r.ctaRatePct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {d.rows.every((r) => r.view + r.interact + r.cta === 0) && (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Nothing captured for this dimension in {windowLabel.toLowerCase()}.
                      </p>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- journeys ---------------- */}
        <TabsContent value="journeys" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Individual partner journeys</CardTitle>
                <CardDescription>
                  One row per session, newest activity first. Open a journey to read its full timeline of views,
                  interactions and CTA clicks.
                </CardDescription>
              </div>
              <ReportExportMenu
                label="Journeys"
                build={() => journeyTable(journeys, windowLabel)}
                disabled={journeys.length === 0}
              />
            </CardHeader>
            <CardContent>
              {journeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No journeys match the current filters in {windowLabel.toLowerCase()}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{`Partner journeys (${windowLabel})`}</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="py-2 pr-4 font-semibold">Last activity</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Brings</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Category</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Level</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Variant</th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">Views</th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">Interactions</th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">CTA</th>
                        <th scope="col" className="py-2 font-semibold">Journey</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journeys.slice(0, 200).map((j) => (
                        <tr key={j.sessionId} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-4 whitespace-nowrap">{new Date(j.lastSeen).toLocaleString()}</td>
                          <td className="py-2 pr-4">{labelOf("bring", j.bring)}</td>
                          <td className="py-2 pr-4">{labelOf("category", j.category)}</td>
                          <td className="py-2 pr-4">{labelOf("level", j.level)}</td>
                          <td className="py-2 pr-4">{labelOf("variant", j.variant)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{j.counts.view}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{j.counts.interact}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{j.counts.cta}</td>
                          <td className="py-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/staff/partners/funnel/${encodeURIComponent(j.sessionId)}?days=${win}`}>
                                Open journey
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {journeys.length > 200 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Showing the 200 most recent of {journeys.length} journeys — narrow the filters or the window to see the rest.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- experiment ---------------- */}
        <TabsContent value="experiment" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Messaging frames A/B</CardTitle>
                <CardDescription>
                  Arm A states the commercial outcome; arm B states the operating mechanic behind it.
                  A comparison is only read as a result once both arms reach {MIN_VIEWS_PER_ARM} views.
                  {abReport.unattributed > 0 && ` ${abReport.unattributed} earlier events carry no variant and are excluded.`}
                </CardDescription>
              </div>
              <ReportExportMenu
                label="Experiment"
                build={() => abReportTable(abReport, windowLabel)}
                disabled={abReport.attributed === 0}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-semibold">{abReport.overall.verdict}</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {abReport.overall.arms.map((a) => (
                    <li key={a.variant}>
                      <span className="font-medium text-foreground">{a.label}</span> — {VARIANT_DESCRIPTION[a.variant]}
                    </li>
                  ))}
                </ul>
              </div>

              {(["overall", "intent", "maturity"] as const).map((segment) => {
                const rows = abReport.comparisons.filter((c) => c.segment === segment);
                if (rows.length === 0) return null;
                return (
                  <div key={segment}>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {segment === "overall" ? "All traffic" : segment === "intent" ? "By partner intent" : "By maturity level"}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <caption className="sr-only">{`Messaging experiment by ${segment} (${windowLabel})`}</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-4 font-semibold">Segment</th>
                            <th scope="col" className="py-2 pr-4 font-semibold">Variant</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Views</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Interactions</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">CTA</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">Interact %</th>
                            <th scope="col" className="py-2 pr-4 text-right font-semibold">CTA %</th>
                            <th scope="col" className="py-2 font-semibold">Reading</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.flatMap((c) =>
                            c.arms.map((a, i) => (
                              <tr key={`${c.key}-${a.variant}`} className="border-b border-border/60 last:border-0">
                                {i === 0 ? (
                                  <th scope="row" rowSpan={c.arms.length} className="py-2 pr-4 align-top text-left font-medium">
                                    {c.label}
                                  </th>
                                ) : null}
                                <td className="py-2 pr-4">
                                  {a.label}
                                  {c.leader === a.variant && (
                                    <Badge variant="secondary" className="ml-2">Leads</Badge>
                                  )}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">{a.view}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{a.interact}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{a.cta}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">
                                  {a.interactRatePct === null ? "—" : `${a.interactRatePct.toFixed(1)}%`}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">
                                  {a.ctaRatePct === null ? "—" : `${a.ctaRatePct.toFixed(1)}%`}
                                </td>
                                {i === 0 ? (
                                  <td rowSpan={c.arms.length} className="py-2 align-top text-xs text-muted-foreground">
                                    {c.verdict}
                                  </td>
                                ) : null}
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

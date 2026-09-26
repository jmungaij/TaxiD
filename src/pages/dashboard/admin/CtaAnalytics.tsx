/**
 * CTA Analytics — admin summary of cta_events.
 * Adds date-range and campaign-source filters plus charts for top converting
 * CTAs and drop-off rates by role.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList,
} from "recharts";

interface Event {
  button_name: string;
  action_type: string;
  target: string | null;
  page_source: string | null;
  campaign_source: string | null;
  utm_source: string | null;
  user_role: string | null;
  converted: boolean;
  conversion_value: number | null;
  clicked_at: string;
}

interface Row { key: string; clicks: number; conversions: number; value: number; rate: number; }

function aggregate(events: Event[], pick: (e: Event) => string | null | undefined): Row[] {
  const map = new Map<string, Row>();
  for (const e of events) {
    const k = pick(e) || "(none)";
    const r = map.get(k) ?? { key: k, clicks: 0, conversions: 0, value: 0, rate: 0 };
    r.clicks++;
    if (e.converted) r.conversions++;
    r.value += Number(e.conversion_value ?? 0);
    map.set(k, r);
  }
  return Array.from(map.values())
    .map(r => ({ ...r, rate: r.clicks ? r.conversions / r.clicks : 0 }))
    .sort((a, b) => b.clicks - a.clicks);
}

function isoDaysAgo(n: number) {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

export default function CtaAnalytics() {
  const [events, setEvents] = React.useState<Event[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [from, setFrom] = React.useState(isoDaysAgo(30));
  const [to, setTo] = React.useState(isoDaysAgo(0));
  const [campaign, setCampaign] = React.useState<string>("all");

  const load = React.useCallback(() => {
    setLoading(true);
    const fromISO = new Date(from + "T00:00:00").toISOString();
    const toISO = new Date(to + "T23:59:59").toISOString();
    supabase
      .from("cta_events")
      .select("button_name,action_type,target,page_source,campaign_source,utm_source,user_role,converted,conversion_value,clicked_at")
      .gte("clicked_at", fromISO)
      .lte("clicked_at", toISO)
      .order("clicked_at", { ascending: false })
      .limit(10000)
      .then(({ data }) => {
        setEvents((data as any) ?? []);
        setLoading(false);
      });
  }, [from, to]);

  React.useEffect(() => { load(); }, [load]);

  const campaigns = React.useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      const v = e.campaign_source || e.utm_source;
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [events]);

  const filtered = React.useMemo(() => {
    if (campaign === "all") return events;
    return events.filter(e => (e.campaign_source || e.utm_source || "") === campaign);
  }, [events, campaign]);

  const byButton   = React.useMemo(() => aggregate(filtered, e => e.button_name), [filtered]);
  const byPage     = React.useMemo(() => aggregate(filtered, e => e.page_source), [filtered]);
  const byCampaign = React.useMemo(() => aggregate(filtered, e => e.campaign_source || e.utm_source), [filtered]);
  const byRole     = React.useMemo(() => aggregate(filtered, e => e.user_role), [filtered]);

  const totalClicks = filtered.length;
  const totalConv = filtered.filter(e => e.converted).length;
  const totalRate = totalClicks ? totalConv / totalClicks : 0;
  const totalValue = filtered.reduce((s, e) => s + Number(e.conversion_value ?? 0), 0);

  const topConverting = [...byButton].filter(r => r.clicks >= 5).sort((a, b) => b.rate - a.rate).slice(0, 10);
  const dropoff = [...byButton].filter(r => r.clicks >= 10 && r.conversions === 0).slice(0, 10);

  // Drop-off rate by role = (clicks - conversions) / clicks
  const dropoffByRole = React.useMemo(
    () => byRole.map(r => ({
      role: r.key,
      dropoff_rate: r.clicks ? (r.clicks - r.conversions) / r.clicks : 0,
      conversion_rate: r.rate,
      clicks: r.clicks,
    })).sort((a, b) => b.clicks - a.clicks),
    [byRole],
  );

  const topConvertingChartData = topConverting.map(r => ({
    name: r.key.length > 22 ? r.key.slice(0, 22) + "…" : r.key,
    rate: Math.round(r.rate * 1000) / 10,
    clicks: r.clicks,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">CTA Analytics</h1>
          <p className="text-muted-foreground">Click &amp; conversion rollup from <code>cta_events</code>.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">Campaign / utm_source</Label>
            <Select value={campaign} onValueChange={setCampaign}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={load}>Refresh</Button>
        </div>
      </div>

      {loading ? <Skeleton className="h-32 w-full" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Clicks" value={totalClicks.toLocaleString()} />
            <Stat label="Conversions" value={totalConv.toLocaleString()} />
            <Stat label="Conversion rate" value={(totalRate * 100).toFixed(1) + "%"} />
            <Stat label="Conversion value" value={"KES " + totalValue.toLocaleString()} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Top converting CTAs (rate %)</CardTitle></CardHeader>
              <CardContent>
                {topConvertingChartData.length === 0 ? <Empty /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topConvertingChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="name" width={140} fontSize={11} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Bar dataKey="rate" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                        <LabelList dataKey="rate" position="right" formatter={(v: number) => `${v}%`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Drop-off rate by role</CardTitle></CardHeader>
              <CardContent>
                {dropoffByRole.length === 0 ? <Empty /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={dropoffByRole.map(r => ({
                      role: r.role,
                      dropoff: Math.round(r.dropoff_rate * 1000) / 10,
                      conversion: Math.round(r.conversion_rate * 1000) / 10,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="role" fontSize={11} />
                      <YAxis tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Bar dataKey="dropoff" stackId="a" fill="hsl(var(--destructive))" name="Drop-off" />
                      <Bar dataKey="conversion" stackId="a" fill="hsl(var(--primary))" name="Conversion" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Top converting CTAs</CardTitle></CardHeader>
              <CardContent>
                <Table rows={topConverting} keyLabel="Button" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Drop-off (≥10 clicks, 0 conversions)</CardTitle></CardHeader>
              <CardContent>
                {dropoff.length === 0 ? <Empty /> : (
                  <ul className="space-y-1 text-sm">
                    {dropoff.map(r => (
                      <li key={r.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
                        <code className="truncate">{r.key}</code>
                        <Badge variant="destructive">{r.clicks} clicks</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="button">
            <TabsList>
              <TabsTrigger value="button">By button</TabsTrigger>
              <TabsTrigger value="page">By page</TabsTrigger>
              <TabsTrigger value="campaign">By campaign</TabsTrigger>
              <TabsTrigger value="role">By role</TabsTrigger>
            </TabsList>
            <TabsContent value="button"><Card><CardContent className="pt-6"><Table rows={byButton} keyLabel="Button" /></CardContent></Card></TabsContent>
            <TabsContent value="page"><Card><CardContent className="pt-6"><Table rows={byPage} keyLabel="Page" /></CardContent></Card></TabsContent>
            <TabsContent value="campaign"><Card><CardContent className="pt-6"><Table rows={byCampaign} keyLabel="Campaign / utm_source" /></CardContent></Card></TabsContent>
            <TabsContent value="role"><Card><CardContent className="pt-6"><Table rows={byRole} keyLabel="Role" /></CardContent></Card></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Empty() { return <p className="text-sm text-muted-foreground py-4 text-center">No data</p>; }

function Table({ rows, keyLabel }: { rows: Row[]; keyLabel: string }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 pr-4">{keyLabel}</th>
            <th className="py-2 pr-4 text-right">Clicks</th>
            <th className="py-2 pr-4 text-right">Conversions</th>
            <th className="py-2 pr-4 text-right">Rate</th>
            <th className="py-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map(r => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-2 pr-4"><code className="text-xs">{r.key}</code></td>
              <td className="py-2 pr-4 text-right">{r.clicks}</td>
              <td className="py-2 pr-4 text-right">{r.conversions}</td>
              <td className="py-2 pr-4 text-right">
                <Badge variant={r.rate >= 0.1 ? "default" : r.rate > 0 ? "secondary" : "outline"}>
                  {(r.rate * 100).toFixed(1)}%
                </Badge>
              </td>
              <td className="py-2 text-right">{r.value ? r.value.toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

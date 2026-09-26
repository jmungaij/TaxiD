/**
 * Corporate Mobility Analytics — executive view of the commercial funnel.
 *
 * Reads existing production tables only (contact_submissions, charter_quotes,
 * charter_bookings, corporate_invoices, corporate_invoice_items, ui_events) and
 * aggregates through the pure helpers in `@/lib/corporate/mobilityKpis`.
 * Filters: date range, company and service category.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  bookingsByCompany, contactCompany, formatHours, formatKes, spendByDepartment,
  summariseEnquiries, summariseFunnel, summariseQuoteConversion, summariseRevenue,
  type BookingRow, type EnquiryRow, type InvoiceItemRow, type InvoiceRow, type QuoteRow,
} from "@/lib/corporate/mobilityKpis";
import { EM_STEPS } from "@/lib/marketing/employeeMobilityFunnel";

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

interface Dataset {
  enquiries: EnquiryRow[];
  quotes: QuoteRow[];
  bookings: BookingRow[];
  invoices: InvoiceRow[];
  items: InvoiceItemRow[];
  events: Array<{ element_id: string | null }>;
}

const EMPTY: Dataset = { enquiries: [], quotes: [], bookings: [], invoices: [], items: [], events: [] };

export default function CorporateMobilityAnalytics() {
  const [from, setFrom] = React.useState(isoDaysAgo(30));
  const [to, setTo] = React.useState(isoDaysAgo(0));
  const [company, setCompany] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [data, setData] = React.useState<Dataset>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const fromISO = new Date(`${from}T00:00:00`).toISOString();
    const toISO = new Date(`${to}T23:59:59`).toISOString();
    try {
      const [enq, quo, boo, inv, items, evt] = await Promise.all([
        supabase.from("contact_submissions")
          .select("id,type,status,company,source_page,employee_count,handled_by,is_spam,created_at,updated_at")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
        supabase.from("charter_quotes")
          .select("id,reference,category_slug,total,status,contact,created_at")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
        supabase.from("charter_bookings")
          .select("id,reference,category_slug,amount,status,payment_status,contact,created_at,paid_at")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
        supabase.from("corporate_invoices")
          .select("corporate_id,status,total_cents,paid_cents,balance_cents,issued_at,paid_at")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
        supabase.from("corporate_invoice_items")
          .select("department,cost_center,employee_name,total_cents,trip_started_at,trip_ended_at")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
        supabase.from("ui_events")
          .select("element_id")
          .like("element_id", "employee_mobility.%")
          .gte("created_at", fromISO).lte("created_at", toISO).limit(1000),
      ]);
      const firstError = [enq, quo, boo, inv, items, evt].find((r) => r.error)?.error;
      if (firstError) setError(firstError.message);
      setData({
        enquiries: (enq.data ?? []) as EnquiryRow[],
        quotes: (quo.data ?? []) as QuoteRow[],
        bookings: (boo.data ?? []) as BookingRow[],
        invoices: (inv.data ?? []) as InvoiceRow[],
        items: (items.data ?? []) as InvoiceItemRow[],
        events: (evt.data ?? []) as Array<{ element_id: string | null }>,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => { void load(); }, [load]);

  const companies = React.useMemo(() => {
    const set = new Set<string>();
    for (const b of data.bookings) set.add(contactCompany(b.contact));
    for (const q of data.quotes) set.add(contactCompany(q.contact));
    for (const e of data.enquiries) if (e.company) set.add(e.company);
    return Array.from(set).sort().slice(0, 60);
  }, [data]);

  const categories = React.useMemo(
    () => Array.from(new Set([...data.quotes, ...data.bookings].map((r) => r.category_slug ?? "(none)"))).sort(),
    [data],
  );

  const filtered = React.useMemo(() => {
    const matchCompany = (c: unknown, name?: string | null) =>
      company === "all" || contactCompany(c) === company || (name ?? "") === company;
    const matchCategory = (slug: string | null) => category === "all" || (slug ?? "(none)") === category;
    return {
      enquiries: data.enquiries.filter((e) => company === "all" || (e.company ?? "") === company),
      quotes: data.quotes.filter((q) => matchCompany(q.contact) && matchCategory(q.category_slug)),
      bookings: data.bookings.filter((b) => matchCompany(b.contact) && matchCategory(b.category_slug)),
      invoices: data.invoices,
      items: data.items,
      events: data.events,
    };
  }, [data, company, category]);

  const enquiries = React.useMemo(() => summariseEnquiries(filtered.enquiries), [filtered.enquiries]);
  const conversion = React.useMemo(
    () => summariseQuoteConversion(filtered.quotes, filtered.bookings),
    [filtered.quotes, filtered.bookings],
  );
  const revenue = React.useMemo(() => summariseRevenue(filtered.invoices), [filtered.invoices]);
  const byCompany = React.useMemo(() => bookingsByCompany(filtered.bookings).slice(0, 12), [filtered.bookings]);
  const byDepartment = React.useMemo(() => spendByDepartment(filtered.items).slice(0, 12), [filtered.items]);
  const funnel = React.useMemo(() => summariseFunnel(filtered.events, EM_STEPS), [filtered.events]);

  const kpis = [
    { k: "Corporate enquiries", v: String(enquiries.total), n: `${enquiries.qualified} qualified · ${(enquiries.qualifiedRate * 100).toFixed(0)}%` },
    { k: "Avg response time", v: formatHours(enquiries.avgResponseHours), n: `${enquiries.withinSlaPct.toFixed(0)}% inside 24 h SLA` },
    { k: "Quotes issued", v: String(conversion.quotesIssued), n: `Pipeline ${formatKes(conversion.pipelineValueKes)}` },
    { k: "Quote conversion", v: `${conversion.conversionPct.toFixed(1)}%`, n: `${conversion.bookingsCreated} bookings` },
    { k: "Bookings settled", v: `${conversion.paymentCompletionPct.toFixed(0)}%`, n: `Won ${formatKes(conversion.wonValueKes)}` },
    { k: "Invoiced revenue", v: formatKes(revenue.invoicedKes), n: `Collected ${formatKes(revenue.collectedKes)}` },
    { k: "Outstanding", v: formatKes(revenue.outstandingKes), n: `${revenue.invoices} invoices · ${revenue.collectionPct.toFixed(0)}% collected` },
    { k: "Avg completion", v: formatHours(conversion.avgQuoteToBookingHours), n: `Settlement ${revenue.avgSettlementDays === null ? "—" : `${revenue.avgSettlementDays.toFixed(1)} d`}` },
  ];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Corporate Mobility Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Enquiries, quote conversion, revenue, department spend and Employee Mobility funnel retention.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="an-from" className="text-xs">From</Label>
            <Input id="an-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[9.5rem]" />
          </div>
          <div>
            <Label htmlFor="an-to" className="text-xs">To</Label>
            <Input id="an-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[9.5rem]" />
          </div>
          <div>
            <Label htmlFor="an-company" className="text-xs">Company</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger id="an-company" className="h-9 w-48"><SelectValue placeholder="All companies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="an-category" className="text-xs">Service</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="an-category" className="h-9 w-44"><SelectValue placeholder="All services" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span>Some datasets could not be read: {error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((m) => (
            <Card key={m.k}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.k}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{m.v}</div>
                <p className="mt-1 text-xs text-muted-foreground">{m.n}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">By company</TabsTrigger>
          <TabsTrigger value="departments">By department</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="enquiries">Enquiry sources</TabsTrigger>
        </TabsList>

        <TabsContent value="companies">
          <Card>
            <CardHeader><CardTitle className="text-base">Bookings and revenue by company</CardTitle></CardHeader>
            <CardContent>
              {byCompany.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings in this period.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCompany} layout="vertical" margin={{ left: 24, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <YAxis type="category" dataKey="key" width={150} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => formatKes(Number(v))} />
                      <Bar dataKey="amountKes" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <Card>
            <CardHeader><CardTitle className="text-base">Invoiced spend by department</CardTitle></CardHeader>
            <CardContent>
              {byDepartment.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoiced trips in this period.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {byDepartment.map((d) => (
                    <li key={d.key} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <span className="font-medium">{d.key}</span>
                      <span className="flex items-center gap-3 text-muted-foreground">
                        <span>{d.bookings} trips</span>
                        <Badge variant="secondary">{d.sharePct.toFixed(1)}%</Badge>
                        <span className="font-semibold text-foreground">{formatKes(d.amountKes)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader><CardTitle className="text-base">Employee Mobility funnel retention</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {funnel.steps.filter((s) => s.count > 0).length === 0 ? (
                  <li className="text-sm text-muted-foreground">No funnel events recorded in this period.</li>
                ) : (
                  funnel.steps.map((s) => (
                    <li key={s.step} className="flex items-center gap-3 text-sm">
                      <span className="w-56 shrink-0 truncate">{s.step.replace(/_/g, " ")}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, s.retentionPct)}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-muted-foreground">
                        {s.count} · {s.retentionPct.toFixed(0)}%
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Abandonment events recorded: {funnel.abandoned}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enquiries">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Enquiries by source page</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {enquiries.bySource.slice(0, 10).map((s) => (
                    <li key={s.key} className="flex justify-between py-2 text-sm">
                      <span className="truncate">{s.key}</span>
                      <span className="font-semibold">{s.count}</span>
                    </li>
                  ))}
                  {enquiries.bySource.length === 0 && (
                    <li className="py-2 text-sm text-muted-foreground">No enquiries in this period.</li>
                  )}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Enquiries by type</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {enquiries.byType.map((s) => (
                    <li key={s.key} className="flex justify-between py-2 text-sm">
                      <span>{s.key}</span>
                      <span className="font-semibold">{s.count}</span>
                    </li>
                  ))}
                  {enquiries.byType.length === 0 && (
                    <li className="py-2 text-sm text-muted-foreground">No enquiries in this period.</li>
                  )}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Avg resolution {formatHours(enquiries.avgResolutionHours)} · {enquiries.open} still open · {enquiries.spam} filtered as spam
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

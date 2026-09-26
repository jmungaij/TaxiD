/**
 * Pricing intelligence — rate card performance, market position, negotiated
 * prices, discounts and margin, read from `pricing_intelligence_summary`.
 * Every figure comes from stored quotation lines and negotiations; where cost
 * or competitor data is absent, the panel says so instead of estimating.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  type PricingIntelligence as Summary,
  fetchCompetitorObservations,
  fetchPricingIntelligence,
} from "@/lib/pricing/competitive";

const money = (n: number | null | undefined, currency = "KES") =>
  n == null ? "—" : `${currency} ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(1)}%`;

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function PricingIntelligence({
  serviceLabel,
  categoryLabel,
}: {
  serviceLabel: (code: string) => string;
  categoryLabel: (code: string) => string;
}) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [observations, setObservations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, obs] = await Promise.all([
        fetchPricingIntelligence(from, to),
        fetchCompetitorObservations(50).catch(() => []),
      ]);
      setSummary(s);
      setObservations(obs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error("Pricing intelligence could not be loaded", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const lanes = useMemo(() => summary?.by_lane ?? [], [summary]);
  const owners = useMemo(() => summary?.by_owner ?? [], [summary]);

  const totals = useMemo(() => {
    const recommended = lanes.reduce((s, l) => s + Number(l.recommended_total ?? 0), 0);
    const sold = lanes.reduce((s, l) => s + Number(l.sold_total ?? 0), 0);
    const marginRows = lanes.filter((l) => l.margin_total != null);
    const marginTotal = marginRows.reduce((s, l) => s + Number(l.margin_total ?? 0), 0);
    const discounted = lanes.reduce((s, l) => s + Number(l.discounted_lines ?? 0), 0);
    const premium = lanes.reduce((s, l) => s + Number(l.premium_lines ?? 0), 0);
    return {
      recommended,
      sold,
      variance: recommended > 0 ? ((sold - recommended) / recommended) * 100 : null,
      marginTotal: marginRows.length ? marginTotal : null,
      marginPercent: marginRows.length && sold > 0 ? (marginTotal / sold) * 100 : null,
      discounted,
      premium,
    };
  }, [lanes]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle className="text-base">Pricing intelligence</CardTitle>
            <CardDescription>
              How the published rate card is performing against what customers actually paid.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Recommended value" value={money(totals.recommended)} />
            <Metric
              label="Sold value"
              value={money(totals.sold)}
              hint={`Variance ${pct(totals.variance)} against the rate card`}
            />
            <Metric
              label="Margin on sold value"
              value={money(totals.marginTotal)}
              hint={
                totals.marginTotal == null
                  ? "No cost baselines recorded for these lanes"
                  : `${totals.marginPercent?.toFixed(1)}% of sold value`
              }
            />
            <Metric
              label="Negotiations"
              value={String(summary?.negotiations ?? 0)}
              hint={`${summary?.approval_required ?? 0} needed approval · ${
                summary?.pending_approval ?? 0
              } still pending`}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{totals.discounted} line(s) sold below recommendation</Badge>
            <Badge variant="outline">{totals.premium} line(s) sold above recommendation</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rate card performance by lane</CardTitle>
          <CardDescription>
            {lanes.length === 0
              ? "No quoted lines in this period."
              : "Each destination and vehicle class, recommended against sold."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lanes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Recommended</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Avg variance</TableHead>
                  <TableHead className="text-right">Below / above</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lanes.map((l) => (
                  <TableRow key={`${l.service_code}-${l.scope_label}-${l.category_code}`}>
                    <TableCell>{serviceLabel(l.service_code)}</TableCell>
                    <TableCell>{l.scope_label}</TableCell>
                    <TableCell>{categoryLabel(l.category_code)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.lines}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.recommended_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.sold_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(l.avg_variance_percent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.discounted_lines ?? 0} / {l.premium_lines ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.margin_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Negotiation behaviour by specialist</CardTitle>
            <CardDescription>
              {owners.length === 0 ? "No owned quotations in this period." : "Who sells at what level."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {owners.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Specialist</TableHead>
                    <TableHead className="text-right">Quotations</TableHead>
                    <TableHead className="text-right">Sold value</TableHead>
                    <TableHead className="text-right">Avg variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owners.map((o) => (
                    <TableRow key={o.owner_staff_id ?? "unassigned"}>
                      <TableCell>{o.owner_name ?? "NOT STATED"}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.quotations}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(o.sold_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(o.avg_variance_percent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Market position</CardTitle>
            <CardDescription>
              {observations.length === 0
                ? "No competitor prices recorded yet — market comparison stays blank until one is observed."
                : "Competitor prices observed by the commercial team."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {observations.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competitor</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Observed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {observations.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.competitor}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {serviceLabel(o.service_code)} · {o.scope_label} · {categoryLabel(o.category_code)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(Number(o.amount), o.currency ?? "KES")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.observed_on}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

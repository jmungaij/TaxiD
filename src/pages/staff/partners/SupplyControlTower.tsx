/**
 * TaxiD PARTNERS 360 — Supply control tower.
 *
 * Live capacity against open demand, per city and service line. Every row is
 * aggregated server-side (`partner_supply_coverage`) from partner supply assets
 * that are linked to verified drivers/vehicles in their canonical masters, so
 * nothing here is a projection. Supply status changes go through the governed
 * routine and are audited.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Layers, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchPartners, partnerName } from "@/lib/partners/api";
import {
  fetchCoverage, fetchSupplyAssets, setSupplyStatus, type SupplyAsset,
} from "@/lib/partners/marketplace";

function Gap({ available, required }: { available: number; required: number }) {
  const gap = required - available;
  if (required === 0) return <span className="text-muted-foreground">No open demand</span>;
  if (gap <= 0) return <Badge variant="outline" className="border-success/40 text-success">Covered</Badge>;
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      Short {gap}
    </Badge>
  );
}

export default function SupplyControlTower() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const coverage = useQuery({ queryKey: ["yp-coverage"], queryFn: fetchCoverage });
  const assets = useQuery({ queryKey: ["yp-supply"], queryFn: () => fetchSupplyAssets() });
  const partners = useQuery({ queryKey: ["yp-partners"], queryFn: fetchPartners });

  const partnerLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of partners.data ?? []) map.set(p.id, partnerName(p));
    return map;
  }, [partners.data]);

  const status = useMutation({
    mutationFn: (v: { id: string; next: SupplyAsset["status"] }) => setSupplyStatus(v.id, v.next),
    onSuccess: () => {
      toast.success("Supply status updated and audited.");
      void qc.invalidateQueries({ queryKey: ["yp-supply"] });
      void qc.invalidateQueries({ queryKey: ["yp-coverage"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const rows = coverage.data ?? [];
  const assetRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = assets.data ?? [];
    if (!needle) return all;
    return all.filter((a) =>
      [a.label, a.city, a.vehicle_class, a.asset_kind, partnerLabel.get(a.partner_id)]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));
  }, [assets.data, q, partnerLabel]);

  const totals = useMemo(() => ({
    capacity: rows.reduce((s, r) => s + Number(r.available_capacity), 0),
    demand: rows.reduce((s, r) => s + Number(r.open_demand), 0),
    shortfall: rows.reduce((s, r) => s + Math.max(0, Number(r.required_capacity) - Number(r.available_capacity)), 0),
    expiring: (assets.data ?? []).filter((a) => a.compliance_expires_at && new Date(a.compliance_expires_at) < new Date(Date.now() + 45 * 864e5)).length,
  }), [rows, assets.data]);

  if (coverage.isLoading || assets.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="TaxiD Partners 360"
        title="Supply control tower"
        lede="Verified partner capacity measured against open demand, by city and service line."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Available capacity", value: String(totals.capacity), hint: "Compliant, available assets" },
          { label: "Open demand", value: String(totals.demand), hint: "Unmatched supply requests" },
          { label: "Capacity shortfall", value: String(totals.shortfall), hint: "Seats/units short of demand" },
          { label: "Compliance expiring", value: String(totals.expiring), hint: "Within 45 days" },
        ].map((k) => (
          <div key={k.label} className="glass-panel rounded-xl border border-border/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="coverage" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="coverage"><Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Coverage</TabsTrigger>
          <TabsTrigger value="assets">Supply register</TabsTrigger>
        </TabsList>

        <TabsContent value="coverage">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Capacity vs demand</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {rows.length === 0 ? (
                <div className="space-y-3 py-4 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    No verified supply and no open demand are recorded yet, so coverage cannot be measured.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm"><Link to="/staff/partners">Review admissions</Link></Button>
                    <Button asChild size="sm" variant="outline"><Link to="/staff/partners/matching">Open demand desk</Link></Button>
                  </div>
                </div>
              ) : (
                <table className="w-full min-w-[46rem] text-sm">
                  <caption className="sr-only">Supply coverage by city and service</caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-4">City</th>
                      <th scope="col" className="py-2 pr-4">Service</th>
                      <th scope="col" className="py-2 pr-4 text-right">Capacity</th>
                      <th scope="col" className="py-2 pr-4 text-right">Assets</th>
                      <th scope="col" className="py-2 pr-4 text-right">Partners</th>
                      <th scope="col" className="py-2 pr-4 text-right">Open demand</th>
                      <th scope="col" className="py-2 pr-4 text-right">Required</th>
                      <th scope="col" className="py-2">Position</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={`${r.city}-${r.service_type}`}>
                        <td className="py-2 pr-4 font-medium">{r.city}</td>
                        <td className="py-2 pr-4">{r.service_type}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{r.available_capacity}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{r.available_assets}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{r.qualified_partners}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{r.open_demand}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{r.required_capacity}</td>
                        <td className="py-2"><Gap available={Number(r.available_capacity)} required={Number(r.required_capacity)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="supply-search" className="text-xs">Search supply</Label>
            <Input id="supply-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset, partner, city…" />
          </div>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              {assetRows.length === 0 ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>No verified supply is currently registered, so no demand can be fulfilled through partners.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm"><Link to="/staff/partners">Open partner network</Link></Button>
                    <Button asChild size="sm" variant="outline"><Link to="/staff/partners/work">Review onboarding queues</Link></Button>
                  </div>
                </div>
              ) : (
                <table className="w-full min-w-[46rem] text-sm">
                  <caption className="sr-only">Partner supply register</caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-4">Asset</th>
                      <th scope="col" className="py-2 pr-4">Partner</th>
                      <th scope="col" className="py-2 pr-4">Services</th>
                      <th scope="col" className="py-2 pr-4 text-right">Capacity</th>
                      <th scope="col" className="py-2 pr-4">Compliance</th>
                      <th scope="col" className="py-2 pr-4">Status</th>
                      <th scope="col" className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {assetRows.map((a) => {
                      const expired = a.compliance_expires_at && new Date(a.compliance_expires_at) < new Date();
                      return (
                        <tr key={a.id}>
                          <td className="py-2 pr-4">
                            <p className="font-medium">{a.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.asset_kind}{a.city ? ` · ${a.city}` : ""}{a.is_demo ? " · DEMO DATA" : ""}
                            </p>
                          </td>
                          <td className="py-2 pr-4">
                            <Link to={`/staff/partners/${a.partner_id}`} className="hover:underline">
                              {partnerLabel.get(a.partner_id) ?? "—"}
                            </Link>
                          </td>
                          <td className="py-2 pr-4">{a.service_types.length ? a.service_types.join(", ") : "Unscoped"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{a.capacity}</td>
                          <td className="py-2 pr-4">
                            {a.compliance_expires_at
                              ? <span className={expired ? "text-destructive" : undefined}>{new Date(a.compliance_expires_at).toLocaleDateString()}</span>
                              : <span className="text-muted-foreground">Not tracked</span>}
                          </td>
                          <td className="py-2 pr-4"><Badge variant="outline" className="text-[10px] uppercase">{a.status}</Badge></td>
                          <td className="py-2 text-right">
                            {a.status === "AVAILABLE" ? (
                              <Button size="sm" variant="outline" disabled={status.isPending}
                                onClick={() => status.mutate({ id: a.id, next: "UNAVAILABLE" })}>
                                Stand down
                              </Button>
                            ) : a.status === "RETIRED" ? null : (
                              <Button size="sm" disabled={status.isPending}
                                onClick={() => status.mutate({ id: a.id, next: "AVAILABLE" })}>
                                Make available
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <Button size="sm" variant="outline" onClick={() => { void qc.invalidateQueries({ queryKey: ["yp-supply"] }); void qc.invalidateQueries({ queryKey: ["yp-coverage"] }); }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh supply picture
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

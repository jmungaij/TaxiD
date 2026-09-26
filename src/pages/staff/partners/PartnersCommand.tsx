/**
 * YALLA PARTNERS OPERATIONS SYSTEM — network command centre.
 *
 * The staff view of the distribution network: who is in it, who is waiting to
 * be let in, what they are selling and what supply they are asking for.
 * Every number is derived from recorded partner orders — nothing is projected,
 * and demonstration partners stay labelled as such.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Handshake, Inbox, Layers, ShieldAlert, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COMMERCIAL_MODEL_LABEL, PARTNER_TYPE_LABEL, SERVICE_TYPE_LABEL, fetchAllOrders,
  fetchCapacityRequests, fetchPartnerApplications, fetchPartners, kes, ordersByService,
  partnerName, reviewPartnerApplication, setPartnerStatus, summariseOrders,
} from "@/lib/partners/api";
import { promoteApplication } from "@/lib/partners/lifecycle";
import {
  fetchCoverage, fetchQuotes, fetchRiskFlags, fetchSupplyAssets,
} from "@/lib/partners/marketplace";


function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-panel rounded-xl border border-border/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function PartnersCommand() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const partners = useQuery({ queryKey: ["yp-partners"], queryFn: fetchPartners });
  const orders = useQuery({ queryKey: ["yp-all-orders"], queryFn: () => fetchAllOrders() });
  const applications = useQuery({ queryKey: ["yp-applications"], queryFn: fetchPartnerApplications });
  const capacity = useQuery({ queryKey: ["yp-capacity"], queryFn: () => fetchCapacityRequests() });
  const supply = useQuery({ queryKey: ["yp-supply"], queryFn: () => fetchSupplyAssets() });
  const coverage = useQuery({ queryKey: ["yp-coverage"], queryFn: fetchCoverage });
  const quotes = useQuery({ queryKey: ["yp-quotes-all"], queryFn: () => fetchQuotes() });
  const risk = useQuery({ queryKey: ["yp-risk"], queryFn: () => fetchRiskFlags() });


  const rows = partners.data ?? [];
  const allOrders = orders.data ?? [];
  const metrics = useMemo(() => summariseOrders(allOrders), [allOrders]);
  const byService = useMemo(() => ordersByService(allOrders), [allOrders]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((p) =>
      [p.legal_name, p.trading_name, p.partner_code, p.city, p.country]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const perPartner = useMemo(() => {
    const map = new Map<string, { orders: number; gross: number; yalla: number }>();
    for (const o of allOrders) {
      const cur = map.get(o.partner_id) ?? { orders: 0, gross: 0, yalla: 0 };
      cur.orders += 1;
      cur.gross += Number(o.customer_price);
      cur.yalla += Number(o.yalla_margin);
      map.set(o.partner_id, cur);
    }
    return map;
  }, [allOrders]);

  const review = useMutation({
    mutationFn: async (v: { id: string; decision: "approved" | "rejected" }) => {
      // Approval is a lifecycle event, not a status flip: the server creates the
      // partner, its wallet and one onboarding case per missing document.
      if (v.decision === "approved") return promoteApplication(v.id);
      return reviewPartnerApplication(v.id, "rejected", "");
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approved"
        ? "Partner created — onboarding documents now required."
        : "Application rejected.");
      void qc.invalidateQueries({ queryKey: ["yp-applications"] });
      void qc.invalidateQueries({ queryKey: ["yp-partners"] });
      void qc.invalidateQueries({ queryKey: ["yp-cases"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Decision failed."),
  });

  const status = useMutation({
    mutationFn: (v: { id: string; next: "active" | "suspended" }) => setPartnerStatus(v.id, { status: v.next }),
    onSuccess: () => {
      toast.success("Partner status updated.");
      void qc.invalidateQueries({ queryKey: ["yp-partners"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const pendingApps = (applications.data ?? []).filter((a) => a.status === "submitted" || a.status === "in_review");
  const openCapacity = (capacity.data ?? []).filter((c) => c.status === "open" || c.status === "sourcing");
  const maxService = Math.max(1, ...byService.map((s) => s.value));

  // Marketplace signals. A failed feed renders "—", never a confident zero.
  const supplyAssets = supply.data ?? [];
  const verifiedSupply = supplyAssets.filter((a) => a.status === "AVAILABLE" || a.status === "APPROVED").length;
  const supplyCapacity = supplyAssets
    .filter((a) => a.status === "AVAILABLE" || a.status === "APPROVED")
    .reduce((s, a) => s + Number(a.capacity), 0);
  const openRisk = (risk.data ?? []).filter((f) => f.state === "OPEN" || f.state === "INVESTIGATING");
  const criticalRisk = openRisk.filter((f) => f.severity === "critical").length;
  const openQuotes = (quotes.data ?? []).filter((q2) =>
    ["REQUESTED", "VIEWED", "DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(q2.state)).length;
  const shortfall = (coverage.data ?? []).reduce(
    (s, r) => s + Math.max(0, Number(r.required_capacity) - Number(r.available_capacity)), 0);


  if (partners.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Yalla Partners Operations System"
        title="Partner network command"
        lede="Distribution partners, their commercial position, pending admissions and open supply requests — one operating picture."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Partners" value={String(rows.length)} hint={`${rows.filter((p) => p.status === "active").length} active`} />
        <Kpi label="Pending admissions" value={String(pendingApps.length)} hint="Awaiting screening or approval" />
        <Kpi label="Verified supply" value={supply.isError ? "—" : String(verifiedSupply)} hint={supply.isError ? "Supply feed unavailable" : `${supplyCapacity} units of capacity`} />
        <Kpi label="Open demand" value={String(openCapacity.length)} hint="Unmatched supply requests" />
        <Kpi label="Network orders" value={String(metrics.orders)} hint={`${metrics.openOrders} in progress`} />
        <Kpi label="Gross booked value" value={kes(metrics.grossValue)} hint="Customer-facing, VAT inclusive" />
        <Kpi label="Yalla margin" value={kes(metrics.yallaMargin)} hint={`Partners earned ${kes(metrics.partnerEarnings)}`} />
        <Kpi label="Open risk flags" value={risk.isError ? "—" : String(openRisk.length)} hint={risk.isError ? "Risk feed unavailable" : `${criticalRisk} critical`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden /> Live operations
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Urgent admissions", value: pendingApps.length, to: "/staff/partners/work", cta: "Open work queues" },
            { label: "Open quotes", value: openQuotes, to: "/staff/partners/matching", cta: "Open demand desk" },
            { label: "Capacity shortfall", value: shortfall, to: "/staff/partners/supply", cta: "Open supply tower" },
            { label: "Risk requiring action", value: openRisk.length, to: "/staff/partners/risk", cta: "Open risk centre" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{item.value}</p>
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link to={item.to}>{item.cta}</Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>


      <Tabs defaultValue="network" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="network"><Handshake className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Network</TabsTrigger>
          <TabsTrigger value="admissions">
            <Inbox className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Admissions
            {pendingApps.length > 0 && <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{pendingApps.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="mix"><TrendingUp className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Service mix</TabsTrigger>
          <TabsTrigger value="capacity">
            <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Supply requests
            {openCapacity.length > 0 && <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{openCapacity.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------------- network */}
        <TabsContent value="network" className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="yp-search" className="text-xs">Search partners</Label>
            <Input id="yp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code, city…" />
          </div>

          {filtered.length === 0 ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">
              {rows.length === 0
                ? "No partners are on the network yet. Approve an application under Admissions to create the first partner account."
                : "No partners match this search."}
            </CardContent></Card>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto pt-6">
                <table className="w-full text-sm">
                  <caption className="sr-only">Yalla partner network</caption>
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-4">Partner</th>
                      <th scope="col" className="py-2 pr-4">Category</th>
                      <th scope="col" className="py-2 pr-4">Model</th>
                      <th scope="col" className="py-2 pr-4">State</th>
                      <th scope="col" className="py-2 pr-4 text-right">Orders</th>
                      <th scope="col" className="py-2 pr-4 text-right">Gross</th>
                      <th scope="col" className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((p) => {
                      const agg = perPartner.get(p.id);
                      return (
                        <tr key={p.id}>
                          <td className="py-2 pr-4">
                            <Link to={`/staff/partners/${p.id}`} className="font-medium hover:underline">{partnerName(p)}</Link>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{p.partner_code}</span>
                              {p.city ? ` · ${p.city}` : ""}{p.country ? `, ${p.country}` : ""}
                              {p.is_demo ? " · DEMO DATA" : ""}
                            </p>
                          </td>
                          <td className="py-2 pr-4">{PARTNER_TYPE_LABEL[p.partner_type]}</td>
                          <td className="py-2 pr-4">{COMMERCIAL_MODEL_LABEL[p.commercial_model].split(" — ")[0]}</td>
                          <td className="py-2 pr-4">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px] uppercase">{p.status}</Badge>
                              <Badge variant="outline" className="text-[10px] uppercase">{p.verification_status.split("_").join(" ")}</Badge>
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">{agg?.orders ?? 0}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(agg?.gross ?? 0)}</td>
                          <td className="py-2 text-right">
                            {p.status === "active" ? (
                              <Button size="sm" variant="outline" onClick={() => status.mutate({ id: p.id, next: "suspended" })} disabled={status.isPending}>
                                Suspend
                              </Button>
                            ) : (
                              <Button size="sm" onClick={() => status.mutate({ id: p.id, next: "active" })} disabled={status.isPending}>
                                Activate
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----------------------------------------------------- admissions */}
        <TabsContent value="admissions" className="space-y-4">
          {(applications.data ?? []).length === 0 ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">No partner applications received.</CardContent></Card>
          ) : (
            (applications.data ?? []).map((a) => (
              <Card key={a.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {a.organisation_name}
                    <Badge variant="outline" className="text-[10px] uppercase">{a.status.split("_").join(" ")}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{a.reference}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Category</dt><dd>{PARTNER_TYPE_LABEL[a.partner_type]}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Model</dt><dd>{COMMERCIAL_MODEL_LABEL[a.commercial_model].split(" — ")[0]}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{a.contact_name} · {a.contact_email}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Location</dt><dd>{[a.city, a.country].filter(Boolean).join(", ") || "—"}</dd></div>
                  </dl>
                  {a.requirements && <p className="rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground">{a.requirements}</p>}
                  {(a.status === "submitted" || a.status === "in_review") && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => review.mutate({ id: a.id, decision: "approved" })} disabled={review.isPending}>
                        Approve &amp; create partner <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => review.mutate({ id: a.id, decision: "rejected" })} disabled={review.isPending}>
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ------------------------------------------------------------ mix */}
        <TabsContent value="mix">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Booked value by service line</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {byService.length === 0 ? (
                <p className="text-sm text-muted-foreground">No partner orders recorded yet.</p>
              ) : (
                byService.map((s) => (
                  <div key={s.service} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{SERVICE_TYPE_LABEL[s.service]}</span>
                      <span className="tabular-nums">{s.count} · {kes(s.value)}</span>
                    </div>
                    <Progress value={(s.value / maxService) * 100} className="h-1.5" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- capacity */}
        <TabsContent value="capacity">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Open supply requests</CardTitle></CardHeader>
            <CardContent>
              {openCapacity.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" aria-hidden /> No open capacity requests from partners.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {openCapacity.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <p className="font-medium">{c.origin_label}{c.destination_label ? ` → ${c.destination_label}` : ""}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{c.request_code}</span> · {SERVICE_TYPE_LABEL[c.service_type]}
                          {c.passengers ? ` · ${c.passengers} pax` : ""}
                          {c.needed_at ? ` · ${new Date(c.needed_at).toLocaleString()}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase">{c.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * YALLA PARTNERS — partner workspace.
 *
 * The authenticated surface a partner's own team uses: their customer register,
 * the "book for a customer" order desk, journeys, capacity requests and their
 * commercial position. Every read is RLS-scoped to the partner(s) the signed-in
 * login is an active member of — the page never asks for a partner id it was
 * not granted.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Building2, FileCheck2, Layers, ListChecks, Plus, Route as RouteIcon, ShieldAlert,
  Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";

import MarketingLayout from "@/components/marketing/MarketingLayout";
import { PartnerDocumentUploadPanel } from "@/components/partners/PartnerDocumentUploadPanel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  COMMERCIAL_MODEL_LABEL, PARTNER_TYPE_LABEL, SERVICE_TYPE_LABEL, createCapacityRequest,
  createPartnerCustomer, createPartnerOrder, fetchCapacityRequests, fetchMyPartnerships,
  fetchPartnerCustomers, fetchPartnerJourneys, fetchPartnerOrders, kes, ordersByService,
  partnerName, priceOrder, summariseOrders, type ServiceType,
} from "@/lib/partners/api";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MarketingLayout>
      <div className="container mx-auto px-4 py-12">{children}</div>
    </MarketingLayout>
  );
}

const WORKSPACE_TABS = [
  "overview", "book", "orders", "customers", "journeys", "capacity", "documents",
] as const;

export default function PartnerWorkspace() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const memberships = useQuery({
    queryKey: ["partner-memberships", user?.id],
    queryFn: () => fetchMyPartnerships(user!.id),
    enabled: Boolean(user?.id),
  });

  const [selected, setSelected] = useState<string>("");
  // Deep-linkable tab, so public lifecycle CTAs land on the right surface.
  const [tab, setTab] = useDeepParam("tab", WORKSPACE_TABS, "overview");
  const list = memberships.data ?? [];
  const activeId = selected || list[0]?.partner_id || "";
  const membership = list.find((m) => m.partner_id === activeId);
  const partner = membership?.partner;
  const enabled = Boolean(activeId);

  const orders = useQuery({ queryKey: ["partner-orders", activeId], queryFn: () => fetchPartnerOrders(activeId), enabled });
  const customers = useQuery({ queryKey: ["partner-customers", activeId], queryFn: () => fetchPartnerCustomers(activeId), enabled });
  const journeys = useQuery({ queryKey: ["partner-journeys", activeId], queryFn: () => fetchPartnerJourneys(activeId), enabled });
  const capacity = useQuery({ queryKey: ["partner-capacity", activeId], queryFn: () => fetchCapacityRequests(activeId), enabled });

  const metrics = useMemo(() => summariseOrders(orders.data ?? []), [orders.data]);
  const byService = useMemo(() => ordersByService(orders.data ?? []), [orders.data]);

  /* ---------------------------------------------------------- new customer */
  const [cust, setCust] = useState({ full_name: "", phone: "", email: "", organisation: "" });
  const addCustomer = useMutation({
    mutationFn: () => createPartnerCustomer(activeId, cust),
    onSuccess: () => {
      toast.success("Customer added to your register.");
      setCust({ full_name: "", phone: "", email: "", organisation: "" });
      void qc.invalidateQueries({ queryKey: ["partner-customers", activeId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add the customer."),
  });

  /* ------------------------------------------------------------- new order */
  const [order, setOrder] = useState({
    partner_customer_id: "",
    service_type: "RIDE" as ServiceType,
    pickup_label: "",
    destination_label: "",
    scheduled_at: "",
    passengers: 1,
    vehicle_class: "",
    supplier_cost: 0,
    special_requirements: "",
  });
  const quote = useMemo(
    () => priceOrder(order.supplier_cost, Number(partner?.partner_margin_pct ?? 0)),
    [order.supplier_cost, partner?.partner_margin_pct],
  );
  const placeOrder = useMutation({
    mutationFn: () =>
      createPartnerOrder(
        { id: activeId, partner_margin_pct: Number(partner?.partner_margin_pct ?? 0) },
        {
          partner_customer_id: order.partner_customer_id || null,
          service_type: order.service_type,
          pickup_label: order.pickup_label,
          destination_label: order.destination_label,
          scheduled_at: order.scheduled_at ? new Date(order.scheduled_at).toISOString() : null,
          passengers: Number(order.passengers) || 1,
          vehicle_class: order.vehicle_class,
          supplier_cost: Number(order.supplier_cost) || 0,
          special_requirements: order.special_requirements,
        },
      ),
    onSuccess: (created) => {
      toast.success(`Order ${created.order_code} submitted for quotation.`);
      setOrder((o) => ({ ...o, pickup_label: "", destination_label: "", special_requirements: "", supplier_cost: 0 }));
      void qc.invalidateQueries({ queryKey: ["partner-orders", activeId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not submit the order."),
  });

  /* ---------------------------------------------------------- new capacity */
  const [cap, setCap] = useState({ service_type: "CHARTER" as ServiceType, origin_label: "", destination_label: "", needed_at: "", passengers: 0, requirements: "" });
  const askCapacity = useMutation({
    mutationFn: () =>
      createCapacityRequest(activeId, {
        service_type: cap.service_type,
        origin_label: cap.origin_label,
        destination_label: cap.destination_label,
        needed_at: cap.needed_at ? new Date(cap.needed_at).toISOString() : null,
        passengers: cap.passengers || null,
        requirements: cap.requirements,
      }),
    onSuccess: () => {
      toast.success("Capacity request sent to the Yalla supply desk.");
      setCap({ service_type: "CHARTER", origin_label: "", destination_label: "", needed_at: "", passengers: 0, requirements: "" });
      void qc.invalidateQueries({ queryKey: ["partner-capacity", activeId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not send the request."),
  });

  /* --------------------------------------------------------------- guards */
  if (loading || (user && memberships.isLoading)) {
    return (
      <Shell>
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="mt-3 h-4 w-2/3" />
        <Skeleton className="mt-6 h-64 w-full" />
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl">
          <CardContent className="space-y-4 pt-6">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Yalla Partners</Badge>
            <h1 className="text-2xl font-bold tracking-tight">Sign in to your partner workspace</h1>
            <p className="text-sm text-muted-foreground">
              Partner workspaces are opened by the Yalla partner desk after verification and contracting.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link to="/auth?redirect=%2Fpartner%2Fworkspace">Sign in</Link></Button>
              <AppButton variant="outline" analytics="partner_workspace_signin_apply" action="navigate" target="/partners/apply">Apply to become a partner</AppButton>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (list.length === 0) {
    return (
      <Shell>
        <Card className="mx-auto max-w-2xl border-warning/40">
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> No partner workspace linked
            </div>
            <h1 className="text-2xl font-bold tracking-tight">This login is not linked to a Yalla partner.</h1>
            <p className="text-sm text-muted-foreground">
              A workspace opens once the partner desk links your login to a verified partner account.
              Nothing has been substituted in its place.
            </p>
            <div className="flex flex-wrap gap-2">
              <AppButton variant="outline" analytics="partner_workspace_unlinked_apply" action="navigate" target="/partners/apply">Apply to become a partner</AppButton>
              <Button variant="outline" asChild><Link to="/partners">Yalla Partners</Link></Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Header */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Yalla Partners</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {partner ? partnerName(partner) : "Partner workspace"}
          </h1>
          {partner && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{PARTNER_TYPE_LABEL[partner.partner_type]}</span>
              <span aria-hidden>·</span>
              <span>{COMMERCIAL_MODEL_LABEL[partner.commercial_model].split(" — ")[0]}</span>
              <span aria-hidden>·</span>
              <span>Your margin {Number(partner.partner_margin_pct)}%</span>
              <Badge variant="outline" className="text-[10px] uppercase">{partner.status}</Badge>
              <Badge variant="outline" className="text-[10px] uppercase">{partner.verification_status.replace("_", " ")}</Badge>
              {partner.is_demo && <Badge variant="outline" className="text-[10px] uppercase text-warning">Demo data</Badge>}
            </p>
          )}
        </div>
        {list.length > 1 && (
          <div className="w-64">
            <Label htmlFor="partner-switch" className="text-xs">Partner account</Label>
            <Select value={activeId} onValueChange={setSelected}>
              <SelectTrigger id="partner-switch"><SelectValue /></SelectTrigger>
              <SelectContent>
                {list.map((m) => (
                  <SelectItem key={m.partner_id} value={m.partner_id}>{partnerName(m.partner)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      {partner && partner.status !== "active" && (
        <Card className="mb-6 border-warning/40">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
            <span>
              This partner account is <strong>{partner.status}</strong>. Orders can be drafted, but Yalla
              will not allocate supply until the account is active and verified.
            </span>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview"><Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Overview</TabsTrigger>
          <TabsTrigger value="book"><Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Book for a customer</TabsTrigger>
          <TabsTrigger value="orders"><ListChecks className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Orders</TabsTrigger>
          <TabsTrigger value="customers"><Users className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Customers</TabsTrigger>
          <TabsTrigger value="journeys"><Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Journeys</TabsTrigger>
          <TabsTrigger value="capacity"><RouteIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Capacity</TabsTrigger>
          <TabsTrigger value="documents"><FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Documents</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- documents */}
        <TabsContent value="documents">
          <PartnerDocumentUploadPanel partnerId={activeId} />
        </TabsContent>



        {/* ------------------------------------------------------- overview */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Orders" value={String(metrics.orders)} hint={`${metrics.openOrders} in progress`} />
            <Kpi label="Gross booked value" value={kes(metrics.grossValue)} hint="Customer-facing, VAT inclusive" />
            <Kpi label="Your earnings" value={kes(metrics.partnerEarnings)} hint="Contracted partner margin" />
            <Kpi
              label="Completion rate"
              value={metrics.onTimeRate === null ? "No closed orders" : `${metrics.onTimeRate}%`}
              hint={metrics.exceptions > 0 ? `${metrics.exceptions} exception(s)` : "Completed vs exception"}
            />
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Where your value comes from</CardTitle></CardHeader>
            <CardContent>
              {byService.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet. Place your first order from “Book for a customer”.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {byService.map((r) => (
                    <li key={r.service} className="flex items-center justify-between py-2 text-sm">
                      <span>{SERVICE_TYPE_LABEL[r.service]}</span>
                      <span className="text-muted-foreground tabular-nums">{r.count} · {kes(r.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- book */}
        <TabsContent value="book">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Book on behalf of your customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="o-customer">Customer</Label>
                  <Select value={order.partner_customer_id} onValueChange={(v) => setOrder((o) => ({ ...o, partner_customer_id: v }))}>
                    <SelectTrigger id="o-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger>
                    <SelectContent>
                      {(customers.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="o-service">Service</Label>
                  <Select value={order.service_type} onValueChange={(v) => setOrder((o) => ({ ...o, service_type: v as ServiceType }))}>
                    <SelectTrigger id="o-service"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SERVICE_TYPE_LABEL).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="o-pickup">Pickup</Label>
                  <Input id="o-pickup" value={order.pickup_label} onChange={(e) => setOrder((o) => ({ ...o, pickup_label: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="o-dest">Destination</Label>
                  <Input id="o-dest" value={order.destination_label} onChange={(e) => setOrder((o) => ({ ...o, destination_label: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="o-when">Scheduled for</Label>
                  <Input id="o-when" type="datetime-local" value={order.scheduled_at} onChange={(e) => setOrder((o) => ({ ...o, scheduled_at: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="o-pax">Passengers / units</Label>
                  <Input id="o-pax" type="number" min={1} value={order.passengers} onChange={(e) => setOrder((o) => ({ ...o, passengers: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label htmlFor="o-class">Vehicle class</Label>
                  <Input id="o-class" placeholder="Executive sedan, 33-seat coach…" value={order.vehicle_class} onChange={(e) => setOrder((o) => ({ ...o, vehicle_class: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="o-cost">Agreed supplier cost (KES)</Label>
                  <Input id="o-cost" type="number" min={0} value={order.supplier_cost} onChange={(e) => setOrder((o) => ({ ...o, supplier_cost: Number(e.target.value) }))} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="o-notes">Special requirements</Label>
                  <Textarea id="o-notes" rows={3} value={order.special_requirements} onChange={(e) => setOrder((o) => ({ ...o, special_requirements: e.target.value }))} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commercial breakdown</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-5">
                  <div><dt className="text-muted-foreground">Supplier cost</dt><dd className="font-medium tabular-nums">{kes(quote.supplierCost)}</dd></div>
                  <div><dt className="text-muted-foreground">Yalla margin</dt><dd className="font-medium tabular-nums">{kes(quote.yallaMargin)}</dd></div>
                  <div><dt className="text-muted-foreground">Your margin</dt><dd className="font-medium tabular-nums">{kes(quote.partnerMargin)}</dd></div>
                  <div><dt className="text-muted-foreground">VAT (16%)</dt><dd className="font-medium tabular-nums">{kes(quote.taxes)}</dd></div>
                  <div><dt className="text-muted-foreground">Customer price</dt><dd className="font-semibold tabular-nums">{kes(quote.customerPrice)}</dd></div>
                </dl>
              </div>

              <Button
                onClick={() => placeOrder.mutate()}
                disabled={placeOrder.isPending || !order.pickup_label.trim() || quote.supplierCost <= 0}
              >
                Submit for quotation <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------------- orders */}
        <TabsContent value="orders">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Order book</CardTitle></CardHeader>
            <CardContent>
              {(orders.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Your partner order book</caption>
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-4">Order</th>
                        <th scope="col" className="py-2 pr-4">Service</th>
                        <th scope="col" className="py-2 pr-4">Route</th>
                        <th scope="col" className="py-2 pr-4">Status</th>
                        <th scope="col" className="py-2 pr-4 text-right">Your margin</th>
                        <th scope="col" className="py-2 text-right">Customer price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(orders.data ?? []).map((o) => (
                        <tr key={o.id}>
                          <td className="py-2 pr-4 font-mono text-xs">{o.order_code}</td>
                          <td className="py-2 pr-4">{SERVICE_TYPE_LABEL[o.service_type]}</td>
                          <td className="py-2 pr-4 text-muted-foreground">{o.pickup_label ?? "—"}{o.destination_label ? ` → ${o.destination_label}` : ""}</td>
                          <td className="py-2 pr-4"><Badge variant="outline" className="text-[10px] uppercase">{o.status.split("_").join(" ")}</Badge></td>
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(o.partner_margin))}</td>
                          <td className="py-2 text-right tabular-nums">{kes(Number(o.customer_price))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ customers */}
        <TabsContent value="customers" className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Your customer register</CardTitle></CardHeader>
            <CardContent>
              {(customers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No customers yet. Add your first one on the right.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(customers.data ?? []).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-medium">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[c.organisation, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details recorded"}
                        </p>
                      </div>
                      <span className="text-sm tabular-nums text-muted-foreground">{kes(Number(c.lifetime_spend))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Add a customer</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label htmlFor="c-name">Full name</Label><Input id="c-name" value={cust.full_name} onChange={(e) => setCust((c) => ({ ...c, full_name: e.target.value }))} /></div>
              <div><Label htmlFor="c-org">Organisation</Label><Input id="c-org" value={cust.organisation} onChange={(e) => setCust((c) => ({ ...c, organisation: e.target.value }))} /></div>
              <div><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" inputMode="tel" value={cust.phone} onChange={(e) => setCust((c) => ({ ...c, phone: e.target.value }))} /></div>
              <div><Label htmlFor="c-email">Email</Label><Input id="c-email" type="email" value={cust.email} onChange={(e) => setCust((c) => ({ ...c, email: e.target.value }))} /></div>
              <Button className="w-full" onClick={() => addCustomer.mutate()} disabled={addCustomer.isPending || !cust.full_name.trim()}>
                Add to register
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- journeys */}
        <TabsContent value="journeys">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer journeys</CardTitle></CardHeader>
            <CardContent>
              {(journeys.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No journeys yet. A journey groups several orders — an arrival transfer, an excursion and a
                  departure transfer — into one commercial view for the same customer.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {(journeys.data ?? []).map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-medium">{j.title}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{j.journey_code}</span> · {j.starts_on ?? "unscheduled"} · {j.passengers} pax
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-[10px] uppercase">{j.status}</Badge>
                        <span className="text-sm tabular-nums">{kes(Number(j.customer_price_total))}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- capacity */}
        <TabsContent value="capacity" className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Capacity requests</CardTitle>
              {/* Carriers answer freight RFQs and publish capacity slots in the
                  carrier freight workspace — this is its navigation entry. */}
              <Button variant="outline" size="sm" asChild>
                <Link to="/partner/freight">Open carrier freight workspace</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {(capacity.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No open requests.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(capacity.data ?? []).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-medium">{c.origin_label}{c.destination_label ? ` → ${c.destination_label}` : ""}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{c.request_code}</span> · {SERVICE_TYPE_LABEL[c.service_type]}
                          {c.passengers ? ` · ${c.passengers} pax` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase">{c.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Request supply</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="cap-service">Service</Label>
                <Select value={cap.service_type} onValueChange={(v) => setCap((c) => ({ ...c, service_type: v as ServiceType }))}>
                  <SelectTrigger id="cap-service"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SERVICE_TYPE_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="cap-origin">Origin</Label><Input id="cap-origin" value={cap.origin_label} onChange={(e) => setCap((c) => ({ ...c, origin_label: e.target.value }))} /></div>
              <div><Label htmlFor="cap-dest">Destination</Label><Input id="cap-dest" value={cap.destination_label} onChange={(e) => setCap((c) => ({ ...c, destination_label: e.target.value }))} /></div>
              <div><Label htmlFor="cap-when">Needed at</Label><Input id="cap-when" type="datetime-local" value={cap.needed_at} onChange={(e) => setCap((c) => ({ ...c, needed_at: e.target.value }))} /></div>
              <div><Label htmlFor="cap-pax">Passengers</Label><Input id="cap-pax" type="number" min={0} value={cap.passengers} onChange={(e) => setCap((c) => ({ ...c, passengers: Number(e.target.value) }))} /></div>
              <div><Label htmlFor="cap-req">Requirements</Label><Textarea id="cap-req" rows={3} value={cap.requirements} onChange={(e) => setCap((c) => ({ ...c, requirements: e.target.value }))} /></div>
              <Button className="w-full" onClick={() => askCapacity.mutate()} disabled={askCapacity.isPending || !cap.origin_label.trim()}>
                Send to supply desk
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" aria-hidden />
        Yalla Partners · every figure shown here comes from your own recorded orders.
      </p>
    </Shell>
  );
}

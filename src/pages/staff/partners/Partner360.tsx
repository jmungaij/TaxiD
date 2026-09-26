/**
 * YALLA PARTNERS 360 — single-partner forensic view.
 *
 * Everything Yalla knows about one distribution partner: identity and
 * verification state, commercial terms, order book, customer base, journeys,
 * supply requests and the append-only partner event trail. No figure is
 * projected: if the partner has traded nothing, the page says so.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, FileCheck2, History, Scale, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { PartnerOnboardingPanel } from "@/components/partners/PartnerOnboardingPanel";
import { PartnerSettlementPanel } from "@/components/partners/PartnerSettlementPanel";
import { PartnerWalletPanel } from "@/components/partners/PartnerWalletPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PartnerPerformancePanel } from "@/components/partners/PartnerPerformancePanel";
import { useAuth } from "@/hooks/useAuth";
import type { OnboardingStage } from "@/lib/partners/lifecycle";
import {
  COMMERCIAL_MODEL_LABEL, PARTNER_TYPE_LABEL, SERVICE_TYPE_LABEL, fetchCapacityRequests,
  fetchPartner, fetchPartnerCustomers, fetchPartnerEvents, fetchPartnerJourneys,
  fetchPartnerOrders, kes, partnerName, setPartnerStatus, summariseOrders,
} from "@/lib/partners/api";


function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-panel rounded-xl border border-border/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function Partner360() {
  const { partnerId = "" } = useParams();
  const qc = useQueryClient();
  const { isFinanceAdmin, isAdmin, isSuperAdmin } = useAuth();
  const canFinance = isFinanceAdmin || isAdmin || isSuperAdmin;
  const enabled = Boolean(partnerId);


  const partner = useQuery({ queryKey: ["yp-partner", partnerId], queryFn: () => fetchPartner(partnerId), enabled });
  const orders = useQuery({ queryKey: ["yp-partner-orders", partnerId], queryFn: () => fetchPartnerOrders(partnerId), enabled });
  const customers = useQuery({ queryKey: ["yp-partner-customers", partnerId], queryFn: () => fetchPartnerCustomers(partnerId), enabled });
  const journeys = useQuery({ queryKey: ["yp-partner-journeys", partnerId], queryFn: () => fetchPartnerJourneys(partnerId), enabled });
  const capacity = useQuery({ queryKey: ["yp-partner-capacity", partnerId], queryFn: () => fetchCapacityRequests(partnerId), enabled });
  const events = useQuery({ queryKey: ["yp-partner-events", partnerId], queryFn: () => fetchPartnerEvents(partnerId), enabled });

  const metrics = useMemo(() => summariseOrders(orders.data ?? []), [orders.data]);

  const verify = useMutation({
    mutationFn: (next: "verified" | "in_review" | "rejected") =>
      setPartnerStatus(partnerId, { verification_status: next }),
    onSuccess: () => {
      toast.success("Verification state updated.");
      void qc.invalidateQueries({ queryKey: ["yp-partner", partnerId] });
      void qc.invalidateQueries({ queryKey: ["yp-partner-events", partnerId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  if (partner.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const p = partner.data;
  if (!p) {
    return (
      <Card className="border-warning/40">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Partner not available
          </div>
          <p className="text-sm text-muted-foreground">
            No partner record is readable under this identifier with your current access.
          </p>
          <Button variant="outline" asChild><Link to="/staff/partners">Back to partner network</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/staff/partners" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Partner network
      </Link>

      <StaffPageHeader
        eyebrow="Yalla Partners 360"
        title={partnerName(p)}
        lede={`${PARTNER_TYPE_LABEL[p.partner_type]} · ${COMMERCIAL_MODEL_LABEL[p.commercial_model].split(" — ")[0]} · partner margin ${Number(p.partner_margin_pct)}%`}
        actions={
          <div className="flex flex-wrap gap-2">
            {p.verification_status !== "verified" && (
              <Button size="sm" onClick={() => verify.mutate("verified")} disabled={verify.isPending}>
                <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Mark verified
              </Button>
            )}
            {p.verification_status !== "in_review" && (
              <Button size="sm" variant="outline" onClick={() => verify.mutate("in_review")} disabled={verify.isPending}>
                Send to review
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">{p.status}</Badge>
        <Badge variant="outline" className="text-[10px] uppercase">{p.verification_status.split("_").join(" ")}</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">{p.partner_code}</Badge>
        {p.is_demo && <Badge variant="outline" className="text-[10px] uppercase text-warning">Demo data</Badge>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Orders" value={String(metrics.orders)} hint={`${metrics.openOrders} in progress`} />
        <Kpi label="Gross booked value" value={kes(metrics.grossValue)} hint="VAT inclusive" />
        <Kpi label="Yalla margin" value={kes(metrics.yallaMargin)} hint={`Partner earned ${kes(metrics.partnerEarnings)}`} />
        <Kpi label="Customers" value={String((customers.data ?? []).length)} hint={`${(journeys.data ?? []).length} journey(s)`} />
      </div>

      <Tabs defaultValue="orders" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="orders">Order book</TabsTrigger>
          <TabsTrigger value="onboarding"><FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Onboarding</TabsTrigger>
          <TabsTrigger value="wallet"><Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Wallet & ledger</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="settlements"><Scale className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Settlements</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="journeys">Journeys</TabsTrigger>
          <TabsTrigger value="capacity">Supply requests</TabsTrigger>
          <TabsTrigger value="trail"><History className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Event trail</TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding">
          <PartnerOnboardingPanel
            partnerId={partnerId}
            stage={((p as unknown as { onboarding_stage?: OnboardingStage }).onboarding_stage ?? "applied")}
          />
        </TabsContent>

        <TabsContent value="wallet">
          <PartnerWalletPanel
            partnerId={partnerId}
            marginPct={Number(p.partner_margin_pct)}
            canTopUp={canFinance}
          />
        </TabsContent>

        <TabsContent value="performance">
          <PartnerPerformancePanel partnerId={partnerId} />
        </TabsContent>

        <TabsContent value="settlements">
          <PartnerSettlementPanel partnerId={partnerId} canAct={canFinance} />
        </TabsContent>



        <TabsContent value="orders">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recorded orders</CardTitle></CardHeader>
            <CardContent>
              {(orders.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">This partner has not placed an order.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Partner order book</caption>
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-4">Order</th>
                        <th scope="col" className="py-2 pr-4">Service</th>
                        <th scope="col" className="py-2 pr-4">Route</th>
                        <th scope="col" className="py-2 pr-4">Status</th>
                        <th scope="col" className="py-2 pr-4 text-right">Supplier cost</th>
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
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(o.supplier_cost))}</td>
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

        <TabsContent value="customers">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer base</CardTitle></CardHeader>
            <CardContent>
              {(customers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No customers registered by this partner.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(customers.data ?? []).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <p className="font-medium">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">{[c.organisation, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{kes(Number(c.lifetime_spend))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="journeys">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Journeys</CardTitle></CardHeader>
            <CardContent>
              {(journeys.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No multi-leg journeys recorded.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(journeys.data ?? []).map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <p className="font-medium">{j.title}</p>
                        <p className="text-xs text-muted-foreground"><span className="font-mono">{j.journey_code}</span> · {j.starts_on ?? "unscheduled"} · {j.passengers} pax</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-[10px] uppercase">{j.status}</Badge>
                        <span className="tabular-nums">{kes(Number(j.customer_price_total))}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="capacity">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Supply requests</CardTitle></CardHeader>
            <CardContent>
              {(capacity.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No capacity requests from this partner.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(capacity.data ?? []).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <p className="font-medium">{c.origin_label}{c.destination_label ? ` → ${c.destination_label}` : ""}</p>
                        <p className="text-xs text-muted-foreground"><span className="font-mono">{c.request_code}</span> · {SERVICE_TYPE_LABEL[c.service_type]}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase">{c.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trail">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Partner event trail</CardTitle></CardHeader>
            <CardContent>
              {(events.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded for this partner.</p>
              ) : (
                <ol className="space-y-3">
                  {(events.data ?? []).map((e) => (
                    <li key={e.id} className="border-l-2 border-border pl-4 text-sm">
                      <p className="font-medium">{e.event_type.split("_").join(" ")}</p>
                      <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

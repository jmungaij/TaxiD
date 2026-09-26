/**
 * PROVIDER SUPPLY GOVERNANCE — the staff review desk for everything that reaches
 * the marketplace.
 *
 * Driver applications, operator listings awaiting approval, live listings,
 * customer enquiries and the bookings raised against them, in one place. Every
 * figure is read from the register; nothing on this page is estimated. Approval
 * authority is unchanged: only administrators and staff holding capacity
 * authority can decide, and the database refuses anyone else.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ProviderDocumentReview from "@/components/staff/ProviderDocumentReview";
import OperatorVerificationDesk from "@/components/staff/OperatorVerificationDesk";
import DriverClearancePanel from "@/components/staff/DriverClearancePanel";
import ProviderPayoutDesk from "@/components/staff/ProviderPayoutDesk";
import DriverWithdrawalQueue from "@/components/staff/DriverWithdrawalQueue";
import YallaWalletPanel from "@/components/staff/YallaWalletPanel";
import ProviderFinanceDashboard from "@/components/staff/ProviderFinanceDashboard";
import ProviderInvoiceQueue from "@/components/staff/ProviderInvoiceQueue";
import {
  EnterpriseBookingsPanel,
  EnterpriseInvoicesPanel,
  OperatorEarningsPanel,
} from "@/components/staff/AdminSupplyFinance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { decideCapacity, explainRefusal } from "@/lib/provider/capacity";
import { bookingMoney } from "@/lib/provider/bookings";
import { FAMILY_LABEL, type ServiceFamily } from "@/lib/marketplace/search";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ConsoleApplication {
  id: string; reference: string; status: string; name: string; city: string | null;
  driver_type: string | null; vehicle: string | null; registration: string | null;
  claimed: boolean; created_at: string; decided_at: string | null;
  seeded_capacity_id: string | null; documents_outstanding: number;
}
interface ConsoleCapacity {
  id: string; family: string; title: string; provider_name: string; provider_kind: string;
  vehicle_type: string; seats: number | null; units: number; base_city: string;
  rate_amount: number | null; rate_basis: string; currency: string; status: string;
  is_test: boolean; submitted_at: string | null; published_at: string | null;
  source_application_id: string | null; is_own: boolean; enquiries: number; bookings: number;
}
interface ConsoleBooking {
  id: string; booking_reference: string; capacity_title: string; family: string;
  provider_name: string; customer_company: string | null; service_from: string | null;
  amount_cents: number; currency: string; status: string;
  proforma_id: string | null; proforma_reference: string | null;
  invoice_reference: string | null; created_at: string;
}
interface ConsoleEnquiry {
  id: string; capacity_title: string; organisation_name: string | null; contact_name: string | null;
  service_date: string | null; status: string; created_at: string; booked: boolean;
}
interface Console {
  summary: Record<string, number>;
  applications: ConsoleApplication[];
  capacity: ConsoleCapacity[];
  bookings: ConsoleBooking[];
  enquiries: ConsoleEnquiry[];
}

const d = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—");
const rate = (v: number | null, c: string) => (v === null ? "On request" : `${c} ${v.toLocaleString("en-KE")}`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-[0.12em]">{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}

export default function StaffProviderSupply() {
  const qc = useQueryClient();
  const [reason, setReason] = React.useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery<Console>({
    queryKey: ["provider-governance-console"],
    queryFn: async () => {
      const { data: res, error: err } = await db.rpc("provider_governance_console", {});
      if (err) throw new Error(err.message);
      return res as Console;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["provider-governance-console"] });

  const decide = useMutation({
    mutationFn: (a: { id: string; decision: "APPROVE" | "SEND_BACK" }) =>
      decideCapacity(a.id, a.decision, reason[a.id]),
    onSuccess: (_r, a) => {
      toast({
        title: a.decision === "APPROVE" ? "Listing published" : "Sent back to the operator",
        description:
          a.decision === "APPROVE"
            ? "Customers can now find it in marketplace search."
            : "The operator has been asked to make a change.",
      });
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "No decision recorded", description: explainRefusal(e.message), variant: "destructive" }),
  });

  const applicationAction = useMutation({
    mutationFn: async (a: { id: string; action: "REVIEW" | "APPROVE" | "REJECT"; note?: string }) => {
      const { data: res, error: err } = await db.rpc("driver_application_decide", {
        p: { application_id: a.id, action: a.action, note: a.note ?? null },
      });
      if (err) throw new Error(err.message);
      if (res?.error) throw new Error(String(res.code ?? "REFUSED"));
      return res;
    },
    onSuccess: (_r, a) => {
      toast({
        title: a.action === "APPROVE" ? "Driver approved" : "Application updated",
        description:
          a.action === "APPROVE"
            ? "A draft marketplace listing was created from their vehicle details."
            : undefined,
      });
      refresh();
    },
    onError: (e: Error) =>
      toast({
        title: "Not recorded",
        description:
          e.message === "MANDATORY_DOCUMENTS_NOT_VERIFIED"
            ? "The required documents are not all verified yet."
            : e.message.replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This desk could not be opened</CardTitle>
            <CardDescription>
              {(error as Error).message === "NOT_AUTHORISED"
                ? "You do not hold capacity approval authority."
                : (error as Error).message}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const c = data!;
  const s = c.summary;
  const awaiting = c.capacity.filter((x) => x.status === "PENDING_APPROVAL");
  const live = c.capacity.filter((x) => x.status === "PUBLISHED");
  const openApps = c.applications.filter((a) => !["APPROVED", "REJECTED", "WITHDRAWN"].includes(a.status));

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Supply governance
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Provider supply review</h1>
        <p className="text-sm text-muted-foreground">
          Driver applications, operator listings, marketplace availability and the bookings raised
          against them. Nothing reaches the marketplace without a decision recorded here.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Applications open" value={String(s.applications_open ?? 0)} hint={`${s.applications_approved ?? 0} approved to date`} />
        <Kpi label="Listings awaiting approval" value={String(s.capacity_awaiting ?? 0)} hint={`${s.capacity_drafts ?? 0} still in draft`} />
        <Kpi label="Live in marketplace" value={String(s.capacity_live ?? 0)} hint={`${s.units_live ?? 0} vehicles offered`} />
        <Kpi
          label="Confirmed booking value"
          value={bookingMoney(Number(s.bookings_billable_cents ?? 0), "KES")}
          hint={`${bookingMoney(Number(s.bookings_invoiced_cents ?? 0), "KES")} invoiced`}
        />
      </div>

      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications">Driver applications ({openApps.length})</TabsTrigger>
          <TabsTrigger value="approval">Awaiting approval ({awaiting.length})</TabsTrigger>
          <TabsTrigger value="live">Marketplace listings ({live.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({c.bookings.length})</TabsTrigger>
          <TabsTrigger value="enquiries">Enquiries ({c.enquiries.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="verification">Operator verification</TabsTrigger>
          <TabsTrigger value="earnings">Operator earnings</TabsTrigger>
          <TabsTrigger value="payouts">Operator payouts</TabsTrigger>
          <TabsTrigger value="driver-withdrawals">Driver withdrawals</TabsTrigger>
          <TabsTrigger value="driver-clearance">Driver payout approval</TabsTrigger>
          <TabsTrigger value="finance">Finance dashboard</TabsTrigger>
          <TabsTrigger value="operator-invoices">Operator statements</TabsTrigger>
          <TabsTrigger value="yalla-wallet">Yalla wallet</TabsTrigger>
          <TabsTrigger value="enterprise">Enterprise bookings</TabsTrigger>
          <TabsTrigger value="invoices">Enterprise invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="pt-4">
          <ProviderDocumentReview />
        </TabsContent>

        <TabsContent value="verification" className="pt-4">
          <OperatorVerificationDesk />
        </TabsContent>

        <TabsContent value="earnings" className="pt-4">
          <OperatorEarningsPanel />
        </TabsContent>

        <TabsContent value="payouts" className="pt-4">
          <ProviderPayoutDesk />
        </TabsContent>

        <TabsContent value="driver-withdrawals" className="pt-4">
          <DriverWithdrawalQueue />
        </TabsContent>

        <TabsContent value="driver-clearance" className="pt-4">
          <DriverClearancePanel />
        </TabsContent>

        <TabsContent value="finance" className="pt-4">
          <ProviderFinanceDashboard />
        </TabsContent>

        <TabsContent value="operator-invoices" className="pt-4">
          <ProviderInvoiceQueue />
        </TabsContent>


        <TabsContent value="yalla-wallet" className="pt-4">
          <YallaWalletPanel />
        </TabsContent>

        <TabsContent value="enterprise" className="pt-4">
          <EnterpriseBookingsPanel />
        </TabsContent>

        <TabsContent value="invoices" className="pt-4">
          <EnterpriseInvoicesPanel />
        </TabsContent>


        <TabsContent value="applications" className="pt-4">
          {c.applications.length === 0 ? (
            <Card><CardHeader><CardDescription>No driver applications have been received.</CardDescription></CardHeader></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead><TableHead>Applicant</TableHead>
                  <TableHead>Vehicle</TableHead><TableHead>Status</TableHead>
                  <TableHead>Documents</TableHead><TableHead>Listing</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.applications.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                    <TableCell>
                      {a.name}
                      <div className="text-xs text-muted-foreground">
                        {a.city ?? "City not stated"}{a.claimed ? "" : " · not linked to a login"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.vehicle ?? "Not stated"}
                      <div className="text-xs text-muted-foreground">{a.registration ?? "No registration"}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{a.status.replace(/_/g, " ").toLowerCase()}</Badge></TableCell>
                    <TableCell className="text-sm">
                      {a.documents_outstanding === 0 ? "All verified" : `${a.documents_outstanding} outstanding`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.seeded_capacity_id ? "Draft created" : a.status === "APPROVED" ? "None" : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {["APPROVED", "REJECTED", "WITHDRAWN"].includes(a.status) ? (
                        <span className="text-xs text-muted-foreground">{d(a.decided_at)}</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={applicationAction.isPending}
                            onClick={() => applicationAction.mutate({ id: a.id, action: "REVIEW" })}
                          >
                            Under review
                          </Button>
                          <Button
                            size="sm"
                            disabled={applicationAction.isPending || a.documents_outstanding > 0 || !a.claimed}
                            onClick={() => applicationAction.mutate({ id: a.id, action: "APPROVE" })}
                          >
                            Approve
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="approval" className="pt-4">
          {awaiting.length === 0 ? (
            <Card><CardHeader><CardDescription>Nothing is waiting for a decision.</CardDescription></CardHeader></Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {awaiting.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{r.title}</CardTitle>
                    <CardDescription>
                      {r.provider_name} · {FAMILY_LABEL[r.family as ServiceFamily] ?? r.family} · {r.vehicle_type} · {r.base_city}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      {rate(r.rate_amount, r.currency)} · {r.units} vehicle(s)
                      {r.seats ? ` · ${r.seats} seats` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">Submitted {d(r.submitted_at)}</p>
                    {r.is_own && (
                      <p className="text-xs text-[hsl(var(--status-warning))]">
                        This is your own listing — another approver is required.
                      </p>
                    )}
                    <Input
                      className="h-9"
                      placeholder="Reason (required to send back)"
                      value={reason[r.id] ?? ""}
                      onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: "APPROVE" })}>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Approve and publish
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!(reason[r.id] ?? "").trim() || decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: "SEND_BACK" })}
                      >
                        Send back
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="live" className="pt-4">
          {live.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No operator capacity is live yet</CardTitle>
                <CardDescription>
                  Marketplace search shows only the governed charter fleet until a listing is approved
                  here. Nothing is filled in on operators' behalf.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead><TableHead>Operator</TableHead>
                  <TableHead>Service</TableHead><TableHead>Base</TableHead>
                  <TableHead>Rate</TableHead><TableHead>Demand</TableHead>
                  <TableHead>Live since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.title}
                      <div className="text-xs text-muted-foreground">{r.vehicle_type}</div>
                    </TableCell>
                    <TableCell>{r.provider_name}</TableCell>
                    <TableCell>{FAMILY_LABEL[r.family as ServiceFamily] ?? r.family}</TableCell>
                    <TableCell>{r.base_city}</TableCell>
                    <TableCell className="tabular-nums">{rate(r.rate_amount, r.currency)}</TableCell>
                    <TableCell className="text-sm">{r.enquiries} enquiries · {r.bookings} bookings</TableCell>
                    <TableCell>{d(r.published_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="bookings" className="pt-4">
          {c.bookings.length === 0 ? (
            <Card><CardHeader><CardDescription>No bookings have been raised against operator capacity.</CardDescription></CardHeader></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead><TableHead>Customer</TableHead>
                  <TableHead>Capacity</TableHead><TableHead>Service date</TableHead>
                  <TableHead>Value</TableHead><TableHead>Status</TableHead>
                  <TableHead>Proforma</TableHead><TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.booking_reference}</TableCell>
                    <TableCell>{b.customer_company ?? "—"}</TableCell>
                    <TableCell>
                      {b.capacity_title}
                      <div className="text-xs text-muted-foreground">{b.provider_name}</div>
                    </TableCell>
                    <TableCell>{d(b.service_from)}</TableCell>
                    <TableCell className="tabular-nums">{bookingMoney(b.amount_cents, b.currency)}</TableCell>
                    <TableCell><Badge variant="outline">{b.status.toLowerCase()}</Badge></TableCell>
                    <TableCell className="text-sm">{b.proforma_reference ?? (b.proforma_id ? "Draft" : "—")}</TableCell>
                    <TableCell className="text-sm">{b.invoice_reference ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="pt-3 text-xs text-muted-foreground">
            Proforma invoices raised from a booking appear in the{" "}
            <Link className="underline" to="/staff/commercial/proforma">proforma register</Link> as drafts and
            follow the normal approval route before issue.
          </p>
        </TabsContent>

        <TabsContent value="enquiries" className="pt-4">
          {c.enquiries.length === 0 ? (
            <Card><CardHeader><CardDescription>No customer enquiries have been raised against listings.</CardDescription></CardHeader></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead><TableHead>Customer</TableHead>
                  <TableHead>Service date</TableHead><TableHead>Status</TableHead>
                  <TableHead>Booked</TableHead><TableHead>Raised</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.enquiries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.capacity_title}</TableCell>
                    <TableCell>
                      {e.organisation_name ?? "—"}
                      <div className="text-xs text-muted-foreground">{e.contact_name ?? ""}</div>
                    </TableCell>
                    <TableCell>{d(e.service_date)}</TableCell>
                    <TableCell><Badge variant="outline">{e.status.toLowerCase()}</Badge></TableCell>
                    <TableCell>{e.booked ? "Yes" : "No"}</TableCell>
                    <TableCell>{d(e.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

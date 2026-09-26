/**
 * MY ACCOUNT — the corporate customer's own relationship view.
 *
 * A signed-in company contact sees their company, what is being worked on,
 * proposals sent to them, their agreements, the services running, and a live
 * status feed. Everything comes from the database under their own identity;
 * internal notes, pricing intelligence and pipeline detail never reach here.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  Building2,
  CalendarClock,
  FileText,
  Handshake,
  Inbox,
  Route as RouteIcon,
  UserRound,
} from "lucide-react";
import {
  fetchCustomerPortal,
  KES,
  statusTone,
  summarise,
} from "@/lib/customer/portal";
import BillingDocuments from "@/components/customer/BillingDocuments";


const dt = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";
const d = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—";

function Status({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={statusTone(status)}>
      {status}
    </Badge>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function CustomerAccount() {
  const qc = useQueryClient();

  // Signed-out visitors are taken to the client sign-in page and returned here.
  React.useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && !data.session) {
        window.location.replace("/clients/login?redirect=%2Fdashboard%2Fmy-account");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-portal"],
    queryFn: fetchCustomerPortal,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });

  // Live status feed: any change to the records behind this page refreshes it.
  React.useEffect(() => {
    const invalidate = () => void qc.invalidateQueries({ queryKey: ["customer-portal"] });
    const channel = supabase
      .channel("customer-portal-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "commercial_quotations" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "commercial_schedules" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "commercial_contract_instances" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>We could not open your account</CardTitle>
            <CardDescription>
              Please sign in again. If this keeps happening, contact your Yalla representative.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const p = data!;
  const nothingYet =
    !p.accounts.length &&
    !p.opportunities.length &&
    !p.proposals.length &&
    !p.service_orders.length &&
    !p.contracts.length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My account</h1>
          <p className="text-sm text-muted-foreground">
            Your company, what we are working on for you, and where each item stands.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/dashboard/service-requests">
            <Inbox className="mr-2 h-4 w-4" aria-hidden /> My requests
          </Link>
        </Button>
      </header>

      {nothingYet ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing on your account yet</CardTitle>
            <CardDescription>
              Once you submit a mobility request, your company, proposals and services will appear
              here with their status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/dashboard/service-requests">Submit a request</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Company */}
      {p.accounts.map((a) => (
        <Card key={a.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-4 w-4 text-primary" aria-hidden /> {a.name}
              </CardTitle>
              <CardDescription>
                {[a.industry, a.city, a.country].filter(Boolean).join(" · ") || "Company details on file"}
                {a.reference ? ` · ${a.reference}` : ""}
              </CardDescription>
            </div>
            <Status status={a.relationship_stage} />
          </CardHeader>
          {a.relationship_contact ? (
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{a.relationship_contact}</span>
              <span className="text-muted-foreground">looks after your account</span>
              {a.relationship_email ? (
                <a className="text-primary underline" href={`mailto:${a.relationship_email}`}>
                  {a.relationship_email}
                </a>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* What we are working on */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RouteIcon className="h-4 w-4 text-primary" aria-hidden /> What we are working on
            </CardTitle>
            <CardDescription>Requirements currently being progressed for your company.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.opportunities.length === 0 ? (
              <Empty>Nothing in progress right now.</Empty>
            ) : (
              p.opportunities.map((o) => (
                <div key={o.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{o.title ?? o.reference ?? "Requirement"}</p>
                    <p className="text-xs text-muted-foreground">Updated {dt(o.updated_at)}</p>
                  </div>
                  <Status status={o.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Proposals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" aria-hidden /> Proposals
            </CardTitle>
            <CardDescription>Prices and terms prepared for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.proposals.length === 0 ? (
              <Empty>No proposal has been issued to you yet.</Empty>
            ) : (
              p.proposals.map((q) => (
                <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{q.reference ?? "Proposal"}</p>
                    <p className="text-sm tabular-nums">
                      {q.total_amount === null
                        ? "Amount still being prepared"
                        : KES(Number(q.total_amount), q.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {q.valid_until ? `Valid until ${d(q.valid_until)}` : `Updated ${dt(q.updated_at)}`}
                    </p>
                  </div>
                  <Status status={q.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Agreements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="h-4 w-4 text-primary" aria-hidden /> Agreements
            </CardTitle>
            <CardDescription>Your contract with Yalla and what it covers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.contracts.length === 0 ? (
              <Empty>No agreement in place yet.</Empty>
            ) : (
              p.contracts.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{c.name ?? "Agreement"}</p>
                    {summarise(c.services) ? (
                      <p className="text-xs text-muted-foreground">{summarise(c.services)}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {c.effective_date ? `Starts ${d(c.effective_date)}` : `Updated ${dt(c.updated_at)}`}
                      {summarise(c.term) ? ` · ${summarise(c.term)}` : ""}
                    </p>
                  </div>
                  <Status status={c.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Services running */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Services
            </CardTitle>
            <CardDescription>The transport services set up under your agreement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.service_orders.length === 0 ? (
              <Empty>No service has been set up yet.</Empty>
            ) : (
              p.service_orders.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{s.title ?? "Service"}</p>
                    {summarise(s.services) ? (
                      <p className="text-xs text-muted-foreground">{summarise(s.services)}</p>
                    ) : null}
                    {summarise(s.locations) ? (
                      <p className="text-xs text-muted-foreground">{summarise(s.locations)}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">Updated {dt(s.updated_at)}</p>
                  </div>
                  <Status status={s.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing documents */}
      <BillingDocuments />

      {/* Live status feed */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" aria-hidden /> Status feed
          </CardTitle>
          <CardDescription>Everything that has happened on your account, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {p.feed.length === 0 ? (
            <Empty>Nothing has happened on your account yet.</Empty>
          ) : (
            <ol className="space-y-3">
              {p.feed.map((f, i) => (
                <li key={`${f.at}-${i}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant="outline">{f.kind}</Badge>
                    <span className="text-sm">{f.label}</span>
                    <span className="text-xs text-muted-foreground">{dt(f.at)}</span>
                  </div>
                  {i < p.feed.length - 1 ? <Separator className="mt-3" /> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ADMIN SUPPLY FINANCE — operator earnings, enterprise ride requests and
 * enterprise invoices, read straight from the register.
 *
 * Every figure is derived from recorded bookings and invoices: gross value is
 * the agreed rate on each booking, Yalla retains a 15% service commission and
 * the operator keeps 85% of services actually delivered. Nothing is estimated
 * and nothing is written from this view.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface OperatorEarningRow {
  provider_user_id: string;
  provider_name: string | null;
  provider_kind: string | null;
  currency: string;
  bookings: number;
  delivered: number;
  upcoming: number;
  delivered_gross_cents: number;
  payout_cents: number;
  commission_cents: number;
  pipeline_gross_cents: number;
  invoiced_cents: number;
  listings_live: number;
  documents_pending: number;
  last_service_at: string | null;
}
export interface CorporateRequestRow {
  id: string;
  organisation: string | null;
  employee_name: string | null;
  pickup: string | null;
  dropoff: string | null;
  estimated_fare_cents: number | null;
  status: string;
  cost_center_code: string | null;
  scheduled_for: string | null;
  decided_at: string | null;
  booking_id: string | null;
  booking_status: string | null;
  created_at: string;
}
export interface CorporateInvoiceRow {
  id: string;
  invoice_number: string;
  organisation: string | null;
  status: string;
  currency: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  lines: number;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
}
export interface FinanceConsole {
  summary: Record<string, number>;
  operators: OperatorEarningRow[];
  corporate_requests: CorporateRequestRow[];
  corporate_invoices: CorporateInvoiceRow[];
}

const money = (cents: number | null | undefined, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(Number(cents ?? 0) / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—");

export function useSupplyFinance() {
  return useQuery<FinanceConsole>({
    queryKey: ["provider-admin-finance-console"],
    queryFn: async () => {
      const { data, error } = await db.rpc("provider_admin_finance_console", {});
      if (error) throw new Error(error.message);
      return data as FinanceConsole;
    },
  });
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-[0.12em]">{label}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Earnings owed to each operator, with the commission Yalla retains. */
export function OperatorEarningsPanel() {
  const { data, isLoading, error } = useSupplyFinance();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <Empty title="Earnings could not be loaded" body={(error as Error).message} />;

  const s = data!.summary;
  const rows = data!.operators;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Delivered service value" value={money(s.delivered_gross_cents)} hint="Gross value of services completed" />
        <Kpi label="Owed to operators" value={money(s.operator_payout_cents)} hint="85% of delivered value" />
        <Kpi label="Yalla commission" value={money(s.commission_cents)} hint="15% service commission retained" />
        <Kpi label="Work ahead" value={money(s.pipeline_gross_cents)} hint="Requested and confirmed, not yet delivered" />
      </div>

      {rows.length === 0 ? (
        <Empty
          title="No operator earnings yet"
          body="Earnings appear as soon as a customer books approved operator capacity. Nothing is filled in on operators' behalf."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operator</TableHead>
              <TableHead>Live listings</TableHead>
              <TableHead>Services delivered</TableHead>
              <TableHead className="text-right">Delivered value</TableHead>
              <TableHead className="text-right">Operator earns</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">Work ahead</TableHead>
              <TableHead>Documents</TableHead>
              <TableHead>Last service</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.provider_user_id}>
                <TableCell>
                  {r.provider_name ?? "Operator"}
                  <div className="text-xs text-muted-foreground">
                    {(r.provider_kind ?? "").replace(/_/g, " ").toLowerCase()}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{r.listings_live}</TableCell>
                <TableCell className="text-sm">
                  {r.delivered} of {r.bookings}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.delivered_gross_cents, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{money(r.payout_cents, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.commission_cents, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.pipeline_gross_cents, r.currency)}</TableCell>
                <TableCell className="text-sm">
                  {r.documents_pending === 0 ? "Nothing waiting" : `${r.documents_pending} to review`}
                </TableCell>
                <TableCell>{day(r.last_service_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Operators keep 85% of every service they deliver; Yalla retains a 15% service commission. Test listings are excluded.
      </p>
    </div>
  );
}

/** Enterprise ride requests, their approval outcome and the trip raised. */
export function EnterpriseBookingsPanel() {
  const { data, isLoading, error } = useSupplyFinance();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <Empty title="Enterprise bookings could not be loaded" body={(error as Error).message} />;

  const rows = data!.corporate_requests;
  const s = data!.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Awaiting approval" value={String(s.corporate_requests_pending ?? 0)} />
        <Kpi label="Requests recorded" value={String(rows.length)} />
        <Kpi label="Trips raised" value={String(rows.filter((r) => r.booking_id).length)} />
      </div>
      {rows.length === 0 ? (
        <Empty
          title="No enterprise ride requests yet"
          body="Requests appear here the moment an organisation submits one through their dashboard."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organisation</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Journey</TableHead>
              <TableHead className="text-right">Estimated fare</TableHead>
              <TableHead>Cost centre</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Trip</TableHead>
              <TableHead>Raised</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.organisation ?? "—"}</TableCell>
                <TableCell>{r.employee_name || "—"}</TableCell>
                <TableCell className="text-sm">
                  {r.pickup ?? "—"}
                  <div className="text-xs text-muted-foreground">to {r.dropoff ?? "—"}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.estimated_fare_cents)}</TableCell>
                <TableCell className="text-sm">{r.cost_center_code ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {r.booking_status ? r.booking_status.replace(/_/g, " ").toLowerCase() : "Not dispatched"}
                </TableCell>
                <TableCell>{day(r.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Enterprise invoices with what has been paid and what is still outstanding. */
export function EnterpriseInvoicesPanel() {
  const { data, isLoading, error } = useSupplyFinance();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <Empty title="Enterprise invoices could not be loaded" body={(error as Error).message} />;

  const rows = data!.corporate_invoices;
  const s = data!.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Invoiced" value={money(s.corporate_invoiced_cents)} />
        <Kpi label="Paid" value={money(s.corporate_paid_cents)} />
        <Kpi label="Outstanding" value={money(s.corporate_outstanding_cents)} />
        <Kpi label="Open invoices" value={String(s.corporate_invoices_open ?? 0)} />
      </div>
      {rows.length === 0 ? (
        <Empty
          title="No enterprise invoices yet"
          body="An invoice is opened automatically when a corporate trip is completed."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trips</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                <TableCell>{r.organisation ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{String(r.status).replace(/_/g, " ").toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="tabular-nums">{r.lines}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.total_cents, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.paid_cents, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{money(r.balance_cents, r.currency)}</TableCell>
                <TableCell>{day(r.issued_at)}</TableCell>
                <TableCell>{day(r.due_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

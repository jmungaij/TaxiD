/**
 * OPERATOR DASHBOARD OVERVIEW — derived from the operator's own records.
 *
 * Three things an operator needs at a glance: whether they are cleared to be
 * listed, the work they are committed to right now, and what they have earned.
 * Every figure is computed from their documents, listings and bookings — nothing
 * here is illustrative.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CalendarCheck, CheckCircle2, Coins, Truck } from "lucide-react";
import { loadProviderBookings, type ProviderBookingRow } from "@/lib/provider/bookings";
import {
  DOC_KIND_LABEL, loadMyDocuments, missingMandatory,
} from "@/lib/provider/documents";

/** Yalla service commission retained on each delivered booking. */
const COMMISSION_RATE = 0.15;

const money = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "date to confirm";

export interface OverviewSummary {
  total: number;
  published: number;
  awaiting: number;
  drafts: number;
  units_live: number;
}

export default function ProviderOverview({
  summary,
  openEnquiries,
  accredited,
}: {
  summary: OverviewSummary;
  openEnquiries: number;
  accredited: boolean;
}) {
  const docs = useQuery({ queryKey: ["provider-documents"], queryFn: loadMyDocuments });
  const bookings = useQuery({ queryKey: ["provider-bookings-earnings"], queryFn: loadProviderBookings });

  const rows: ProviderBookingRow[] = bookings.data ?? [];
  const active = rows.filter((r) => r.status === "CONFIRMED" || r.status === "REQUESTED");
  const delivered = rows.filter((r) => r.status === "DELIVERED");
  const currency = rows[0]?.currency ?? "KES";
  const sum = (l: ProviderBookingRow[]) => l.reduce((t, r) => t + Number(r.amount_cents ?? 0), 0);
  const earned = Math.round(sum(delivered) * (1 - COMMISSION_RATE));
  const committed = Math.round(sum(active) * (1 - COMMISSION_RATE));

  const outstanding = docs.data ? missingMandatory(docs.data) : [];
  const cleared = Boolean(docs.data) && outstanding.length === 0;

  const loading = docs.isLoading || bookings.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase">
              <Truck className="h-3.5 w-3.5" aria-hidden /> Live listings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.published}</p>
            <p className="text-xs text-muted-foreground">
              {summary.units_live} vehicle{summary.units_live === 1 ? "" : "s"} bookable ·{" "}
              {summary.awaiting} awaiting approval
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase">
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden /> Active assignments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-16" /> : (
              <p className="text-2xl font-semibold">{active.length}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {openEnquiries} open enquir{openEnquiries === 1 ? "y" : "ies"} to answer
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase">
              <Coins className="h-3.5 w-3.5" aria-hidden /> Earned to date
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : (
              <p className="text-2xl font-semibold">{money(earned, currency)}</p>
            )}
            <p className="text-xs text-muted-foreground">
              from {delivered.length} delivered service{delivered.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs uppercase">
              <Coins className="h-3.5 w-3.5" aria-hidden /> Committed ahead
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : (
              <p className="text-2xl font-semibold">{money(committed, currency)}</p>
            )}
            <p className="text-xs text-muted-foreground">your share of work not yet delivered</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Are you ready to be listed?</CardTitle>
          <CardDescription>
            Customers only see your vehicles once your paperwork is verified and a listing is approved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Step done={accredited} label="Operator record approved on the platform" />
          {docs.isLoading ? (
            <Skeleton className="h-5 w-64" />
          ) : (
            <Step
              done={cleared}
              label={
                cleared
                  ? "Licence, insurance and inspection verified"
                  : `Still needed: ${outstanding.map((k) => DOC_KIND_LABEL[k]).join(", ") || "document verification"}`
              }
            />
          )}
          <Step done={summary.total > 0} label="At least one vehicle or service described" />
          <Step done={summary.published > 0} label="A listing approved and live in marketplace search" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your next jobs</CardTitle>
          <CardDescription>Work you have accepted or been asked to confirm.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : active.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing scheduled yet. Confirmed jobs appear here with the customer, the dates and your share.
            </p>
          ) : (
            <ul className="divide-y">
              {active.slice(0, 6).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{r.capacity_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.customer_company ?? "Customer"} · {day(r.service_from)} · {r.booking_reference}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {money(Math.round(Number(r.amount_cents ?? 0) * (1 - COMMISSION_RATE)), r.currency)}
                    </span>
                    <Badge variant="outline">{r.status === "CONFIRMED" ? "confirmed" : "to confirm"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <p className="flex items-start gap-2">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-[hsl(var(--status-success))]" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 text-[hsl(var(--status-warning))]" aria-hidden />
      )}
      <span className={done ? "" : "text-muted-foreground"}>{label}</span>
    </p>
  );
}

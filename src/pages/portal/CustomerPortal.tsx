/**
 * Customer portal — /my/yalla/:token
 *
 * The client sees only their own quotes, contracts and ride bookings, read
 * through the token link. Nothing is invented: an empty section says plainly
 * that there is nothing recorded yet.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
import {
  openCustomerPortal,
  PORTAL_REFUSAL_TEXT,
  type PortalView,
} from "@/lib/commercial/customerPortal";
import { CONTACT } from "@/config/contact";

const money = (n: number | null | undefined, currency: string | null | undefined) =>
  n === null || n === undefined
    ? "NOT STATED"
    : `${currency || "KES"} ${Math.round(Number(n)).toLocaleString("en-KE")}`;

const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const dateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-portal", token],
    queryFn: () => openCustomerPortal(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  React.useEffect(() => {
    document.title = "Your SAFARID account | SAFARID";
  }, []);

  if (!token) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardContent className="pt-6 text-sm">{PORTAL_REFUSAL_TEXT.INVALID_LINK}</CardContent>
        </Card>
      </main>
    );
  }

  const refused = data && data.ok === false ? data : null;
  const view = data && data.ok === true ? (data as PortalView) : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> SAFARID
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view ? view.account.name : "Your SAFARID account"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your quotes, contracts and ride bookings, as recorded by SAFARID. Questions:{" "}
          <a className="underline" href={`mailto:${CONTACT.salesEmail}`}>
            {CONTACT.salesEmail}
          </a>{" "}
          or {CONTACT.phoneDisplay}.
        </p>
      </header>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            Your records could not be read just now. Please try again shortly.
          </CardContent>
        </Card>
      )}

      {refused && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            {PORTAL_REFUSAL_TEXT[refused.error] ?? PORTAL_REFUSAL_TEXT.INVALID_LINK}
          </CardContent>
        </Card>
      )}

      {view && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quotes</CardTitle>
              <CardDescription>Prices we have quoted you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {view.quotes.length === 0 && <Empty>No quote has been recorded for you yet.</Empty>}
              {view.quotes.map((q) => (
                <div key={q.quote_number} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{q.quote_number}</span>
                    <Badge variant="secondary">{q.status ?? "RECORDED"}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {money(q.total_amount, q.currency)} · shared {date(q.created_at)} · valid until{" "}
                    {date(q.valid_until)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contracts</CardTitle>
              <CardDescription>Agreements between your organisation and SAFARID.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {view.contracts.length === 0 && (
                <Empty>No contract has been recorded for you yet.</Empty>
              )}
              {view.contracts.map((c) => (
                <div key={c.contract_number} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {c.contract_number} — {c.title ?? "Mobility service agreement"}
                    </span>
                    <Badge variant="secondary">{c.status ?? "RECORDED"}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {money(c.value_amount, c.currency)}
                    {c.value_type ? ` (${c.value_type.split("_").join(" ").toLowerCase()})` : ""} ·
                    signed {date(c.signature_date)} · term {date(c.term_start)} to {date(c.term_end)}
                  </p>
                  {c.payment_terms && (
                    <p className="mt-1 text-muted-foreground">Payment terms: {c.payment_terms}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ride bookings</CardTitle>
              <CardDescription>Rides recorded for your organisation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {view.rides.length === 0 && <Empty>No ride booking has been recorded for you yet.</Empty>}
              {view.rides.map((r) => (
                <div key={r.booking_number} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.booking_number}</span>
                    <Badge variant="secondary">{r.status ?? "RECORDED"}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {r.pickup ?? "Pick-up not recorded"} → {r.dropoff ?? "Drop-off not recorded"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {dateTime(r.scheduled_for)} · {money(r.total_fare, r.currency)} ·{" "}
                    {r.payment_status ?? "payment not recorded"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            This link is private to your organisation and stops working on {date(view.expires_at)}.
          </p>
        </div>
      )}
    </main>
  );
}

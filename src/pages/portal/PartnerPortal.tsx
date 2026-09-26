/**
 * Partner portal — /my/partner/:token
 *
 * An approved partner sees only their own enquiry progress, quotes, contracts
 * and ride bookings, read through the token link. Nothing is invented: an empty
 * section says plainly that there is nothing recorded yet.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake } from "lucide-react";
import {
  openPartnerPortal,
  PARTNER_PORTAL_REFUSAL_TEXT,
  type PartnerPortalView,
} from "@/lib/commercial/partnerPortal";
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

const words = (v: string | null | undefined) => (v ? v.split("_").join(" ").toLowerCase() : "—");

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function PartnerPortal() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["partner-portal", token],
    queryFn: () => openPartnerPortal(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  React.useEffect(() => {
    document.title = "Your Yalla partnership | Yalla Mobility";
  }, []);

  if (!token) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Card>
          <CardContent className="pt-6 text-sm">{PARTNER_PORTAL_REFUSAL_TEXT.INVALID_LINK}</CardContent>
        </Card>
      </main>
    );
  }

  const refused = data && data.ok === false ? data : null;
  const view = data && data.ok === true ? (data as PartnerPortalView) : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Handshake className="h-3.5 w-3.5" aria-hidden /> Yalla Partners
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view ? view.partner.organisation : "Your Yalla partnership"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your partnership progress, quotes, contracts and ride bookings, as recorded by Yalla.
          Questions:{" "}
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
            {PARTNER_PORTAL_REFUSAL_TEXT[refused.error] ?? PARTNER_PORTAL_REFUSAL_TEXT.INVALID_LINK}
          </CardContent>
        </Card>
      )}

      {view && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your partnership</CardTitle>
              <CardDescription>What we hold on record for you.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Reference", value: view.partner.reference ?? "—" },
                { label: "Partner type", value: words(view.partner.partner_type) },
                { label: "Commercial model", value: words(view.partner.commercial_model) },
                {
                  label: "Location",
                  value: [view.partner.city, view.partner.country].filter(Boolean).join(", ") || "—",
                },
                { label: "Applied", value: date(view.partner.applied_at) },
                { label: "Approved", value: date(view.partner.approved_at) },
              ].map((k) => (
                <div key={k.label} className="rounded-md border p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {k.label}
                  </p>
                  <p className="mt-1 text-sm font-medium">{k.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where your enquiry stands</CardTitle>
              <CardDescription>Progress recorded by the Yalla team.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!view.enquiry && (
                <Empty>Your enquiry has not been picked up on the sales desk yet.</Empty>
              )}
              {view.enquiry && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{words(view.enquiry.stage)}</Badge>
                    {view.enquiry.lead_ref && (
                      <span className="text-muted-foreground">{view.enquiry.lead_ref}</span>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    Meeting held {dateTime(view.enquiry.meeting_held_at)} · quote shared{" "}
                    {dateTime(view.enquiry.quote_shared_at)} · contract shared{" "}
                    {dateTime(view.enquiry.contract_shared_at)} · contract signed{" "}
                    {dateTime(view.enquiry.contract_signed_at)}
                  </p>
                  {view.enquiry.awaiting_item && (
                    <p className="text-muted-foreground">
                      Waiting on {words(view.enquiry.waiting_on)}: {view.enquiry.awaiting_item}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

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
              <CardDescription>Agreements between your organisation and Yalla.</CardDescription>
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
                    {money(c.value_amount, c.currency)} · signed {date(c.signature_date)} · term{" "}
                    {date(c.term_start)} to {date(c.term_end)}
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
              <CardDescription>Rides recorded against your organisation.</CardDescription>
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

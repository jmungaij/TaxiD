import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookingCall, errText } from "@/lib/meetings/booking";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Video } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type R = Record<string, unknown>;
interface Portal { email: string; verified: boolean; leads: R[]; invoices: R[]; bookings: R[]; meetings: R[] }

const d = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—");
const money = (cents: unknown, cur: unknown) => typeof cents === "number" ? `${cur ?? "KES"} ${(cents / 100).toLocaleString("en-KE")}` : "—";

function Section({ title, rows, empty, render }: { title: string; rows: R[]; empty: string; render: (r: R, i: number) => React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></CardTitle></CardHeader>
      <CardContent className="divide-y p-0">
        {rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{empty}</p> : rows.map(render)}
      </CardContent>
    </Card>
  );
}

export default function MyClientPortal() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["my-client-portal", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_client_portal" as never);
      if (error) throw error;
      return data as unknown as Portal;
    },
  });

  return (
    <MarketingPage>
      <PageHero eyebrow="Client portal" title="Your Yalla Mobility account" subtitle="Your bookings, enquiries, invoices and meetings in one place." />
      <section className="container mx-auto max-w-5xl space-y-6 px-4 py-10">
        {authLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : !user ? (
          <Card><CardContent className="space-y-4 p-8 text-center">
            <p>Sign in with your own account to see your records.</p>
            <Button asChild><Link to={`/auth?redirect=${encodeURIComponent("/my/account")}`}>Sign in</Link></Button>
          </CardContent></Card>
        ) : q.isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : q.error ? (
          <Card><CardContent className="p-6 text-sm text-destructive">We could not load your records. Please try again.</CardContent></Card>
        ) : q.data && !q.data.verified ? (
          <Card><CardContent className="p-6 text-sm">Please confirm your email address ({q.data.email}) first — we only show records once we know the email is yours.</CardContent></Card>
        ) : q.data && (
          <>
            <p className="text-sm text-muted-foreground">Showing records for <strong>{q.data.email}</strong>.</p>
            <Section title="Bookings" rows={q.data.bookings} empty="No bookings yet." render={(r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div><div className="font-medium">{String(r.reference)} · {String(r.asset ?? "")}</div><div className="text-muted-foreground">{d(r.created_at)}</div></div>
                <div className="flex items-center gap-2"><Badge variant="secondary">{String(r.status)}</Badge><Badge variant="outline">{String(r.payment_status ?? "")}</Badge><span className="font-mono">{r.amount != null ? `${r.currency} ${Number(r.amount).toLocaleString("en-KE")}` : ""}</span></div>
              </div>)} />
            <Section title="Invoices" rows={q.data.invoices} empty="No invoices issued to your email." render={(r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div><div className="font-medium">Proforma {String(r.number)} · {String(r.company ?? "")}</div><div className="text-muted-foreground">Issued {d(r.issue_date)} · valid until {d(r.valid_until)}</div></div>
                <div className="flex items-center gap-2"><Badge variant="secondary">{String(r.status)}</Badge><span className="font-mono">{money(r.total_cents, r.currency)}</span></div>
              </div>)} />
            <Section title="Enquiries" rows={q.data.leads} empty="No enquiries under your email." render={(r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div><div className="font-medium">{String(r.organisation ?? r.ref)}</div><div className="text-muted-foreground">{String(r.service ?? "")} · opened {d(r.created_at)}</div></div>
                <Badge variant="secondary">{String(r.stage)}</Badge>
              </div>)} />
            <Section title="Meetings" rows={q.data.meetings} empty="No meetings booked." render={(r, i) => {
              const live = r.status === "confirmed" && Date.parse(String(r.starts_at)) > Date.now();
              return (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div><div className="font-medium">{r.type ? `${String(r.type)} · ` : ""}{String(r.topic).split("\n")[0]}</div><div className="text-muted-foreground">{new Date(String(r.starts_at)).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" })}{r.host ? ` · with ${String(r.host)}` : ""}{r.duration ? ` · ${String(r.duration)} min` : ""}</div>
                  {r.lead_ref ? <div className="mt-1 text-xs text-muted-foreground">Linked enquiry: <b>{String(r.lead_ref)}</b>{r.lead_service ? ` · ${String(r.lead_service)}` : ""}{r.lead_stage ? ` · ${String(r.lead_stage)}` : ""}</div> : null}</div>
                <div className="flex items-center gap-2"><Badge variant="secondary">{String(r.status)}</Badge>
                  {live && r.id ? <Button size="sm" variant="outline" onClick={async () => {
                    try { const { token } = await bookingCall<{ token: string }>({ action: "portal_link", booking_id: r.id }); navigate(`/book-a-meeting/manage/${token}`); }
                    catch (e) { alert(errText(e)); }
                  }}>Move or cancel</Button> : null}
                  {r.join_url && live ? <Button size="sm" asChild><a href={String(r.join_url)} target="_blank" rel="noreferrer"><Video className="mr-1 h-4 w-4" />Join</a></Button> : null}</div>
              </div>); }} />
            <Button variant="outline" asChild><Link to="/book-a-meeting">Book another meeting</Link></Button>
          </>
        )}
      </section>
    </MarketingPage>
  );
}

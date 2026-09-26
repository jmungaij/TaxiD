/**
 * Customer-facing charter Booking status page.
 *
 * Customers look up one of their bookings by reference and follow the flight
 * in real time (Supabase Realtime on `charter_bookings`), including operator
 * reason codes and notes, plus a downloadable confirmation summary when their
 * notification preferences allow it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Loader2, Paperclip, RefreshCw, Search, Radio } from "lucide-react";
import { FlightTimeline } from "@/components/charter/FlightTimeline";
import { LiveTripTracker } from "@/components/charter/LiveTripTracker";
import { useAuth } from "@/hooks/useAuth";
import { corporateLoginHref } from "@/lib/charter/portalRoutes";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  charterApi, DEFAULT_CHARTER_PREFS,
  type CharterBookingRow, type CharterNotificationPrefs,
} from "@/lib/charter/api";
import { reasonLabel } from "@/lib/charter/access";
import { statusLabel } from "@/lib/charter/transitions";
import { downloadConfirmationSummary, resolveEvidenceLinks } from "@/lib/charter/confirmationSummary";

type StatusView = Partial<CharterBookingRow> & { reference?: string };

export default function CharterBookingStatus() {
  const { user } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [reference, setReference] = useState(params.get("ref") ?? "");
  const [booking, setBooking] = useState<StatusView | null>(null);
  const [prefs, setPrefs] = useState<CharterNotificationPrefs>(DEFAULT_CHARTER_PREFS);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    charterApi.getPrefs().then(setPrefs).catch(() => undefined);
  }, [user]);

  const lookup = useCallback(async (ref: string) => {
    const clean = ref.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const status = await charterApi.flightStatus(clean);
      setBooking({ ...status, reference: clean });
      setParams({ ref: clean }, { replace: true });
    } catch (e) {
      setBooking(null);
      setError(e instanceof Error ? e.message : "Could not load this booking.");
    } finally {
      setLoading(false);
    }
  }, [setParams]);

  useEffect(() => {
    const initial = params.get("ref");
    if (initial && user) void lookup(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Live updates for the looked-up booking reference.
  useEffect(() => {
    const ref = booking?.reference;
    if (!ref) return;
    const channel = supabase
      .channel(`charter-status-${ref}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "charter_bookings", filter: `reference=eq.${ref}` },
        (payload) => {
          const next = payload.new as CharterBookingRow;
          setBooking((prev) => (prev ? { ...prev, ...next } : next));
          if (prefs.status_emails) {
            toast({ title: "Flight status updated", description: statusLabel(next.flight_status) });
          }
        },
      )
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    return () => {
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [booking?.reference, prefs.status_emails]);

  const trip = (booking?.trip ?? {}) as Record<string, string>;
  const events = useMemo(() => booking?.flight_events ?? [], [booking]);

  /**
   * Concierge confirmation sheet — full timeline, human reason labels and any
   * attached evidence documents resolved to short-lived signed links.
   */
  const downloadSummary = async () => {
    if (!booking) return;
    setSummaryBusy(true);
    try {
      const links = await resolveEvidenceLinks(events);
      downloadConfirmationSummary({ ...booking, flight_events: events }, links);
      toast({ title: "Confirmation summary ready", description: `${booking.reference} downloaded.` });
    } catch (e) {
      toast({
        title: "Could not build summary",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <MarketingPage>
      <SeoHead
        path="/charter/booking-status"
        title="Charter Booking Status | SAFARID"
        description="Track your SAFARID charter booking in real time: live flight timeline, operator updates and downloadable confirmation summary."
      />
      <PageHero
        eyebrow="Charter Business"
        title="Booking status"
        subtitle="Track your charter in real time — live flight timeline, operator reason codes and a downloadable confirmation summary."
      />
      <div className="container mx-auto px-4 py-12">

      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="border-border/50 bg-card/70 shadow-[0_24px_60px_-45px_hsl(var(--primary)/0.55)] backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Find your booking</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => { e.preventDefault(); void lookup(reference); }}
            >
              <div className="flex-1">
                <Label htmlFor="cbs-ref">Booking reference</Label>
                <Input
                  id="cbs-ref" className="mt-2" placeholder="CH-XXXXXXXX" maxLength={40}
                  value={reference} onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={loading || !reference.trim() || !user}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Track booking
              </Button>
            </form>
            {!user && (
              <p className="mt-3 text-sm text-muted-foreground">
                <Link to={corporateLoginHref(location.pathname + location.search)} className="underline">Sign in</Link> to view your charter bookings.
              </p>
            )}
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {booking && (
          <Card className="border-border/50 bg-card/70 shadow-[0_28px_70px_-45px_hsl(var(--primary)/0.6)] backdrop-blur">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {booking.asset_name ?? "Charter"} · <span className="font-mono">{booking.reference}</span>
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{statusLabel(booking.flight_status)}</Badge>
                  {live && (
                    <Badge variant="outline" className="text-primary">
                      <Radio className="mr-1 h-3 w-3" /> Live
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-muted-foreground">
                {trip.origin || "—"} → {trip.destination || "—"}
                {trip.date ? ` · ${trip.date}` : ""}
              </p>

              <LiveTripTracker
                reference={booking.reference ?? ""}
                origin={trip.origin}
                destination={trip.destination}
                status={booking.flight_status}
                events={events}
              />

              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="mb-3 text-sm font-semibold">Flight timeline</p>
                <FlightTimeline currentStatus={booking.flight_status ?? "requested"} events={events} />
              </div>

              {events.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Operator updates</p>
                  <ul className="space-y-2">
                    {[...events].reverse().map((e, i) => (
                      <li key={`${e.at}-${i}`} className="rounded-lg border border-border/60 p-3 text-xs">
                        <span className="font-medium text-foreground">{statusLabel(e.status)}</span>
                        <span className="text-muted-foreground"> · {new Date(e.at).toLocaleString()}</span>
                        {e.reason_code && <span className="text-muted-foreground"> · {reasonLabel(e.reason_code)}</span>}
                        {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
                        {e.evidence_url && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Paperclip className="h-3 w-3" /> Evidence document attached
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {prefs.downloadable_summaries ? (
                  <Button data-analytics="charterbookingstatus.download" variant="outline" onClick={() => void downloadSummary()} disabled={summaryBusy}>
                    {summaryBusy
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Download className="mr-2 h-4 w-4" />}
                    Download confirmation summary
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Downloadable summaries are turned off in your notification preferences.
                  </p>
                )}
                <Button variant="outline" onClick={() => void lookup(booking.reference ?? "")} disabled={loading}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </MarketingPage>
  );
}

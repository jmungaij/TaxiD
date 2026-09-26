/**
 * ADMIN TRIP DETAIL — one real booking, read from the booking register.
 *
 * Reached from the trip directory. Everything shown is stored against the
 * booking itself; where a value was never recorded the page says so instead of
 * inventing a route, a fare or a timeline.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Share2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatMoney,
  formatWhen,
  getTrip,
  tripTimeline,
  tripWaypoints,
} from "@/lib/trips/adminTrips";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

export default function AdminTripDetail() {
  const { tripId = "" } = useParams();

  const trip = useQuery({
    queryKey: ["admin-trip", tripId],
    queryFn: () => getTrip(tripId),
    enabled: Boolean(tripId),
  });
  const timeline = useQuery({
    queryKey: ["admin-trip-timeline", tripId],
    queryFn: () => tripTimeline(tripId),
    enabled: Boolean(tripId),
  });
  const stops = useQuery({
    queryKey: ["admin-trip-waypoints", tripId],
    queryFn: () => tripWaypoints(tripId),
    enabled: Boolean(tripId),
  });

  if (trip.isLoading) return <Skeleton className="h-64 w-full" />;

  if (trip.error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">This trip could not be read.</p>
          <p className="text-muted-foreground">{(trip.error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const t = trip.data;
  if (!t)
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
          <p>NO TRIP FOUND for this reference. Nothing has been created in its place.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/trips">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back to trips
            </Link>
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Trip record
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.booking_number || t.id}
          </h1>
          <p className="text-sm text-muted-foreground">
            Booked {formatWhen(t.created_at)} · {t.intent || "personal"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t.status}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link to={`/dashboard/admin/trip-share/${t.id}`}>
              <Share2 className="mr-1 h-4 w-4" aria-hidden /> Share links
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/trips">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> All trips
            </Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Route</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">{t.pickup_address || "PICKUP NOT RECORDED"}</p>
              <p className="text-xs text-muted-foreground">Pick-up</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
            <div>
              <p className="font-medium">{t.dropoff_address || "DROP-OFF NOT RECORDED"}</p>
              <p className="text-xs text-muted-foreground">Drop-off</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fare" value={formatMoney(t.total_fare, t.currency)} />
        <Field label="Payment status" value={t.payment_status || "NOT RECORDED"} />
        <Field label="Payment method" value={t.payment_method || "NOT RECORDED"} />
        <Field label="Paid at" value={formatWhen(t.paid_at)} />
        <Field label="Passengers" value={t.passenger_count ?? "NOT RECORDED"} />
        <Field label="Scheduled for" value={formatWhen(t.scheduled_for)} />
        <Field label="Started" value={formatWhen(t.started_at)} />
        <Field label="Completed" value={formatWhen(t.completed_at)} />
        <Field
          label="Driver on record"
          value={t.driver_id ? <span className="font-mono text-xs">{t.driver_id}</span> : "NOT ASSIGNED"}
        />
        <Field
          label="Rider"
          value={t.rider_user_id ? <span className="font-mono text-xs">{t.rider_user_id}</span> : "NOT RECORDED"}
        />
        <Field
          label="Vehicle"
          value={t.vehicle_id ? <span className="font-mono text-xs">{t.vehicle_id}</span> : "NOT ASSIGNED"}
        />
        <Field
          label="Payment reference"
          value={t.payment_reference || "NOT RECORDED"}
        />
      </div>

      {t.cancelled_at && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cancelled</CardTitle>
            <CardDescription>{formatWhen(t.cancelled_at)}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {t.cancellation_reason || "NO REASON RECORDED"}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Status history</CardTitle>
          <CardDescription>Each change recorded against this trip.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {timeline.isLoading && <Skeleton className="h-16 w-full" />}
          {timeline.error && (
            <p className="text-muted-foreground">
              Status history could not be read: {(timeline.error as Error).message}
            </p>
          )}
          {!timeline.isLoading && !timeline.error && (timeline.data ?? []).length === 0 && (
            <p className="text-muted-foreground">NO STATUS CHANGES RECORDED FOR THIS TRIP.</p>
          )}
          {(timeline.data ?? []).map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span className="font-medium">
                {e.from_status ? `${e.from_status} → ${e.to_status}` : e.to_status}
              </span>
              <span className="text-xs text-muted-foreground">{formatWhen(e.created_at)}</span>
              {e.reason && <span className="w-full text-xs text-muted-foreground">{e.reason}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stops</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {stops.isLoading && <Skeleton className="h-12 w-full" />}
          {!stops.isLoading && (stops.data ?? []).length === 0 && (
            <p className="text-muted-foreground">
              NO INTERMEDIATE STOPS RECORDED — pick-up and drop-off above are the full route.
            </p>
          )}
          {(stops.data ?? []).map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span className="font-medium">
                {w.seq}. {w.address || "ADDRESS NOT RECORDED"}
              </span>
              <span className="text-xs text-muted-foreground">
                Arrived {formatWhen(w.arrived_at)} · Departed {formatWhen(w.departed_at)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Live trip progress tracker for a charter booking.
 *
 * Subscribes to Supabase Realtime for the booking row and renders the
 * operator-recorded progress along the route plus any disruption signals
 * raised by the operator. Progress is derived from the flight status ladder
 * and the flight event log — the only telemetry the platform actually holds.
 * There is no GPS position feed, so the panel never claims one.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Navigation, Radio, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { statusLabel } from "@/lib/charter/transitions";
import { reasonLabel } from "@/lib/charter/access";

export interface FlightEventItem {
  at: string;
  status: string;
  note?: string | null;
  reason_code?: string | null;
}

interface Props {
  reference: string;
  origin?: string;
  destination?: string;
  /** Current flight status from the booking row. */
  status?: string | null;
  /** Operator-recorded flight events from the booking row. */
  events?: FlightEventItem[];
}

/** Route completion implied by each rung of the flight status ladder. */
const STATUS_PROGRESS: Record<string, number> = {
  requested: 5,
  scheduled: 15,
  crew_assigned: 25,
  boarding: 35,
  departed: 50,
  en_route: 70,
  landed: 85,
  arrived: 95,
  completed: 100,
  cancelled: 0,
};

export function LiveTripTracker({ reference, origin, destination, status, events = [] }: Props) {
  const [currentStatus, setCurrentStatus] = useState(status ?? "requested");
  const [items, setItems] = useState<FlightEventItem[]>(events);
  const [live, setLive] = useState(false);

  // Keep in sync when the parent loads or refreshes the booking.
  useEffect(() => { if (status) setCurrentStatus(status); }, [status]);
  useEffect(() => { setItems(events); }, [events]);

  useEffect(() => {
    if (!reference) return;
    // Live updates come only from row changes on charter_bookings, where the
    // table's own row-level rules decide what each viewer may receive. No
    // Broadcast/Presence topic is used: those channels are not topic-scoped
    // here, so an untrusted subscriber could otherwise join by reference alone.
    const channel = supabase
      .channel(`charter-booking-updates-${reference}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "charter_bookings", filter: `reference=eq.${reference}` },
        (payload) => {
          const next = payload.new as { flight_status?: string; flight_events?: FlightEventItem[] };
          if (next.flight_status) setCurrentStatus(next.flight_status);
          if (Array.isArray(next.flight_events)) setItems(next.flight_events);
        },
      )
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    return () => {
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [reference]);

  const progress = Math.max(0, Math.min(100, STATUS_PROGRESS[currentStatus] ?? 0));
  const latest = items[items.length - 1] ?? null;
  const disruptions = useMemo(() => items.filter((e) => e.reason_code), [items]);

  return (
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Navigation className="h-4 w-4" /> Live trip tracking
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{statusLabel(currentStatus)}</Badge>
            <Badge variant="outline" className={live ? "gap-1 text-primary" : "gap-1"}>
              <Radio className="h-3 w-3" /> {live ? "Live" : "Reconnecting"}
            </Badge>
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>{origin ?? "Origin"}</span>
            <span>{destination ?? "Destination"}</span>
          </div>
          <Progress value={progress} />
          <p className="mt-1 text-xs text-muted-foreground">
            {progress}% of journey complete
          </p>
        </div>

        {latest ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" />
            Last update {new Date(latest.at).toLocaleString("en-KE")} · {statusLabel(latest.status)}
            {latest.note ? ` — ${latest.note}` : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Updates appear here as the operator confirms each stage of the journey.
          </p>
        )}

        {disruptions.length > 0 && (
          <ul className="space-y-2">
            {disruptions.slice(-4).reverse().map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>
                  <span className="font-medium text-foreground">{reasonLabel(e.reason_code)}</span>
                  {e.note ? <span className="block text-muted-foreground">{e.note}</span> : null}
                  <span className="block text-muted-foreground">{new Date(e.at).toLocaleString("en-KE")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default LiveTripTracker;

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Radio, MapPin, Navigation, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface ActiveTrip {
  id: string;
  booking_number: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  total_fare: number | null;
  pickup_eta: string | null;
  passenger_count: number | null;
}

interface DutyState {
  driver_id: string;
  driver_status: string;
  is_online: boolean;
  is_available: boolean;
  last_ping: string | null;
  active_trip: ActiveTrip | null;
}

const HEARTBEAT_MS = 30_000;

/** Reads the browser position once, resolving null when unavailable/denied. */
function readPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 }
    );
  });
}

/**
 * Driver duty console: the supply side of dispatch. Going online publishes the
 * driver's live position so trip matching can actually find them, and the
 * active trip card drives the arriving → in progress → completed transitions.
 */
export function DriverDutyPanel() {
  const [state, setState] = useState<DutyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("driver_duty_state");
    if (!error) setState((data as unknown as DutyState) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ping = useCallback(
    async (online: boolean, available = true) => {
      const pos = await readPosition();
      const { data, error } = await supabase.rpc("driver_set_availability", {
        _online: online,
        _available: available,
        _lat: pos?.lat ?? null,
        _lng: pos?.lng ?? null,
        _accuracy_m: pos?.accuracy ?? null,
      });
      if (error) return { ok: false, reason: error.message };
      return (data as any) ?? { ok: false, reason: "unknown" };
    },
    []
  );

  // Heartbeat keeps the location ping fresh — dispatch ignores pings older
  // than 10 minutes, so a stale driver silently drops out of supply.
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (!state?.is_online) return;
    timer.current = setInterval(() => {
      void ping(true, state.is_available).then(() => void refresh());
    }, HEARTBEAT_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [state?.is_online, state?.is_available, ping, refresh]);

  async function toggleOnline(next: boolean) {
    setBusy(true);
    try {
      const result = await ping(next, true);
      if (!result.ok) {
        const messages: Record<string, string> = {
          location_required: "Allow location access so riders can be matched to you.",
          driver_not_active: "Your driver account isn't active yet — complete onboarding first.",
        };
        toast.error(messages[result.reason] ?? result.reason ?? "Could not update your status");
        return;
      }
      toast.success(next ? "You're online — accepting trips" : "You're offline");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function advance(to: string, label: string) {
    if (!state?.active_trip) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("driver_advance_trip", {
        _booking_id: state.active_trip.id,
        _to_status: to,
        _reason: to === "cancelled" ? "Cancelled by driver" : null,
      });
      if (error) throw error;
      if (!(data as any)?.ok) {
        toast.error("That step isn't allowed from the current trip state.");
        return;
      }
      toast.success(label);
      await refresh();
    } catch (err) {
      toast.error(err.message ?? "Could not update the trip");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading duty status…
        </CardContent>
      </Card>
    );
  }

  if (!state) return null;

  const trip = state.active_trip;

  return (
    <Card data-testid="driver-duty-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Radio className={`w-5 h-5 ${state.is_online ? "text-primary" : "text-muted-foreground"}`} />
          Duty status
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={state.is_online ? "default" : "secondary"}>
            {state.is_online ? (state.is_available ? "Online · available" : "Online · on trip") : "Offline"}
          </Badge>
          <Switch
            checked={state.is_online}
            disabled={busy}
            onCheckedChange={(v) => void toggleOnline(v)}
            aria-label="Go online"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state.is_online && (
          <p className="text-sm text-muted-foreground">
            Go online to enter the dispatch pool. We publish your position every 30 seconds while you're online so
            nearby ride requests can reach you.
          </p>
        )}

        {state.is_online && !trip && (
          <p className="text-sm text-muted-foreground">
            You're in the dispatch pool. Keep this screen open — the next matched trip appears here automatically.
          </p>
        )}

        {trip && (
          <div className="rounded-lg border p-4 space-y-3" data-testid="driver-active-trip">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{trip.booking_number}</span>
              <Badge variant="outline">{trip.status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <span>{trip.pickup_address}</span>
              </div>
              <div className="flex items-start gap-2">
                <Navigation className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>{trip.dropoff_address}</span>
              </div>
              <div className="text-muted-foreground">
                KES {Number(trip.total_fare ?? 0).toLocaleString()} · {trip.passenger_count ?? 1} passenger(s)
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {trip.status === "driver_assigned" && (
                <Button size="sm" disabled={busy} onClick={() => void advance("driver_arriving", "On your way")}>
                  Start heading to pickup
                </Button>
              )}
              {trip.status === "driver_arriving" && (
                <Button size="sm" disabled={busy} onClick={() => void advance("in_progress", "Trip started")}>
                  Rider on board — start trip
                </Button>
              )}
              {trip.status === "in_progress" && (
                <Button size="sm" disabled={busy} onClick={() => void advance("completed", "Trip completed")}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Complete trip
                </Button>
              )}
              {trip.status !== "in_progress" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void advance("cancelled", "Trip cancelled")}
                >
                  <XCircle className="w-4 h-4 mr-1" /> Can't take it
                </Button>
              )}
            </div>
          </div>
        )}

        {state.last_ping && (
          <p className="text-xs text-muted-foreground/70">
            Last position ping {new Date(state.last_ping).toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default DriverDutyPanel;

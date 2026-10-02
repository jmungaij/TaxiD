import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TripMessages } from "@/components/rider/TripMessages";
import { MapPinned, Radio, Siren } from "lucide-react";

/**
 * Shown for the driver's active trip: shares live position (server computes
 * ETA), shows the rider's chosen meeting point and the Meet me channel.
 */
export function LiveTripPanel({ bookingId, meetingPointId }: { bookingId: string; meetingPointId: string | null }) {
  const [sharing, setSharing] = useState<"on" | "denied" | "unsupported" | "starting">("starting");
  const [eta, setEta] = useState<number | null>(null);
  const [point, setPoint] = useState<{ place_name: string; point_name: string; landmark: string | null } | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) { setSharing("unsupported"); return; }
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        setSharing("on");
        if (Date.now() - last < 8000) return;
        last = Date.now();
        const speed = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;
        const { data } = await supabase.rpc("driver_post_location", {
          _booking_id: bookingId, _lat: pos.coords.latitude, _lng: pos.coords.longitude,
          _speed_kmh: speed, _heading: pos.coords.heading ?? null,
        });
        const r = data as { ok?: boolean; eta_seconds?: number } | null;
        if (r?.ok && r.eta_seconds != null) setEta(r.eta_seconds);
      },
      (err) => setSharing(err.code === err.PERMISSION_DENIED ? "denied" : "starting"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [bookingId]);

  const [sos, setSos] = useState<{ reference: string; status: string } | null>(null);
  useEffect(() => {
    const load = () => supabase.from("safety_incidents").select("reference,status").eq("trip_booking_id", bookingId)
      .in("status", ["open", "acknowledged", "responding", "escalated"]).order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setSos((data?.[0] as typeof sos) ?? null));
    load();
    const ch = supabase.channel(`drv-sos-${bookingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "safety_incidents", filter: `trip_booking_id=eq.${bookingId}` }, load)
      .subscribe();
    const t = setInterval(load, 20000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!meetingPointId) { setPoint(null); return; }
    supabase.from("pickup_points").select("place_name,point_name,landmark").eq("id", meetingPointId).maybeSingle()
      .then(({ data }) => setPoint(data as typeof point));
  }, [meetingPointId]);

  return (
    <div className="mt-3 w-full space-y-3 rounded-md border p-3 text-sm">
      {sos && (
        <div role="alert" data-testid="driver-sos-banner" className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-2 text-destructive">
          <Siren className="h-4 w-4 mt-0.5" />
          <div><div className="font-semibold">Your rider raised a safety alert ({sos.reference})</div>
            <div className="text-xs">Stop safely when possible and follow instructions from TaxiD Safety. Keep location sharing on.</div></div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <Radio className={sharing === "on" ? "h-4 w-4 text-success" : "h-4 w-4 text-muted-foreground"} />
        {sharing === "on" && <>Sharing your live location with the rider{eta != null ? ` · ETA ${Math.max(1, Math.round(eta / 60))} min` : ""}</>}
        {sharing === "starting" && "Getting your location…"}
        {sharing === "denied" && <span className="text-destructive">Location is blocked. Allow location so the rider can see you coming.</span>}
        {sharing === "unsupported" && "This device can't share location."}
      </div>
      {point && (
        <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
          <MapPinned className="h-4 w-4 text-primary mt-0.5" />
          <div><div className="font-medium">Meet at {point.place_name} — {point.point_name}</div>
            {point.landmark && <div className="text-xs text-muted-foreground">{point.landmark}</div>}</div>
        </div>
      )}
      <TripMessages bookingId={bookingId} role="driver" active />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import BrandLogo from "@/components/brand/BrandLogo";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { Card } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import { brandColor } from "@/lib/design/brandColor";

interface ShareBooking {
  id: string;
  booking_number: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lng: number;
  dropoff_lat: number;
  status: string;
}

// Public token-based trip share page (no auth).
// Resolves the token via the trip-share-resolve edge function so the
// trip_share_links table can remain owner-scoped and unenumerable.
export default function PublicTripSharePage() {
  const { token } = useParams<{ token: string }>();
  const pin =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("pin") ?? ""
      : "";
  const [tripBookingId, setTripBookingId] = useState<string | null>(null);
  const [booking, setBooking] = useState<ShareBooking | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const driverRef = useRef<any>(null);

  useEffect(() => {
    if (!token) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      // supabase.functions.invoke has no query-string option, so we hit the
      // function URL directly with the token as a query param.
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      let data: any = null;
      try {
        const qs = new URLSearchParams({ token });
        if (pin) qs.set("pin", pin);
        const res = await fetch(
          `${base}/functions/v1/trip-share-resolve?${qs.toString()}`,
          { method: "GET", headers: { apikey: anon, Authorization: `Bearer ${anon}` } },
        );
        data = await res.json().catch(() => null);
        if (!res.ok || !data || data.error) {
          const code = String(data?.error ?? "invalid");
          const reasons: Record<string, string> = {
            pin_required: "PIN required — append ?pin=… to the link",
            pin_wrong: "Incorrect PIN",
            locked: "Too many attempts — this link is temporarily locked",
            expired: "Share link expired",
            revoked: "Share link revoked",
            exhausted: "Share link has reached its view limit",
          };
          setErr(reasons[code] ?? "Invalid or expired share link");
          return;
        }

      } catch {
        setErr("Invalid or expired share link");
        return;
      }
      const payload = data as {
        trip_booking_id: string;
        booking: ShareBooking;
        position: { lat: number; lng: number } | null;
      };
      setTripBookingId(payload.trip_booking_id);
      setBooking(payload.booking);
      if (payload.position) setPos(payload.position);

      channel = supabase
        .channel(`share-${token}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "trip_tracking",
            filter: `trip_booking_id=eq.${payload.trip_booking_id}`,
          },
          (p) => {
            const row = p.new as { lat: number | string; lng: number | string };
            setPos({ lat: Number(row.lat), lng: Number(row.lng) });
          },
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [token, pin]);

  useEffect(() => {
    if (!booking || !mapEl.current) return;
    loadGoogleMaps().then((g) => {
      mapRef.current = new g.maps.Map(mapEl.current!, {
        center: { lat: booking.pickup_lat, lng: booking.pickup_lng },
        zoom: 13,
        disableDefaultUI: true,
      });
      new g.maps.Marker({
        map: mapRef.current,
        position: { lat: booking.pickup_lat, lng: booking.pickup_lng },
        label: "A",
      });
      new g.maps.Marker({
        map: mapRef.current,
        position: { lat: booking.dropoff_lat, lng: booking.dropoff_lng },
        label: "B",
      });
    });
  }, [booking]);

  useEffect(() => {
    if (!pos || !mapRef.current) return;
    const g = (window as unknown as { google: any }).google;
    if (!driverRef.current) {
      driverRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: pos,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: brandColor("status-success"),
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
        },
      });
      mapRef.current.panTo(pos);
    } else {
      driverRef.current.setPosition(pos);
    }
  }, [pos]);

  if (err)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-sm text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="font-semibold">{err}</p>
        </Card>
      </div>
    );

  if (!booking)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center justify-between">
          <BrandLogo className="h-6 max-w-[132px]" />
          <div className="text-xs text-muted-foreground">
            Live trip · {booking.booking_number}
            {tripBookingId ? "" : ""}
          </div>
        </div>
      </header>
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <Card className="p-4 text-sm">
          <div>
            <span className="text-muted-foreground">From:</span> {booking.pickup_address}
          </div>
          <div>
            <span className="text-muted-foreground">To:</span> {booking.dropoff_address}
          </div>
          <div className="mt-1 text-xs">
            <span className="text-muted-foreground">Status:</span> {booking.status}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div ref={mapEl} className="w-full h-[60vh]" />
        </Card>
      </div>
    </div>
  );
}

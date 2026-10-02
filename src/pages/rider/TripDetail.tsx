import { runMpesaCheckout } from "@/lib/payments/checkout";
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RiderShell } from "@/components/rider/RiderShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle, Share2, X, Copy, UserRound, Star, Phone, Receipt } from "lucide-react";
import { TripProgress, deriveStage, stageLabel, haversineM } from "@/components/rider/TripProgress";
import { TripMessages } from "@/components/rider/TripMessages";
import { MeetingPointPicker, type PickupPoint } from "@/components/rider/MeetingPointPicker";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CANCEL_REASONS = ["Driver is taking too long", "I changed my plans", "Wrong pickup location", "Booked by mistake", "Found another ride"];
const COMPLIMENTS = ["Safe driving", "Clean car", "Friendly", "Good route", "On time"];
import { toast } from "sonner";

interface Booking {
  id: string;
  booking_number: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  status: string;
  total_fare: number | null;
  driver_id: string | null;
  payment_method: string;
  pickup_eta: string | null;
  meeting_point_id?: string | null;
}

interface SosConfirmation {
  sentAt: Date;
  contactName: string | null;
  contactPhone: string | null;
  contactRelationship: string | null;
  etaMinutes: number;
}

interface DriverCard {
  driver_id: string;
  name: string;
  phone: string | null;
  rating: number | null;
  driver_code: string | null;
  pickup_eta: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
}

const SEARCHING_STATUSES = ["pending", "searching", "scheduled"];

export default function RiderTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [fix, setFix] = useState<{ at: number; eta: number | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [meetingPoint, setMeetingPoint] = useState<PickupPoint | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const [tipAmount, setTipAmount] = useState(100);
  const [tipping, setTipping] = useState(false);
  const [tipPhone, setTipPhone] = useState("");
  const [tipProgress, setTipProgress] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverCard | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [ratingSaved, setRatingSaved] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [pickupPin, setPickupPin] = useState<{ pin: string; verified: boolean } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sos, setSos] = useState<SosConfirmation | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);


  // Load booking + realtime
  useEffect(() => {
    if (!id || !user) return;
    supabase.from("trip_bookings").select("*").eq("id", id).single().then(({ data }) => {
      if (data) setBooking(data as Booking);
    });
    const ch = supabase
      .channel(`booking-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_bookings", filter: `id=eq.${id}` }, (p) =>
        setBooking(p.new as Booking)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trip_tracking", filter: `trip_booking_id=eq.${id}` },
        (p) => {
          const n = p.new as any;
          setDriverPos({ lat: Number(n.lat), lng: Number(n.lng) });
          setFix({ at: new Date(n.recorded_at).getTime(), eta: n.eta_seconds ?? null });
        }
      )
      .subscribe();
    supabase.from("trip_tracking").select("lat,lng,eta_seconds,recorded_at").eq("trip_booking_id", id)
      .order("recorded_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
        if (data) {
          setDriverPos({ lat: Number(data.lat), lng: Number(data.lng) });
          setFix({ at: new Date(data.recorded_at).getTime(), eta: data.eta_seconds ?? null });
        }
      });
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [id, user]);

  useEffect(() => {
    if (!id || booking?.status !== "completed") return;
    supabase.from("trip_tips").select("amount").eq("trip_booking_id", id).maybeSingle()
      .then(({ data }) => data && setTip(Number(data.amount)));
  }, [id, booking?.status]);

  useEffect(() => {
    if (!user || booking?.status !== "completed") return;
    supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle()
      .then(({ data }) => data?.phone && setTipPhone((p) => p || String(data.phone)));
  }, [user, booking?.status]);

  async function sendTip(viaMpesa: boolean) {
    if (!booking) return;
    setTipping(true);
    if (viaMpesa) {
      const out = await runMpesaCheckout(
        { amountKes: tipAmount, phone: tipPhone, reference: `TIP-${booking.booking_number}`, walletType: "personal" },
        (p) => setTipProgress(p.message),
      );
      setTipProgress(null);
      if (out.state !== "paid") {
        setTipping(false);
        return toast.error(out.message ?? "M-Pesa payment did not complete.");
      }
    }
    const { data, error } = await supabase.rpc("trip_tip_driver", { _booking_id: booking.id, _amount: tipAmount });
    setTipping(false);
    const r = data as any;
    if (error || !r?.ok) {
      const code = r?.error;
      return toast.error(
        code === "INSUFFICIENT_FUNDS" ? `Not enough in your wallet (KES ${r.balance}). Top up with M-Pesa first.`
        : code === "NO_WALLET" ? "Open your Wallet page first to set it up."
        : code === "ALREADY_TIPPED" ? "You've already tipped on this trip."
        : "Tip not sent. Try again.");
    }
    setTip(tipAmount);
    toast.success(`Thanks! KES ${tipAmount} tip sent to your driver.`);
  }

  // Resolve the assigned driver through the definer RPC — riders cannot read
  // public.drivers directly, which is why this card used to show a raw UUID.
  useEffect(() => {
    if (!booking?.driver_id) {
      setDriver(null);
      return;
    }
    supabase.rpc("trip_driver_card", { _booking_id: booking.id }).then(({ data }) => {
      if (data) setDriver(data as unknown as DriverCard);
    });
  }, [booking?.driver_id, booking?.id, booking?.pickup_eta]);

  // Pickup PIN — shown to the rider only; the driver must enter it to start.
  useEffect(() => {
    if (!booking?.driver_id || ["completed", "cancelled"].includes(booking.status)) return;
    supabase.rpc("trip_pickup_pin", { _booking_id: booking.id }).then(({ data }) => {
      if (data) setPickupPin(data as unknown as { pin: string; verified: boolean });
    });
  }, [booking?.id, booking?.driver_id, booking?.status]);

  // Existing rating (a rider may only rate a trip once).
  useEffect(() => {
    if (!id || !user || booking?.status !== "completed") return;
    supabase
      .from("trip_ratings")
      .select("overall")
      .eq("trip_booking_id", id)
      .eq("rater_user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRating(Number(data.overall ?? 0));
          setRatingSaved(true);
        }
      });
  }, [id, user, booking?.status]);

  async function findDriver() {
    if (!booking) return;
    setAssigning(true);
    try {
      const { data, error } = await supabase.rpc("trip_assign_driver", { _booking_id: booking.id });
      if (error) throw error;
      if ((data as any)?.assigned) {
        toast.success("Driver assigned");
        const { data: fresh } = await supabase.from("trip_bookings").select("*").eq("id", booking.id).single();
        if (fresh) setBooking(fresh as Booking);
      } else {
        toast.info("No driver available nearby yet. We'll keep looking — try again in a moment.");
      }
    } catch (err) {
      toast.error(err.message ?? "Could not assign a driver");
    } finally {
      setAssigning(false);
    }
  }

  async function submitRating() {
    if (!booking || !user || rating < 1) return;
    setSavingRating(true);
    const { error } = await supabase.from("trip_ratings").insert({
      trip_booking_id: booking.id,
      rater_user_id: user.id,
      ratee_kind: "driver",
      overall: rating,
      comment: [tags.join(", "), ratingComment.trim()].filter(Boolean).join(" — ") || null,
    });
    setSavingRating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRatingSaved(true);
    toast.success("Thanks for rating your trip");
  }


  // Init map
  useEffect(() => {
    if (!booking || !mapEl.current) return;
    loadGoogleMaps().then((g) => {
      mapRef.current = new g.maps.Map(mapEl.current!, {
        center: { lat: booking.pickup_lat, lng: booking.pickup_lng },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
      });
      new g.maps.Marker({
        map: mapRef.current,
        position: { lat: booking.pickup_lat, lng: booking.pickup_lng },
        label: { text: "A", color: "white" },
      });
      new g.maps.Marker({
        map: mapRef.current,
        position: { lat: booking.dropoff_lat, lng: booking.dropoff_lng },
        label: { text: "B", color: "white" },
      });
      new g.maps.Polyline({
        map: mapRef.current,
        path: [
          { lat: booking.pickup_lat, lng: booking.pickup_lng },
          { lat: booking.dropoff_lat, lng: booking.dropoff_lng },
        ],
        strokeColor: "hsl(217 91% 60%)",
        strokeOpacity: 0.5,
        strokeWeight: 3,
      });
      const bounds = new g.maps.LatLngBounds();
      bounds.extend({ lat: booking.pickup_lat, lng: booking.pickup_lng });
      bounds.extend({ lat: booking.dropoff_lat, lng: booking.dropoff_lng });
      mapRef.current.fitBounds(bounds, 60);
    });
  }, [booking?.id]);

  // Live driver marker
  useEffect(() => {
    if (!driverPos || !mapRef.current) return;
    const g = window.google;
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: driverPos,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "hsl(142 76% 36%)",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
        },
      });
    } else {
      driverMarkerRef.current.setPosition(driverPos);
    }
  }, [driverPos]);

  async function raiseSOS() {
    if (!booking) return;
    const pos = driverPos ?? { lat: booking.pickup_lat, lng: booking.pickup_lng };
    const { error } = await supabase.rpc("safety_raise_sos", {
      _booking_id: booking.id,
      _lat: pos.lat,
      _lng: pos.lng,
      _message: "SOS from rider",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("SOS alert sent. Help is on the way.");
    // Pull the primary emergency contact so the rider can see who was notified
    // and an ETA estimate. Falls back gracefully when nothing is set.
    let contactName: string | null = null;
    let contactPhone: string | null = null;
    let contactRelationship: string | null = null;
    if (user) {
      const { data: contacts } = await supabase
        .from("emergency_contacts")
        .select("name, phone_number, relationship, is_primary")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .limit(1);
      const primary = contacts?.[0];
      if (primary) {
        contactName = primary.name;
        contactPhone = primary.phone_number;
        contactRelationship = primary.relationship;
      }
    }
    setSos({
      sentAt: new Date(),
      contactName,
      contactPhone,
      contactRelationship,
      etaMinutes: 5,
    });
  }

  async function cancelTrip() {
    if (!booking) return;
    const { error } = await supabase.rpc("trip_cancel_booking", { _booking_id: booking.id, _reason: `Rider: ${cancelReason}` });
    setCancelOpen(false);
    if (error) toast.error(error.message);
    else toast.success("Trip cancelled");
  }

  async function shareTrip() {
    if (!booking || !user) return;
    const { data, error } = await supabase.functions.invoke("trip-share-issue", {
      body: { trip_booking_id: booking.id, ttl_seconds: 3600, max_uses: 3 },
    });
    if (error || !data?.token) {
      toast.error(error?.message ?? "Failed to create share link");
      return;
    }
    const url = `${window.location.origin}/t/${data.token}`;
    setShareUrl(url);
    await navigator.clipboard.writeText(url).catch(() => {});
    toast.success("Share link copied to clipboard (valid 1h, 3 uses)");
  }

  if (!booking) {
    return (
      <RiderShell>
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </RiderShell>
    );
  }

  const cancellable = !["completed", "cancelled"].includes(booking.status);
  const onTrip = ["in_progress", "started"].includes(booking.status);
  const target = onTrip ? { lat: booking.dropoff_lat, lng: booking.dropoff_lng } : { lat: booking.pickup_lat, lng: booking.pickup_lng };
  const liveFresh = !!fix && now - fix.at < 2 * 60_000;
  const distance = driverPos ? haversineM(driverPos, target) : null;
  const stage = deriveStage({
    status: booking.status, hasDriver: !!booking.driver_id, pinVerified: !!pickupPin?.verified,
    distanceToTargetM: liveFresh ? distance : null, hasLivePosition: liveFresh,
  });
  const predicted = fix?.eta != null ? fix.at + fix.eta * 1000 : null;
  const promised = booking.pickup_eta ? new Date(booking.pickup_eta).getTime() : null;
  const delayed = ["en_route", "arriving"].includes(stage) && predicted && promised && predicted - promised > 3 * 60_000;
  const stale = ["assigned", "en_route", "arriving", "on_trip", "approaching"].includes(stage) && fix && !liveFresh;
  const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nextAction: Record<string, string> = {
    booked: "We're finding you a driver.",
    assigned: "Your driver is getting ready. Check the plate below.",
    en_route: "Head to your pickup point.",
    arriving: "Your driver is almost there — be ready at the pickup point.",
    arrived: "Check the plate, then give your driver the PIN.",
    verified: "You're verified — get in and buckle up.",
    on_trip: "Enjoy your ride. Share your trip with someone if you like.",
    approaching: "Almost there — get ready to leave the car.",
    completed: "Rate your driver, add a tip, or get your receipt.",
  };

  return (
    <RiderShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold">{booking.booking_number}</h1>
            <Badge>{stageLabel(stage)}</Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={shareTrip}>
              <Share2 className="h-4 w-4 mr-1" /> Share trip
            </Button>
            <Button size="sm" variant="destructive" onClick={raiseSOS}>
              <AlertTriangle className="h-4 w-4 mr-1" /> SOS
            </Button>
            {cancellable && (
              <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        </div>

        <Card className="p-4 space-y-3">
          <TripProgress stage={stage} />
          {stage !== "cancelled" && <p className="text-sm font-medium" data-testid="next-action">{nextAction[stage]}</p>}
          {liveFresh && distance != null && stage !== "completed" && (
            <p className="text-xs text-muted-foreground">
              Driver is {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} from your {onTrip ? "destination" : "pickup"}
              {predicted ? ` · arriving around ${fmt(predicted)}` : ""}
            </p>
          )}
          {delayed && (
            <div role="status" className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm" data-testid="delay-alert">
              Your driver is running late. Updated arrival: <strong>{fmt(predicted!)}</strong>
            </div>
          )}
          {stale && (
            <div role="status" className="rounded-md border p-2 text-xs text-muted-foreground" data-testid="stale-alert">
              Driver location hasn't updated for a few minutes. Use Meet me or call your driver.
            </div>
          )}
        </Card>

        {booking.driver_id && (
          <Card className="p-4 space-y-4">
            <MeetingPointPicker
              bookingId={booking.id}
              pickup={{ lat: booking.pickup_lat, lng: booking.pickup_lng }}
              selectedId={booking.meeting_point_id ?? null}
              editable={!onTrip && cancellable}
              onChange={(p) => { setMeetingPoint(p); if (p && p.id !== booking.meeting_point_id) setBooking({ ...booking, meeting_point_id: p.id }); }}
            />
            <TripMessages bookingId={booking.id} role="rider" active={cancellable} />
          </Card>
        )}

        <Card className="overflow-hidden">
          <div ref={mapEl} className="w-full h-[420px]" />
        </Card>

        <Card className="p-4 space-y-2 text-sm">
          <div><span className="text-muted-foreground">From:</span> {booking.pickup_address}</div>
          <div><span className="text-muted-foreground">To:</span> {booking.dropoff_address}</div>
          <div><span className="text-muted-foreground">Fare:</span> KES {Number(booking.total_fare ?? 0).toLocaleString()} · {booking.payment_method}</div>
        </Card>

        {driver ? (
          <Card className="p-4 space-y-1 text-sm" data-testid="driver-card">
            <div className="flex items-center gap-2 font-semibold">
              <UserRound className="h-4 w-4 text-primary" /> {driver.name}
              {driver.rating != null && (
                <Badge variant="secondary" className="text-[10px]">
                  <Star className="h-3 w-3 mr-1" /> {Number(driver.rating).toFixed(1)}
                </Badge>
              )}
            </div>
            {driver.plate_number && (
              <div className="mt-2 rounded-md border bg-muted/40 p-3" data-testid="vehicle-details">
                <div className="font-mono text-2xl font-bold tracking-widest">{driver.plate_number}</div>
                <div className="text-muted-foreground">
                  {[driver.vehicle_color, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "Vehicle"}
                </div>
              </div>
            )}
            {pickupPin && !["in_progress", "completed", "cancelled"].includes(booking.status) && (
              <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3" data-testid="pickup-pin">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Verify your ride</div>
                <div className="font-mono text-3xl font-bold tracking-[0.4em]">{pickupPin.pin}</div>
                <p className="text-xs text-muted-foreground">
                  Check the plate matches, then give this PIN to your driver. The trip can only start once they enter it.
                </p>
              </div>
            )}
            {driver.driver_code && (
              <div className="text-xs text-muted-foreground">Driver ID {driver.driver_code}</div>
            )}
            {driver.pickup_eta && (
              <div className="text-muted-foreground">
                Arriving around{" "}
                {new Date(driver.pickup_eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
            {driver.phone && (
              <Button asChild size="sm" variant="outline" className="mt-2">
                <a href={`tel:${driver.phone}`}>
                  <Phone className="h-4 w-4 mr-1" /> Call driver
                </a>
              </Button>
            )}
          </Card>
        ) : (
          SEARCHING_STATUSES.includes(booking.status) && (
            <Card className="p-4 space-y-2 text-sm" data-testid="driver-search-card">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Matching you with a nearby driver…
              </div>
              <p className="text-xs text-muted-foreground">
                We look for the closest online driver to your pickup point. If none is free yet, try again in a moment.
              </p>
              <Button size="sm" onClick={findDriver} disabled={assigning} aria-busy={assigning}>
                {assigning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Find a driver now
              </Button>
            </Card>
          )
        )}

        {booking.status === "completed" && (
          <Card className="p-4 space-y-3 text-sm" data-testid="trip-rating-card">
            <div className="font-semibold">Rate your trip</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  disabled={ratingSaved}
                  onClick={() => setRating(n)}
                  className="p-1 disabled:opacity-70"
                >
                  <Star
                    className={`h-6 w-6 ${n <= rating ? "text-primary fill-primary" : "text-muted-foreground"}`}
                  />
                </button>
              ))}
            </div>
            {ratingSaved ? (
              <p className="text-xs text-muted-foreground">Thanks — your rating has been recorded.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2" aria-label="Compliments">
                  {COMPLIMENTS.map((c) => (
                    <Button key={c} type="button" size="sm" variant={tags.includes(c) ? "default" : "outline"} className="h-7 text-xs"
                      aria-pressed={tags.includes(c)}
                      onClick={() => setTags((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]))}>
                      {c}
                    </Button>
                  ))}
                </div>
                <Input
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="Anything we should know? (optional)"
                />
                <Button size="sm" onClick={submitRating} disabled={rating < 1 || savingRating} aria-busy={savingRating}>
                  {savingRating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Submit rating
                </Button>
              </>
            )}
          </Card>
        )}


        {booking.status === "completed" && (
          <Card className="p-4 text-sm space-y-2 print:shadow-none" data-testid="trip-receipt">
            <div className="flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /> Receipt</div>
              <Button size="sm" variant="outline" onClick={() => window.print()}>Print / save PDF</Button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-muted-foreground">Trip</span><span>{booking.booking_number}</span>
              <span className="text-muted-foreground">Driver</span><span>{driver?.name ?? "—"}</span>
              <span className="text-muted-foreground">Paid with</span><span className="capitalize">{booking.payment_method}</span>
              <span className="text-muted-foreground font-medium">Total</span><span className="font-semibold">KES {Number(booking.total_fare ?? 0).toLocaleString()}</span>
            </div>
          </Card>
        )}

        {booking.status === "completed" && booking.driver_id && (
          <Card className="p-4 space-y-2 text-sm" data-testid="tip-card">
            <div className="font-semibold">Tip your driver</div>
            {tip != null ? (
              <p className="text-muted-foreground">You tipped KES {tip.toLocaleString()}. Thank you!</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {[50, 100, 200, 500].map((a) => (
                    <Button key={a} size="sm" variant={tipAmount === a ? "default" : "outline"} onClick={() => setTipAmount(a)}>KES {a}</Button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <Input aria-label="M-Pesa phone" inputMode="tel" placeholder="M-Pesa phone, e.g. 0712345678" value={tipPhone} onChange={(e) => setTipPhone(e.target.value)} className="max-w-[220px]" />
                  <Button size="sm" onClick={() => void sendTip(true)} disabled={tipping || !tipPhone.trim()} aria-busy={tipping}>
                    {tipping && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Tip KES {tipAmount} with M-Pesa
                  </Button>
                </div>
                {tipProgress && <p className="text-xs text-primary" role="status">{tipProgress}</p>}
                <Button size="sm" variant="ghost" className="px-0" disabled={tipping} onClick={() => void sendTip(false)}>
                  Or pay from my TaxiD wallet balance
                </Button>
              </>
            )}
          </Card>
        )}

        <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this trip?</AlertDialogTitle>
              <AlertDialogDescription>Tell us why, so we can improve matching.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2" role="radiogroup" aria-label="Cancellation reason">
              {CANCEL_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="cancel-reason" checked={cancelReason === r} onChange={() => setCancelReason(r)} className="accent-primary" />
                  {r}
                </label>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep trip</AlertDialogCancel>
              <AlertDialogAction onClick={cancelTrip} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Cancel trip</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {sos && (
          <Card
            data-testid="sos-confirmation"
            role="status"
            aria-live="polite"
            className="p-4 border-destructive/40 bg-destructive/5 space-y-2"
          >
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" /> SOS confirmation
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Primary contact:</span>{" "}
              <span data-testid="sos-contact-name">{sos.contactName ?? "No emergency contact on file"}</span>
              {sos.contactPhone && (
                <>
                  {" · "}
                  <span data-testid="sos-contact-phone">{sos.contactPhone}</span>
                </>
              )}
              {sos.contactRelationship && (
                <span className="text-muted-foreground"> ({sos.contactRelationship})</span>
              )}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Estimated response ETA:</span>{" "}
              <span data-testid="sos-eta">~{sos.etaMinutes} min</span>
            </div>
            <div className="text-xs text-muted-foreground">
              TaxiD safety operators have been alerted with your location. Use “Share trip” to send your
              emergency contact a live link, or call them directly.
            </div>
          </Card>
        )}

        {shareUrl && (
          <Card className="p-3 flex items-center gap-2">
            <Input value={shareUrl} readOnly className="font-mono text-xs" />
            <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(shareUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </Card>
        )}

        <Link to="/rider/trips" className="text-sm text-primary underline">← Back to trips</Link>
      </div>
    </RiderShell>
  );
}

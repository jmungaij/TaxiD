import { MeetingPointPicker, type PickupPoint } from "@/components/rider/MeetingPointPicker";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { MapBooking } from "@/components/rider/MapBooking";
import { RiderErrorBoundary } from "@/components/rider/RiderErrorBoundary";
import type { BookingPoint } from "@/components/rider/bookingTypes";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { loadGoogleMaps } from "@/lib/googleMaps";

interface RideType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  capacity: number;
  base_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  minimum_fare: number;
  icon: string;
}

export default function RiderBookPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pickup, setPickup] = useState<BookingPoint | null>(null);
  const [meetingPoint, setMeetingPoint] = useState<PickupPoint | null>(null);
  const [dropoff, setDropoff] = useState<BookingPoint | null>(null);
  const [estimate, setEstimate] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [rideTypes, setRideTypes] = useState<RideType[]>([]);
  const [selectedRide, setSelectedRide] = useState<string | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  function loadRideTypes() {
    setLoadError(false);
    supabase
      .from("ride_types")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) {
          setLoadError(true);
          return;
        }
        if (data) {
          setRideTypes(data as RideType[]);
          if (data[1]) setSelectedRide(data[1].id);
        }
      });
  }

  useEffect(() => {
    loadRideTypes();
  }, []);

  useEffect(() => {
    const pickupAddress = searchParams.get("pickup")?.trim();
    const dropoffAddress = searchParams.get("destination")?.trim();
    if (!pickupAddress && !dropoffAddress) return;
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      const geocoder = new google.maps.Geocoder();
      const resolve = (address: string, setter: (point: BookingPoint) => void) => {
        geocoder.geocode({ address }, (results, status) => {
          const result = results?.[0];
          if (cancelled || status !== "OK" || !result) return;
          setter({ address: result.formatted_address || address, lat: result.geometry.location.lat(), lng: result.geometry.location.lng() });
        });
      };
      if (pickupAddress && !pickup) resolve(pickupAddress, setPickup);
      if (dropoffAddress && !dropoff) resolve(dropoffAddress, setDropoff);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [searchParams]);

  function fareFor(rt: RideType): number {
    if (!estimate) return rt.minimum_fare;
    const total = rt.base_fare + estimate.distanceKm * rt.per_km_rate + estimate.durationMin * rt.per_minute_rate;
    return Math.max(rt.minimum_fare, Math.round(total));
  }

  async function bookNow() {
    if (!user || !pickup || !dropoff || !selectedRide || !estimate) {
      toast.error("Please pick pickup, drop-off and a ride type");
      return;
    }
    setSubmitting(true);
    try {
      const { data: req, error: e1 } = await supabase
        .from("trip_requests")
        .insert({
          rider_user_id: user.id,
          pickup_address: pickup.address,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          dropoff_address: dropoff.address,
          dropoff_lat: dropoff.lat,
          dropoff_lng: dropoff.lng,
          ride_type_id: selectedRide,
          passenger_count: passengers,
          estimated_distance_km: estimate.distanceKm,
          estimated_duration_min: estimate.durationMin,
          status: "quoting",
        })
        .select("id")
        .single();
      if (e1 || !req) throw e1 ?? new Error("Could not create request");

      const { data: quote, error: e2 } = await supabase.rpc("trip_quote_fare", {
        _request_id: req.id,
        _distance_km: estimate.distanceKm,
        _duration_min: estimate.durationMin,
      });
      if (e2 || !quote?.[0]) throw e2 ?? new Error("Could not quote fare");

      const { data: bookingId, error: e3 } = await supabase.rpc("trip_confirm_booking", {
        _quote_id: quote[0].quote_id,
        _payment_method: "wallet",
        _scheduled_for: searchParams.get("when"),
      });
      if (e3 || !bookingId) throw e3 ?? new Error("Could not confirm booking");

      if (meetingPoint) {
        const { error: eMp } = await supabase.rpc("trip_set_meeting_point", { _booking_id: bookingId as string, _point_id: meetingPoint.id });
        if (eMp) console.warn("meeting point not saved", eMp);
      }

      // Dispatch: actually match a driver. Without this the booking stays
      // 'pending' forever and the trip screen shows "Searching…" indefinitely.
      let assigned = false;
      const { data: dispatch, error: eAssign } = await supabase.rpc("trip_assign_driver", {
        _booking_id: bookingId as string,
      });
      if (eAssign) {
        console.warn("dispatch failed", eAssign);
      } else {
        assigned = Boolean((dispatch as any)?.assigned);
      }


      // Fire-and-forget booking confirmation email (won't block navigation)
      const rideName = rideTypes.find((r) => r.id === selectedRide)?.name;
      supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "booking-confirmation",
          recipientEmail: user.email,
          idempotencyKey: `booking-confirm-${bookingId}`,
          templateData: {
            riderName: user.user_metadata?.full_name ?? user.email?.split("@")[0],
            bookingId: String(bookingId),
            pickupAddress: pickup.address,
            dropoffAddress: dropoff.address,
            pickupTime: "Shortly",
            vehicleClass: rideName ?? "Standard",
            fareEstimate: String(quote[0].total ?? ""),
            currency: "KES",
            tripUrl: `${window.location.origin}/rider/trips/${bookingId}`,
            siteName: "TaxiD Africa",
          },
        },
      }).catch((e) => console.warn("booking email enqueue failed", e));

      toast.success(
        assigned ? "Driver assigned — track them on your trip screen" : "Booking confirmed. Looking for a nearby driver…"
      );
      navigate(`/rider/trips/${bookingId}`);


    } catch (err) {
      toast.error(err.message ?? "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RiderShell>
      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Where to?</h1>
          <p className="text-muted-foreground text-sm mb-4">Tap the map to set pickup, then your destination.</p>
          <RiderErrorBoundary sectionName="Booking map">
            <MapBooking
              pickup={pickup}
              dropoff={dropoff}
              onPickupChange={setPickup}
              onDropoffChange={setDropoff}
              onEstimate={setEstimate}
            />
          </RiderErrorBoundary>
        </div>

        <aside className="space-y-3">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Choose a ride</h3>
            {loadError && (
              <div className="mb-3">
                <ErrorState
                  message="We couldn't load available ride types. Please try again."
                  onRetry={loadRideTypes}
                  testId="rider-book-error"
                />
              </div>
            )}
            {!estimate && (
              <p className="text-xs text-muted-foreground mb-3">Set pickup and drop-off to see fares.</p>
            )}
            <div className="space-y-2">
              {rideTypes.map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => setSelectedRide(rt.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedRide === rt.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {rt.name}
                        <Badge variant="secondary" className="text-[10px]">
                          <Users className="h-3 w-3 mr-1" />
                          {rt.capacity}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{rt.description}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">KES {fareFor(rt).toLocaleString()}</div>
                      {estimate && (
                        <div className="text-[10px] text-muted-foreground">
                          {estimate.distanceKm} km · {estimate.durationMin} min
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {pickup && (
            <Card className="p-4">
              <MeetingPointPicker
                pickup={{ lat: pickup.lat, lng: pickup.lng }}
                selectedId={meetingPoint?.id ?? null}
                editable
                onChange={setMeetingPoint}
              />
            </Card>
          )}

          <Card className="p-4">
            <label className="text-xs font-medium">Passengers</label>
            <div className="flex items-center gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={() => setPassengers(Math.max(1, passengers - 1))}>
                −
              </Button>
              <span className="font-semibold w-8 text-center">{passengers}</span>
              <Button size="sm" variant="outline" onClick={() => setPassengers(passengers + 1)}>
                +
              </Button>
            </div>
          </Card>

          <Button className="w-full" size="lg" onClick={bookNow} disabled={submitting || !pickup || !dropoff || !selectedRide}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm booking
          </Button>
        </aside>
      </div>
    </RiderShell>
  );
}

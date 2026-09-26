/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, haversineKm } from "@/lib/googleMaps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MapPin, Navigation, Loader2, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { AddressSearchInput } from "./AddressSearchInput";
import type { BookingPoint } from "./bookingTypes";


export type { BookingPoint } from "./bookingTypes";

interface Props {
  pickup: BookingPoint | null;
  dropoff: BookingPoint | null;
  onPickupChange: (p: BookingPoint | null) => void;
  onDropoffChange: (p: BookingPoint | null) => void;
  onEstimate: (estimate: { distanceKm: number; durationMin: number }) => void;
}

type ActivePin = "pickup" | "dropoff";

export function MapBooking({ pickup, dropoff, onPickupChange, onDropoffChange, onEstimate }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const [active, setActive] = useState<ActivePin>("pickup");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Init map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: -1.286389, lng: 36.817223 }, // Nairobi
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        geocoderRef.current = new g.maps.Geocoder();
        mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
          handlePinDrop({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute estimate when both pins set
  useEffect(() => {
    if (pickup && dropoff) {
      const km = haversineKm(pickup, dropoff);
      // rough estimate: 35 km/h average urban
      const min = Math.max(5, Math.round((km / 35) * 60));
      onEstimate({ distanceKm: +km.toFixed(2), durationMin: min });
      drawLine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // Update markers when points change
  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    const g = window.google;
    if (pickup) {
      if (!pickupMarkerRef.current) {
        pickupMarkerRef.current = new g.maps.Marker({
          map: mapRef.current,
          position: pickup,
          label: { text: "A", color: "white", fontWeight: "bold" },
          draggable: true,
        });
        pickupMarkerRef.current.addListener("dragend", (e: google.maps.MapMouseEvent) => {
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          reverseGeocode(p).then((addr) => onPickupChange({ ...p, address: addr }));
        });
      } else {
        pickupMarkerRef.current.setPosition(pickup);
      }
    } else if (pickupMarkerRef.current) {
      pickupMarkerRef.current.setMap(null);
      pickupMarkerRef.current = null;
    }
    if (dropoff) {
      if (!dropoffMarkerRef.current) {
        dropoffMarkerRef.current = new g.maps.Marker({
          map: mapRef.current,
          position: dropoff,
          label: { text: "B", color: "white", fontWeight: "bold" },
          draggable: true,
        });
        dropoffMarkerRef.current.addListener("dragend", (e: google.maps.MapMouseEvent) => {
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          reverseGeocode(p).then((addr) => onDropoffChange({ ...p, address: addr }));
        });
      } else {
        dropoffMarkerRef.current.setPosition(dropoff);
      }
    } else if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.setMap(null);
      dropoffMarkerRef.current = null;
    }
  }, [pickup, dropoff, onPickupChange, onDropoffChange]);

  function drawLine() {
    if (!mapRef.current || !pickup || !dropoff) return;
    const g = window.google;
    if (lineRef.current) lineRef.current.setMap(null);
    lineRef.current = new g.maps.Polyline({
      path: [pickup, dropoff],
      strokeColor: "hsl(217 91% 60%)",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map: mapRef.current,
    });
    const bounds = new g.maps.LatLngBounds();
    bounds.extend(pickup);
    bounds.extend(dropoff);
    mapRef.current.fitBounds(bounds, 80);
  }

  async function reverseGeocode(p: { lat: number; lng: number }): Promise<string> {
    if (!geocoderRef.current) return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    return new Promise((resolve) => {
      geocoderRef.current.geocode({ location: p }, (results: google.maps.GeocoderResult[] | null, status: google.maps.GeocoderStatus) => {
        if (status === "OK" && results?.[0]) resolve(results[0].formatted_address);
        else resolve(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
      });
    });
  }

  async function handlePinDrop(p: { lat: number; lng: number }) {
    const address = await reverseGeocode(p);
    const point = { ...p, address };
    if (active === "pickup") {
      onPickupChange(point);
      setActive("dropoff");
    } else {
      onDropoffChange(point);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation not available");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const address = await reverseGeocode(p);
        onPickupChange({ ...p, address });
        mapRef.current?.panTo(p);
        mapRef.current?.setZoom(15);
      },
      () => toast.error("Could not get your location")
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Card className="p-3 text-xs text-destructive" role="alert">
          Map unavailable: {error}. You can still search and type addresses below.
        </Card>
      )}
      <div className="space-y-2">

        <AddressSearchInput
          label="Pickup address"
          badge="A"
          testId="rider-book-pickup"
          placeholder="Search pickup — place, street or landmark"
          value={pickup}
          active={active === "pickup"}
          onFocusField={() => setActive("pickup")}
          bias={pickup ?? undefined}
          onResolve={(p) => {
            onPickupChange(p);
            if (p) {
              mapRef.current?.panTo(p);
              mapRef.current?.setZoom(15);
              setActive("dropoff");
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label="Swap pickup and drop-off"
            disabled={!pickup || !dropoff}
            onClick={() => {
              const a = pickup;
              onPickupChange(dropoff);
              onDropoffChange(a);
            }}
          >
            <ArrowUpDown className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Swap
          </Button>
        </div>
        <AddressSearchInput
          label="Drop-off address"
          badge="B"
          testId="rider-book-dropoff"
          placeholder="Search destination — place, street or landmark"
          value={dropoff}
          active={active === "dropoff"}
          onFocusField={() => setActive("dropoff")}
          bias={pickup ?? undefined}
          onResolve={(p) => {
            onDropoffChange(p);
            if (p) {
              mapRef.current?.panTo(p);
              mapRef.current?.setZoom(14);
            }
          }}
        />
      </div>

      <Button variant="outline" size="sm" onClick={useCurrentLocation} className="w-full">
        <Navigation className="h-4 w-4 mr-2" /> Use current location
      </Button>

      <div className="relative rounded-lg overflow-hidden border h-[420px]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        <div ref={mapEl} className="w-full h-full" />
        {!loading && !pickup && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-card border shadow rounded-full px-3 py-1 text-xs flex items-center gap-1 pointer-events-none">
            <MapPin className="h-3 w-3" /> Tap the map to drop your pickup pin
          </div>
        )}
      </div>
    </div>
  );
}

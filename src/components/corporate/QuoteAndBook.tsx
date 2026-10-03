/**
 * Quote & Book: prices a trip from the rate card on the server (taxid_quote,
 * including airport distance pricing with zone floors) and confirms it through
 * the TravelDesk booking routine, which re-prices server-side, holds company
 * funds and writes the trip ledger. The browser never decides the fare.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Pt = { address: string; lat: string; lng: string };
const empty: Pt = { address: "", lat: "", lng: "" };
const PRESETS: { id: string; name: string; lat: number; lng: number }[] = [
  { id: "jkia", name: "JKIA (Jomo Kenyatta Airport)", lat: -1.3192, lng: 36.9278 },
  { id: "wilson", name: "Wilson Airport", lat: -1.3217, lng: 36.8148 },
];
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const BASIS: Record<string, string> = {
  metered: "Distance and time",
  airport_distance: "Airport trip charged by distance and time",
  airport_zone_floor: "Airport zone minimum applied",
};
const ERR: Record<string, string> = {
  COMPANY_FUNDS_INSUFFICIENT: "The company wallet and credit don't cover this fare. Top up on the Funding page.",
  FLIGHT_NUMBER_REQUIRED: "Airport transfers need a flight number.",
  PASSENGER_NAME_REQUIRED: "Enter the passenger's name.",
  NOT_AUTHORISED: "Only company admins and managers can book here.",
  BOOKING_CODES_REQUIRED: "Your company requires booking codes on every trip.",
  BUDGET_EXCEEDED: "This trip would go over the budget.",
  LOCATIONS_REQUIRED: "Choose both pickup and drop-off.",
  DAY_RATE_VEHICLE: "This vehicle is booked by day rate, not per trip.",
};

interface Quote {
  ok: boolean; error?: string; ride_type: string; distance_km: number; duration_min: number; base_kes: number;
  distance_kes: number; time_kes: number; minimum_kes: number; metered_kes: number; airport: string | null;
  zone: string | null; zone_floor_kes: number | null; pickup_premium_kes: number; basis: string; fare_kes: number;
}

export default function QuoteAndBook({ corporateId }: { corporateId: string }) {
  const [types, setTypes] = React.useState<{ id: string; name: string }[]>([]);
  const [places, setPlaces] = React.useState<{ id: string; name: string; address?: string; lat: number; lng: number }[]>([]);
  const [rt, setRt] = React.useState("");
  const [from, setFrom] = React.useState<Pt>(empty);
  const [to, setTo] = React.useState<Pt>(empty);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [flight, setFlight] = React.useState("");
  const [when, setWhen] = React.useState("");
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [booked, setBooked] = React.useState<string | null>(null);

  React.useEffect(() => {
    db.from("ride_types").select("id,name,pricing_model,sort_order").eq("is_active", true).neq("pricing_model", "daily_charter").order("sort_order")
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setTypes(data ?? []));
    db.from("corporate_locations").select("id,name,address,lat,lng").eq("corporate_id", corporateId).eq("active", true).order("name")
      .then(({ data }: { data: typeof places | null }) => setPlaces(data ?? []));
  }, [corporateId]);

  const all = [...PRESETS, ...places];
  const coords = (p: Pt) => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) });

  const getQuote = async () => {
    setBooked(null);
    const a = coords(from), b = coords(to);
    if (!rt || [a.lat, a.lng, b.lat, b.lng].some(Number.isNaN)) return toast({ title: "Choose a vehicle, pickup and drop-off", variant: "destructive" });
    setBusy(true);
    const { data, error } = await db.rpc("taxid_quote", { _ride_type: rt, _plat: a.lat, _plng: a.lng, _dlat: b.lat, _dlng: b.lng });
    setBusy(false);
    if (error || !data?.ok) { setQuote(null); return toast({ title: "No price", description: ERR[data?.error] ?? error?.message ?? data?.error, variant: "destructive" }); }
    setQuote(data as Quote);
  };

  const confirm = async () => {
    if (!quote) return;
    const a = coords(from), b = coords(to);
    setBusy(true);
    const { data, error } = await db.rpc("corporate_guest_book", {
      _corporate_id: corporateId, _kind: quote.airport ? "airport_transfer" : "guest",
      _passenger_name: name, _passenger_phone: phone || null,
      _pickup_address: from.address || "Pickup", _plat: a.lat, _plng: a.lng,
      _dropoff_address: to.address || "Drop-off", _dlat: b.lat, _dlng: b.lng,
      _ride_type_id: rt, _scheduled_for: when ? new Date(when).toISOString() : null,
      _details: { flight_number: flight || undefined, quoted_fare_kes: quote.fare_kes },
    });
    setBusy(false);
    if (error || !data?.ok) return toast({ title: "Not booked", description: ERR[data?.error] ?? data?.message ?? error?.message ?? data?.error, variant: "destructive" });
    setBooked(data.reference ?? "Booked");
    toast({ title: "Booking confirmed", description: "Funds are held and the trip is in the ledger. It goes to drivers now." });
  };

  const PointPicker = ({ label, value, onChange }: { label: string; value: Pt; onChange: (p: Pt) => void }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select onValueChange={(id) => { const p = all.find((x) => x.id === id); if (p) { onChange({ address: ("address" in p && p.address) || p.name, lat: String(p.lat), lng: String(p.lng) }); setQuote(null); } }}>
        <SelectTrigger><SelectValue placeholder="Choose an airport or saved place" /></SelectTrigger>
        <SelectContent>{all.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
      </Select>
      <Input placeholder="Address" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Latitude" value={value.lat} onChange={(e) => { onChange({ ...value, lat: e.target.value }); setQuote(null); }} />
        <Input placeholder="Longitude" value={value.lng} onChange={(e) => { onChange({ ...value, lng: e.target.value }); setQuote(null); }} />
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Get a price</CardTitle><CardDescription>Priced from the TaxiD rate card. Airport trips are charged by distance, never below the zone price.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Vehicle</Label>
            <Select value={rt} onValueChange={(v) => { setRt(v); setQuote(null); }}>
              <SelectTrigger><SelectValue placeholder="Choose a vehicle" /></SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {PointPicker({ label: "Pickup", value: from, onChange: setFrom })}
          {PointPicker({ label: "Drop-off", value: to, onChange: setTo })}
          <Button onClick={getQuote} disabled={busy}>Calculate price</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Price and booking</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!quote ? <p className="text-sm text-muted-foreground">Calculate a price to see the breakdown.</p> : (
            <>
              <div className="flex items-baseline justify-between"><span className="text-3xl font-semibold">{kes(quote.fare_kes)}</span><Badge variant="secondary">{BASIS[quote.basis] ?? quote.basis}</Badge></div>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Vehicle</dt><dd>{quote.ride_type}</dd>
                <dt className="text-muted-foreground">Distance / time</dt><dd>{quote.distance_km} km · ~{quote.duration_min} min</dd>
                <dt className="text-muted-foreground">Starting fare</dt><dd>{kes(quote.base_kes)}</dd>
                <dt className="text-muted-foreground">Distance charge</dt><dd>{kes(quote.distance_kes)}</dd>
                <dt className="text-muted-foreground">Time charge</dt><dd>{kes(quote.time_kes)}</dd>
                <dt className="text-muted-foreground">Minimum fare</dt><dd>{kes(quote.minimum_kes)}</dd>
                {quote.airport && <><dt className="text-muted-foreground">Airport</dt><dd>{quote.airport}{quote.zone ? ` · ${quote.zone}` : ""}</dd></>}
                {quote.pickup_premium_kes > 0 && <><dt className="text-muted-foreground">Airport pickup</dt><dd>{kes(quote.pickup_premium_kes)}</dd></>}
                {quote.zone_floor_kes != null && <><dt className="text-muted-foreground">Zone minimum</dt><dd>{kes(quote.zone_floor_kes)}</dd></>}
              </dl>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Passenger name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>Passenger phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                {quote.airport && <div><Label>Flight number</Label><Input value={flight} onChange={(e) => setFlight(e.target.value)} /></div>}
                <div><Label>Pickup time (optional)</Label><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
              </div>
              <Button onClick={confirm} disabled={busy || !name}>Confirm booking</Button>
              {booked && <p className="text-sm">Confirmed: <b>{booked}</b>. The final fare is re-checked by the server and shown on TravelDesk.</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

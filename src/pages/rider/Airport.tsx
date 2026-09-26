import { useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plane } from "lucide-react";
import { toast } from "sonner";

interface AB {
  id: string;
  direction: string;
  airport_code: string;
  terminal: string | null;
  flight_number: string | null;
  flight_time: string | null;
  passenger_count: number;
  luggage_count: number;
  meet_and_greet: boolean;
  vip: boolean;
}

export default function RiderAirportPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<AB[]>([]);
  const [direction, setDirection] = useState("arrival");
  const [code, setCode] = useState("NBO");
  const [terminal, setTerminal] = useState("");
  const [flight, setFlight] = useState("");
  const [when, setWhen] = useState("");
  const [pax, setPax] = useState(1);
  const [lug, setLug] = useState(0);
  const [mg, setMg] = useState(false);
  const [vip, setVip] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user]);

  async function refresh() {
    if (!user) return;
    setLoadError(false);
    const { data, error } = await supabase
      .from("airport_bookings")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(true);
      return;
    }
    setItems((data as AB[]) ?? []);
  }

  async function create() {
    if (!user) return;
    const { error } = await supabase.from("airport_bookings").insert({
      user_id: user.id,
      direction,
      airport_code: code,
      terminal: terminal || null,
      flight_number: flight || null,
      flight_time: when ? new Date(when).toISOString() : null,
      passenger_count: pax,
      luggage_count: lug,
      meet_and_greet: mg,
      vip,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Airport ride booked");
      refresh();
    }
  }

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Plane className="h-6 w-6" /> Airport transfers
      </h1>

      {loadError && (
        <div className="mb-4">
          <ErrorState
            message="We couldn't load your airport bookings. Please try again."
            onRetry={refresh}
            testId="rider-airport-error"
          />
        </div>
      )}

      <Card className="p-4 mb-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Direction</Label>
            <select
              className="w-full h-10 border rounded-md px-3 bg-background"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="arrival">Arrival (pickup at airport)</option>
              <option value="departure">Departure (drop at airport)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Airport code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} />
          </div>
          <div>
            <Label className="text-xs">Terminal</Label>
            <Input value={terminal} onChange={(e) => setTerminal(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Flight number</Label>
            <Input value={flight} onChange={(e) => setFlight(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label className="text-xs">Flight time</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Passengers</Label>
              <Input type="number" min={1} value={pax} onChange={(e) => setPax(+e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Luggage</Label>
              <Input type="number" min={0} value={lug} onChange={(e) => setLug(+e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={mg} onCheckedChange={setMg} /> Meet & greet
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={vip} onCheckedChange={setVip} /> VIP chauffeur
          </label>
        </div>
        <Button onClick={create}>Book airport ride</Button>
      </Card>

      <div className="space-y-2">
        {items.map((a) => (
          <Card key={a.id} className="p-3">
            <div className="text-sm font-medium">
              {a.direction === "arrival" ? "Arrive at" : "Depart from"} {a.airport_code}
              {a.terminal ? ` · T${a.terminal}` : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {a.flight_number ? `Flight ${a.flight_number}` : ""}{" "}
              {a.flight_time ? `· ${new Date(a.flight_time).toLocaleString()}` : ""}
              {a.meet_and_greet ? " · Meet & greet" : ""}
              {a.vip ? " · VIP" : ""}
            </div>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No airport bookings yet.</p>}
      </div>
    </RiderShell>
  );
}

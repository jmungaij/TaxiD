import { useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Sched {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_for: string;
  recurrence: string;
  status: string;
}

export default function RiderSchedulePage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Sched[]>([]);
  const [pa, setPa] = useState("");
  const [da, setDa] = useState("");
  const [pl, setPl] = useState("");
  const [pn, setPn] = useState("");
  const [dl, setDl] = useState("");
  const [dn, setDn] = useState("");
  const [when, setWhen] = useState("");
  const [rec, setRec] = useState("none");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user]);

  async function refresh() {
    if (!user) return;
    setLoadError(false);
    const { data, error } = await supabase
      .from("scheduled_trips")
      .select("*")
      .eq("user_id", user.id)
      .order("scheduled_for");
    if (error) {
      setLoadError(true);
      return;
    }
    setItems((data as Sched[]) ?? []);
  }

  async function create() {
    if (!user || !pa || !da || !pl || !pn || !dl || !dn || !when) {
      toast.error("Fill all fields");
      return;
    }
    const { error } = await supabase.from("scheduled_trips").insert({
      user_id: user.id,
      pickup_address: pa,
      pickup_lat: parseFloat(pl),
      pickup_lng: parseFloat(pn),
      dropoff_address: da,
      dropoff_lat: parseFloat(dl),
      dropoff_lng: parseFloat(dn),
      scheduled_for: new Date(when).toISOString(),
      recurrence: rec,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Scheduled");
      setPa("");
      setDa("");
      setPl("");
      setPn("");
      setDl("");
      setDn("");
      setWhen("");
      refresh();
    }
  }

  async function remove(id: string) {
    await supabase.from("scheduled_trips").delete().eq("id", id);
    refresh();
  }

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Calendar className="h-6 w-6" /> Scheduled trips
      </h1>

      {loadError && (
        <div className="mb-4">
          <ErrorState
            message="We couldn't load your scheduled trips. Please try again."
            onRetry={refresh}
            testId="rider-schedule-error"
          />
        </div>
      )}

      <Card className="p-4 mb-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Pickup address</Label>
            <Input value={pa} onChange={(e) => setPa(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Drop-off address</Label>
            <Input value={da} onChange={(e) => setDa(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Pickup lat" value={pl} onChange={(e) => setPl(e.target.value)} />
            <Input placeholder="Pickup lng" value={pn} onChange={(e) => setPn(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Drop lat" value={dl} onChange={(e) => setDl(e.target.value)} />
            <Input placeholder="Drop lng" value={dn} onChange={(e) => setDn(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">When</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Recurrence</Label>
            <select
              className="w-full h-10 border rounded-md px-3 bg-background"
              value={rec}
              onChange={(e) => setRec(e.target.value)}
            >
              <option value="none">One-off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <Button onClick={create}>Schedule trip</Button>
      </Card>

      <div className="space-y-2">
        {items.map((s) => (
          <Card key={s.id} className="p-3 flex items-center gap-3">
            <Calendar className="h-4 w-4 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                {s.pickup_address} → {s.dropoff_address}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(s.scheduled_for).toLocaleString()} · {s.recurrence}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No scheduled trips.</p>}
      </div>
    </RiderShell>
  );
}

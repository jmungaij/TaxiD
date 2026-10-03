import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Siren } from "lucide-react";

interface LiveTrip {
  id: string; booking_number: string; status: string; traveller: string | null; driver_name: string | null; plate_number: string | null;
  vehicle: string | null; pickup_address: string | null; dropoff_address: string | null; pickup_eta: string | null;
  minutes_late: number | null; open_incidents: number; risk: "low" | "medium" | "high";
}

/** Live company travellers with driver/vehicle/ETA/route and a server-computed risk level. */
export function DutyOfCarePanel({ corporateId }: { corporateId: string }) {
  const [trips, setTrips] = useState<LiveTrip[] | null>(null);
  const [denied, setDenied] = useState(false);
  const load = () => supabase.rpc("corporate_duty_of_care", { _corp: corporateId }).then(({ data }) => {
    const d = data as { ok: boolean; trips?: LiveTrip[] } | null;
    if (!d?.ok) { setDenied(true); setTrips([]); } else setTrips(d.trips ?? []);
  });
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [corporateId]);

  if (denied) return <Card className="p-4 text-sm">Only company admins and managers can see live travellers.</Card>;
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Live travellers</h3>
        <span className="text-xs text-muted-foreground">Refreshes every 30 seconds</span>
      </div>
      {trips === null ? <p className="text-sm text-muted-foreground">Loading…</p> : !trips.length ? (
        <p className="text-sm text-muted-foreground">No company trips are in progress.</p>
      ) : trips.map((t) => (
        <div key={t.id} className="border-t pt-2 text-sm grid md:grid-cols-[1fr_auto] gap-2">
          <div>
            <div className="font-medium">{t.traveller ?? "Guest"} · <span className="font-mono">{t.booking_number}</span> · {t.status.replace(/_/g, " ")}</div>
            <div className="text-muted-foreground">{t.pickup_address} → {t.dropoff_address}</div>
            <div className="text-muted-foreground">
              {t.driver_name ? `${t.driver_name} · ${t.vehicle ?? ""} ${t.plate_number ?? ""}` : "Waiting for a driver to accept"}
              {t.pickup_eta ? ` · ETA ${new Date(t.pickup_eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              {t.minutes_late ? ` · ${t.minutes_late} min late` : ""}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant={t.risk === "high" ? "destructive" : t.risk === "medium" ? "secondary" : "outline"}>{t.risk} risk</Badge>
            {t.open_incidents > 0 && (
              <Button size="sm" variant="destructive" className="gap-1" asChild>
                <a href="tel:999"><Siren className="h-3 w-3" /> Escalate</a>
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

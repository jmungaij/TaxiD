import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type Point = { id: string; place_name: string; point_name: string; landmark: string | null; lat: number; lng: number; radius_m: number; is_active: boolean };
const empty = { place_name: "", point_name: "", landmark: "", lat: "", lng: "", radius_m: "400" };

/** Admin list of approved pickup entrances/gates for busy places (malls, airports). */
export default function PickupPointsPage() {
  const [rows, setRows] = useState<Point[]>([]);
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from("pickup_points").select("*").order("place_name").then(({ data, error }) => {
    if (error) toast.error("Could not load meeting points");
    setRows((data ?? []) as Point[]);
  });
  useEffect(() => { void load(); }, []);

  async function add() {
    const lat = Number(f.lat), lng = Number(f.lng), radius = Number(f.radius_m);
    if (!f.place_name.trim() || !f.point_name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return toast.error("Enter the place, the entrance name and a valid latitude and longitude.");
    setBusy(true);
    const { error } = await supabase.from("pickup_points").insert({
      place_name: f.place_name.trim(), point_name: f.point_name.trim(), landmark: f.landmark.trim() || null,
      lat, lng, radius_m: Math.min(3000, Math.max(50, radius || 400)),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setF(empty); toast.success("Meeting point added"); void load();
  }

  async function toggle(p: Point) {
    const { error } = await supabase.from("pickup_points").update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return toast.error(error.message);
    void load();
  }

  const field = (k: keyof typeof empty, label: string, ph?: string) => (
    <Input aria-label={label} placeholder={ph ?? label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Pickup meeting points</h1>
        <p className="text-sm text-muted-foreground">Approved entrances and gates riders can choose at busy places. Riders see the points within each point's range of their pickup.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Add a meeting point</CardTitle><CardDescription>Copy latitude and longitude from Google Maps (right-click the exact entrance).</CardDescription></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {field("place_name", "Place", "Place, e.g. Westgate Mall")}
          {field("point_name", "Entrance", "Entrance, e.g. Main entrance")}
          {field("landmark", "Landmark", "Landmark (optional)")}
          {field("lat", "Latitude")}
          {field("lng", "Longitude")}
          {field("radius_m", "Range in metres")}
          <Button className="sm:col-span-3" onClick={add} disabled={busy}>Add meeting point</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Meeting points ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No meeting points yet.</p>}
          {rows.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border-t pt-2 text-sm">
              <div><div className="font-medium">{p.place_name} — {p.point_name}</div>
                <div className="text-xs text-muted-foreground">{p.landmark ? `${p.landmark} · ` : ""}{Number(p.lat).toFixed(5)}, {Number(p.lng).toFixed(5)} · {p.radius_m} m</div></div>
              <Switch checked={p.is_active} onCheckedChange={() => void toggle(p)} aria-label={`Active: ${p.point_name}`} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

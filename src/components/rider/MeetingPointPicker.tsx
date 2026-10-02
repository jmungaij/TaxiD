import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPinned } from "lucide-react";
import { toast } from "sonner";
import { haversineM } from "./TripProgress";

export type PickupPoint = { id: string; place_name: string; point_name: string; landmark: string | null; lat: number; lng: number; radius_m: number };

/** Approved entrances/gates near the rider's pickup; rider picks one, driver sees it. */
export function MeetingPointPicker({ bookingId, pickup, selectedId, editable, onChange }: {
  bookingId?: string; pickup: { lat: number; lng: number }; selectedId: string | null; editable: boolean;
  onChange: (p: PickupPoint | null) => void;
}) {
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = 0.03; // ~3 km bounding box, refined by each point's radius
    supabase.from("pickup_points").select("id,place_name,point_name,landmark,lat,lng,radius_m").eq("is_active", true)
      .gte("lat", pickup.lat - d).lte("lat", pickup.lat + d).gte("lng", pickup.lng - d).lte("lng", pickup.lng + d)
      .then(({ data }) => {
        const near = ((data ?? []) as PickupPoint[])
          .map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }))
          .filter((p) => haversineM(pickup, p) <= p.radius_m);
        setPoints(near);
        const sel = near.find((p) => p.id === selectedId);
        if (sel) onChange(sel);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, selectedId]);

  if (points.length === 0) return null;

  async function choose(p: PickupPoint) {
    if (!bookingId) { onChange(p.id === selectedId ? null : p); return; }
    setSaving(true);
    const { error } = await supabase.rpc("trip_set_meeting_point", { _booking_id: bookingId, _point_id: p.id });
    setSaving(false);
    if (error) return toast.error("Could not set the meeting point");
    onChange(p);
    toast.success(`Meeting point set: ${p.point_name}`);
  }

  const selected = points.find((p) => p.id === selectedId);
  return (
    <div className="space-y-2 text-sm" data-testid="meeting-points">
      <div className="font-semibold flex items-center gap-2"><MapPinned className="h-4 w-4 text-primary" /> Recommended meeting point</div>
      {selected && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="font-medium">{selected.place_name} — {selected.point_name}</div>
          {selected.landmark && <div className="text-xs text-muted-foreground">{selected.landmark}</div>}
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap gap-1.5">
          {points.map((p) => (
            <Button key={p.id} size="sm" variant={p.id === selectedId ? "default" : "outline"} className="h-7 text-xs" disabled={saving} onClick={() => void choose(p)}>
              {p.point_name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

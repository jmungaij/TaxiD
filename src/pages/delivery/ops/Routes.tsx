import { useEffect, useMemo, useState } from "react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, Navigation, CheckCircle2, Clock } from "lucide-react";

interface Job {
  id: string;
  package_id: string;
  status: string;
  assigned_driver_id: string | null;
}
interface Segment {
  id: string;
  job_id: string;
  segment_index: number;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_m: number | null;
  duration_s: number | null;
}
interface Tracking {
  package_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
}
interface Eta {
  package_id: string;
  predicted_eta: string;
  confidence: number | null;
  created_at: string;
}

export default function RoutesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tracking, setTracking] = useState<Record<string, Tracking>>({});
  const [etas, setEtas] = useState<Record<string, Eta>>({});
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: jbs } = await supabase
      .from("delivery_dispatch_jobs")
      .select("id, package_id, status, assigned_driver_id")
      .in("status", ["assigned", "in_progress", "queued"])
      .order("created_at", { ascending: false })
      .limit(20);
    setJobs((jbs as Job[]) ?? []);
    const ids = (jbs ?? []).map((j: Job) => j.id);
    const pkgIds = (jbs ?? []).map((j: Job) => j.package_id);
    if (ids.length) {
      const { data: segs } = await supabase
        .from("delivery_route_segments")
        .select("*")
        .in("job_id", ids)
        .order("segment_index");
      setSegments((segs as Segment[]) ?? []);
    }
    if (pkgIds.length) {
      const [trk, eta] = await Promise.all([
        supabase
          .from("package_tracking")
          .select("package_id, lat, lng, recorded_at")
          .in("package_id", pkgIds)
          .order("recorded_at", { ascending: false })
          .limit(pkgIds.length * 5),
        supabase
          .from("delivery_eta_predictions")
          .select("package_id, predicted_eta, confidence, created_at")
          .in("package_id", pkgIds)
          .order("created_at", { ascending: false })
          .limit(pkgIds.length * 5),
      ]);
      const tmap: Record<string, Tracking> = {};
      (trk.data ?? []).forEach((t: Tracking) => {
        if (!tmap[t.package_id]) tmap[t.package_id] = t;
      });
      setTracking(tmap);
      const emap: Record<string, Eta> = {};
      (eta.data ?? []).forEach((e: Eta) => {
        if (!emap[e.package_id]) emap[e.package_id] = e;
      });
      setEtas(emap);
    }
  };

  useEffect(() => {
    load();
    // Realtime: refresh whenever segments, ETAs or tracking change
    const ch = supabase
      .channel("ops-routes")
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_route_segments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_eta_predictions" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "package_tracking" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const segsByJob = useMemo(() => {
    const m: Record<string, Segment[]> = {};
    segments.forEach((s) => (m[s.job_id] = m[s.job_id] ?? []).push(s));
    return m;
  }, [segments]);

  const seedRoute = async (job: Job) => {
    setBusy(true);
    // Naive 3-segment route from pickup → dropoff
    const { data: pkg } = await supabase
      .from("packages")
      .select("pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
      .eq("id", job.package_id)
      .maybeSingle();
    if (!pkg?.pickup_lat || !pkg?.dropoff_lat) {
      toast.error("Package missing coordinates");
      setBusy(false);
      return;
    }
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const pts = [0, 0.5, 1].map((t) => ({
      lat: lerp(pkg.pickup_lat as number, pkg.dropoff_lat as number, t),
      lng: lerp(pkg.pickup_lng as number, pkg.dropoff_lng as number, t),
    }));
    const segs = pts.slice(0, -1).map((p, i) => ({
      job_id: job.id,
      segment_index: i,
      start_lat: p.lat,
      start_lng: p.lng,
      end_lat: pts[i + 1].lat,
      end_lng: pts[i + 1].lng,
      distance_m: 1500,
      duration_s: 360,
    }));
    const { error } = await supabase.from("delivery_route_segments").insert(segs);
    if (error) toast.error(error.message);
    else toast.success("Route planned");
    setBusy(false);
    load();
  };

  const advanceTracking = async (job: Job, seg: Segment) => {
    if (!seg.end_lat || !seg.end_lng) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("package_tracking").insert({
      package_id: job.package_id,
      lat: seg.end_lat,
      lng: seg.end_lng,
      recorded_at: new Date().toISOString(),
    });
    await supabase.from("package_events").insert({
      package_id: job.package_id,
      event_type: "in_transit",
      actor_id: u.user?.id,
      location_lat: seg.end_lat,
      location_lng: seg.end_lng,
      notes: `Reached segment ${seg.segment_index + 1}`,
    });
    // Re-predict ETA
    const remaining = (segsByJob[job.id]?.length ?? 1) - (seg.segment_index + 1);
    await supabase.from("delivery_eta_predictions").insert({
      package_id: job.package_id,
      job_id: job.id,
      predicted_eta: new Date(Date.now() + remaining * 360_000).toISOString(),
      confidence: 0.78,
      model_version: "heuristic-v1",
      features: { remaining_segments: remaining },
    });
    toast.success("Tracking updated");
    setBusy(false);
    load();
  };

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Navigation className="h-7 w-7" /> Route Planner</h1>
          <p className="opacity-90 text-sm">Segments, live tracking and predicted ETAs.</p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-5xl space-y-4">
        {jobs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No active dispatch jobs.</Card>
        ) : (
          jobs.map((j) => {
            const segs = segsByJob[j.id] ?? [];
            const trk = tracking[j.package_id];
            const eta = etas[j.package_id];
            const reachedIndex = segs.findIndex((s) => trk && Math.abs((s.end_lat ?? 0) - trk.lat) < 0.0001 && Math.abs((s.end_lng ?? 0) - trk.lng) < 0.0001);
            return (
              <Card key={j.id} className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-medium">Job {j.id.slice(0, 8)} <Badge variant="outline" className="ml-2 capitalize">{j.status}</Badge></div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                      <span><MapPin className="inline h-3 w-3 mr-0.5" />{segs.length} segments</span>
                      {eta && <span><Clock className="inline h-3 w-3 mr-0.5" />ETA {new Date(eta.predicted_eta).toLocaleTimeString()} ({Math.round((eta.confidence ?? 0) * 100)}%)</span>}
                      {trk && <span>Last ping {new Date(trk.recorded_at).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                  {segs.length === 0 ? (
                    <Button size="sm" onClick={() => seedRoute(j)} disabled={busy}>Plan route</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setActive(active === j.id ? null : j.id)}>
                      {active === j.id ? "Hide segments" : "Show segments"}
                    </Button>
                  )}
                </div>

                {active === j.id && segs.length > 0 && (
                  <ol className="space-y-2">
                    {segs.map((s, i) => {
                      const done = reachedIndex >= 0 && i <= reachedIndex;
                      return (
                        <li key={s.id} className="flex items-center justify-between border rounded-md p-2">
                          <div className="flex items-center gap-3 text-sm">
                            <span className={`rounded-full h-6 w-6 inline-flex items-center justify-center text-xs ${done ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                              {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                            </span>
                            <span>
                              ({s.start_lat?.toFixed(4)}, {s.start_lng?.toFixed(4)}) → ({s.end_lat?.toFixed(4)}, {s.end_lng?.toFixed(4)})
                            </span>
                            <span className="text-xs text-muted-foreground">{(s.distance_m ?? 0)}m · {(s.duration_s ?? 0)}s</span>
                          </div>
                          {!done && (
                            <Button size="sm" variant="outline" onClick={() => advanceTracking(j, s)} disabled={busy}>
                              Mark reached
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>
            );
          })
        )}
      </section>
    </MarketingLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Truck, Trophy, Clock, Send } from "lucide-react";

interface Pkg {
  id: string;
  tracking_number: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  order_id: string | null;
}
interface Job {
  id: string;
  package_id: string;
  status: string;
  priority: number;
  sla_deadline: string | null;
  assigned_driver_id: string | null;
  created_at: string;
}
interface Candidate {
  id: string;
  driver_id: string;
  score: number;
  distance_km: number | null;
  eta_seconds: number | null;
}
interface Driver {
  id: string;
  first_name: string | null;
  last_name: string | null;
  driver_rating: number | null;
}

export default function Dispatch() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [candidatesByJob, setCandidatesByJob] = useState<Record<string, Candidate[]>>({});
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [priority, setPriority] = useState("3");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [pkgs, jbs, drv] = await Promise.all([
      supabase
        .from("packages")
        .select("id, tracking_number, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, order_id")
        .in("status", ["created", "accepted"])
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("delivery_dispatch_jobs")
        .select("id, package_id, status, priority, sla_deadline, assigned_driver_id, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("drivers").select("id, first_name, last_name, driver_rating").limit(20),
    ]);
    setPackages((pkgs.data as Pkg[]) ?? []);
    setJobs((jbs.data as Job[]) ?? []);
    setDrivers(((drv.data as unknown) as Driver[]) ?? []);

    const jobIds = (jbs.data ?? []).map((j: Job) => j.id);
    if (jobIds.length) {
      const { data } = await supabase
        .from("delivery_driver_candidates")
        .select("id, job_id, driver_id, score, distance_km, eta_seconds")
        .in("job_id", jobIds)
        .order("score", { ascending: false });
      const grouped: Record<string, Candidate[]> = {};
      (data ?? []).forEach((c: Candidate & { job_id: string }) => {
        (grouped[c.job_id] = grouped[c.job_id] ?? []).push(c);
      });
      setCandidatesByJob(grouped);
    } else {
      setCandidatesByJob({});
    }
  };

  useEffect(() => {
    load();
  }, []);

  const driverName = useMemo(() => {
    const m = new Map(
      drivers.map((d) => [d.id, [d.first_name, d.last_name].filter(Boolean).join(" ") || d.id.slice(0, 8)])
    );
    return (id: string) => m.get(id) ?? id.slice(0, 8);
  }, [drivers]);

  /** Naive ranking: random-but-deterministic seeded score per driver+job. Replace with GNN later. */
  const rankCandidates = (jobId: string, pkg: Pkg) => {
    return drivers.slice(0, 5).map((d) => {
      const distance_km = 0.5 + ((d.id.charCodeAt(0) % 30) + (pkg.tracking_number.length % 7)) / 4;
      const eta_seconds = Math.round((distance_km / 0.35) * 60); // ~21 km/h
      const rating = d.driver_rating ?? 4.5;
      const score = +(rating * 0.5 + (1 / Math.max(distance_km, 0.1)) * 4).toFixed(2);
      return { job_id: jobId, driver_id: d.id, score, distance_km, eta_seconds };
    });
  };

  const createJob = async (pkg: Pkg) => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const sla = new Date(Date.now() + 90 * 60_000).toISOString();
    const { data: job, error } = await supabase
      .from("delivery_dispatch_jobs")
      .insert({
        package_id: pkg.id,
        order_id: pkg.order_id,
        module: "package",
        status: "queued",
        priority: Number(priority),
        sla_deadline: sla,
        origin_lat: pkg.pickup_lat,
        origin_lng: pkg.pickup_lng,
        destination_lat: pkg.dropoff_lat,
        destination_lng: pkg.dropoff_lng,
      })
      .select("id")
      .single();
    if (error || !job) {
      toast.error(error?.message ?? "Failed to create job");
      setBusy(false);
      return;
    }
    const ranked = rankCandidates(job.id, pkg);
    if (ranked.length) {
      await supabase.from("delivery_driver_candidates").insert(ranked);
    }
    // ETA prediction
    const bestEta = ranked[0]?.eta_seconds ?? 1800;
    await supabase.from("delivery_eta_predictions").insert({
      package_id: pkg.id,
      job_id: job.id,
      predicted_eta: new Date(Date.now() + bestEta * 1000).toISOString(),
      confidence: 0.72,
      model_version: "heuristic-v1",
      features: { distance_km: ranked[0]?.distance_km ?? null },
    });
    await supabase.from("package_events").insert({
      package_id: pkg.id,
      event_type: "dispatched",
      actor_id: u.user?.id,
      notes: `Dispatch job created (priority ${priority})`,
      metadata: { job_id: job.id },
    });
    toast.success("Dispatch job created");
    setBusy(false);
    load();
  };

  const assignDriver = async (job: Job, candidate: Candidate) => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("delivery_dispatch_jobs")
      .update({ status: "assigned", assigned_driver_id: candidate.driver_id, last_attempt_at: new Date().toISOString() })
      .eq("id", job.id);
    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }
    await supabase.from("delivery_assignment_queue").insert({
      job_id: job.id,
      driver_id: candidate.driver_id,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await supabase
      .from("packages")
      .update({ assigned_driver_id: candidate.driver_id, status: "accepted" })
      .eq("id", job.package_id);
    await supabase.from("package_events").insert({
      package_id: job.package_id,
      event_type: "assigned",
      actor_id: u.user?.id,
      notes: `Assigned to ${driverName(candidate.driver_id)} (score ${candidate.score})`,
      metadata: { driver_id: candidate.driver_id, job_id: job.id },
    });
    toast.success("Driver assigned");
    setBusy(false);
    load();
  };

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Truck className="h-7 w-7" /> Dispatch Console</h1>
          <p className="opacity-90 text-sm">Queue, rank candidates and assign drivers with ETA predictions.</p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-6xl grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Unassigned packages</h2>
          <div className="flex items-end gap-2 mb-3">
            <div className="flex-1">
              <Label className="text-xs">New job priority (1–5)</Label>
              <Input type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No packages waiting for dispatch.</p>
          ) : (
            <div className="space-y-2">
              {packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <div className="font-mono text-sm">{p.tracking_number}</div>
                    <div className="text-xs text-muted-foreground capitalize">{p.status.replace("_", " ")}</div>
                  </div>
                  <Button size="sm" onClick={() => createJob(p)} disabled={busy}>
                    <Send className="h-4 w-4 mr-1" /> Create job
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Dispatch jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => {
                const open = selectedJob === j.id;
                const cands = candidatesByJob[j.id] ?? [];
                return (
                  <div key={j.id} className="border rounded-md">
                    <button
                      onClick={() => setSelectedJob(open ? null : j.id)}
                      className="w-full p-3 text-left flex items-center justify-between hover:bg-muted/40"
                    >
                      <div>
                        <div className="text-sm font-medium">Job {j.id.slice(0, 8)}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Badge variant="outline">P{j.priority}</Badge>
                          <span className="capitalize">{j.status}</span>
                          {j.sla_deadline && <span><Clock className="inline h-3 w-3 mr-0.5" />SLA {new Date(j.sla_deadline).toLocaleTimeString()}</span>}
                          {j.assigned_driver_id && <span>→ {driverName(j.assigned_driver_id)}</span>}
                        </div>
                      </div>
                      <Badge>{cands.length} candidates</Badge>
                    </button>
                    {open && (
                      <div className="border-t p-3 space-y-2">
                        {cands.length === 0 && <p className="text-xs text-muted-foreground">No candidates ranked.</p>}
                        {cands.map((c, i) => (
                          <div key={c.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              {i === 0 && <Trophy className="h-4 w-4 text-status-warning" />}
                              <span>{driverName(c.driver_id)}</span>
                              <span className="text-xs text-muted-foreground">
                                · score {c.score} · {c.distance_km?.toFixed(1)} km · ETA {Math.round((c.eta_seconds ?? 0) / 60)}m
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant={j.assigned_driver_id === c.driver_id ? "secondary" : "outline"}
                              disabled={busy || j.status !== "queued"}
                              onClick={() => assignDriver(j, c)}
                            >
                              {j.assigned_driver_id === c.driver_id ? "Assigned" : "Assign"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </MarketingLayout>
  );
}
